package handler

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
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
	monitor   *quizsvc.QuizMonitorService
}

func NewQuizHandler(db *gorm.DB, xxtClient *xxt.Client, cc *svc.CredentialCrypto, monitor *quizsvc.QuizMonitorService) *QuizHandler {
	return &QuizHandler{db: db, xxtClient: xxtClient, cc: cc, monitor: monitor}
}

// ================= 内部辅助函数 =================

func getUserUID(c *gin.Context) int64 {
	// 优先使用 common 包的标准 key（与 auth 中间件一致）
	if uid := common.GetUserUID(c); uid != 0 {
		return uid
	}
	// 兼容其他可能的 key 名
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

// ================= 补全的路由方法 =================

func (h *QuizHandler) GetConfig(c *gin.Context) {
	uid := getUserUID(c)
	if uid == 0 {
		fail(c, http.StatusInternalServerError, "无法获取用户信息")
		return
	}
	config, err := h.monitor.GetConfig(uid)
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
	if err := h.monitor.UpdateConfig(uid, &config); err != nil {
		fail(c, http.StatusInternalServerError, "更新配置失败")
		return
	}
	success(c, nil)
}

func (h *QuizHandler) StartMonitor(c *gin.Context) {
	uid := getUserUID(c)
	if uid == 0 {
		fail(c, http.StatusInternalServerError, "无法获取用户信息")
		return
	}

	// 读取前端传来的 course_id / class_id
	var req struct {
		CourseID int64 `json:"course_id"`
		ClassID  int64 `json:"class_id"`
	}
	c.ShouldBindJSON(&req) // 忽略错误，可能为空

	// 如果请求体没传，尝试从已保存的配置中读取
	if req.CourseID == 0 || req.ClassID == 0 {
		cfg, _ := h.monitor.GetConfig(uid)
		if cfg != nil {
			req.CourseID = cfg.CourseID
			req.ClassID = cfg.ClassID
		}
	}

	if err := h.monitor.StartMonitor(uid, req.CourseID, req.ClassID); err != nil {
		fail(c, http.StatusInternalServerError, "启动监控失败: "+err.Error())
		return
	}
	success(c, gin.H{"message": "监控已启动"})
}

func (h *QuizHandler) StopMonitor(c *gin.Context) {
	uid := getUserUID(c)
	if uid == 0 {
		fail(c, http.StatusInternalServerError, "无法获取用户信息")
		return
	}
	h.monitor.StopMonitor(uid)
	success(c, gin.H{"message": "监控已停止"})
}

func (h *QuizHandler) GetStatus(c *gin.Context) {
	uid := getUserUID(c)
	if uid == 0 {
		fail(c, http.StatusInternalServerError, "无法获取用户信息")
		return
	}
	status := h.monitor.GetMonitorStatus(uid)
	success(c, status)
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

// ================= SSE 实时事件推送 =================

func (h *QuizHandler) Events(c *gin.Context) {
	uid := getUserUID(c)
	if uid == 0 {
		fail(c, http.StatusInternalServerError, "无法获取用户信息")
		return
	}

	ch, cancel := h.monitor.Subscribe(uid)
	defer cancel()

	c.Writer.Header().Set("Content-Type", "text/event-stream")
	c.Writer.Header().Set("Cache-Control", "no-cache")
	c.Writer.Header().Set("Connection", "keep-alive")
	c.Writer.Header().Set("X-Accel-Buffering", "no")

	// SSE 心跳：每 15s 发送注释行，防止 nginx/cloudflare 超时断开
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
			// SSE 协议心跳（注释行，客户端 EventSource 自动忽略）
			fmt.Fprintf(w, ": keepalive\n\n")
			return true
		case <-c.Request.Context().Done():
			return false
		}
	})
}

// ================= WebSocket 实时推送（前端连接） =================

