package service

import (
	"context"
	"log"
	"sync"
	"time"

	"xbt2/server/internal/xxt"
)

// ==================== 监控模式常量 ====================

const (
	MonitorOff     = iota // 完全停止
	MonitorPreWarm        // 预热保活：用户凭证已缓存
)

// userMonitorState 每个用户的预热状态
type userMonitorState struct {
	cancel   context.CancelFunc
	ctx      context.Context // 用户专属 context（WS 断开时 cancel，传递给异步任务）
	mode     int
	mobile   string
	password string
	courseID int64
	classID  int64

	cache   *ActivityCache // 活动列表缓存（预热轮询写入，detectActivities 快速读取）
	cacheMu sync.Mutex
}

// ActivityCache 预热活动列表缓存
type ActivityCache struct {
	Activities  []xxt.Active // 缓存的活动列表
	LastUpdated time.Time    // 上次更新时间
	ExpiresAt   time.Time    // 过期时间
}

// IsValid 检查缓存是否在有效期内
func (c *ActivityCache) IsValid() bool {
	return c != nil && time.Now().Before(c.ExpiresAt)
}

// Update 更新缓存内容并重置有效期
func (c *ActivityCache) Update(activities []xxt.Active, ttl time.Duration) {
	if c == nil {
		return
	}
	now := time.Now()
	c.Activities = activities
	c.LastUpdated = now
	c.ExpiresAt = now.Add(ttl)
}

const (
	preWarmInterval          = 60 * time.Second // 活动列表轮询间隔
	cacheTTL                 = 10 * time.Second // 缓存有效期（缩短到 10s，降低新活动检测延迟）
	sessionKeepaliveInterval = 50 * time.Second // session 保活间隔（略小于轮询间隔，错峰执行）
)

// ==================== 预热循环 ====================

// preWarmLoop 预热保活循环（替代原来的空循环）
// 功能：
//  1. 每 60s 调用 GetActivesAllFast 拉取活动列表，写入 ActivityCache（TTL=30s）
//  2. 每 50s 调用 GetPanUploadToken 做轻量 session 保活（超星 side cookie 保鲜）
//  3. 两个 ticker 错峰执行，避免请求突发
//  4. 首次立即执行一次，快速建立缓存
//  5. 生命周期绑定 WebSocket：WS连接 → 预热启动，WS断开 → 完全停止
func (qm *QuizMonitor) preWarmLoop(ctx context.Context, userUID int64, mobile, password string, courseID, classID int64) {
	// 首次进入时初始化缓存
	qm.mu.Lock()
	if state, exists := qm.users[userUID]; exists {
		state.cacheMu.Lock()
		state.cache = &ActivityCache{}
		state.cacheMu.Unlock()
	}
	qm.mu.Unlock()

	log.Printf("[QuizMonitor] 🔥 预热启动: uid=%d course=%d class=%d（60s轮询保活）", userUID, courseID, classID)

	ticker := time.NewTicker(preWarmInterval)
	defer ticker.Stop()

	keepaliveTicker := time.NewTicker(sessionKeepaliveInterval)
	defer keepaliveTicker.Stop()

	// 首次立即执行一次，快速建立缓存
	qm.preWarmFetch(userUID, mobile, password, courseID, classID)

	for {
		select {
		case <-ctx.Done():
			log.Printf("[QuizMonitor] 预热退出: uid=%d", userUID)
			return

		case <-ticker.C:
			// 60s 轮询：拉取活动列表，更新缓存，同时保持 session 活跃
			qm.preWarmFetch(userUID, mobile, password, courseID, classID)

		case <-keepaliveTicker.C:
			// 50s 轻量保活：两次轮询中间做一次无副作用请求，确保 cookie 不过期
			qm.preWarmKeepalive(mobile, password)
		}
	}
}

// preWarmFetch 执行一次预热拉取
// 调用 GetActivesAllFast（xxt client 内部有 200ms 缓存，60s 间隔必定触发网络请求）
// 结果写入 userMonitorState.cache，供 detectActivities 优先读取
func (qm *QuizMonitor) preWarmFetch(userUID int64, mobile, password string, courseID, classID int64) {
	actives, err := qm.xxtCli.GetActivesAllFast(mobile, password, courseID, classID)
	if err != nil {
		log.Printf("[QuizMonitor] ⚠ 预热获取活动列表失败: uid=%d err=%v", userUID, err)
		return
	}

	qm.mu.Lock()
	if state, exists := qm.users[userUID]; exists {
		state.cacheMu.Lock()
		if state.cache == nil {
			state.cache = &ActivityCache{}
		}
		state.cache.Update(actives, cacheTTL)
		state.cacheMu.Unlock()
	}
	qm.mu.Unlock()

	if len(actives) > 0 {
		log.Printf("[QuizMonitor] 📋 预热缓存更新: uid=%d activities=%d", userUID, len(actives))
	}
}

// preWarmKeepalive 轻量 session 保活
// 通过 GetPanUploadToken 做一次低开销 API 请求，保持超星侧 cookie 不因 idle 而过期
// 此接口仅查询 token，无副作用
func (qm *QuizMonitor) preWarmKeepalive(mobile, password string) {
	_, err := qm.xxtCli.GetPanUploadToken(mobile, password)
	if err != nil {
		log.Printf("[QuizMonitor] ⚠ Session保活失败: mobile=%s err=%v", maskMobile(mobile), err)
	} else {
		log.Printf("[QuizMonitor] 💓 Session保活成功: mobile=%s", maskMobile(mobile))
	}
}

// maskMobile 隐藏手机号中间四位用于日志
func maskMobile(mobile string) string {
	if len(mobile) < 7 {
		return mobile
	}
	return mobile[:3] + "****" + mobile[len(mobile)-4:]
}
