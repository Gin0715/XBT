package service

import (
	"context"
	"log"
)

// ==================== 监控模式常量 ====================

const (
	MonitorOff     = iota // 完全停止
	MonitorPreWarm        // 预热保活：用户凭证已缓存
)

// userMonitorState 每个用户的预热状态
type userMonitorState struct {
	cancel   context.CancelFunc
	mode     int
	mobile   string
	password string
	courseID int64
	classID  int64
}

// ==================== 预热循环 ====================

// preWarmLoop 预热保活：仅保持用户凭证在内存中，不做任何网络请求
// 不轮询超星活动列表（避免触发风控），仅在用户点击一键抢答时强制拉取最新数据
// 超星 session 由 OneClickAnswer 中的 ensureSession 自动续期（24h内有效）
// 生命周期绑定 WebSocket：WS连接 → 预热启动，WS断开 → 完全停止
func (qm *QuizMonitor) preWarmLoop(ctx context.Context, userUID int64, _, _ string, courseID, classID int64) {
	log.Printf("[QuizMonitor] 🔥 预热就绪: uid=%d course=%d class=%d（凭证已缓存，等待抢答）", userUID, courseID, classID)

	// 预热期间完全不请求超星 API，静待用户点击一键抢答
	// 这种设计避免了频繁请求触发风控退避
	<-ctx.Done()
	log.Printf("[QuizMonitor] 预热退出: uid=%d", userUID)
}
