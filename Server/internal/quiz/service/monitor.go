package service

import (
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"gorm.io/gorm"
	mainmodel "xbt2/server/internal/model"
	"xbt2/server/internal/quiz/model"
	svc "xbt2/server/internal/service"
	"xbt2/server/internal/xxt"
)

// MonitorEvent SSE 实时事件
type MonitorEvent struct {
	Type       string `json:"type"`                 // detected / answered / status
	ActivityID int64  `json:"activity_id,omitempty"`
	Name       string `json:"name,omitempty"`
	CourseName string `json:"course_name,omitempty"`
	Success    bool   `json:"success,omitempty"`
	Message    string `json:"message,omitempty"`
	Elapsed    int64  `json:"elapsed,omitempty"`    // 抢答耗时(毫秒)
	Running    bool   `json:"running,omitempty"`
	Timestamp  int64  `json:"timestamp"`
}

type subscriber struct {
	ch chan MonitorEvent
}

type QuizMonitorService struct {
	db          *gorm.DB
	xxtClient   *xxt.Client
	cc          *svc.CredentialCrypto
	monitors    map[int64]*MonitorInstance
	mu          sync.RWMutex
	subscribers map[int64][]*subscriber // userUID → 订阅者列表
	subMu       sync.RWMutex
}

type MonitorInstance struct {
	muAnswered       sync.Mutex // 保护 answered map 并发访问
	UserUID          int64
	Config           *model.QuizConfig
	Running          bool
	StopChan         chan struct{}
	stopOnce         sync.Once   // 确保 StopChan 只关闭一次
	answered         map[int64]bool
	cachedMobile     string      // 缓存的用户名，避免每次轮询查库
	cachedPassword   string      // 缓存的密码，避免每次轮询解密
	cachedCourseName string      // 缓存的课程名，避免每次轮询查库
	activeMode       bool        // 活跃模式：发现活动后进入高频轮询
	idleStreak       int         // 连续空闲次数，用于动态降频
	turboMode        bool        // 极速模式：有待开始活动即将启动（预判预热）
	lastAnswerTime   int64       // 上次抢答成功时间戳（毫秒），用于保持活跃期
	pendingActivities map[int64]*pendingActInfo // 待开始活动: activeID → 活动信息
}

// pendingActInfo 预判预热的活动信息
type pendingActInfo struct {
	StartTime int64  // 活动开始时间（毫秒时间戳）
	Name      string // 活动名称
}

func NewQuizMonitorService(db *gorm.DB, xxtClient *xxt.Client, cc *svc.CredentialCrypto) *QuizMonitorService {
	return &QuizMonitorService{
		db:          db,
		xxtClient:   xxtClient,
		cc:          cc,
		monitors:    make(map[int64]*MonitorInstance),
		subscribers: make(map[int64][]*subscriber),
	}
}

func (s *QuizMonitorService) StartMonitor(userUID int64, courseID, classID int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// 安全停止旧实例（如果存在）
	if existing, exists := s.monitors[userUID]; exists {
		existing.safeStop()
		delete(s.monitors, userUID)
	}

	config := &model.QuizConfig{}
	if err := s.db.Where("user_uid = ?", userUID).First(config).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			config = &model.QuizConfig{
				UserUID:    userUID,
				Enabled:    true,
				AutoAnswer: true,
				DelayMs:    0,
				CourseID:   courseID,
				ClassID:    classID,
			}
			s.db.Create(config)
		} else {
			return err
		}
	} else {
		if courseID > 0 {
			config.CourseID = courseID
		}
		if classID > 0 {
			config.ClassID = classID
		}
		s.db.Save(config)
	}

	// 清空抢答缓存，避免旧会话的风控退避状态影响新监控
	s.xxtClient.ResetQuizCache(config.CourseID, config.ClassID)

	answered := s.loadAnsweredFromDB(userUID, config.CourseID, config.ClassID)

	instance := &MonitorInstance{
		UserUID:           userUID,
		Config:            config,
		Running:           true,
		StopChan:          make(chan struct{}),
		answered:          answered,
		pendingActivities: make(map[int64]*pendingActInfo),
	}
	// 预热凭证缓存（避免每次轮询都查库+解密）
	var user mainmodel.User
	if err := s.db.Where("uid = ?", userUID).First(&user).Error; err == nil {
		if password, err := s.cc.Decrypt(user.CredentialCipher); err == nil {
			instance.cachedMobile = user.Mobile
			instance.cachedPassword = password
		}
	}

	s.monitors[userUID] = instance
	go s.runMonitor(instance)

	// 实时广播：监控已启动
	s.broadcast(userUID, MonitorEvent{
		Type:    EventStatus,
		Running: true,
		Message: "监控已启动",
	})

	return nil
}

