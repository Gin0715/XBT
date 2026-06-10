package service

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// ==================== WebSocket Hub（前端实时推送） ====================

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true // 允许所有来源
	},
}

// WSMessage WebSocket 推送消息（服务端 → 客户端）
type WSMessage struct {
	Type string      `json:"type"`
	Data interface{} `json:"data"`
	Time int64       `json:"time"`
}

const (
	WSTypeQuizActivity = "quiz_activity" // 新抢答活动
	WSTypeQuizRecord   = "quiz_record"   // 抢答记录更新
	WSTypePing         = "ping"          // 心跳
	WSTypePong         = "pong"          // 心跳响应
)

// WSConn 单个前端 WebSocket 连接
type WSConn struct {
	conn     *websocket.Conn
	userUID  int64
	connID   string // 唯一标识，用于多连接管理
	courseID int64
	classID  int64
	send     chan []byte
	hub      *WSHub

	closeMu sync.Mutex
	closed  bool
	done    chan struct{} // writePump 退出时关闭
}

// WSHub 管理所有前端 WebSocket 连接
// 支持单用户多连接（每连接独立管理）
type WSHub struct {
	conns   map[int64]map[string]*WSConn // userUID → map[connID]conn
	mu      sync.RWMutex
	monitor *QuizMonitor
}

var DefaultWSHub = NewWSHub()

// SetMonitor 设置监控管理器（WS 连接断开时自动停止监控）
func (h *WSHub) SetMonitor(m *QuizMonitor) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.monitor = m
}

func NewWSHub() *WSHub {
	return &WSHub{
		conns: make(map[int64]map[string]*WSConn),
	}
}

// generateConnID 生成唯一连接 ID（16 字节随机 hex）
func generateConnID() string {
	b := make([]byte, 8)
	rand.Read(b)
	return fmt.Sprintf("%x", b)
}

// Register 注册新连接，支持单用户多连接共存
// v2 改进：
//   - 不再踢掉旧连接，同用户多个连接可以共存
//   - 每个连接有独立 connID，后续断开时只移除对应连接
//   - 自动启动预热（首个连接启动，后续连接复用已有预热）
func (h *WSHub) Register(conn *websocket.Conn, userUID, courseID, classID int64) *WSConn {
	h.mu.Lock()

	connID := generateConnID()
	wc := &WSConn{
		conn:     conn,
		userUID:  userUID,
		connID:   connID,
		courseID: courseID,
		classID:  classID,
		send:     make(chan []byte, 64),
		hub:      h,
		done:     make(chan struct{}),
	}

	if h.conns[userUID] == nil {
		h.conns[userUID] = make(map[string]*WSConn)
	}
	h.conns[userUID][connID] = wc
	connCount := len(h.conns[userUID])
	h.mu.Unlock()

	log.Printf("[WSHub] ✅ 前端 WS 已连接: uid=%d conn=%s course=%d class=%d (共%d个连接)",
		userUID, connID[:8], courseID, classID, connCount)

	go wc.writePump()
	go wc.readPump()

	// WS 连接时自动启动预热（仅当尚未运行时启动，由 monitor 内部去重）
	if h.monitor != nil {
		go h.monitor.StartPreWarmFromDB(userUID, courseID, classID)
	}

	return wc
}

// Unregister 注销指定连接
// v2 改进：接受 connID 参数，只移除对应连接，不影响同一用户的其他连接
// 当用户所有连接都断开时，才会完全停止监控和预热
func (h *WSHub) Unregister(userUID int64, connID ...string) {
	h.mu.Lock()
	defer h.mu.Unlock()

	conns, exists := h.conns[userUID]
	if !exists {
		return
	}

	// 如果提供了 connID，只移除指定连接
	if len(connID) > 0 && connID[0] != "" {
		if wc, ok := conns[connID[0]]; ok {
			wc.closeMu.Lock()
			if !wc.closed {
				wc.closed = true
				close(wc.send)
			}
			wc.closeMu.Unlock()
			delete(conns, connID[0])
			log.Printf("[WSHub] 移除连接: uid=%d conn=%s", userUID, connID[0][:8])
		}
	}

	// 用户没有任何剩余连接 → 清理用户条目并停止预热
	if len(h.conns[userUID]) == 0 {
		delete(h.conns, userUID)
		if h.monitor != nil {
			h.monitor.FullStop(userUID)
		}
		log.Printf("[WSHub] 用户所有连接已断开: uid=%d（已停止预热）", userUID)
	}
}