func (h *QuizHandler) WS(c *gin.Context) {
	uid := getUserUID(c)
	if uid == 0 {
		fail(c, http.StatusInternalServerError, "无法获取用户信息")
		return
	}

	// 从 query param 提取课程信息
	courseID, _ := strconv.ParseInt(c.Query("course_id"), 10, 64)
	classID, _ := strconv.ParseInt(c.Query("class_id"), 10, 64)

	// 升级 HTTP → WebSocket
	conn, err := quizsvc.UpgradeWS(c.Writer, c.Request)
	if err != nil {
		log.Printf("[QuizWS] 升级失败: uid=%d err=%v", uid, err)
		return
	}

	// 注册到 Hub（自动踢掉旧连接）
	quizsvc.DefaultWSHub.Register(conn, uid, courseID, classID)
}

// ================= 核心业务接口 =================

func (h *QuizHandler) SubmitAnswer(c *gin.Context) {
	uid := getUserUID(c)
	if uid == 0 {
		// ✅ 修复：改为 500，防止前端误判为 Token 过期
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

	activeId := req.ActivePrimaryID
	if activeId == 0 { 
		activeId = req.ActiveID 
	}

	if activeId == 0 || req.CourseID == 0 || req.ClassID == 0 {
		fail(c, http.StatusBadRequest, "缺少必要参数 (active_id, course_id, class_id)")
		return
	}

	var user mainmodel.User
	if err := h.db.Where("uid = ?", uid).First(&user).Error; err != nil {
		fail(c, http.StatusNotFound, "用户不存在")
		return
	}

	password, err := h.cc.Decrypt(user.CredentialCipher)
	if err != nil {
		// ✅ 修复：改为 400，并打印详细日志，绝不返回 401！
		log.Printf("❌ [用户%d] 解密凭证失败: %v, cipher_len=%d", uid, err, len(user.CredentialCipher))
		fail(c, http.StatusBadRequest, "登录凭证解密失败，请在系统中重新绑定/登录超星账号")
		return
	}

	result, err := h.xxtClient.QuickAnswer(user.Mobile, password, req.CourseID, req.ClassID, activeId)
	if err != nil {
		fail(c, http.StatusInternalServerError, "抢答请求失败: "+err.Error())
		return
	}

	isSuccess := false
	resultMsg := "抢答结果未知"

	// 基于真实抓包解析 stuAnswer 返回（与 monitor.autoAnswer 一致）
	var res struct {
		Result   int             `json:"result"`
		Msg      string          `json:"msg"`
		ErrorMsg string          `json:"errorMsg"`
		Data     json.RawMessage `json:"data"`
	}

	if err := json.Unmarshal([]byte(result), &res); err == nil {
		if res.ErrorMsg != "" {
			resultMsg = res.ErrorMsg
		} else if res.Msg != "" {
			resultMsg = res.Msg
		}
		if res.Result == 1 {
			// result=1 可能表示成功，也可能是 data=1（人数已满）
			if string(res.Data) == "1" {
				isSuccess = false
				resultMsg = "抢答人数已达上限"
			} else {
				isSuccess = true
				if resultMsg == "" || resultMsg == res.ErrorMsg {
					resultMsg = "抢答成功！"
				}
			}
		}
	} else {
		lower := strings.ToLower(result)
		if strings.Contains(lower, "抢答成功") || strings.Contains(lower, "success") || strings.Contains(result, `"result":1`) {
			isSuccess = true
			resultMsg = "抢答成功！"
		} else if strings.Contains(lower, "fail") || strings.Contains(lower, "error") || strings.Contains(lower, "已结束") {
			resultMsg = result
		} else {
			resultMsg = result
		}
	}

	record := &model.QuizRecord{
		UserUID:    uid,
		ActivityID: activeId,
		Success:    isSuccess,
		Message:    resultMsg,
	}
	h.db.Create(record)

	if isSuccess {
		success(c, gin.H{"active_id": activeId, "message": resultMsg})
	} else {
		fail(c, http.StatusBadRequest, resultMsg)
	}
}