// safeStop 安全停止 MonitorInstance，避免重复关闭 StopChan
func (m *MonitorInstance) safeStop() {
	m.stopOnce.Do(func() {
		close(m.StopChan)
		m.Running = false
	})
}

func (s *QuizMonitorService) loadAnsweredFromDB(userUID, courseID, classID int64) map[int64]bool {
	result := make(map[int64]bool)
	var activities []model.QuizActivity
	s.db.Where("user_uid = ? AND course_id = ? AND class_id = ?",
		userUID, courseID, classID).Find(&activities)
	for _, a := range activities {
		result[a.ActivityID] = true
	}
	var records []model.QuizRecord
	s.db.Where("user_uid = ? AND activity_id IN (SELECT activity_id FROM quiz_activities WHERE user_uid = ? AND course_id = ? AND class_id = ?)",
		userUID, userUID, courseID, classID).Find(&records)
	for _, r := range records {
		result[r.ActivityID] = true
	}
	return result
}

func (s *QuizMonitorService) StopMonitor(userUID int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if instance, exists := s.monitors[userUID]; exists {
		instance.safeStop()
		delete(s.monitors, userUID)

		// 实时广播：监控已停止
		s.broadcast(userUID, MonitorEvent{
			Type:    EventStatus,
			Running: false,
			Message: "监控已停止",
		})
	}
}

func (s *QuizMonitorService) GetMonitorStatus(userUID int64) *model.QuizMonitorStatus {
	s.mu.RLock()
	defer s.mu.RUnlock()
	instance, exists := s.monitors[userUID]
	status := &model.QuizMonitorStatus{
		UserUID:   userUID,
		IsRunning: exists && instance.Running,
		Connected: exists && instance.Running,
	}
	if exists {
		status.ActivityCount = len(instance.answered)
	}
	return status
}

// 事件类型常量
const (
	EventDetected = "detected" // 发现抢答活动
	EventAnswered = "answered" // 抢答结果
	EventStatus   = "status"   // 监控状态变更
)

// Subscribe 订阅实时事件，返回事件通道和取消函数
func (s *QuizMonitorService) Subscribe(userUID int64) (<-chan MonitorEvent, func()) {
	s.subMu.Lock()
	defer s.subMu.Unlock()
	sub := &subscriber{ch: make(chan MonitorEvent, 32)}
	s.subscribers[userUID] = append(s.subscribers[userUID], sub)
	cancel := func() {
		s.subMu.Lock()
		defer s.subMu.Unlock()
		subs := s.subscribers[userUID]
		for i, sb := range subs {
			if sb == sub {
				s.subscribers[userUID] = append(subs[:i], subs[i+1:]...)
				close(sb.ch)
				return
			}
		}
	}
	return sub.ch, cancel
}

func (s *QuizMonitorService) broadcast(userUID int64, evt MonitorEvent) {
	evt.Timestamp = time.Now().UnixMilli()
	// SSE 通道（内存 channel）
	s.subMu.RLock()
	for _, sub := range s.subscribers[userUID] {
		select {
		case sub.ch <- evt:
		default:
			// 订阅者消费太慢，丢弃事件（非阻塞）
		}
	}
	s.subMu.RUnlock()
	// WebSocket 通道（前端直连）
	switch evt.Type {
	case EventDetected:
		BroadcastQuizActivity(userUID, evt)
	case EventAnswered:
		BroadcastQuizRecord(userUID, evt)
	}
}

