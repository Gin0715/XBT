package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"xbt2/server/internal/common"
	mainmodel "xbt2/server/internal/model"
	"xbt2/server/internal/quiz/model"
	quizsvc "xbt2/server/internal/quiz/service"
	svc "xbt2/server/internal/service"
	"xbt2/server/internal/xxt"
)

type QuizHandler struct {
	db        *gorm.DB
	xxtClient *xxt.Client
	cc        *svc.CredentialCrypto
	svc       *quizsvc.QuizService
}

func NewQuizHandler(db *gorm.DB, xxtClient *xxt.Client, cc *svc.CredentialCrypto, svc *quizsvc.QuizService) *QuizHandler {
	return &QuizHandler{db: db, xxtClient: xxtClient, cc: cc, svc: svc}
}

// ================= 内部辅助函数 =================

func getUserUID(c *gin.Context) int64 {
	if uid := common.GetUserUID(c); uid != 0 {
		return uid
	}
	keys := []string{"uid", "user_id", "userID", "userId", "sub", "id"}
	var val any
	var exists bool
	for _, key := range keys {
		val, exists = c.Get(key)
		if exists {
			break
		}
	}
	if !exists {
		return 0
	}
	switch v := val.(type) {
	case int64:
		return v
	case int:
		return int64(v)
	case float64:
		return int64(v)
	case uint:
		return int64(v)
	case string:
		var id int64
		json.Unmarshal([]byte(v), &id)
		return id
	}
	return 0
}

func success(c *gin.Context, data interface{}) {
	c.JSON(http.StatusOK, gin.H{"code": 0, "msg": "ok", "data": data})
}

func fail(c *gin.Context, httpCode int, msg string) {
	c.JSON(httpCode, gin.H{"code": -1, "msg": msg, "data": nil})
}

// ================= 配置管理 =================

func (h *QuizHandler) GetConfig(c *gin.Context) {
	uid := getUserUID(c)
	if uid == 0 {
		fail(c, http.StatusInternalServerError, "无法获取用户信息")
		return
	}
	config, err := h.svc.GetConfig(uid)
	if err != nil {
		fail(c, http.StatusInternalServerError, "获取配置失败")
		return
	}
	success(c, config)
}

