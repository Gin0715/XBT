package service

import (
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"xbt2/server/internal/model"
	"xbt2/server/internal/xxt"
)

const (
	signMaxRetries      = 2                 // 签到请求最大重试次数（网络级重试）
	signRetryBackoff    = 500 * time.Millisecond // 重试基础等待时间
	sourceNameCacheTTL  = 5 * time.Minute   // 用户名称缓存有效期
)

type SignService struct {
	db  *gorm.DB
	xxt *xxt.Client
	cc  *CredentialCrypto
}

func NewSignService(db *gorm.DB, xxtClient *xxt.Client, cc *CredentialCrypto) *SignService {
	return &SignService{db: db, xxt: xxtClient, cc: cc}
}

type ExecuteSignRequest struct {
	ActivityID   int64
	TargetUID    int64
	SignType     int
	CourseID     int64
	ClassID      int64
	IfRefreshEWM bool
	Special      map[string]interface{}
}

type ExecutePhotoSignRequest struct {
	ActivityID   int64
	TargetUID    int64
	CourseID     int64
	ClassID      int64
	IfRefreshEWM bool
	ObjectID     string
	Filename     string
	ContentType  string
	Photo        []byte
}

type SignCheckItem struct {
	UserID           int64  `json:"user_id"`
	Signed           bool   `json:"signed"`
	RecordSource     int64  `json:"record_source"`
	RecordSourceName string `json:"record_source_name"`
	Message          string `json:"message"`
}

type SignExecuteResult struct {
	UserID           int64  `json:"user_id"`
	Success          bool   `json:"success"`
	AlreadySigned    bool   `json:"already_signed"`
	RecordSource     int64  `json:"record_source"`
	RecordSourceName string `json:"record_source_name"`
	Message          string `json:"message"`
}

func (s *SignService) CheckSignStates(activityID int64, userIDs []int64) ([]SignCheckItem, error) {
	if activityID <= 0 {
		return nil, errors.New("invalid activity_id")
	}
	uniq := dedupeUIDs(userIDs)
	if len(uniq) == 0 {
		return []SignCheckItem{}, nil
	}

	// 批量查询：一次 WHERE IN 替代 N 次独立查询
	var records []model.SignRecord
	if err := s.db.Where("activity_id = ? AND user_uid IN ?", activityID, uniq).Find(&records).Error; err != nil {
		return nil, err
	}
	recordByUID := make(map[int64]model.SignRecord, len(records))
	for _, r := range records {
		recordByUID[r.UserUID] = r
	}

	items := make([]SignCheckItem, 0, len(uniq))
	for _, uid := range uniq {
		if rec, ok := recordByUID[uid]; ok {
			items = append(items, s.buildSignCheckItem(uid, &rec))
		} else {
			items = append(items, s.buildSignCheckItem(uid, nil))
		}
	}
	return items, nil
}

func (s *SignService) buildSignCheckItem(uid int64, rec *model.SignRecord) SignCheckItem {
	state := SignCheckItem{UserID: uid, Signed: false, RecordSource: 0, RecordSourceName: "", Message: "未签到"}
	if rec == nil {
		return state
	}
	state.Signed = true
	state.RecordSource = rec.SourceUID
	if rec.SourceUID == -1 {
		state.RecordSourceName = "学习通"
		state.Message = "该同学已在学习通签到"
		return state
	}
	if rec.SourceUID == uid {
		state.RecordSourceName = s.getSourceName(uid)
		if state.RecordSourceName == "" {
			state.RecordSourceName = "本人"
		}
		state.Message = "该同学已本人签到"
		return state
	}
	state.RecordSourceName = s.getSourceName(rec.SourceUID)
	if state.RecordSourceName == "" {
		state.RecordSourceName = "未知用户"
	}
	state.Message = fmt.Sprintf("该同学已被%s代签", state.RecordSourceName)
	return state
}