func (s *QuizMonitorService) runMonitor(instance *MonitorInstance) {
	// 立刻执行首次检测
	s.pollAndAnswer(instance)

	// 自适应轮询间隔：极速 200ms / 活跃 200ms / 空闲逐步放松到 2s
	pollInterval := 100 * time.Millisecond
	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-instance.StopChan:
			return
		case <-ticker.C:
			if !instance.Config.Enabled {
				continue
			}
			s.pollAndAnswer(instance)

			// 动态调整轮询间隔
			// 抢答后保持 30s 高频轮询（100ms），确保后续抢答也能快速检测
			now := time.Now().UnixMilli()
			answerCooldown := instance.lastAnswerTime > 0 && (now - instance.lastAnswerTime) < 30000
			
			switch {
			case instance.turboMode:
				if pollInterval != 100*time.Millisecond {
					pollInterval = 100 * time.Millisecond
					ticker.Reset(pollInterval)
				}
			case instance.activeMode || answerCooldown:
				if pollInterval != 100*time.Millisecond {
					pollInterval = 100 * time.Millisecond
					ticker.Reset(pollInterval)
				}
				instance.idleStreak++
				// 仅在超出冷却期后才允许降频
				if !answerCooldown && instance.idleStreak > 300 {
					instance.activeMode = false
					instance.idleStreak = 0
				}
			default:
				instance.idleStreak++
				if instance.idleStreak > 25 && pollInterval != 1000*time.Millisecond {
					pollInterval = 1000 * time.Millisecond
					ticker.Reset(pollInterval)
				} else if instance.idleStreak > 150 && pollInterval != 2000*time.Millisecond {
					pollInterval = 2000 * time.Millisecond
					ticker.Reset(pollInterval)
				}
			}
		}
	}
}

func (s *QuizMonitorService) pollAndAnswer(instance *MonitorInstance) {
	cfg := instance.Config
	if cfg.CourseID == 0 || cfg.ClassID == 0 {
		return
	}

	courseName := s.lookupCourseName(instance)

	// 优先使用缓存凭证
	mobile := instance.cachedMobile
	password := instance.cachedPassword
	if mobile == "" {
		var user mainmodel.User
		if err := s.db.Where("uid = ?", instance.UserUID).First(&user).Error; err != nil {
			return
		}
		var err error
		password, err = s.cc.Decrypt(user.CredentialCipher)
		if err != nil {
			return
		}
		mobile = user.Mobile
		instance.cachedMobile = mobile
		instance.cachedPassword = password
	}

	actives, err := s.xxtClient.GetActivesAllFast(mobile, password, cfg.CourseID, cfg.ClassID)
	if err != nil {
		return
	}

	for _, act := range actives {
		instance.muAnswered.Lock()
		alreadyAnswered := instance.answered[act.ActiveID]
		instance.muAnswered.Unlock()
		if alreadyAnswered {
			continue
		}

		// 预热队列：检测到待开始活动(status=0)，加入预判列表
		if act.Status == 0 && act.StartTime > time.Now().UnixMilli() {
			instance.pendingActivities[act.ActiveID] = &pendingActInfo{StartTime: act.StartTime, Name: act.Name}
			log.Printf("[QuizMonitor] 📋 待开始活动: uid=%d active=%d name=%s start=%d",
				instance.UserUID, act.ActiveID, act.Name, act.StartTime)
			continue
		}
		// 活动已开始/结束 → 从预热队列移除
		delete(instance.pendingActivities, act.ActiveID)


		// 跳过已结束的活动（Status=2 或 endTime 已过），避免浪费 API 资源
		if act.Status == 2 || (act.EndTime > 0 && act.EndTime < time.Now().UnixMilli()) {
			instance.muAnswered.Lock()
			instance.answered[act.ActiveID] = true
			instance.muAnswered.Unlock()
			continue
		}
		name := strings.ToLower(act.Name)
		isQuiz := strings.Contains(name, "抢答") ||
			strings.Contains(name, "问答") ||
			strings.Contains(name, "测验") ||
			strings.Contains(name, "互动")

		if !isQuiz {
			continue
		}

		// 标记为已发现
		instance.muAnswered.Lock()
		instance.answered[act.ActiveID] = true
		instance.muAnswered.Unlock()
		instance.activeMode = true
		instance.idleStreak = 0

		log.Printf("[QuizMonitor] 发现抢答: uid=%d active=%d name=%s",
			instance.UserUID, act.ActiveID, act.Name)

		// 实时广播：发现抢答活动
		s.broadcast(instance.UserUID, MonitorEvent{
			Type:       EventDetected,
			ActivityID: act.ActiveID,
			Name:       act.Name,
			CourseName: courseName,
			Message:    fmt.Sprintf("%d,%d,%d", act.StartTime, act.EndTime, act.Status),
		})

		// 异步保存记录 + 抢答（DB 操作移出轮询路径，减少检测→抢答延迟）
		if cfg.AutoAnswer {
			go s.autoAnswerWithSave(instance, mobile, password, cfg, act, courseName)
		}
	}

	// 预热队列检查：是否有活动即将在 3 秒内开始 → 极速模式
	now := time.Now().UnixMilli()
	instance.turboMode = false
	for aid, info := range instance.pendingActivities {
		if info.StartTime > 0 && info.StartTime-now < 3000 && info.StartTime > now {
			instance.turboMode = true
			if info.StartTime-now < 30 {
				go s.speculativeAnswer(instance, mobile, password, cfg, aid, info.StartTime, info.Name, courseName)
				delete(instance.pendingActivities, aid)
			}
			break
		}
		if info.StartTime > 0 && now-info.StartTime > 30000 {
			delete(instance.pendingActivities, aid)
		}
	}
}

