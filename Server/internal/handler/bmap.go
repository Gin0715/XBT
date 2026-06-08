package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"xbt2/server/internal/common"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
	"golang.org/x/sync/singleflight"
)

const (
	bmapSearchCachePrefix = "bmap:search:"
	bmapSearchTTL         = 24 * time.Hour
	bmapSearchAPI         = "https://api.map.baidu.com/place/v2/search"
)

type BMapHandler struct {
	redisClient *redis.Client
	httpClient  *http.Client
	apiKey      string
	flight      singleflight.Group
	mu          sync.Mutex
	lastCall    time.Time
}

func NewBMapHandler(redisClient *redis.Client, apiKey string) *BMapHandler {
	return &BMapHandler{
		redisClient: redisClient,
		httpClient: &http.Client{
			Timeout: 15 * time.Second,
		},
		apiKey:   apiKey,
		lastCall: time.Now().Add(-time.Second),
	}
}

func (h *BMapHandler) Search(c *gin.Context) {
	keyword := strings.TrimSpace(c.Query("keyword"))
	if keyword == "" {
		common.Fail(c, 400, "keyword 参数不能为空")
		return
	}

	// 优先使用前端传入的 AK（用户在前端 UI 配置的 Key），否则使用服务端配置
	ak := strings.TrimSpace(c.Query("ak"))
	if ak == "" {
		ak = h.apiKey
	}

	// 前端传入自定义 AK 时不做 Redis 缓存（避免 Key 泄漏、不同 Key 结果串混）
	if ak != h.apiKey {
		ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
		defer cancel()
		payload, err := h.requestBMapSearch(ctx, keyword, ak)
		if err != nil {
			common.Fail(c, 500, fmt.Sprintf("百度地图搜索失败: %v", err))
			return
		}
		c.Data(200, "application/json; charset=utf-8", payload)
		return
	}

	cacheKey := fmt.Sprintf("%s%s", bmapSearchCachePrefix, keyword)
	payload, err := h.fetchCachedOrRemote(c.Request.Context(), cacheKey, keyword, ak)
	if err != nil {
		common.Fail(c, 500, fmt.Sprintf("百度地图搜索失败: %v", err))
		return
	}

	c.Data(200, "application/json; charset=utf-8", payload)
}

func (h *BMapHandler) fetchCachedOrRemote(ctx context.Context, cacheKey, keyword, ak string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	cached, err := h.redisClient.Get(ctx, cacheKey).Bytes()
	if err == nil {
		return cached, nil
	}
	if err != nil && err != redis.Nil {
		log.Printf("bmap cache get error: %v", err)
	}

	result, err, _ := h.flight.Do(cacheKey, func() (interface{}, error) {
		if err := h.waitRateLimit(ctx); err != nil {
			return nil, err
		}

		payload, err := h.requestBMapSearch(ctx, keyword, ak)
		if err != nil {
			return nil, err
		}

		if err := h.redisClient.Set(ctx, cacheKey, payload, bmapSearchTTL).Err(); err != nil {
			log.Printf("bmap cache set failed: %v", err)
		}
		return payload, nil
	})
	if err != nil {
		return nil, err
	}

	bytes, ok := result.([]byte)
	if !ok {
		return nil, fmt.Errorf("unexpected cache fetch result type")
	}
	return bytes, nil
}

func (h *BMapHandler) waitRateLimit(ctx context.Context) error {
	h.mu.Lock()
	next := h.lastCall.Add(time.Second)
	now := time.Now()
	if next.After(now) {
		delay := next.Sub(now)
		h.lastCall = next
		h.mu.Unlock()

		select {
		case <-time.After(delay):
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	}

	h.lastCall = now
	h.mu.Unlock()
	return nil
}

func (h *BMapHandler) requestBMapSearch(ctx context.Context, keyword, ak string) ([]byte, error) {
	// 未传入 AK 时回退到服务端配置
	if ak == "" {
		ak = h.apiKey
	}
	if ak == "" {
		return nil, fmt.Errorf("未配置百度地图 API Key，请在地址库面板中配置")
	}

	endpoint, err := url.Parse(bmapSearchAPI)
	if err != nil {
		return nil, err
	}

	q := endpoint.Query()
	q.Set("query", keyword)
	q.Set("region", "全国")
	q.Set("output", "json")
	q.Set("scope", "2")
	q.Set("page_size", "15")
	q.Set("ak", ak)
	endpoint.RawQuery = q.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return nil, err
	}

	resp, err := h.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("百度地图返回状态 %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	if !json.Valid(body) {
		return nil, fmt.Errorf("百度地图返回了无效 JSON")
	}

	// 检查百度 API 的业务状态码
	var bmapResp struct {
		Status  int    `json:"status"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(body, &bmapResp); err == nil && bmapResp.Status != 0 {
		return nil, fmt.Errorf("百度地图 API 返回错误 [%d]: %s", bmapResp.Status, bmapResp.Message)
	}

	return body, nil

}
