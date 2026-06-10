package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"strings"
	"sync"
	"time"

	"gorm.io/gorm"
	mainmodel "xbt2/server/internal/model"
	"xbt2/server/internal/quiz/model"
	svc "xbt2/server/internal/service"
	"xbt2/server/internal/xxt"
)

// ================= 事件推送（保留用于 WS/SSE 结果推送） =================

// MonitorEvent 抢答事件
type MonitorEvent struct {
	Type       string `json:"type"`
	ActivityID int64  `json:"activity_id,omitempty"`
	Name       string `json:"name,omitempty"`
	CourseName string `json:"course_name,omitempty"`
	Success    bool   `json:"success,omitempty"`
	Message    string `json:"message,omitempty"`
	Elapsed    int64  `json:"elapsed,omitempty"`
	Running    bool   `json:"running,omitempty"`
	Timestamp  int64  `json:"timestamp"`
}

const (
	EventDetected = "detected"
	EventAnswered = "answered"
	EventStatus   = "status"
	EventWarning  = "warning"
)

type subscriber struct {
	ch chan MonitorEvent
}

// CoursePair 课程-班级对
type CoursePair struct {
	CourseID int64 `json:"course_id"`
	ClassID  int64 `json:"class_id"`
}

// ================= 核心服务 =================

// QuizService 抢答服务（手动模式）
type QuizService struct {
	db          *gorm.DB
	xxtClient   *xxt.Client
	cc          *svc.CredentialCrypto
	courseCache *svc.CourseCache

	subscribers map[int64][]*subscriber
	subMu       sync.RWMutex

	// 用户上下文缓存（凭证 + 风控状态）
	userCache map[int64]*UserContext
	cacheMu   sync.RWMutex

	// 活动防重锁: key="userUID:activityID"
	answering   map[string]bool
	answeringMu sync.Mutex
// 一键抢答 10s 防重复提交
	oneClickCooldowns   map[int64]time.Time // userUID â cooldown until
	oneClickCooldownsMu sync.Mutex

	// Monitor is the auto-detect and answer monitor
	Monitor *QuizMonitor
}

// UserContext 用户运行时上下文
type UserContext struct {
	cachedMobile        string
	cachedPassword      string
	config              *model.QuizConfig
	backoffStrategy     *BackoffStrategy
	backoffUntil        time.Time
	pausedUntil         time.Time
	consecutiveFailures int
	sessionCheckedAt    time.Time // 上次 session 有效性检查时间（防重复检查）
}

// AnswerResult 一键抢答结果
type AnswerResult struct {
	Success    bool   `json:"success"`
	Message    string `json:"message"`
	ElapsedMs  int64  `json:"elapsed_ms"`
	ActivityID int64  `json:"activity_id"`
}

// BatchAnswerResult æ¹éæ¢ç­æ±æ»ç»æ
type BatchAnswerResult struct {
	Total   int             `json:"total"`    // æ£æµå°çæ´»å¨æ»æ°
	Success int             `json:"success"`  // æåæ°
	Failed  int             `json:"failed"`   // å¤±è´¥æ°
	Skipped int             `json:"skipped"`  // è·³è¿æ°ï¼å·²æ¢ç­/å·²ç»æï¼
	Details []*AnswerResult  `json:"details"`  // æ¯ä¸ªæ´»å¨çè¯¦ç»ç»æ
	Elapsed int64            `json:"elapsed_ms"` // æ»èæ¶
}

// NewQuizService 创建抢答服务
func NewQuizService(db *gorm.DB, xxtClient *xxt.Client, cc *svc.CredentialCrypto, courseCache *svc.CourseCache) *QuizService {
	svc := &QuizService{
		db:          db,
		xxtClient:   xxtClient,
		cc:          cc,
		courseCache: courseCache,
		subscribers: make(map[int64][]*subscriber),
		userCache:   make(map[int64]*UserContext),
		answering:          make(map[string]bool),
		oneClickCooldowns: make(map[int64]time.Time),
	}
	svc.Monitor = NewQuizMonitor(svc, xxtClient)
	return svc
}

// ================= 一键抢答 =================

// ManualQuickAnswer 手动一键抢答
// shortDelay: delayMs ≤ 1000ms 时同步执行，返回完整结果
// longDelay:  delayMs > 1000ms 时异步执行，返回"已触发"状态，通过 WS/SSE 推送结果
func (s *QuizService) ManualQuickAnswer(cctx context.Context, userUID int64, activeID, courseID, classID int64) (*AnswerResult, error) {
	// 1. 防重锁：同一用户同一活动只能抢答一次
	lockKey := fmt.Sprintf("%d:%d", userUID, activeID)
	s.answeringMu.Lock()
	if s.answering[lockKey] {
		s.answeringMu.Unlock()
		return nil, fmt.Errorf("该活动正在抢答中，请勿重复操作")
	}
	s.answering[lockKey] = true
	s.answeringMu.Unlock()
	defer func() {
		s.answeringMu.Lock()
		delete(s.answering, lockKey)
		s.answeringMu.Unlock()
	}()

	// 2. 获取用户配置和凭证
	userCtx := s.ensureUserContext(userUID)
	if userCtx == nil {
		return nil, fmt.Errorf("获取用户信息失败")
	}
	if userCtx.config.CourseID == 0 || userCtx.config.ClassID == 0 {
		return nil, fmt.Errorf("请先在设置中配置课程")
	}

	// 3. 检查风控暂停
	userCtx = s.ensureUserContext(userUID) // 刷新
	if userCtx.pausedUntil.After(time.Now()) {
		return nil, fmt.Errorf("请等待风控冷却结束后再试（剩余 %.0fs）",
			userCtx.pausedUntil.Sub(time.Now()).Seconds())
	}

	// 4. 检查退避
	if userCtx.backoffUntil.After(time.Now()) {
		return nil, fmt.Errorf("操作过于频繁，请稍后再试")
	}

	// 5. 检查活动状态 & 处理等待学生就位模式
	prepResult, prepErr := s.checkAndPrepareActivity(cctx, userCtx, userUID, activeID, courseID, classID)
	if prepErr != nil {
		return nil, prepErr
	}
	if prepResult != nil {
		return prepResult, nil
	}

	// 6. 执行抢答
	delayMs := userCtx.config.DelayMs

	// 长延迟 → 异步
	if delayMs > 1000 {
		go s.runDelayedAnswer(userCtx, userUID, activeID, courseID, classID, delayMs)
		return &AnswerResult{
			Success:    true,
			Message:    fmt.Sprintf("抢答已触发（延迟 %dms），结果将通过实时推送通知", delayMs),
			ActivityID: activeID,
		}, nil
	}

	// 短延迟 → 同步
	return s.executeAnswer(cctx, userCtx, userUID, activeID, courseID, classID, delayMs)
}