func (s *QuizMonitorService) autoAnswer(instance *MonitorInstance, mobile string, password string, cfg *model.QuizConfig, act xxt.Active) {
	if cfg.DelayMs > 0 {
		time.Sleep(time.Duration(cfg.DelayMs) * time.Millisecond)
	}

	var result string
	var err error
	var elapsed int64
	maxRetries := 2

	for retry := 0; retry <= maxRetries; retry++ {
		if retry > 0 {
			log.Printf("[QuizMonitor] 🔄 重试抢答(%d/%d): uid=%d active=%d elapsed=%dms err=%v",
				retry, maxRetries, instance.UserUID, act.ActiveID, elapsed, err)
			time.Sleep(100 * time.Millisecond)
		}
		answerStart := time.Now()
		result, err = s.xxtClient.QuickAnswer(mobile, password, cfg.CourseID, cfg.ClassID, act.ActiveID)
		elapsed = time.Since(answerStart).Milliseconds()
		if err == nil && isFinalResult(result) {
			break
		}
	}

	if err != nil {
		log.Printf("[QuizMonitor] ❌ 抢答异常(重试后): uid=%d active=%d err=%v elapsed=%dms", instance.UserUID, act.ActiveID, err, elapsed)
		s.broadcast(instance.UserUID, MonitorEvent{
			Type:       EventAnswered,
			ActivityID: act.ActiveID,
			Name:       act.Name,
			Success:    false,
			Message:    "请求异常: " + err.Error(),
			Elapsed:    elapsed,
		})
		s.saveRecord(instance.UserUID, act.ActiveID, false, "请求异常: "+err.Error())
		return
	}

	isSuccess, msg, isFinal := parseQuickAnswerResult(result)

	s.broadcast(instance.UserUID, MonitorEvent{
		Type:       EventAnswered,
		ActivityID: act.ActiveID,
		Name:       act.Name,
		Success:    isSuccess,
		Message:    msg,
		Elapsed:    elapsed,
	})

	if isSuccess {
		instance.lastAnswerTime = time.Now().UnixMilli()
		log.Printf("[QuizMonitor] ✅ 抢答成功: uid=%d active=%d msg=%s elapsed=%dms raw=%s",
			instance.UserUID, act.ActiveID, msg, elapsed, truncate(result, 200))
	} else if isFinal {
		log.Printf("[QuizMonitor] ⏭ 跳过(终态): uid=%d active=%d msg=%s raw=%s",
			instance.UserUID, act.ActiveID, msg, truncate(result, 200))
	} else {
		log.Printf("[QuizMonitor] ❌ 抢答失败: uid=%d active=%d msg=%s elapsed=%dms raw=%s",
			instance.UserUID, act.ActiveID, msg, elapsed, truncate(result, 200))
	}

	s.saveRecord(instance.UserUID, act.ActiveID, isSuccess, msg)
}