// BroadcastToUser 向指定用户的所有 WebSocket 连接推送消息（非阻塞）
func (h *WSHub) BroadcastToUser(userUID int64, msg WSMessage) {
	msg.Time = time.Now().UnixMilli()
	data, err := json.Marshal(msg)
	if err != nil {
		return
	}

	h.mu.RLock()
	conns, exists := h.conns[userUID]
	h.mu.RUnlock()
	if !exists {
		return
	}

	for _, wc := range conns {
		wc.trySend(data)
	}
}

// BroadcastToCourse 向监控同一课程的所有用户的所有连接推送消息
func (h *WSHub) BroadcastToCourse(courseID int64, msg WSMessage) {
	msg.Time = time.Now().UnixMilli()
	data, err := json.Marshal(msg)
	if err != nil {
		return
	}

	h.mu.RLock()
	defer h.mu.RUnlock()
	for _, conns := range h.conns {
		for _, wc := range conns {
			if wc.courseID == courseID {
				wc.trySend(data)
			}
		}
	}
}

// ConnCount 返回当前所有连接数（所有用户合计）
func (h *WSHub) ConnCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	count := 0
	for _, conns := range h.conns {
		count += len(conns)
	}
	return count
}

// ==================== WSConn 方法 ====================

// shutdown 优雅关闭连接：关闭 send channel 让 writePump 自行退出
// 不会直接调用 conn.Close()，由 writePump 负责清理
func (wc *WSConn) shutdown() {
	wc.closeMu.Lock()
	defer wc.closeMu.Unlock()
	if wc.closed {
		return
	}
	wc.closed = true
	close(wc.send)
}

// trySend 非阻塞发送，连接已关闭时静默丢弃
func (wc *WSConn) trySend(data []byte) {
	wc.closeMu.Lock()
	closed := wc.closed
	wc.closeMu.Unlock()
	if closed {
		return
	}
	select {
	case wc.send <- data:
	default:
		// 发送队列满，丢弃（客户端消费太慢）
	}
}

// writePump 向客户端写入消息（单一写入者，杜绝并发 WriteMessage）
func (wc *WSConn) writePump() {
	defer close(wc.done)
	defer func() {
		wc.conn.Close()
		// 优雅退出时传入 connID 只移除本连接
		wc.hub.Unregister(wc.userUID, wc.connID)
	}()

	ticker := time.NewTicker(25 * time.Second) // 25s ping
	defer ticker.Stop()

	for {
		select {
		case msg, ok := <-wc.send:
			if !ok {
				// send channel 已关闭 —— 优雅退出
				wc.conn.SetWriteDeadline(time.Now().Add(3 * time.Second))
				wc.conn.WriteMessage(websocket.CloseMessage,
					websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
				return
			}
			wc.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := wc.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-ticker.C:
			wc.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := wc.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// readPump 从客户端读取消息（主要处理 pong 和关闭）
func (wc *WSConn) readPump() {
	defer wc.hub.Unregister(wc.userUID, wc.connID)

	wc.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	wc.conn.SetPongHandler(func(string) error {
		wc.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	for {
		_, _, err := wc.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
				log.Printf("[WSHub] WS 读取异常: uid=%d conn=%s err=%v", wc.userUID, wc.connID[:8], err)
			}
			return
		}
	}
}

// ==================== 辅助 ====================

// UpgradeWS 将 HTTP 连接升级为 WebSocket
func UpgradeWS(w http.ResponseWriter, r *http.Request) (*websocket.Conn, error) {
	return upgrader.Upgrade(w, r, nil)
}

// BroadcastQuizActivity 便捷方法：推送抢答活动给指定用户
func BroadcastQuizActivity(userUID int64, evt MonitorEvent) {
	DefaultWSHub.BroadcastToUser(userUID, WSMessage{
		Type: WSTypeQuizActivity,
		Data: evt,
	})
}

// BroadcastQuizRecord 便捷方法：推送抢答记录给指定用户
func BroadcastQuizRecord(userUID int64, evt MonitorEvent) {
	DefaultWSHub.BroadcastToUser(userUID, WSMessage{
		Type: WSTypeQuizRecord,
		Data: evt,
	})
}