// runDelayedAnswer 异步执行带延迟的抢答
func (s *QuizService) runDelayedAnswer(userCtx *UserContext, userUID, activeID, courseID, classID int64, delayMs int) {
	// 异步执行创建新的可取消上下文
	runCtx, cancel := context.WithCancel(context.Background())
	defer cancel()
	// 等待延迟时间
	if delayMs > 0 {
		jitter := rand.Intn(100)
		time.Sleep(time.Duration(delayMs+jitter) * time.Millisecond)
	}

	_, err := s.executeAnswer(runCtx, userCtx, userUID, activeID, courseID, classID, 0)
	if err != nil {
		log.Printf("[Quiz] 异步抢答失败: uid=%d active=%d err=%v", userUID, activeID, err)
		s.broadcast(userUID, MonitorEvent{
			Type:       EventAnswered,
			ActivityID: activeID,
			Success:    false,
			Message:    err.Error(),
			Elapsed:    0,
		})
	}
}

// executeAnswer 执行单次抢答（含延迟、重试、风控）
func (s *QuizService) executeAnswer(cctx context.Context, userCtx *UserContext, userUID, activeID, courseID, classID int64, delayMs int) (*AnswerResult, error) {
	// 延迟等待（异步调用时 delayMs=0，因为已在 runDelayedAnswer 中等过）
	if delayMs > 0 {
		jitter := rand.Intn(100)
		time.Sleep(time.Duration(delayMs+jitter) * time.Millisecond)
	}

	// 执行抢答前检查 session 有效性，过期自动续期
	if !s.ensureSessionValid(userUID, userCtx) {
		return nil, fmt.Errorf("登录凭证已失效，无法执行抢答")
	}

	var lastResult *AnswerResult
	maxRetries := 2

	for retry := 0; retry <= maxRetries; retry++ {
		if retry > 0 {
			// 指数退避：100ms → 300ms → 500ms
			backoffMs := 100 * (1 << (retry - 1))
			if backoffMs > 500 {
				backoffMs = 500
			}
			jitterMs := rand.Intn(100)
			select {
			case <-cctx.Done():
				log.Printf("[Quiz] ⏰ 用户已取消重试: uid=%d active=%d", userUID, activeID)
				return nil, cctx.Err()
			case <-time.After(time.Duration(backoffMs+jitterMs) * time.Millisecond):
			}
		}

		answerStart := time.Now()
		result, err := s.xxtClient.QuickAnswer(userCtx.cachedMobile, userCtx.cachedPassword, courseID, classID, activeID)
		elapsed := time.Since(answerStart).Milliseconds()

		if err != nil {
			if result != "" && xxt.IsAntiCrawlResponse(result) >= 2 {
				s.handleAntiCrawl(userCtx, result)
			}
			continue
		}

		// 风控检测（JSON 响应中的风控）
		if xxt.IsAntiCrawlResponse(result) >= 2 {
			s.handleAntiCrawl(userCtx, result)
		}

		isSuccess, msg, isFinal, _ := xxt.ParseQuickAnswerResult(result)

		lastResult = &AnswerResult{
			Success:    isSuccess,
			Message:    msg,
			ElapsedMs:  elapsed,
			ActivityID: activeID,
		}

		if isSuccess {
			// 尝试获取超星服务端记录的真实抢答时间
			serverTs := xxt.ExtractAnswerServerTime(result)

			// 若响应中无时间戳，再请求活动详情获取服务端时间
			if serverTs == 0 {
				if attendInfo, err := s.xxtClient.GetAnswerAttendInfo(
					userCtx.cachedMobile, userCtx.cachedPassword, courseID, classID, activeID,
				); err == nil {
					serverTs = attendInfo.Data.PptActive.Servertime
					if serverTs > 0 && attendInfo.Data.PptActive.StartTime > 0 {
						// 使用(服务端当前时间 - 活动开始时间)作为真实抢答耗时
						realElapsed := serverTs - attendInfo.Data.PptActive.StartTime
						if realElapsed > 0 && realElapsed < 3600000 { // 不超过1小时
							elapsed = realElapsed
							log.Printf("[Quiz] 📡 服务端抢答耗时: %dms (server=%d start=%d)",
								elapsed, serverTs, attendInfo.Data.PptActive.StartTime)
						}
					}
				}
			}

			// 抢答成功
			log.Printf("[Quiz] ✅ 抢答成功: uid=%d active=%d msg=%s elapsed=%dms serverTs=%d",
				userUID, activeID, msg, elapsed, serverTs)
			s.saveRecord(userUID, activeID, true, msg)
			s.broadcast(userUID, MonitorEvent{
				Type:       EventAnswered,
				ActivityID: activeID,
				Success:    true,
				Message:    msg,
				Elapsed:    elapsed,
			})
			return lastResult, nil
		}

		if isFinal {
			log.Printf("[Quiz] ⏭ 跳过(终态): uid=%d active=%d msg=%s", userUID, activeID, msg)
			s.saveRecord(userUID, activeID, false, msg)
			s.broadcast(userUID, MonitorEvent{
				Type:       EventAnswered,
				ActivityID: activeID,
				Success:    false,
				Message:    msg,
				Elapsed:    elapsed,
			})
			return lastResult, fmt.Errorf(msg)
		}

		log.Printf("[Quiz] ❌ 抢答失败(重试): uid=%d active=%d msg=%s elapsed=%dms",
			userUID, activeID, msg, elapsed)
	}

	if lastResult != nil {
		s.saveRecord(userUID, activeID, false, lastResult.Message)
		s.broadcast(userUID, MonitorEvent{
			Type:       EventAnswered,
			ActivityID: activeID,
			Success:    false,
			Message:    lastResult.Message,
			Elapsed:    lastResult.ElapsedMs,
		})
		return lastResult, fmt.Errorf(lastResult.Message)
	}
	return nil, fmt.Errorf("抢答请求失败（多次重试后仍无法提交）")
}

