package xxt

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// ======================== 服务域名发现 ========================

// ServiceDomains 从 serviceDomainScript 解析出的服务域名配置
type ServiceDomains struct {
	Properties map[string]string // 所有 ServiceDomain.xxx 属性
	Vars       map[string]string // 所有 _CP_xxx 变量
	RawScript  string
	FetchedAt  time.Time
}

var (
	cachedDomains     *ServiceDomains
	domainsFetchMu    sync.Mutex
	domainsCacheTTL   = 1 * time.Hour // 域名配置缓存 1 小时
)

// FetchServiceDomains 获取并解析超星服务域名配置
func (c *Client) FetchServiceDomains(mobile, password string) (*ServiceDomains, error) {
	domainsFetchMu.Lock()
	defer domainsFetchMu.Unlock()

	if cachedDomains != nil && time.Since(cachedDomains.FetchedAt) < domainsCacheTTL {
		return cachedDomains, nil
	}

	s, err := c.ensureSession(mobile, password)
	if err != nil {
		return nil, fmt.Errorf("serviceDomain 登录失败: %w", err)
	}
	cli := *c.http
	cli.Jar = s.Jar

	scriptURL := "https://mobilelearn.chaoxing.com/widget/service-domain/serviceDomainScript?DB_STRATEGY=RANDOM"
	req, _ := http.NewRequest(http.MethodGet, scriptURL, nil)
	req.Header.Set("User-Agent", c.mobileUA)
	resp, err := cli.Do(req)
	if err != nil {
		return nil, fmt.Errorf("serviceDomain 请求失败: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	script := string(body)

	domains := &ServiceDomains{
		Properties: make(map[string]string),
		Vars:       make(map[string]string),
		RawScript:  script,
		FetchedAt:  time.Now(),
	}

	// 解析 ServiceDomain.xxx = "value" 模式
	svcRe := regexp.MustCompile(`ServiceDomain\.(\w+)\s*=\s*"([^"]*)"`)
	for _, match := range svcRe.FindAllStringSubmatch(script, -1) {
		domains.Properties[match[1]] = match[2]
	}

	// 解析 ServiceDomain["xxx"] = "value" 模式
	svcBracketRe := regexp.MustCompile(`ServiceDomain\["(\w+)"\]\s*=\s*"([^"]*)"`)
	for _, match := range svcBracketRe.FindAllStringSubmatch(script, -1) {
		domains.Properties[match[1]] = match[2]
	}

	// 解析 var _CP_xxx = "value" 模式
	varRe := regexp.MustCompile(`var\s+(_CP_\w+)\s*=\s*"([^"]*)"`)
	for _, match := range varRe.FindAllStringSubmatch(script, -1) {
		domains.Vars[match[1]] = match[2]
	}

	// 解析 var xxx = "value" 模式（更宽泛的变量声明）
	varRe2 := regexp.MustCompile(`var\s+(\w+)\s*=\s*"([^"]*)"`)
	for _, match := range varRe2.FindAllStringSubmatch(script, -1) {
		if !strings.HasPrefix(match[1], "_CP_") {
			domains.Vars[match[1]] = match[2]
			// 也加入 Properties 以便 WS 发现
			if _, exists := domains.Properties[match[1]]; !exists {
				domains.Properties[match[1]] = match[2]
			}
		}
	}

	// 诊断：解析不到 key 时输出脚本片段
	if len(domains.Properties) == 0 {
		preview := script
		if len(preview) > 500 {
			preview = preview[:500]
		}
		log.Printf("[WebSocket] ⚠️ serviceDomainScript 解析到 0 个 key, HTTP状态=%d, 脚本长度=%d, 预览:\n%s",
			resp.StatusCode, len(script), preview)
	}

	cachedDomains = domains
	return domains, nil
}

// DiscoverWSUrl 尝试从服务域名配置中发现 WebSocket URL（返回唯一最佳候选）
func (sd *ServiceDomains) DiscoverWSUrl() string {
	candidates := sd.DiscoverWSUrlCandidates()
	if len(candidates) > 0 {
		return candidates[0]
	}
	return ""
}

// DiscoverWSUrlCandidates 返回所有候选 WebSocket URL（按优先级排序）
func (sd *ServiceDomains) DiscoverWSUrlCandidates() []string {
	var candidates []string
	seen := make(map[string]bool)
	realCount := 0 // 真正从域名配置中发现的候选数

	addCandidate := func(url string) {
		if url != "" && !seen[url] {
			seen[url] = true
			candidates = append(candidates, url)
		}
	}

	// 阶段 1：搜索明确的 WebSocket 相关 key
	wsKeyPatterns := []string{
		"wsDomain", "wssDomain", "websocketDomain",
		"imDomain", "imWSDomain", "socketDomain", "socketUrl",
		"pushDomain", "realtimeDomain", "notificationDomain",
		"chatDomain", "messageDomain", "stompDomain",
		"wsUrl", "wssUrl", "websocketUrl", "pushUrl",
		"connectDomain", "streamDomain", "eventDomain",
		"linkDomain", "linkWSDomain", "ws",
	}
	for _, key := range wsKeyPatterns {
		if val, ok := sd.Properties[key]; ok && val != "" {
			addCandidate(buildWSUrl(val))
			realCount++
		}
	}

	// 阶段 2：在所有可用域名中搜索含关键字的 key
	for key, val := range sd.Properties {
		if val == "" {
			continue
		}
		lowerKey := strings.ToLower(key)
		lowerVal := strings.ToLower(val)
		if strings.Contains(lowerKey, "ws") || strings.Contains(lowerKey, "socket") ||
			strings.Contains(lowerKey, "push") || strings.Contains(lowerKey, "im") ||
			strings.Contains(lowerKey, "chat") || strings.Contains(lowerKey, "msg") ||
			strings.Contains(lowerKey, "event") || strings.Contains(lowerKey, "stream") ||
			strings.Contains(lowerVal, "websocket") || strings.Contains(lowerVal, "socket") {
			addCandidate(buildWSUrl(val))
			realCount++
		}
	}

	// 阶段 3：输出所有可用 key 以便调试
	var keys []string
	for k := range sd.Properties {
		keys = append(keys, k)
	}
	log.Printf("[WebSocket] 从域名配置发现 %d 个真实候选，可用域名 keys(%d): %v", realCount, len(keys), keys)

	// 阶段 4：兜底候选 — 仅在有真实候选时附加（否则跳过，避免无意义握手）
	if realCount > 0 {
		for _, host := range []string{"mobilelearn.chaoxing.com", "im.chaoxing.com"} {
			for _, path := range []string{"/ws", "/websocket", "/stomp"} {
				addCandidate("wss://" + host + path)
			}
		}
	} else if len(keys) == 0 {
		log.Printf("[WebSocket] 未发现任何域名配置且无兜底，跳过超星 WS 连接")
	} else {
		log.Printf("[WebSocket] 有 %d 个域名 key 但无 WS 相关 key，跳过无效兜底连接", len(keys))
	}

	return candidates
}

// buildWSUrl 从域名构造 WebSocket URL
func buildWSUrl(domain string) string {
	domain = strings.TrimSpace(domain)
	if domain == "" {
		return ""
	}
	// 去掉已有的协议前缀
	domain = strings.TrimPrefix(domain, "https://")
	domain = strings.TrimPrefix(domain, "http://")
	domain = strings.TrimPrefix(domain, "wss://")
	domain = strings.TrimPrefix(domain, "ws://")
	// 去掉尾部斜杠和已有路径
	if idx := strings.Index(domain, "/"); idx >= 0 {
		domain = domain[:idx]
	}
	domain = strings.TrimRight(domain, "/")
	return "wss://" + domain + "/ws"
}

// ======================== WebSocket 客户端 ========================

// WSEvent WebSocket 推送的实时事件
type WSEvent struct {
	Type       string          `json:"type"`                 // activity_new / activity_update / activity_end
	ActivityID int64           `json:"activity_id,omitempty"`
	Name       string          `json:"name,omitempty"`
	CourseID   int64           `json:"course_id,omitempty"`
	ClassID    int64           `json:"class_id,omitempty"`
	StartTime  int64           `json:"start_time,omitempty"` // 毫秒时间戳
	EndTime    int64           `json:"end_time,omitempty"`
	Status     int             `json:"status,omitempty"` // 0待开始 1进行中 2已结束
	RawData    json.RawMessage `json:"raw,omitempty"`
}

// WSClient WebSocket 客户端，用于接收超星实时活动推送
type WSClient struct {
	conn     *websocket.Conn
	courseID int64
	classID  int64
	msgChan  chan WSEvent
	done     chan struct{}
	closed   bool
	mu       sync.Mutex
	wsURL    string
}

// ConnectWS 建立 WebSocket 连接
func (c *Client) ConnectWS(mobile, password string, courseID, classID int64, wsURL string) (*WSClient, error) {
	if wsURL == "" {
		return nil, fmt.Errorf("WebSocket URL 为空")
	}

	s, err := c.ensureSession(mobile, password)
	if err != nil {
		return nil, fmt.Errorf("WS 登录失败: %w", err)
	}

	// 从 cookie jar 提取 cookies 转为 HTTP header
	cookieHeader := buildCookieHeader(s, wsURL)

	headers := http.Header{}
	headers.Set("User-Agent", c.mobileUA)
	headers.Set("Origin", "https://mobilelearn.chaoxing.com")
	if cookieHeader != "" {
		headers.Set("Cookie", cookieHeader)
	}

	dialer := websocket.Dialer{
		HandshakeTimeout: 10 * time.Second,
	}

	conn, _, err := dialer.Dial(wsURL, headers)
	if err != nil {
		return nil, fmt.Errorf("WS 连接失败: %w", err)
	}

	ws := &WSClient{
		conn:     conn,
		courseID: courseID,
		classID:  classID,
		msgChan:  make(chan WSEvent, 64),
		done:     make(chan struct{}),
		wsURL:    wsURL,
	}

	// 发送订阅消息
	ws.subscribe()

	// 启动读协程
	go ws.readPump()

	// 启动 ping 保活
	go ws.pingLoop()

	return ws, nil
}

// buildCookieHeader 从 session 的 cookie jar 构建 Cookie header
func buildCookieHeader(s *Session, wsURL string) string {
	u, err := url.Parse(wsURL)
	if err != nil {
		return ""
	}
	// 也检查 https 版本的 cookies
	httpsURL := &url.URL{Scheme: "https", Host: u.Host}
	httpURL := &url.URL{Scheme: "http", Host: u.Host}

	var cookies []string
	for _, ck := range s.Jar.Cookies(httpsURL) {
		cookies = append(cookies, ck.Name+"="+ck.Value)
	}
	for _, ck := range s.Jar.Cookies(httpURL) {
		// 避免重复
		found := false
		for _, existing := range cookies {
			if strings.HasPrefix(existing, ck.Name+"=") {
				found = true
				break
			}
		}
		if !found {
			cookies = append(cookies, ck.Name+"="+ck.Value)
		}
	}
	return strings.Join(cookies, "; ")
}

// subscribe 发送订阅消息到 WebSocket
// 尝试多种协议格式以兼容超星的不同实现
func (ws *WSClient) subscribe() {
	// 尝试 STOMP 风格订阅
	stompFrame := fmt.Sprintf(
		"SUBSCRIBE\nid:sub-0\ndestination:/course/%d/%d\n\n\x00",
		ws.courseID, ws.classID,
	)
	ws.conn.WriteMessage(websocket.TextMessage, []byte(stompFrame))

	// 也尝试 JSON 风格订阅
	jsonSub := map[string]interface{}{
		"type":     "subscribe",
		"courseId": ws.courseID,
		"classId":  ws.classID,
		"channels": []string{
			fmt.Sprintf("course:%d:%d", ws.courseID, ws.classID),
			"activity",
		},
	}
	if data, err := json.Marshal(jsonSub); err == nil {
		ws.conn.WriteMessage(websocket.TextMessage, data)
	}

	// 最小订阅：仅发送课程信息
	minSub := fmt.Sprintf(`{"action":"subscribe","courseId":%d,"classId":%d}`, ws.courseID, ws.classID)
	ws.conn.WriteMessage(websocket.TextMessage, []byte(minSub))
}

// readPump 持续读取 WebSocket 消息
func (ws *WSClient) readPump() {
	defer close(ws.done)

	for {
		_, message, err := ws.conn.ReadMessage()
		if err != nil {
			ws.mu.Lock()
			if !ws.closed {
				log.Printf("[WebSocket] 读取失败: %v", err)
			}
			ws.mu.Unlock()
			return
		}

		events := ws.parseMessage(message)
		for _, evt := range events {
			select {
			case ws.msgChan <- evt:
			default:
				// channel 满，丢弃（防止阻塞）
			}
		}
	}
}

// parseMessage 解析 WebSocket 消息为 WSEvent 列表
func (ws *WSClient) parseMessage(data []byte) []WSEvent {
	text := strings.TrimSpace(string(data))
	if text == "" || text == "\n" || text == "\x00" {
		return nil
	}

	// 尝试 JSON 解析
	var events []WSEvent

	// 尝试单条 JSON
	var single map[string]interface{}
	if json.Unmarshal(data, &single) == nil {
		evt := ws.extractEvent(single)
		if evt != nil {
			events = append(events, *evt)
		}
		return events
	}

	// 尝试 JSON 数组
	var arr []map[string]interface{}
	if json.Unmarshal(data, &arr) == nil {
		for _, item := range arr {
			evt := ws.extractEvent(item)
			if evt != nil {
				events = append(events, *evt)
			}
		}
		return events
	}

	return nil
}

// extractEvent 从 JSON map 提取 WSEvent
// 兼容多种字段命名格式
func (ws *WSClient) extractEvent(m map[string]interface{}) *WSEvent {
	// 提取类型
	evtType := strVal(firstNonNil(
		m["type"], m["msgType"], m["messageType"],
		m["event"], m["action"], m["cmd"],
	))

	// 提取活动 ID
	actID := int64FromAny(firstNonNil(
		m["activeId"], m["activityId"], m["active_id"],
		m["id"], m["activePrimaryId"], m["activeid"],
		m["data.activeId"], m["data.activityId"],
	))

	// 如果有嵌套 data
	dataMap := m
	if nested, ok := m["data"].(map[string]interface{}); ok {
		dataMap = nested
		// 重新尝试从嵌套数据中提取 ID
		if actID == 0 {
			actID = int64FromAny(firstNonNil(
				dataMap["activeId"], dataMap["activityId"],
				dataMap["active_id"], dataMap["id"],
			))
		}
	}

	if actID == 0 && evtType == "" {
		return nil
	}

	name := strVal(firstNonNil(
		m["name"], m["title"], m["activityName"],
		dataMap["name"], dataMap["title"],
	))

	courseID := int64FromAny(firstNonNil(
		m["courseId"], m["course_id"],
		dataMap["courseId"], dataMap["course_id"],
	))
	classID := int64FromAny(firstNonNil(
		m["classId"], m["class_id"],
		dataMap["classId"], dataMap["class_id"],
	))

	startTime := int64FromAny(firstNonNil(
		m["startTime"], m["start_time"], m["starttime"],
		dataMap["startTime"], dataMap["start_time"], dataMap["starttime"],
	))
	endTime := int64FromAny(firstNonNil(
		m["endTime"], m["end_time"], m["endtime"],
		dataMap["endTime"], dataMap["end_time"], dataMap["endtime"],
	))
	status := int(int64FromAny(firstNonNil(
		m["status"], dataMap["status"],
	)))

	rawData, _ := json.Marshal(m)

	return &WSEvent{
		Type:       evtType,
		ActivityID: actID,
		Name:       name,
		CourseID:   courseID,
		ClassID:    classID,
		StartTime:  startTime,
		EndTime:    endTime,
		Status:     status,
		RawData:    rawData,
	}
}

// pingLoop 定期发送 ping 保活
func (ws *WSClient) pingLoop() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ws.done:
			return
		case <-ticker.C:
			ws.mu.Lock()
			if ws.closed {
				ws.mu.Unlock()
				return
			}
			ws.conn.WriteControl(websocket.PingMessage, []byte{}, time.Now().Add(5*time.Second))
			ws.mu.Unlock()
		}
	}
}

// Events 返回事件通道
func (ws *WSClient) Events() <-chan WSEvent {
	return ws.msgChan
}

// Close 关闭 WebSocket 连接
func (ws *WSClient) Close() {
	ws.mu.Lock()
	defer ws.mu.Unlock()
	if ws.closed {
		return
	}
	ws.closed = true
	ws.conn.WriteMessage(websocket.CloseMessage,
		websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
	ws.conn.Close()
}
