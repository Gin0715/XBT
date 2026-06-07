package service

import (
	"encoding/json"
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
	courseID int64
	classID  int64
	send     chan []byte
	hub      *WSHub

	closeMu sync.Mutex
	closed  bool
	done    chan struct{} // writePump 退出时关闭
}

// WSHub 管理所有前端 WebSocket 连接
type WSHub struct {
	conns map[int64]*WSConn // userUID → 唯一连接
	mu    sync.RWMutex
}

var DefaultWSHub = NewWSHub()

func NewWSHub() *WSHub {
	return &WSHub{
		conns: make(map[int64]*WSConn),
	}
}

// Register 注册新连接，踢掉旧连接（单用户唯一连接）
func (h *WSHub) Register(conn *websocket.Conn, userUID, courseID, classID int64) *WSConn {
	h.mu.Lock()
	// 踢掉旧连接（优雅关闭，等待 writePump 退出）
	if old, exists := h.conns[userUID]; exists {
		log.Printf("[WSHub] 踢掉旧连接: uid=%d", userUID)
		old.shutdown() // 仅关闭 send channel，writePump 自行退出
		// 等待旧 writePump 退出（最多 3s），释放 conn
		select {
		case <-old.done:
		case <-time.After(3 * time.Second):
			log.Printf("[WSHub] 旧连接 writePump 超时: uid=%d", userUID)
		}
		delete(h.conns, userUID)
	}

	wc := &WSConn{
		conn:     conn,
		userUID:  userUID,
		courseID: courseID,
		classID:  classID,
		send:     make(chan []byte, 64),
		hub:      h,
		done:     make(chan struct{}),
	}
	h.conns[userUID] = wc
	h.mu.Unlock()

	log.Printf("[WSHub] ✅ 前端 WS 已连接: uid=%d course=%d class=%d", userUID, courseID, classID)

	go wc.writePump()
	go wc.readPump()

	return wc
}

// Unregister 注销连接
func (h *WSHub) Unregister(userUID int64) {
	h.mu.Lock()
	if wc, exists := h.conns[userUID]; exists {
		wc.closeMu.Lock()
		isClosed := wc.closed
		if !isClosed {
			wc.closed = true
			close(wc.send)
		}
		wc.closeMu.Unlock()
		delete(h.conns, userUID)
	}
	h.mu.Unlock()
}

// BroadcastToUser 向指定用户推送消息（非阻塞，连接已关闭时静默丢弃）
func (h *WSHub) BroadcastToUser(userUID int64, msg WSMessage) {
	h.mu.RLock()
	wc, exists := h.conns[userUID]
	h.mu.RUnlock()
	if !exists {
		return
	}
	msg.Time = time.Now().UnixMilli()
	data, err := json.Marshal(msg)
	if err != nil {
		return
	}
	wc.trySend(data)
}

// BroadcastToCourse 向监控同一课程的所有用户推送消息
func (h *WSHub) BroadcastToCourse(courseID int64, msg WSMessage) {
	msg.Time = time.Now().UnixMilli()
	data, err := json.Marshal(msg)
	if err != nil {
		return
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	for _, wc := range h.conns {
		if wc.courseID == courseID {
			wc.trySend(data)
		}
	}
}

// ConnCount 返回当前连接数
func (h *WSHub) ConnCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.conns)
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
		// 确保 hub 清理（可能已被 Unregister 清理，幂等安全）
		wc.hub.Unregister(wc.userUID)
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
	defer wc.hub.Unregister(wc.userUID)

	wc.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	wc.conn.SetPongHandler(func(string) error {
		wc.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	for {
		_, _, err := wc.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
				log.Printf("[WSHub] WS 读取异常: uid=%d err=%v", wc.userUID, err)
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