// autoAnswerWithSave 异步保存活动记录 + 抢答（DB 操作从轮询路径移出）
func (s *QuizMonitorService) autoAnswerWithSave(instance *MonitorInstance, mobile string, password string, cfg *model.QuizConfig, act xxt.Active, courseName string) {
	// 先保存活动记录（异步，不阻塞轮询）
	activity := &model.QuizActivity{
		UserUID:    instance.UserUID,
		ActivityID: act.ActiveID,
		CourseID:   cfg.CourseID,
		ClassID:    cfg.ClassID,
		CourseName: courseName,
		Title:      act.Name,
		StartTime:  act.StartTime,
		EndTime:    act.EndTime,
		Status:     act.Status,
		AutoAnswer: cfg.AutoAnswer,
	}
	s.db.Where("activity_id = ? AND user_uid = ?", act.ActiveID, instance.UserUID).
		FirstOrCreate(activity)

	// 执行抢答
	s.autoAnswer(instance, mobile, password, cfg, act)
}

// isFinalResult 快速判断 QuickAnswer 返回是否已到终态（用于自动重试判断）
func isFinalResult(rawResult string) bool {
	if rawResult == "" {
		return false
	}
	lower := strings.ToLower(rawResult)
	return strings.Contains(lower, "已过期") ||
		strings.Contains(lower, "已结束") ||
		strings.Contains(lower, "学生已抢答") ||
		strings.Contains(lower, "已抢答") ||
		strings.Contains(lower, "人数已达上限") ||
		strings.Contains(lower, "已达上限") ||
		strings.Contains(rawResult, `"result":1`)
}