func (h *QuizHandler) UpdateConfig(c *gin.Context) {
	uid := getUserUID(c)
	if uid == 0 {
		fail(c, http.StatusInternalServerError, "无法获取用户信息")
		return
	}
	var config model.QuizConfig
	if err := c.ShouldBindJSON(&config); err != nil {
		fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	if err := h.svc.UpdateConfig(uid, &config); err != nil {
		fail(c, http.StatusInternalServerError, "更新配置失败")
		return
	}
	success(c, nil)
}

// ================= 核心业务：一键抢答 =================

// SubmitAnswer 手动一键抢答
// 短延迟（≤1000ms）同步返回结果，长延迟异步通过 WS/SSE 推送
func (h *QuizHandler) SubmitAnswer(c *gin.Context) {
	uid := getUserUID(c)
	if uid == 0 {
		fail(c, http.StatusInternalServerError, "系统错误：无法获取用户信息，请检查 JWT 配置")
		return
	}

	var req struct {
		ActiveID        int64 `json:"active_id"`
		ActivePrimaryID int64 `json:"activePrimaryId"`
		CourseID        int64 `json:"course_id"`
		ClassID         int64 `json:"class_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "参数错误: "+err.Error())
		return
	}

	activeID := req.ActivePrimaryID
	if activeID == 0 {
		activeID = req.ActiveID
	}
	if activeID == 0 || req.CourseID == 0 || req.ClassID == 0 {
		fail(c, http.StatusBadRequest, "缺少必要参数 (active_id, course_id, class_id)")
		return
	}

	// 调用服务层执行抢答
	result, err := h.svc.ManualQuickAnswer(context.Background(), uid, activeID, req.CourseID, req.ClassID)
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}

	success(c, result)
}

func (h *QuizHandler) GetActivities(c *gin.Context) {
	uid := getUserUID(c)
	if uid == 0 {
		fail(c, http.StatusInternalServerError, "无法获取用户信息")
		return
	}
	var activities []model.QuizActivity
	h.db.Where("user_uid = ?", uid).Order("created_at desc").Limit(50).Find(&activities)
	success(c, activities)
}

func (h *QuizHandler) GetRecords(c *gin.Context) {
	uid := getUserUID(c)
	if uid == 0 {
		fail(c, http.StatusInternalServerError, "无法获取用户信息")
		return
	}
	var records []model.QuizRecord
	h.db.Where("user_uid = ?", uid).Order("created_at desc").Limit(50).Find(&records)
	success(c, records)
}

func (h *QuizHandler) ClearRecords(c *gin.Context) {
	uid := getUserUID(c)
	if uid == 0 {
		fail(c, http.StatusInternalServerError, "无法获取用户信息")
		return
	}
	h.db.Where("user_uid = ?", uid).Delete(&model.QuizRecord{})
	h.db.Where("user_uid = ?", uid).Delete(&model.QuizActivity{})
	success(c, gin.H{"message": "已清空抢答记录"})
}

// ================= 日志管理 =================

func (h *QuizHandler) GetLogs(c *gin.Context) {
	uid := getUserUID(c)
	if uid == 0 {
		fail(c, http.StatusInternalServerError, "无法获取用户信息")
		return
	}
	var logs []model.QuizLog
	h.db.Where("user_uid = ?", uid).Order("created_at desc").Limit(100).Find(&logs)
	success(c, logs)
}

func (h *QuizHandler) ClearLogs(c *gin.Context) {
	uid := getUserUID(c)
	if uid == 0 {
		fail(c, http.StatusInternalServerError, "无法获取用户信息")
		return
	}
	h.db.Where("user_uid = ?", uid).Delete(&model.QuizLog{})
	success(c, gin.H{"message": "已清空抢答日志"})
}

// ================= SSE 实时事件推送 =================

func (h *QuizHandler) Events(c *gin.Context) {
	uid := getUserUID(c)
	if uid == 0 {
		fail(c, http.StatusInternalServerError, "无法获取用户信息")
		return
	}

	ch, cancel := h.svc.Subscribe(uid)
	defer cancel()

	c.Writer.Header().Set("Content-Type", "text/event-stream")
	c.Writer.Header().Set("Cache-Control", "no-cache")
	c.Writer.Header().Set("Connection", "keep-alive")
	c.Writer.Header().Set("X-Accel-Buffering", "no")

	keepalive := time.NewTicker(15 * time.Second)
	defer keepalive.Stop()

	c.Stream(func(w io.Writer) bool {
		select {
		case evt, ok := <-ch:
			if !ok {
				return false
			}
			data, _ := json.Marshal(evt)
			fmt.Fprintf(w, "event: %s\ndata: %s\n\n", evt.Type, string(data))
			return true
		case <-keepalive.C:
			fmt.Fprintf(w, ": keepalive\n\n")
			return true
		case <-c.Request.Context().Done():
			return false
		}
	})
}

// ================= WebSocket 实时推送 =================

func (h *QuizHandler) WS(c *gin.Context) {
	uid := getUserUID(c)
	if uid == 0 {
		fail(c, http.StatusInternalServerError, "无法获取用户信息")
		return
	}

	courseID, _ := strconv.ParseInt(c.Query("course_id"), 10, 64)
	classID, _ := strconv.ParseInt(c.Query("class_id"), 10, 64)

	conn, err := quizsvc.UpgradeWS(c.Writer, c.Request)
	if err != nil {
		log.Printf("[QuizWS] 升级失败: uid=%d err=%v", uid, err)
		return
	}

	quizsvc.DefaultWSHub.Register(conn, uid, courseID, classID)
}

// ================= 统一抢答控制 =================

// ToggleMonitor 一键抢答：立即检测当前活动并执行抢答（一次性操作，无后台监控）
// 检测结果通过 WS 实时推送
// POST /api/quiz/one-click-answer
func (h *QuizHandler) ToggleMonitor(c *gin.Context) {
	uid := getUserUID(c)
	if uid == 0 {
		fail(c, http.StatusInternalServerError, "系统错误：无法获取用户信息")
		return
	}

	// 解密凭证
	var user mainmodel.User
	if err := h.db.Where("uid = ?", uid).First(&user).Error; err != nil {
		fail(c, http.StatusNotFound, "用户不存在")
		return
	}
	password, err := h.cc.Decrypt(user.CredentialCipher)
	if err != nil {
		fail(c, http.StatusBadRequest, "登录凭证解密失败")
		return
	}

	// 获取当前配置课程
	cfg, err := h.svc.GetConfig(uid)
	if err != nil || cfg == nil || cfg.CourseID == 0 || cfg.ClassID == 0 {
		fail(c, http.StatusBadRequest, "请先配置课程")
		return
	}

	// 检测并抢答当前课程的抢答活动
	detected, _ := h.svc.Monitor.OneClickAnswer(uid, user.Mobile, password, cfg.CourseID, cfg.ClassID)

	success(c, gin.H{
		"detected":  detected,
		"answering": detected > 0,
	})

}

// GetStatus 获取当前状态
// GET /api/quiz/status
func (h *QuizHandler) GetStatus(c *gin.Context) {
	uid := getUserUID(c)
	if uid == 0 {
		fail(c, http.StatusInternalServerError, "无法获取用户信息")
		return
	}

	mode := h.svc.Monitor.GetMode(uid)
	cfg, _ := h.svc.GetConfig(uid)

	status := "off"
	if mode == quizsvc.MonitorPreWarm {
		status = "prewarming"
	}

	// 查询最近活动（只展示当前配置课程）
	var now = time.Now().UnixMilli()
	var activities []model.QuizActivity
	query := h.db.Where("user_uid = ?", uid)
	if cfg != nil && cfg.CourseID > 0 {
		query = query.Where("course_id = ?", cfg.CourseID)
	}
	query.Order("created_at desc").Limit(10).Find(&activities)

	// 查询已有记录的活动 ID 集合（有记录说明已处理过：已抢答/已结束/人数满）
	var recordIDs []int64
	h.db.Model(&model.QuizRecord{}).Where("user_uid = ?", uid).Pluck("activity_id", &recordIDs)
	recorded := make(map[int64]bool, len(recordIDs))
	for _, id := range recordIDs {
		recorded[id] = true
	}

	for i, act := range activities {
		if act.Status != 1 {
			continue
		}
		// 条件1：end_time 已过
		if act.EndTime > 0 && now >= act.EndTime {
			activities[i].Status = 2
			continue
		}
		// 条件2：已有抢答记录（说明已被处理过——无论成功失败或已结束）
		if recorded[act.ActivityID] {
			activities[i].Status = 2
		}
	}

	// 查询统计
	var totalRecords int64
	var successRecords int64
	h.db.Model(&model.QuizRecord{}).Where("user_uid = ?", uid).Count(&totalRecords)
	h.db.Model(&model.QuizRecord{}).Where("user_uid = ? AND success = ?", uid, true).Count(&successRecords)

	success(c, gin.H{
		"mode":         status,
		"running":      false,
		"prewarming":   mode == quizsvc.MonitorPreWarm,
		"config":       cfg,
		"activities":   activities,
		"total_count":  totalRecords,
		"success_count": successRecords,
	})
}

// ================= 旧接口保留兼容 =================

// StartMonitor 启动预热
func (h *QuizHandler) StartMonitor(c *gin.Context) {
	uid := getUserUID(c)
	if uid == 0 {
		fail(c, http.StatusInternalServerError, "无法获取用户信息")
		return
	}

	var user mainmodel.User
	if err := h.db.Where("uid = ?", uid).First(&user).Error; err != nil {
		fail(c, http.StatusNotFound, "用户不存在")
		return
	}
	password, err := h.cc.Decrypt(user.CredentialCipher)
	if err != nil {
		fail(c, http.StatusBadRequest, "登录凭证解密失败")
		return
	}

	cfg, err := h.svc.GetConfig(uid)
	if err != nil || cfg == nil || cfg.CourseID == 0 || cfg.ClassID == 0 {
		fail(c, http.StatusBadRequest, "请先配置课程")
		return
	}

	h.svc.Monitor.StartPreWarm(uid, user.Mobile, password, cfg.CourseID, cfg.ClassID)
	success(c, gin.H{"message": "预热已启动"})
}

// StopMonitor 停止预热
func (h *QuizHandler) StopMonitor(c *gin.Context) {
	uid := getUserUID(c)
	if uid == 0 {
		fail(c, http.StatusInternalServerError, "无法获取用户信息")
		return
	}

	h.svc.Monitor.Stop(uid)
	success(c, gin.H{"message": "已停止"})
}