func (s *SignService) ExecuteOne(operatorUID int64, req ExecuteSignRequest) SignExecuteResult {
	state := s.resolveSignState(req.ActivityID, req.TargetUID)
	if state.Signed {
		return SignExecuteResult{
			UserID:           req.TargetUID,
			Success:          true,
			AlreadySigned:    true,
			RecordSource:     state.RecordSource,
			RecordSourceName: state.RecordSourceName,
			Message:          state.Message,
		}
	}

	var target model.User
	if err := s.db.Where("uid = ?", req.TargetUID).First(&target).Error; err != nil {
		return SignExecuteResult{UserID: req.TargetUID, Success: false, Message: "该同学未登录或账号不可用"}
	}
	password, err := s.cc.Decrypt(target.CredentialCipher)
	if err != nil {
		return SignExecuteResult{UserID: req.TargetUID, Success: false, Message: "该同学登录信息已过期，请先重新登录"}
	}

	fixed := xxt.FixedParams{
		ActiveID:     req.ActivityID,
		UID:          req.TargetUID,
		CourseID:     req.CourseID,
		ClassID:      req.ClassID,
		IfRefreshEWM: req.IfRefreshEWM,
	}
	if req.SignType == xxt.SignQRCode {
		enc, _ := req.Special["enc"].(string)
		code, _ := req.Special["c"].(string)
		if err := s.xxt.PreSign(target.Mobile, password, fixed, code, enc); err != nil {
			return SignExecuteResult{UserID: req.TargetUID, Success: false, Message: "预签到失败，请重试"}
		}
	}

	result, err := s.signWithRetry(target.Mobile, password, fixed, req.SignType, req.Special)
	if err != nil {
		return SignExecuteResult{UserID: req.TargetUID, Success: false, Message: s.toUserSignMessage(err.Error())}
	}
	result = strings.TrimSpace(result)
	if result != "success" {
		if strings.Contains(result, "您已签到过了") {
			rec := model.SignRecord{UserUID: req.TargetUID, ActivityID: req.ActivityID, SourceUID: -1, SignTimeMS: time.Now().UnixMilli()}
			_ = s.db.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "user_uid"}, {Name: "activity_id"}}, DoNothing: true}).Create(&rec).Error
			return SignExecuteResult{
				UserID:           req.TargetUID,
				Success:          true,
				AlreadySigned:    true,
				RecordSource:     -1,
				RecordSourceName: "学习通",
				Message:          "该同学已在学习通签到",
			}
		}
		return SignExecuteResult{UserID: req.TargetUID, Success: false, Message: s.toUserSignMessage(result)}
	}

	rec := model.SignRecord{
		UserUID:    req.TargetUID,
		ActivityID: req.ActivityID,
		SourceUID:  operatorUID,
		SignTimeMS: time.Now().UnixMilli(),
	}
	if err := s.db.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "user_uid"}, {Name: "activity_id"}}, DoNothing: true}).Create(&rec).Error; err != nil {
		return SignExecuteResult{UserID: req.TargetUID, Success: false, Message: "保存签到结果失败，请重试"}
	}

	sourceName := s.getSourceName(operatorUID)
	if strings.TrimSpace(sourceName) == "" {
		sourceName = "未知用户"
	}
	return SignExecuteResult{
		UserID:           req.TargetUID,
		Success:          true,
		AlreadySigned:    false,
		RecordSource:     operatorUID,
		RecordSourceName: sourceName,
		Message:          "签到成功",
	}
}

func (s *SignService) ExecutePhoto(operatorUID int64, req ExecutePhotoSignRequest) SignExecuteResult {
	if req.ActivityID <= 0 || req.CourseID <= 0 || req.ClassID <= 0 {
		return SignExecuteResult{UserID: req.TargetUID, Success: false, Message: "签到参数不完整"}
	}
	if req.TargetUID <= 0 {
		req.TargetUID = operatorUID
	}
	state := s.resolveSignState(req.ActivityID, req.TargetUID)
	if state.Signed {
		return SignExecuteResult{
			UserID:           req.TargetUID,
			Success:          true,
			AlreadySigned:    true,
			RecordSource:     state.RecordSource,
			RecordSourceName: state.RecordSourceName,
			Message:          state.Message,
		}
	}

	objectID := strings.TrimSpace(req.ObjectID)
	if objectID == "" {
		if len(req.Photo) == 0 {
			return SignExecuteResult{UserID: req.TargetUID, Success: false, Message: "请上传照片或传入 object_id"}
		}
		var target model.User
		if err := s.db.Where("uid = ?", req.TargetUID).First(&target).Error; err != nil {
			return SignExecuteResult{UserID: req.TargetUID, Success: false, Message: "该同学未登录或账号不可用"}
		}
		password, err := s.cc.Decrypt(target.CredentialCipher)
		if err != nil {
			return SignExecuteResult{UserID: req.TargetUID, Success: false, Message: "该同学登录信息已过期，请先重新登录"}
		}
		objectID, err = s.xxt.UploadPanFile(target.Mobile, password, req.Filename, req.ContentType, req.Photo)
		if err != nil {
			return SignExecuteResult{UserID: req.TargetUID, Success: false, Message: "照片上传失败：" + err.Error()}
		}
	}

	return s.ExecuteOne(operatorUID, ExecuteSignRequest{
		ActivityID:   req.ActivityID,
		TargetUID:    req.TargetUID,
		SignType:     xxt.SignNormal,
		CourseID:     req.CourseID,
		ClassID:      req.ClassID,
		IfRefreshEWM: req.IfRefreshEWM,
		Special: map[string]interface{}{
			"object_id": objectID,
		},
	})
}