// parseQuickAnswerResult 解析 QuickAnswer 返回值，返回 (是否成功, 消息文本)
func parseQuickAnswerResult(rawResult string) (isSuccess bool, msg string, isFinal bool) {
	isSuccess = false
	msg = rawResult

	var res struct {
		Result   int             `json:"result"`
		Msg      string          `json:"msg"`
		ErrorMsg string          `json:"errorMsg"`
		Data     json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal([]byte(rawResult), &res); err == nil {
		if res.ErrorMsg != "" {
			msg = res.ErrorMsg
		} else if res.Msg != "" {
			msg = res.Msg
		}
		if res.Result == 1 {
			if string(res.Data) == "1" {
				msg = "抢答人数已达上限"
			} else {
				isSuccess = true
			}
		}
	} else {
		lower := strings.ToLower(rawResult)
		isSuccess = strings.Contains(lower, "抢答成功") || strings.Contains(lower, "success") || strings.Contains(rawResult, `"result":1`)
	}

	lowerMsg := strings.ToLower(msg)
	isFinal = isSuccess ||
		strings.Contains(lowerMsg, "已过期") ||
		strings.Contains(lowerMsg, "已结束") ||
		strings.Contains(lowerMsg, "学生已抢答") ||
		strings.Contains(lowerMsg, "已抢答") ||
		strings.Contains(lowerMsg, "人数已达上限") ||
		strings.Contains(lowerMsg, "已达上限")
	return
}

// saveRecord 保存抢答记录到数据库
func (s *QuizMonitorService) saveRecord(userUID, activityID int64, success bool, msg string) {
	rec := &model.QuizRecord{
		UserUID:    userUID,
		ActivityID: activityID,
		Success:    success,
		Message:    msg,
	}
	s.db.Create(rec)
}

// speculativeAnswer 预发抢答
func (s *QuizMonitorService) speculativeAnswer(instance *MonitorInstance, mobile, password string, cfg *model.QuizConfig, activeID int64, startTime int64, name, courseName string) {
	delay := startTime - time.Now().UnixMilli()
	if delay > 30 {
		return
	}

	log.Printf("[QuizMonitor] 🚀 预发抢答: uid=%d active=%d name=%s", instance.UserUID, activeID, name)

	for attempt := 0; attempt < 25; attempt++ {
		if !instance.Running {
			return
		}
		if instance.isAnswered(activeID) {
			return
		}

		result, err := s.xxtClient.QuickAnswer(mobile, password, cfg.CourseID, cfg.ClassID, activeID)
		if err != nil {
			time.Sleep(100 * time.Millisecond)
			continue
		}

		isSuccess, msg, isFinal := parseQuickAnswerResult(result)

		if isSuccess || isFinal {
			if !instance.isAnswered(activeID) {
				instance.markAnswered(activeID)
				s.broadcast(instance.UserUID, MonitorEvent{
					Type:       EventDetected,
					ActivityID: activeID,
					Name:       name,
					CourseName: courseName,
					Message:    fmt.Sprintf("%d,%d,%d", 0, 0, 1),
				})
				s.broadcast(instance.UserUID, MonitorEvent{
					Type:       EventAnswered,
					ActivityID: activeID,
					Name:       name,
					CourseName: courseName,
					Success:    isSuccess,
					Message:    msg,
					Elapsed:    time.Now().UnixMilli() - startTime,
				})
				s.saveRecord(instance.UserUID, activeID, isSuccess, msg)
				if isSuccess {
					instance.lastAnswerTime = time.Now().UnixMilli()
					log.Printf("[QuizMonitor] ✅ 预发抢答成功: uid=%d active=%d msg=%s", instance.UserUID, activeID, msg)
				} else {
					log.Printf("[QuizMonitor] ⏭ 预发抢答终态: uid=%d active=%d msg=%s", instance.UserUID, activeID, msg)
				}
			}
			return
		}

		time.Sleep(100 * time.Millisecond)
	}
}

func (s *QuizMonitorService) lookupCourseName(instance *MonitorInstance) string {
	if instance.cachedCourseName != "" {
		return instance.cachedCourseName
	}
	var course mainmodel.Course
	if err := s.db.Where("course_id = ? AND class_id = ?",
		instance.Config.CourseID, instance.Config.ClassID).
		First(&course).Error; err == nil {
		instance.cachedCourseName = course.Name
		return course.Name
	}
	return ""
}

func (s *QuizMonitorService) GetConfig(userUID int64) (*model.QuizConfig, error) {
	config := &model.QuizConfig{}
	err := s.db.Where("user_uid = ?", userUID).First(config).Error
	if err == gorm.ErrRecordNotFound {
		return &model.QuizConfig{
			UserUID:    userUID,
			Enabled:    false,
			AutoAnswer: true,
			DelayMs:    0,
			WSEnabled:  true,
		}, nil
	}
	return config, err
}

func (s *QuizMonitorService) UpdateConfig(userUID int64, config *model.QuizConfig) error {
	existing := &model.QuizConfig{}
	err := s.db.Where("user_uid = ?", userUID).First(existing).Error
	if err == gorm.ErrRecordNotFound {
		config.UserUID = userUID
		return s.db.Create(config).Error
	}
	existing.Enabled = config.Enabled
	existing.AutoAnswer = config.AutoAnswer
	existing.DelayMs = config.DelayMs
	existing.WSEnabled = config.WSEnabled
	if config.WSUrl != "" {
		existing.WSUrl = config.WSUrl
	}
	if config.CourseID > 0 {
		existing.CourseID = config.CourseID
	}
	if config.ClassID > 0 {
		existing.ClassID = config.ClassID
	}
	if config.MonitorCourses != "" {
		existing.MonitorCourses = config.MonitorCourses
	}
	return s.db.Save(existing).Error
}

func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}

// isAnswered 并发安全地检查活动是否已处理
func (m *MonitorInstance) isAnswered(activeID int64) bool {
	m.muAnswered.Lock()
	defer m.muAnswered.Unlock()
	return m.answered[activeID]
}

// markAnswered 并发安全地标记活动为已处理
func (m *MonitorInstance) markAnswered(activeID int64) {
	m.muAnswered.Lock()
	m.answered[activeID] = true
	m.muAnswered.Unlock()
}

func ParseMonitorCourses(coursesJSON string) []int64 {
	if coursesJSON == "" {
		return []int64{}
	}
	var courses []int64
	if err := json.Unmarshal([]byte(coursesJSON), &courses); err != nil {
		return []int64{}
	}
	return courses
}