// ================= 风控处理 + Session 续期 =================

func (s *QuizService) handleAntiCrawl(userCtx *UserContext, response string) {
	userCtx.consecutiveFailures++
	if userCtx.consecutiveFailures > 12 {
		userCtx.consecutiveFailures = 12
	}

	backoffDelay := userCtx.backoffStrategy.NextBackoff()
	userCtx.backoffUntil = time.Now().Add(backoffDelay)

	if userCtx.consecutiveFailures >= 5 {
		userCtx.pausedUntil = time.Now().Add(10 * time.Second)
	}

	respSummary := response
	if len(respSummary) > 120 {
		respSummary = respSummary[:120] + "..."
	}
	log.Printf("[Quiz] 🚫 风控触发: uid=? consecutive=%d backoff=%v resp=%s",
		userCtx.consecutiveFailures, backoffDelay, respSummary)
	if userCtx.consecutiveFailures >= 5 {
		log.Printf("[Quiz] 🛑 风控降温 10s: consecutive=%d", userCtx.consecutiveFailures)
	}

	// 检测会话过期：HTML 响应表示超星侧 session 已失效
	if strings.HasPrefix(response, "<") || strings.Contains(response, "<!DOCTYPE") {
		log.Printf("[Quiz] 🔄 Session已过期，重置: mobile=%s", maskMobile(userCtx.cachedMobile))
		s.xxtClient.ResetSession(userCtx.cachedMobile)
		userCtx.sessionCheckedAt = time.Time{} // 下次检查时重新登录
	}

	// 风控后清空活动缓存，下次请求强制刷新
	s.xxtClient.ResetQuizCache(0, 0)
}

// isSessionValid 检查用户 session 是否有效
// 通过 GetPanUploadToken 做一次低开销 API 调用验证 cookie 是否仍然有效
// 返回 true=有效，false=需要重新登录
func (s *QuizService) isSessionValid(userCtx *UserContext) bool {
	if userCtx == nil || userCtx.cachedMobile == "" || userCtx.cachedPassword == "" {
		return false
	}
	_, err := s.xxtClient.GetPanUploadToken(userCtx.cachedMobile, userCtx.cachedPassword)
	if err != nil {
		// token missing / login 相关错误表示 session 失效
		errStr := err.Error()
		if strings.Contains(errStr, "token missing") || strings.Contains(errStr, "login") {
			return false
		}
		// 其他网络错误不判定为 session 失效（可能是临时故障）
		return true
	}
	return true
}

// refreshSession 强制刷新用户 session（重新登录）
// 最多重试 maxRetry 次，成功后更新 xxt client 的 session 缓存
// 连续失败 3 次后推送 "登录失效" 事件
func (s *QuizService) refreshSession(userUID int64, userCtx *UserContext) bool {
	const maxRetry = 3
	for i := 0; i < maxRetry; i++ {
		_, err := s.xxtClient.PreLogin(userCtx.cachedMobile, userCtx.cachedPassword)
		if err == nil {
			userCtx.sessionCheckedAt = time.Now()
			log.Printf("[Quiz] ✅ Session续期成功: uid=%d attempt=%d", userUID, i+1)
			return true
		}
		log.Printf("[Quiz] ⚠ Session续期失败(%d/%d): uid=%d err=%v", i+1, maxRetry, userUID, err)
		if i < maxRetry-1 {
			time.Sleep(time.Duration(500*(i+1)) * time.Millisecond) // 500ms → 1000ms 退避
		}
	}

	// 连续失败，推送登录失效事件
	log.Printf("[Quiz] ❌ Session续期彻底失败: uid=%d", userUID)
	s.broadcast(userUID, MonitorEvent{
		Type:    EventWarning,
		Success: false,
		Message: "登录凭证已失效，请重新登录",
	})
	return false
}

// ensureSessionValid 在 executeAnswer 前调用，确保 session 有效
// 每 sessionCheckInterval（5分钟）检查一次，过期时自动续期
const sessionCheckInterval = 5 * time.Minute

func (s *QuizService) ensureSessionValid(userUID int64, userCtx *UserContext) bool {
	if userCtx == nil {
		return false
	}
	// 上次检查在有效期内 → 跳过
	if !userCtx.sessionCheckedAt.IsZero() && time.Since(userCtx.sessionCheckedAt) < sessionCheckInterval {
		return true
	}
	// 需要检查
	if s.isSessionValid(userCtx) {
		userCtx.sessionCheckedAt = time.Now()
		return true
	}
	// session 已过期，尝试续期
	return s.refreshSession(userUID, userCtx)
}

// ================= 用户上下文管理 =================

func (s *QuizService) ensureUserContext(userUID int64) *UserContext {
	s.cacheMu.RLock()
	ctx, exists := s.userCache[userUID]
	s.cacheMu.RUnlock()
	if exists && ctx.config != nil {
		return ctx
	}

	// 加载配置
	config := &model.QuizConfig{}
	if err := s.db.Where("user_uid = ?", userUID).First(config).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			config = &model.QuizConfig{
				UserUID:    userUID,
				Enabled:    true,
				AutoAnswer: true,
				DelayMs:    0,
			}
			s.db.Create(config)
		} else {
			return nil
		}
	}

	// 解密凭证
	var mobile, password string
	var user mainmodel.User
	if err := s.db.Where("uid = ?", userUID).First(&user).Error; err == nil {
		mobile = user.Mobile
		if pwd, err := s.cc.Decrypt(user.CredentialCipher); err == nil {
			password = pwd
		}
	}

	if exists {
		// 复用已有对象，更新字段
		ctx.config = config
		ctx.cachedMobile = mobile
		ctx.cachedPassword = password
		return ctx
	}

	ctx = &UserContext{
		cachedMobile:    mobile,
		cachedPassword:  password,
		config:          config,
		backoffStrategy: NewBackoffStrategy(),
	}
	s.cacheMu.Lock()
	s.userCache[userUID] = ctx
	s.cacheMu.Unlock()
	return ctx
}

