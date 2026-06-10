package service

import "time"

// BackoffStrategy 风控退避策略
type BackoffStrategy struct {
	BaseDelay       time.Duration // 基础退避时间 (默认 3s)
	MaxDelay        time.Duration // 最大退避时间 (默认 12s)
	CurrentDelay    time.Duration // 当前退避时间
	BackoffCount    int           // 连续退避次数
	MaxBackoffCount int           // 最大退避次数，达到后不再递增 (默认 6)
}

// NewBackoffStrategy 创建退避策略
func NewBackoffStrategy() *BackoffStrategy {
	return &BackoffStrategy{
		BaseDelay:       3 * time.Second,
		MaxDelay:        12 * time.Second,
		CurrentDelay:    0,
		BackoffCount:    0,
		MaxBackoffCount: 6,
	}
}

// NextBackoff 计算下一次退避时间（指数增长）
// 序列: 3s → 6s → 12s → 12s (max)
func (bs *BackoffStrategy) NextBackoff() time.Duration {
	if bs.BackoffCount >= bs.MaxBackoffCount {
		return bs.CurrentDelay
	}
	bs.BackoffCount++
	delay := bs.BaseDelay
	for i := 1; i < bs.BackoffCount; i++ {
		delay *= 2
		if delay >= bs.MaxDelay {
			delay = bs.MaxDelay
			break
		}
	}
	bs.CurrentDelay = delay
	return delay
}

// Reset 重置退避状态
func (bs *BackoffStrategy) Reset() {
	bs.BackoffCount = 0
	bs.CurrentDelay = 0
}

// IsInBackoff 当前是否在退避期
func (bs *BackoffStrategy) IsInBackoff(backoffUntil time.Time) bool {
	return time.Now().Before(backoffUntil)
}