func (s *SignService) toUserSignMessage(raw string) string {
	msg := strings.TrimSpace(raw)
	if msg == "" {
		return "签到失败，请稍后重试"
	}

	lower := strings.ToLower(msg)
	switch {
	case msg == "validate" || strings.Contains(lower, "validate"):
		return "签到校验未通过，请重试"
	case strings.Contains(msg, "验证码识别失败") || strings.Contains(lower, "captcha"):
		return "验证码校验失败，请重试"
	case strings.Contains(msg, "缺少二维码 enc 参数"):
		return "二维码参数缺失，请刷新活动后重试"
	case strings.Contains(msg, "缺少 sign_code 参数"):
		return "签到码缺失，请输入后重试"
	case strings.Contains(msg, "请求过于频繁"):
		return "操作太频繁，请稍后再试"
	case strings.Contains(msg, "活动已结束"):
		return "该签到已结束"
	case strings.Contains(msg, "签到成功"):
		return "签到成功"
	case strings.Contains(msg, "您已签到过了"):
		return "该同学已在学习通签到"
	default:
		return msg
	}
}

// signWithRetry 签到请求带网络级重试，仅对瞬态错误进行重试
func (s *SignService) signWithRetry(mobile, password string, fixed xxt.FixedParams, signType int, special map[string]any) (string, error) {
	var lastErr error
	for attempt := 0; attempt <= signMaxRetries; attempt++ {
		result, err := s.xxt.Sign(mobile, password, fixed, signType, special)
		if err == nil {
			return result, nil
		}
		lastErr = err
		// 仅对网络/超时类错误重试，应用层错误不重试
		if !isTransientNetworkError(err) {
			break
		}
		if attempt < signMaxRetries {
			time.Sleep(signRetryBackoff * time.Duration(1<<attempt))
		}
	}
	return "", lastErr
}

// isTransientNetworkError 判断是否为可重试的瞬态网络错误
func isTransientNetworkError(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	// 超时类
	if strings.Contains(msg, "timeout") || strings.Contains(msg, "time out") {
		return true
	}
	// 连接类
	if strings.Contains(msg, "connection reset") || strings.Contains(msg, "connection refused") {
		return true
	}
	if strings.Contains(msg, "connection closed") || strings.Contains(msg, "broken pipe") {
		return true
	}
	// DNS 类
	if strings.Contains(msg, "no such host") || strings.Contains(msg, "temporary failure") {
		return true
	}
	// TLS 握手类
	if strings.Contains(msg, "handshake") || strings.Contains(msg, "tls") {
		return true
	}
	return false
}

func (s *SignService) resolveSignState(activityID, uid int64) SignCheckItem {
	if activityID <= 0 || uid <= 0 {
		return SignCheckItem{UserID: uid, Signed: false, RecordSource: 0, RecordSourceName: "", Message: "未签到"}
	}
	var rec model.SignRecord
	if err := s.db.Where("user_uid = ? AND activity_id = ?", uid, activityID).Take(&rec).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return SignCheckItem{UserID: uid, Signed: false, RecordSource: 0, RecordSourceName: "", Message: "未签到"}
		}
		return SignCheckItem{UserID: uid, Signed: false, RecordSource: 0, RecordSourceName: "", Message: "查询失败"}
	}
	return s.buildSignCheckItem(uid, &rec)
}

// sourceNameCache 用户名称缓存（同一次操作中多次查询同一用户时避免重复 DB 查询）
var sourceNameCache sync.Map

func (s *SignService) getSourceName(sourceUID int64) string {
	if sourceUID <= 0 {
		return ""
	}
	// 查缓存
	if cached, ok := sourceNameCache.Load(sourceUID); ok {
		entry := cached.(*sourceNameEntry)
		if time.Since(entry.fetchedAt) < sourceNameCacheTTL {
			return entry.name
		}
		// 过期了，删除后重新查询
		sourceNameCache.Delete(sourceUID)
	}
	var user model.User
	if err := s.db.Where("uid = ?", sourceUID).Take(&user).Error; err != nil {
		// 写入空缓存防止反复查询不存在的用户（短期有效）
		sourceNameCache.Store(sourceUID, &sourceNameEntry{name: "", fetchedAt: time.Now()})
		return ""
	}
	name := strings.TrimSpace(user.Name)
	sourceNameCache.Store(sourceUID, &sourceNameEntry{name: name, fetchedAt: time.Now()})
	return name
}

type sourceNameEntry struct {
	name      string
	fetchedAt time.Time
}

func dedupeUIDs(userIDs []int64) []int64 {
	set := make(map[int64]struct{}, len(userIDs))
	out := make([]int64, 0, len(userIDs))
	for _, uid := range userIDs {
		if uid <= 0 {
			continue
		}
		if _, ok := set[uid]; ok {
			continue
		}
		set[uid] = struct{}{}
		out = append(out, uid)
	}
	return out
}