// lookupCourseNameByID 根据 courseID/classID 查询课程名称（优先查共享缓存，其次 courses 表）
func (s *QuizService) lookupCourseNameByID(courseID, classID int64) string {
	if courseID == 0 {
		return ""
	}
	// 先从共享缓存读取
	if name, _, _, ok := s.courseCache.Get(courseID, classID); ok {
		return name
	}
	// 缓存未命中 → 从 courses 表查
	var course mainmodel.Course
	if err := s.db.Select("name").Where("course_id = ? AND class_id = ?", courseID, classID).Take(&course).Error; err == nil {
		s.courseCache.Set(course.CourseID, course.ClassID, course.Name, course.Teacher, course.Icon)
		return course.Name
	}
	return fmt.Sprintf("课程%d", courseID)
}

// lookupCourseInfo 查询课程的完整信息（名称/教师/图标），优先使用共享缓存
func (s *QuizService) lookupCourseInfo(courseID, classID int64) (name, teacher, icon string) {
	if courseID == 0 {
		return "", "", ""
	}
	// 优先从共享课程缓存读取
	if name, teacher, icon, ok := s.courseCache.Get(courseID, classID); ok {
		return name, teacher, icon
	}
	// 缓存未命中 → 从 courses 表查（含完整信息）
	var course mainmodel.Course
	if err := s.db.Select("name, teacher, icon").Where("course_id = ? AND class_id = ?", courseID, classID).Take(&course).Error; err == nil {
		// 写入缓存供后续使用
		s.courseCache.Set(course.CourseID, course.ClassID, course.Name, course.Teacher, course.Icon)
		return course.Name, course.Teacher, course.Icon
	}
	// 回退到 QuizConfig 中的名称缓存
	var cfg model.QuizConfig
	if err := s.db.Select("course_name, icon").Where("course_id = ? AND class_id = ?", courseID, classID).Take(&cfg).Error; err == nil && cfg.CourseName != "" {
		return cfg.CourseName, "", cfg.Icon
	}
	return fmt.Sprintf("课程%d", courseID), "", ""
}

// lookupCourseName 查询课程名称（走缓存）
func (s *QuizService) lookupCourseName(ctx *UserContext) string {
	if ctx.config.CourseID == 0 {
		return ""
	}
	var course mainmodel.Course
	if err := s.db.Where("course_id = ? AND class_id = ?",
		ctx.config.CourseID, ctx.config.ClassID).
		First(&course).Error; err == nil {
		return course.Name
	}
	return ""
}

// ================= 配置管理 =================

func (s *QuizService) GetConfig(userUID int64) (*model.QuizConfig, error) {
	config := &model.QuizConfig{}
	err := s.db.Where("user_uid = ?", userUID).First(config).Error
	if err == gorm.ErrRecordNotFound {
		return &model.QuizConfig{UserUID: userUID, AutoAnswer: true, DelayMs: 0, WSEnabled: true}, nil
	}
	return config, err
}

func (s *QuizService) UpdateConfig(userUID int64, cfg *model.QuizConfig) error {
	existing := &model.QuizConfig{}
	err := s.db.Where("user_uid = ?", userUID).First(existing).Error
	if err == gorm.ErrRecordNotFound {
		cfg.UserUID = userUID
		return s.db.Create(cfg).Error
	}
	existing.AutoAnswer = cfg.AutoAnswer
	existing.DelayMs = cfg.DelayMs
	existing.Enabled = cfg.Enabled
	existing.WSEnabled = cfg.WSEnabled
	if cfg.CourseID > 0 {
		existing.CourseID = cfg.CourseID
	}
	if cfg.ClassID > 0 {
		existing.ClassID = cfg.ClassID
	}
	// 更新课程名称和图标的缓存
	if cfg.CourseID > 0 {
		if cfg.CourseName != "" {
			existing.CourseName = cfg.CourseName
		} else {
			existing.CourseName = s.lookupCourseNameByID(existing.CourseID, existing.ClassID)
		}
		// 从共享缓存或 DB 获取图标
		_, _, icon := s.lookupCourseInfo(existing.CourseID, existing.ClassID)
		if icon != "" {
			existing.Icon = icon
		} else if cfg.Icon != "" {
			existing.Icon = cfg.Icon
		}
	}
	if cfg.WSUrl != "" {
		existing.WSUrl = cfg.WSUrl
	}
	if cfg.MonitorCourses != "" {
		existing.MonitorCourses = cfg.MonitorCourses
	}
	if err := s.db.Save(existing).Error; err != nil {
		return err
	}

	// 更新缓存
	s.cacheMu.RLock()
	ctx, exists := s.userCache[userUID]
	s.cacheMu.RUnlock()
	if exists {
		s.cacheMu.Lock()
		ctx.config = existing
		s.cacheMu.Unlock()
	}
	return nil
}

// ================= 事件订阅（SSE / WebSocket 推送） =================

func (s *QuizService) Subscribe(userUID int64) (<-chan MonitorEvent, func()) {
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

func (s *QuizService) broadcast(userUID int64, evt MonitorEvent) {
	evt.Timestamp = time.Now().UnixMilli()
	s.subMu.RLock()
	for _, sub := range s.subscribers[userUID] {
		select {
		case sub.ch <- evt:
		default:
		}
	}
	s.subMu.RUnlock()

	switch evt.Type {
	case EventDetected:
		BroadcastQuizActivity(userUID, evt)
	case EventAnswered:
		BroadcastQuizRecord(userUID, evt)
	case EventStatus:
		BroadcastQuizRecord(userUID, evt)
	case EventWarning:
		BroadcastQuizActivity(userUID, evt)
	}
}

// ================= 数据库操作 =================

func (s *QuizService) saveRecord(userUID, activityID int64, success bool, msg string) {
	rec := &model.QuizRecord{
		UserUID:    userUID,
		ActivityID: activityID,
		Success:    success,
		Message:    msg,
	}
	s.db.Create(rec)

	// 同步写入操作日志
	status := "failed"
	if success {
		status = "success"
	}
	s.saveLog(userUID, &model.QuizLog{
		ActivityID: activityID,
		Type:       "answer",
		Status:     status,
		Message:    msg,
	})
}

// saveLog 写入抢答操作日志
func (s *QuizService) saveLog(userUID int64, logEntry *model.QuizLog) {
	if logEntry == nil {
		return
	}
	logEntry.UserUID = userUID
	s.db.Create(logEntry)
}

// saveActivity 保存抢答活动到数据库（供活动列表展示）
func (s *QuizService) saveActivity(userUID, courseID, classID int64, act xxt.Active) {
	// 查询课程名称
	courseName := ""
	var course struct{ Name string }
	if err := s.db.Table("courses").
		Select("name").
		Where("course_id = ? AND class_id = ?", courseID, classID).
		Take(&course).Error; err == nil {
		courseName = course.Name
	}

	activity := &model.QuizActivity{
		UserUID:    userUID,
		ActivityID: act.ActiveID,
		CourseID:   courseID,
		ClassID:    classID,
		Title:      act.Name,
		CourseName: courseName,
		StartTime:  act.StartTime,
		EndTime:    act.EndTime,
		Status:     act.Status,
	}
	s.db.Where("activity_id = ? AND user_uid = ?", act.ActiveID, userUID).
		Assign(activity).
		FirstOrCreate(activity)
}

// ================= 清理 =================

// checkAndPrepareActivity 检查活动状态，处理"等待学生就位"模式
// 返回值:
//   (result, nil) → 需要提前返回（已抢答/人数满/已结束）
//   (nil, nil)    → 正常，继续执行抢答
//   (nil, err)    → 错误，终止
func (s *QuizService) checkAndPrepareActivity(cctx context.Context, userCtx *UserContext, userUID, activeID, courseID, classID int64) (*AnswerResult, error) {
	// 获取活动详情（含抢答状态）
	attendInfo, err := s.xxtClient.GetAnswerAttendInfo(userCtx.cachedMobile, userCtx.cachedPassword, courseID, classID, activeID)
	if err != nil {
		// 获取失败不阻塞抢答（降级：直接尝试 QuickAnswer）
		log.Printf("[Quiz] ⚠ 获取活动详情失败（降级）: uid=%d active=%d err=%v", userUID, activeID, err)
		return nil, nil
	}

	// 已抢答
	if attendInfo.AlreadyAnswered() {
		log.Printf("[Quiz] ⏭ 已抢答过: uid=%d active=%d", userUID, activeID)
		return &AnswerResult{
			Success:    false,
			Message:    "您已抢答过了",
			ActivityID: activeID,
		}, fmt.Errorf("您已抢答过了")
	}

	// 人数已满
	if attendInfo.IsAnswerFull() {
		log.Printf("[Quiz] ⏭ 人数已满: uid=%d active=%d", userUID, activeID)
		return nil, fmt.Errorf("抢答人数已达上限")
	}

	// 已结束
	if attendInfo.IsEnded() {
		log.Printf("[Quiz] ⏭ 已结束: uid=%d active=%d", userUID, activeID)
		return nil, fmt.Errorf("抢答已结束")
	}

	// 等待学生就位模式
	if attendInfo.NeedWaitForReady() {
		log.Printf("[Quiz] 🔄 等待学生就位模式: uid=%d active=%d 执行准备...", userUID, activeID)

		// 广播准备状态
		s.broadcast(userUID, MonitorEvent{
			Type:       EventStatus,
			ActivityID: activeID,
			Success:    false,
			Message:    "正在准备就位...",
		})

		// 调用 StuAnswerPrepare
		_, prepErr := s.xxtClient.StuAnswerPrepare(userCtx.cachedMobile, userCtx.cachedPassword, courseID, classID, activeID)
		if prepErr != nil {
			return nil, fmt.Errorf("准备就位失败: %v", prepErr)
		}

		// 广播准备完成
		s.broadcast(userUID, MonitorEvent{
			Type:       EventStatus,
			ActivityID: activeID,
			Success:    false,
			Message:    "已就位，等待教师开启抢答...",
		})

		// 轮询 GetTeacherIfOpenAnswer（最多 30s）
		pollStart := time.Now()
		timeout := 30 * time.Second
		for time.Since(pollStart) < timeout {
			select {
			case <-cctx.Done():
				log.Printf("[Quiz] ⏰ 用户已断开，停止等待教师开启: uid=%d active=%d", userUID, activeID)
				return nil, fmt.Errorf("用户已取消")
			case <-time.After(1 * time.Second):
			}
			isOpen, pollErr := s.xxtClient.GetTeacherIfOpenAnswer(userCtx.cachedMobile, userCtx.cachedPassword, courseID, classID, activeID)
			if pollErr == nil && isOpen {
				log.Printf("[Quiz] ✅ 教师已开启抢答: uid=%d active=%d 耗时=%.0fs",
					userUID, activeID, time.Since(pollStart).Seconds())
				return nil, nil // 教师已开启，继续执行抢答
			}
		}

		// 超时
		log.Printf("[Quiz] ⏰ 等待教师开启超时: uid=%d active=%d", userUID, activeID)
		return nil, fmt.Errorf("等待教师开启抢答超时（30s）")
	}

	return nil, nil // 普通模式，继续执行
}

// QuickAnswerAll 一键批量抢答：检测当前所有进行中的抢答活动并全部抢答
// 10s 防重复提交，每个活动之间 ±50ms 抖动
// GetUserActivityIDs 获取用户已处理过的活动ID列表（用于初始化监测去重集合）
func (s *QuizService) GetUserActivityIDs(userUID int64) ([]int64, error) {
	var ids []int64
	err := s.db.Model(&model.QuizRecord{}).
		Where("user_uid = ?", userUID).
		Pluck("activity_id", &ids).Error
	return ids, err
}

func (s *QuizService) QuickAnswerAll(userUID int64) (*BatchAnswerResult, error) {
	// 1. 10s 防重复提交
	s.oneClickCooldownsMu.Lock()
	if until, exists := s.oneClickCooldowns[userUID]; exists && time.Now().Before(until) {
		remaining := until.Sub(time.Now()).Seconds()
		s.oneClickCooldownsMu.Unlock()
		return nil, fmt.Errorf("请稍后再试（剩余 %.0fs）", remaining)
	}
	s.oneClickCooldowns[userUID] = time.Now().Add(10 * time.Second)
	s.oneClickCooldownsMu.Unlock()

	startTime := time.Now()

	// 2. 获取用户上下文
	userCtx := s.ensureUserContext(userUID)
	if userCtx == nil {
		return nil, fmt.Errorf("获取用户信息失败")
	}
	if userCtx.config.CourseID == 0 || userCtx.config.ClassID == 0 {
		return nil, fmt.Errorf("请先在设置中配置课程")
	}

	// 3. 从超星拉取当前活动列表
	actives, err := s.xxtClient.GetActivesAllFast(userCtx.cachedMobile, userCtx.cachedPassword, userCtx.config.CourseID, userCtx.config.ClassID)
	if err != nil {
		return nil, fmt.Errorf("获取活动列表失败: %v", err)
	}

	// 4. 过滤出抢答类活动
	batch := &BatchAnswerResult{
		Details: make([]*AnswerResult, 0),
	}
	var quizActives []xxt.Active
	for _, act := range actives {
		if !xxt.IsQuizActivity(act.Name) && !xxt.IsQuizActivityByType(act.ActiveType) {
			continue
		}
		// 只抢答进行中的活动（status=1），跳过待开始(0)和已结束(2)
		if act.Status != 1 {
			continue
		}
		quizActives = append(quizActives, act)
	}
	batch.Total = len(quizActives)

	if batch.Total == 0 {
		batch.Elapsed = time.Since(startTime).Milliseconds()
		return batch, nil
	}

	// 5. 遍历每个活动，执行抢答
	for i, act := range quizActives {
		// 每个活动之间 ±50ms 抖动
		if i > 0 {
			jitter := time.Duration(50 + rand.Intn(50)) * time.Millisecond
			time.Sleep(jitter)
		}

		answerStart := time.Now()

		// 检查活动状态
		_, prepErr := s.checkAndPrepareActivity(context.Background(), userCtx, userUID, act.ActiveID, userCtx.config.CourseID, userCtx.config.ClassID)
		if prepErr != nil {
			skipResult := &AnswerResult{
				Success:    false,
				Message:    prepErr.Error(),
				ElapsedMs:  time.Since(answerStart).Milliseconds(),
				ActivityID: act.ActiveID,
			}
			batch.Details = append(batch.Details, skipResult)
			batch.Skipped++
			continue
		}

		// 执行抢答（不加延迟，直接提交）
		result, execErr := s.executeAnswer(context.Background(), userCtx, userUID, act.ActiveID, userCtx.config.CourseID, userCtx.config.ClassID, 0)
		if execErr != nil && result == nil {
			failResult := &AnswerResult{
				Success:    false,
				Message:    execErr.Error(),
				ElapsedMs:  time.Since(answerStart).Milliseconds(),
				ActivityID: act.ActiveID,
			}
			batch.Details = append(batch.Details, failResult)
			batch.Failed++
			continue
		}
		if result == nil {
			result = &AnswerResult{
				Success:    false,
				Message:    "未知错误",
				ElapsedMs:  time.Since(answerStart).Milliseconds(),
				ActivityID: act.ActiveID,
			}
		}
		batch.Details = append(batch.Details, result)
		if result.Success {
			batch.Success++
		} else {
			batch.Failed++
		}
	}

	batch.Elapsed = time.Since(startTime).Milliseconds()
	return batch, nil
}

// Shutdown 清理订阅者
func (s *QuizService) Shutdown() {
	log.Printf("[Quiz] 清理订阅者...")
	s.subMu.Lock()
	for uid, subs := range s.subscribers {
		for _, sub := range subs {
			close(sub.ch)
		}
		delete(s.subscribers, uid)
	}
	s.subMu.Unlock()
}

// ==================== QuizMonitor 定义 ====================

// QuizMonitor 管理每位用户的预热和抢答
// 预热(PreWarm)：保持凭证缓存和超星 session 在线（WS 连接时自动启动）
// 抢答：用户点击一键抢答时强制拉取最新活动并执行抢答，完成后回到预热状态
type QuizMonitor struct {
	svc    *QuizService
	xxtCli *xxt.Client

	mu    sync.Mutex
	users map[int64]*userMonitorState // userUID → 状态
}

// NewQuizMonitor 创建监控管理器
func NewQuizMonitor(svc *QuizService, xxtCli *xxt.Client) *QuizMonitor {
	return &QuizMonitor{
		svc:    svc,
		xxtCli: xxtCli,
		users:  make(map[int64]*userMonitorState),
	}
}

// StartPreWarm 启动预热：保持凭证缓存和超星 session 在线
// 不轮询活动列表，仅在用户点击一键抢答时强制拉取最新数据
func (qm *QuizMonitor) StartPreWarm(userUID int64, mobile, password string, courseID, classID int64) {
	qm.mu.Lock()
	defer qm.mu.Unlock()

	if state, exists := qm.users[userUID]; exists {
		// 更新凭证，无需重启 goroutine
		state.mobile = mobile
		state.password = password
		state.courseID = courseID
		state.classID = classID
		return
	}

	// 全新启动预热
	ctx, cancel := context.WithCancel(context.Background())
	qm.users[userUID] = &userMonitorState{
		ctx:      ctx,
		cancel:   cancel,
		mode:     MonitorPreWarm,
		mobile:   mobile,
		password: password,
		courseID: courseID,
		classID:  classID,
		cache:    &ActivityCache{},
	}
	qm.mu.Unlock()
	go qm.preWarmLoop(ctx, userUID, mobile, password, courseID, classID)
	qm.mu.Lock()
}

// StartPreWarmFromDB 从数据库加载凭证后启动预热（WS 连接时自动调用）
func (qm *QuizMonitor) StartPreWarmFromDB(userUID int64, courseID, classID int64) {
	config, err := qm.svc.GetConfig(userUID)
	if err != nil || config == nil {
		return
	}
	if courseID == 0 {
		courseID = config.CourseID
	}
	if classID == 0 {
		classID = config.ClassID
	}
	if courseID == 0 || classID == 0 {
		return // 未配置课程，跳过预热
	}

	userCtx := qm.svc.ensureUserContext(userUID)
	if userCtx == nil {
		return
	}

	qm.StartPreWarm(userUID, userCtx.cachedMobile, userCtx.cachedPassword, courseID, classID)
}

// parseCourseIDs 解析 QuizConfig.CourseIDs JSON 字符串为课程列表
func parseCourseIDs(jsonStr string) []CoursePair {
	if jsonStr == "" {
		return nil
	}
	var pairs []CoursePair
	if err := json.Unmarshal([]byte(jsonStr), &pairs); err != nil || len(pairs) == 0 {
		return nil
	}
	// 去重
	seen := make(map[string]bool)
	var result []CoursePair
	for _, p := range pairs {
		key := fmt.Sprintf("%d:%d", p.CourseID, p.ClassID)
		if seen[key] {
			continue
		}
		seen[key] = true
		result = append(result, p)
	}
	return result
}

// getConfigCourses 从配置中获取要监控的课程列表
// 优先级: CourseIDs(多课程) > CourseID/ClassID(单课程兼容)
func (s *QuizService) getConfigCourses(userUID int64) []CoursePair {
	cfg, err := s.GetConfig(userUID)
	if err != nil || cfg == nil {
		return nil
	}

	// 优先使用 CourseIDs（多课程模式）
	if pairs := parseCourseIDs(cfg.CourseIDs); len(pairs) > 0 {
		return pairs
	}

	// 降级到单课程模式（向后兼容）
	if cfg.CourseID > 0 {
		return []CoursePair{{CourseID: cfg.CourseID, ClassID: cfg.ClassID}}
	}

	return nil
}

// OneClickAnswer 一键抢答：检测进行中的抢答活动 → 异步执行抢答
// v2 支持多课程：
//   - 如果配置了 CourseIDs → 遍历所有选中课程分别检测并合并结果
//   - 如果仅配置了 CourseID/ClassID → 单课程模式（向后兼容）
//   - 如果未配置任何课程 → 从超星拉取所有课程并检测全部
// 返回检测到的活动总数（同步返回，抢答结果通过 WS 推送）
func (qm *QuizMonitor) OneClickAnswer(userUID int64, mobile, password string, configCourseID, configClassID int64) (int, error) {
	qm.StartPreWarm(userUID, mobile, password, configCourseID, configClassID)

	// 获取课程列表（多课程优先）
	courses := qm.svc.getConfigCourses(userUID)

	// 如果配置中没有课程，从超星拉取全部课程
	if len(courses) == 0 {
		allCourses, err := qm.xxtCli.GetCourses(mobile, password)
		if err == nil && len(allCourses) > 0 {
			for _, c := range allCourses {
				courses = append(courses, CoursePair{CourseID: c.CourseID, ClassID: c.ClassID})
			}
			log.Printf("[QuizMonitor] 📚 未指定课程，自动检测全部: uid=%d courses=%d", userUID, len(courses))
		}
	}

	if len(courses) == 0 {
		// 兜底：用传入的 courseID（可能是0）
		courses = []CoursePair{{CourseID: configCourseID, ClassID: configClassID}}
	}

	// 遍历所有课程，检测活动并去重
	allDetected := make([]xxt.Active, 0)
	seenIDs := make(map[int64]bool)

	for _, cp := range courses {
		detected := qm.detectActivities(userUID, mobile, password, cp.CourseID, cp.ClassID)
		for _, act := range detected {
			if !seenIDs[act.ActiveID] {
				seenIDs[act.ActiveID] = true
				// 确保活动有正确的课程信息
				if act.CourseID == 0 {
					act.CourseID = cp.CourseID
					act.ClassID = cp.ClassID
				}
				allDetected = append(allDetected, act)
			}
		}
	}

	if len(allDetected) == 0 {
		log.Printf("[QuizMonitor] ⚠ 未检测到任何进行中的抢答活动: uid=%d courses=%d", userUID, len(courses))
		return 0, nil
	}

	log.Printf("[QuizMonitor] 🎯 一键抢答: uid=%d courses=%d detected=%d", userUID, len(courses), len(allDetected))

	// 异步执行抢答（结果通过 WS 推送）
	go qm.answerActivities(userUID, mobile, password, 0, 0, allDetected)
	return len(allDetected), nil
}

// getCachedActivities 读取原始缓存数据（不做过滤，用于 fallback 和增量 diff）
func (qm *QuizMonitor) getCachedActivities(userUID int64) []xxt.Active {
	qm.mu.Lock()
	state, exists := qm.users[userUID]
	qm.mu.Unlock()
	if !exists {
		return nil
	}

	state.cacheMu.Lock()
	defer state.cacheMu.Unlock()
	if state.cache == nil {
		return nil
	}
	// 即使缓存过期也返回数据，作为实时拉取失败的兜底
	return state.cache.Activities
}

// updateUserCache 更新用户的活动缓存
func (qm *QuizMonitor) updateUserCache(userUID int64, activities []xxt.Active) {
	qm.mu.Lock()
	if state, exists := qm.users[userUID]; exists {
		state.cacheMu.Lock()
		if state.cache == nil {
			state.cache = &ActivityCache{}
		}
		state.cache.Update(activities, cacheTTL)
		state.cacheMu.Unlock()
	}
	qm.mu.Unlock()
}

// getUserContext 获取用户专属 context（WS 断开时自动取消）
// 用于传递到异步抢答任务，确保用户断开后 goroutine 能及时退出
func (qm *QuizMonitor) getUserContext(userUID int64) context.Context {
	qm.mu.Lock()
	defer qm.mu.Unlock()
	if state, exists := qm.users[userUID]; exists && state.ctx != nil {
		return state.ctx
	}
	return context.Background()
}

// detectActivities 检测当前进行中的抢答活动
// v2 重写：每次调用都强制实时拉取，缓存仅用于兜底和增量检测
// 核心修复：预览仅依赖缓存导致新活动最长 60s 才被检测到的 BUG
//
// 策略（三级保障，层层兜底）:
//   1. GetActivesAllFast —— 始终做实时网络请求（xxt 内部 200ms 缓存，一定能拿到最新数据）
//   2. 快速拉取失败 → GetActivesAllForce —— 绕过风控退避强制拉取
//   3. 强制拉取也失败 → 过期缓存数据兜底 —— 绝不返回空列表（除非真没数据）
func (qm *QuizMonitor) detectActivities(userUID int64, mobile, password string, courseID, classID int64) []xxt.Active {
	// Step 0：保存缓存快照，用于增量检测和兜底
	cachedActives := qm.getCachedActivities(userUID)
	cachedIDs := make(map[int64]bool, len(cachedActives))
	for _, a := range cachedActives {
		cachedIDs[a.ActiveID] = true
	}

	// Step 1：始终执行实时拉取（核心修复——每次点击都走网络请求）
	freshActives, err := qm.xxtCli.GetActivesAllFast(mobile, password, courseID, classID)
	if err != nil || len(freshActives) == 0 {
		// Step 2：快速拉取失败 → 强制刷新（绕过风控退避）
		freshActives, err = qm.xxtCli.GetActivesAllForce(mobile, password, courseID, classID)
	}

	// Step 3：合并数据源——实时数据优先，实时为空则降级到缓存（即使过期）
	mergeSource := freshActives
	if len(mergeSource) == 0 {
		mergeSource = cachedActives
	}
	if len(mergeSource) == 0 {
		log.Printf("[QuizMonitor] ⚠ 无任何活动数据: uid=%d", userUID)
		return nil // 真没有数据
	}

	// 更新缓存（用最新数据刷新，供后续 diff 和预热使用）
	qm.updateUserCache(userUID, mergeSource)

	// Step 4：增量检测——缓存中没有但实时拉取返回的活动即为新活动
	if len(freshActives) > 0 {
		var newCount int
		for _, a := range freshActives {
			if !cachedIDs[a.ActiveID] {
				newCount++
				log.Printf("[QuizMonitor] 🆕 检测到新活动: uid=%d active=%d name=%s", userUID, a.ActiveID, a.Name)
			}
		}
		if newCount > 0 {
			log.Printf("[QuizMonitor] 📊 增量汇总: uid=%d 新活动=%d 缓存=%d 实时=%d",
				userUID, newCount, len(cachedActives), len(freshActives))
		}
	}

	// Step 5：过滤——已处理的活动不重复返回
	seen := make(map[int64]bool)
	if records, err := qm.svc.GetUserActivityIDs(userUID); err == nil {
		for _, id := range records {
			seen[id] = true
		}
	}

	// Step 6：筛选进行中的抢答活动
	var detected []xxt.Active
	now := time.Now().UnixMilli()
	for _, act := range mergeSource {
		if !xxt.IsQuizActivity(act.Name) && !xxt.IsQuizActivityByType(act.ActiveType) {
			continue
		}
		if act.Status != 1 {
			continue
		}
		if act.EndTime > 0 && now >= act.EndTime {
			continue
		}
		if seen[act.ActiveID] {
			continue
		}
		// 如指定了单门课程 → 只返回该课程的活动
		if courseID > 0 && act.CourseID > 0 && act.CourseID != courseID {
			continue
		}
		detected = append(detected, act)
	}

	log.Printf("[QuizMonitor] 🎯 检测完成: uid=%d detected=%d total=%d source=%s",
		userUID, len(detected), len(mergeSource),
		map[bool]string{true: "fresh", false: "cache"}[len(freshActives) > 0])
	return detected
}

// answerActivities 异步执行抢答（结果通过 WS 推送）
// 使用用户专属 context，WS 断开时自动取消未完成的抢答任务
func (qm *QuizMonitor) answerActivities(userUID int64, _, _ string, defaultCourseID, defaultClassID int64, detected []xxt.Active) {
	// 获取用户专属 context（WS 断开时自动 cancel）
	userCtx := qm.getUserContext(userUID)

	for _, act := range detected {
		// 检查 context 是否已取消（用户已断开连接）
		select {
		case <-userCtx.Done():
			log.Printf("[QuizMonitor] ⏰ 用户已断开，停止抢答: uid=%d active=%d", userUID, act.ActiveID)
			return
		default:
		}

		// 使用活动自身携带的课程信息（支持多课程）
		actCourseID := act.CourseID
		actClassID := act.ClassID
		if actCourseID == 0 {
			actCourseID = defaultCourseID
			actClassID = defaultClassID
		}

		// 保存活动到数据库（供活动列表展示）
		qm.svc.saveActivity(userUID, actCourseID, actClassID, act)

		log.Printf("[QuizMonitor] 检测到活动并抢答: uid=%d active=%d name=%s", userUID, act.ActiveID, act.Name)
		BroadcastQuizActivity(userUID, MonitorEvent{
			Type:       EventDetected,
			ActivityID: act.ActiveID,
			Name:       act.Name,
			Success:    false,
			Message:    "检测到抢答活动",
		})
			qm.svc.saveLog(userUID, &model.QuizLog{
				ActivityID:   act.ActiveID,
				Type:         "detect",
				Status:       "pending",
				Message:      "检测到抢答活动",
				ActivityName: act.Name,
			})

		// 使用用户 context 替代 context.Background()，支持断线取消
		result, err := qm.svc.ManualQuickAnswer(userCtx, userUID, act.ActiveID, actCourseID, actClassID)
		if err != nil {
			log.Printf("[QuizMonitor] 抢答失败: uid=%d active=%d err=%v", userUID, act.ActiveID, err)
		} else {
			log.Printf("[QuizMonitor] 抢答成功: uid=%d active=%d elapsed=%dms", userUID, act.ActiveID, result.ElapsedMs)
		}
	}
}

// Stop 停止所有（完全停止，同 FullStop）
func (qm *QuizMonitor) Stop(userUID int64) {
	qm.FullStop(userUID)
}

// FullStop 完全停止（WS 断开时调用）
func (qm *QuizMonitor) FullStop(userUID int64) {
	qm.mu.Lock()
	defer qm.mu.Unlock()

	if state, exists := qm.users[userUID]; exists {
		state.cancel()
		delete(qm.users, userUID)
		log.Printf("[QuizMonitor] 已完全停止: uid=%d", userUID)
	}
}

// StopAll 停止所有
func (qm *QuizMonitor) StopAll() {
	qm.mu.Lock()
	defer qm.mu.Unlock()

	for uid, state := range qm.users {
		state.cancel()
		delete(qm.users, uid)
	}
	log.Printf("[QuizMonitor] 已停止全部监控")
}

// GetMode 获取当前模式（MonitorOff 或 MonitorPreWarm）
func (qm *QuizMonitor) GetMode(userUID int64) int {
	qm.mu.Lock()
	defer qm.mu.Unlock()

	if state, exists := qm.users[userUID]; exists {
		return state.mode
	}
	return MonitorOff
}
