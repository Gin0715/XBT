package xxt

import (
	"bytes"
	"crypto/tls"
	"encoding/json"
	"fmt"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"net/http/cookiejar"
	"net/textproto"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	SignNormal   = 0
	SignQRCode   = 2
	SignGesture  = 3
	SignLocation = 4
	SignCode     = 5
	captchaID    = "42sxgHoTPTKbt0uZxPJ7ssOvtXr3ZgZ1"
	captchaType  = "slide"
)

// 抢答风控退避上限（防止 count 无限增长）
const (
	maxQuizBackoffCount    = 8               // 抢答最大退避次数，达到后不再递增
	maxSignBackoffCount    = 5               // 签到最大退避次数
	resetBackoffAfter      = 2 * time.Minute // 连续退避超时后硬重置
	quizProbeBackoffMinGap = 2 * time.Second // 退避期间探测最小间隔（原 800ms 太激进）
)

type activesCacheEntry struct {
	actives        []Active
	timestamp      time.Time
	backoffUntil   time.Time // 风控退避截止时间
	backoffCount   int       // 连续风控次数
	firstBackoffAt time.Time // 首次风控时间（用于超时硬重置）
}

type Client struct {
	aesKey         string
	mobileUA       string
	activeFetchMax int
	http           *http.Client
	sessionMu      sync.Mutex
	sessions       map[string]*Session
	cacheMu        sync.RWMutex
	activesCache   map[string]*activesCacheEntry // key: "courseID:classID"
}

type Session struct {
	Mobile      string
	Password    string
	UID         int64
	Name        string
	Avatar      string
	Jar         *cookiejar.Jar
	LastLoginAt time.Time
}

type LoginResult struct {
	UID    int64
	Name   string
	Avatar string
}

type Course struct {
	Teacher  string
	Name     string
	CourseID int64
	ClassID  int64
	Icon     string
}

type Active struct {
	ActiveID   int64
	Name       string
	ActiveType int   // 超星活动类型: 2=签到, 3=抢答/问答, 6/8=答题
	CourseID   int64 // 所属课程ID
	ClassID    int64 // 所属班级ID
	StartTime  int64 // 活动开始时间（毫秒时间戳）
	EndTime    int64 // 活动结束时间（毫秒时间戳）
	Status     int   // 活动状态: 0待开始 1进行中 2已结束
}

type SignDetail struct {
	StartTime    int64
	EndTime      int64
	SignType     int
	IfRefreshEWM bool
	IfPhoto      bool
}

type FixedParams struct {
	ActiveID     int64
	UID          int64
	CourseID     int64
	ClassID      int64
	IfRefreshEWM bool
}

func New(aesKey, mobileUA string, insecureTLS bool, activeFetchMax int) *Client {
	tr := &http.Transport{}
	if insecureTLS {
		tr.TLSClientConfig = &tls.Config{InsecureSkipVerify: true}
	}
	if activeFetchMax <= 0 {
		activeFetchMax = 20
	}
	return &Client{
		aesKey:         aesKey,
		mobileUA:       mobileUA,
		activeFetchMax: activeFetchMax,
		http: &http.Client{
			Timeout:   20 * time.Second,
			Transport: tr,
		},
		sessions:     make(map[string]*Session),
		activesCache: make(map[string]*activesCacheEntry),
	}
}

func (c *Client) PreLogin(mobile, password string) (*LoginResult, error) {
	jar, _ := cookiejar.New(nil)
	cli := *c.http
	cli.Jar = jar

	form := url.Values{}
	form.Set("fid", "-1")
	form.Set("uname", encryptXXTByAES(mobile, c.aesKey))
	form.Set("password", encryptXXTByAES(password, c.aesKey))
	form.Set("refer", "https://i.chaoxing.com")
	form.Set("t", "true")
	form.Set("forbidotherlogin", "0")
	form.Set("validate", "")
	form.Set("doubleFactorLogin", "0")
	form.Set("independentId", "0")
	form.Set("independentNameId", "0")

	req, _ := http.NewRequest(http.MethodPost, "https://passport2.chaoxing.com/fanyalogin?"+form.Encode(), nil)
	req.Header.Set("User-Agent", "Mozilla/5.0")
	resp, err := cli.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var lr struct {
		Status bool `json:"status"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&lr); err != nil {
		return nil, fmt.Errorf("login decode failed: %w", err)
	}
	if !lr.Status {
		return nil, fmt.Errorf("账号或密码错误")
	}

	req2, _ := http.NewRequest(http.MethodGet, "http://i.chaoxing.com/base", nil)
	req2.Header.Set("User-Agent", "Mozilla/5.0")
	resp2, err := cli.Do(req2)
	if err != nil {
		return nil, err
	}
	defer resp2.Body.Close()
	html, _ := io.ReadAll(resp2.Body)
	s := string(html)

	name := extractBetween(s, `<p class="user-name">`, `</p>`)
	avatar := extractBetween(s, `<img class="icon-head" src="`, `">`)
	uid := int64(0)
	for _, ck := range jar.Cookies(&url.URL{Scheme: "https", Host: "passport2.chaoxing.com"}) {
		if ck.Name == "UID" {
			uid, _ = strconv.ParseInt(ck.Value, 10, 64)
			break
		}
	}
	if uid == 0 {
		for _, ck := range jar.Cookies(&url.URL{Scheme: "https", Host: "i.chaoxing.com"}) {
			if ck.Name == "UID" {
				uid, _ = strconv.ParseInt(ck.Value, 10, 64)
				break
			}
		}
	}
	if uid == 0 {
		return nil, fmt.Errorf("登录后未获取到UID")
	}

	c.sessionMu.Lock()
	c.sessions[mobile] = &Session{
		Mobile:      mobile,
		Password:    password,
		UID:         uid,
		Name:        name,
		Avatar:      avatar,
		Jar:         jar,
		LastLoginAt: time.Now(),
	}
	c.sessionMu.Unlock()

	return &LoginResult{UID: uid, Name: name, Avatar: avatar}, nil
}

func (c *Client) ensureSession(mobile, password string) (*Session, error) {
	c.sessionMu.Lock()
	s, ok := c.sessions[mobile]
	c.sessionMu.Unlock()
	if ok && s.Password == password && time.Since(s.LastLoginAt) < 24*time.Hour {
		return s, nil
	}
	_, err := c.PreLogin(mobile, password)
	if err != nil {
		return nil, err
	}
	c.sessionMu.Lock()
	defer c.sessionMu.Unlock()
	return c.sessions[mobile], nil
}

func (c *Client) GetCourses(mobile, password string) ([]Course, error) {
	s, err := c.ensureSession(mobile, password)
	if err != nil {
		return nil, err
	}
	cli := *c.http
	cli.Jar = s.Jar

	u := "https://mooc1-api.chaoxing.com/mycourse/backclazzdata?view=json&getTchClazzType=1&mcode="
	req, _ := http.NewRequest(http.MethodGet, u, nil)
	req.Header.Set("User-Agent", "Mozilla/5.0")
	resp, err := cli.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var payload struct {
		ChannelList []struct {
			Content map[string]interface{} `json:"content"`
		} `json:"channelList"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, err
	}

	seen := map[string]struct{}{}
	courses := make([]Course, 0)
	for _, ch := range payload.ChannelList {
		content := ch.Content
		if content == nil {
			continue
		}
		if _, ok := content["folderName"]; ok {
			continue
		}
		if rt, ok := content["roletype"].(float64); ok && int(rt) == 1 {
			continue
		}
		courseMap, ok := content["course"].(map[string]interface{})
		if !ok {
			continue
		}
		dataArr, ok := courseMap["data"].([]interface{})
		if !ok {
			continue
		}
		for _, item := range dataArr {
			m, ok := item.(map[string]interface{})
			if !ok {
				continue
			}
			squareURL, _ := m["courseSquareUrl"].(string)
			u2, err := url.Parse(squareURL)
			if err != nil {
				continue
			}
			q := u2.Query()
			courseID, _ := strconv.ParseInt(q.Get("courseId"), 10, 64)
			classID, _ := strconv.ParseInt(q.Get("classId"), 10, 64)
			if courseID == 0 || classID == 0 {
				continue
			}
			key := fmt.Sprintf("%d_%d", courseID, classID)
			if _, exists := seen[key]; exists {
				continue
			}
			seen[key] = struct{}{}
			courses = append(courses, Course{
				Teacher:  strVal(m["teacherfactor"]),
				Name:     strVal(m["name"]),
				CourseID: courseID,
				ClassID:  classID,
				Icon:     strVal(m["imageurl"]),
			})
		}
	}
	return courses, nil
}

// fetchActivesRaw 从超星获取活动原始列表（带缓存+动态退避，sign/quiz 隔离）
// maxCacheAge: 缓存有效期，签到此值较大（5s），抢答此值较小（800ms）
// caller: "sign" 或 "quiz"，用于隔离缓存和退避计数器，避免签到风控影响抢答
func (c *Client) fetchActivesRaw(mobile, password string, courseID, classID int64, maxCacheAge time.Duration, caller string) []map[string]interface{} {
	cacheKey := fmt.Sprintf("%s:%d:%d", caller, courseID, classID)
	now := time.Now()

	c.cacheMu.RLock()
	entry, hasEntry := c.activesCache[cacheKey]
	c.cacheMu.RUnlock()

	if hasEntry {
		inBackoff := now.Before(entry.backoffUntil)
		if inBackoff {
			if caller == "quiz" {
				if entry.backoffCount >= maxQuizBackoffCount {
					// 已达最大退避次数：完全停止探测，等退避超时后自然恢复
					return nil
				}
				// 退避期间降低探测频率，避免自激
				if time.Since(entry.timestamp) < quizProbeBackoffMinGap {
					return nil
				}
				// 间隔足够，穿透退避做一次探测
			} else {
				// 签到退避期间：完全停止（非时间敏感）
				return nil
			}
		} else {
			// 非退避期：正常缓存检查
			if time.Since(entry.timestamp) < maxCacheAge {
				return nil
			}
		}
	}

	// 请求超星
	s, err := c.ensureSession(mobile, password)
	if err != nil {
		return nil
	}
	cli := *c.http
	cli.Jar = s.Jar

	u := fmt.Sprintf("https://mobilelearn.chaoxing.com/ppt/activeAPI/taskactivelist?courseId=%d&classId=%d", courseID, classID)
	req, _ := http.NewRequest(http.MethodGet, u, nil)
	req.Header.Set("User-Agent", c.mobileUA)
	resp, err := cli.Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil
	}
	var payload interface{}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil
	}

	activeList := findActiveList(payload)
	if len(activeList) == 0 {
		activeList = findBestActivityArray(payload)
	}

	isRateLimited := false
	rawStr := string(raw)
	if len(activeList) == 0 {
		if strings.Contains(rawStr, "请勿频繁操作") ||
			strings.Contains(rawStr, "频率过高") ||
			strings.Contains(rawStr, "too many") {
			isRateLimited = true
		}
	}

	// 更新缓存 + 处理退避
	c.cacheMu.Lock()
	prevBackoffCount := 0
	var prevFirstBackoff time.Time
	if hasEntry {
		prevBackoffCount = entry.backoffCount
		prevFirstBackoff = entry.firstBackoffAt
	}
	newEntry := &activesCacheEntry{
		actives:        rawToActives(activeList, c.activeFetchMax, false),
		timestamp:      time.Now(),
		backoffCount:   prevBackoffCount,
		firstBackoffAt: prevFirstBackoff,
	}
	if isRateLimited {
		maxCount := maxQuizBackoffCount
		if caller == "sign" {
			maxCount = maxSignBackoffCount
		}

		if newEntry.backoffCount < maxCount {
			newEntry.backoffCount++
		}
		// 首次风控时记录时间戳
		if newEntry.firstBackoffAt.IsZero() {
			newEntry.firstBackoffAt = time.Now()
		}

		// 连续退避超过重置时限 → 硬重置
		if time.Since(newEntry.firstBackoffAt) > resetBackoffAfter {
			newEntry.backoffCount = 0
			newEntry.firstBackoffAt = time.Time{}
			log.Printf("[%s] 风控退避超时重置: course=%d class=%d",
				caller, courseID, classID)
		} else if newEntry.backoffCount <= maxCount {
			// 指数退避: 3s * 2^count，最大 12s（快速恢复，避免长时间卡死）
			backoffSec := 3
			for i := 1; i < newEntry.backoffCount && backoffSec < 12; i++ {
				backoffSec *= 2
			}
			newEntry.backoffUntil = time.Now().Add(time.Duration(backoffSec) * time.Second)
			log.Printf("[%s] 风控退避: course=%d class=%d count=%d backoff=%ds",
				caller, courseID, classID, newEntry.backoffCount, backoffSec)
		}
		// 保留旧缓存数据（如果有的话）
		if hasEntry && len(entry.actives) > 0 {
			newEntry.actives = entry.actives
		}
		// 已达最大退避次数后不再输出日志（静默等待超时重置）
	} else {
		// 成功请求：重置退避状态
		newEntry.backoffCount = 0
		newEntry.firstBackoffAt = time.Time{}
		// 如果之前处于退避中，记录恢复日志
		if prevBackoffCount > 0 {
			log.Printf("[%s] 风控退避结束: course=%d class=%d 已恢复正常",
				caller, courseID, classID)
		}
		if len(activeList) == 0 && !isRateLimited {
			log.Printf("[%s] GetActives empty: course=%d class=%d body=%s",
				caller, courseID, classID, truncateForLog(rawStr, 240))
		}
	}
	c.activesCache[cacheKey] = newEntry
	c.cacheMu.Unlock()

	return activeList
}

// ResetQuizCache 清空抢答相关缓存（启动监控时调用，避免旧风控状态影响新会话）
func (c *Client) ResetQuizCache(courseID, classID int64) {
	c.cacheMu.Lock()
	defer c.cacheMu.Unlock()
	quizKey := fmt.Sprintf("quiz:%d:%d", courseID, classID)
	delete(c.activesCache, quizKey)
	log.Printf("[xxt] 已清空抢答缓存: course=%d class=%d", courseID, classID)
}

func rawToActives(activeList []map[string]interface{}, max int, signOnly bool) []Active {
	out := make([]Active, 0)
	seen := make(map[int64]struct{})
	for _, a := range activeList {
		activeType := int(int64FromAny(firstNonNil(a["activeType"], a["type"], a["atype"])))
		name := strVal(firstNonNil(a["nameOne"], a["name"], a["activeName"], a["title"]))
		id := int64FromAny(firstNonNil(a["id"], a["activeId"], a["active_id"]))
		if id == 0 {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		if signOnly && activeType != 2 && !strings.Contains(name, "签到") {
			continue
		}
		if name == "" {
			name = fmt.Sprintf("活动 %d", id)
		}
		// 提取活动时间（毫秒时间戳，兼容多种字段名）
		st := int64FromAny(firstNonNil(a["startTime"], a["start_time"], a["startTimestamp"]))
		et := int64FromAny(firstNonNil(a["endTime"], a["end_time"], a["endTimestamp"]))
		status := int(int64FromAny(firstNonNil(a["status"], a["state"])))
		out = append(out, Active{
			ActiveID:   id,
			Name:       name,
			ActiveType: activeType,
			StartTime:  st,
			EndTime:    et,
			Status:     status,
		})
		if len(out) >= max {
			break
		}
	}
	return out
}

func (c *Client) GetActives(mobile, password string, courseID, classID int64) ([]Active, error) {
	s, err := c.ensureSession(mobile, password)
	if err != nil {
		return nil, err
	}
	cli := *c.http
	cli.Jar = s.Jar

	u := fmt.Sprintf("https://mobilelearn.chaoxing.com/ppt/activeAPI/taskactivelist?courseId=%d&classId=%d", courseID, classID)
	req, _ := http.NewRequest(http.MethodGet, u, nil)
	req.Header.Set("User-Agent", c.mobileUA)
	resp, err := cli.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	var payload interface{}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, err
	}

	activeList := findActiveList(payload)
	if len(activeList) == 0 {
		activeList = findBestActivityArray(payload)
	}
	if len(activeList) == 0 {
		log.Printf("GetActives empty source: course=%d class=%d body=%s", courseID, classID, truncateForLog(string(raw), 240))
	}
	out := make([]Active, 0)
	seen := make(map[int64]struct{})
	for _, a := range activeList {
		activeType := int64FromAny(firstNonNil(a["activeType"], a["type"], a["atype"]))
		name := strVal(firstNonNil(a["nameOne"], a["name"], a["activeName"], a["title"]))
		id := int64FromAny(firstNonNil(a["id"], a["activeId"], a["active_id"]))
		if id == 0 {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		if activeType != 2 && !strings.Contains(name, "签到") {
			continue
		}
		if name == "" {
			name = fmt.Sprintf("活动 %d", id)
		}
		out = append(out, Active{
			ActiveID: id,
			Name:     name,
		})
		if len(out) >= c.activeFetchMax {
			break
		}
	}
	return out, nil
}
func (c *Client) GetActivesAll(mobile, password string, courseID, classID int64) ([]Active, error) {
	activeList := c.fetchActivesRaw(mobile, password, courseID, classID, 5*time.Second, "sign")
	if activeList == nil {
		cacheKey := fmt.Sprintf("sign:%d:%d", courseID, classID)
		c.cacheMu.RLock()
		if entry, ok := c.activesCache[cacheKey]; ok {
			c.cacheMu.RUnlock()
			return entry.actives, nil
		}
		c.cacheMu.RUnlock()
		return []Active{}, nil
	}
	return rawToActives(activeList, c.activeFetchMax, false), nil
}

// GetActivesAllFast 抢答专用快速获取（200ms 缓存，极速模式 100ms 轮询）
func (c *Client) GetActivesAllFast(mobile, password string, courseID, classID int64) ([]Active, error) {
	activeList := c.fetchActivesRaw(mobile, password, courseID, classID, 200*time.Millisecond, "quiz")
	if activeList == nil {
		cacheKey := fmt.Sprintf("quiz:%d:%d", courseID, classID)
		c.cacheMu.RLock()
		if entry, ok := c.activesCache[cacheKey]; ok {
			c.cacheMu.RUnlock()
			return entry.actives, nil
		}
		c.cacheMu.RUnlock()
		return []Active{}, nil
	}
	return rawToActives(activeList, c.activeFetchMax, false), nil
}

// GetActivesAllForce 强制从超星拉取最新活动列表（绕过缓存和风控退避）
// 用于一键抢答的即时检测场景，确保获取最新数据而非过期缓存
func (c *Client) GetActivesAllForce(mobile, password string, courseID, classID int64) ([]Active, error) {
	// 清空抢答缓存，绕过退避
	c.ResetQuizCache(courseID, classID)

	s, err := c.ensureSession(mobile, password)
	if err != nil {
		return nil, err
	}
	cli := *c.http
	cli.Jar = s.Jar

	u := fmt.Sprintf("https://mobilelearn.chaoxing.com/ppt/activeAPI/taskactivelist?courseId=%d&classId=%d", courseID, classID)
	req, _ := http.NewRequest(http.MethodGet, u, nil)
	req.Header.Set("User-Agent", c.mobileUA)
	resp, err := cli.Do(req)
	if err != nil {
		return nil, fmt.Errorf("强制获取活动列表失败: %w", err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	var payload interface{}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, err
	}

	activeList := findActiveList(payload)
	if len(activeList) == 0 {
		activeList = findBestActivityArray(payload)
	}

	// 更新缓存（重置退避状态）
	c.cacheMu.Lock()
	now := time.Now()
	cacheKey := fmt.Sprintf("quiz:%d:%d", courseID, classID)
	c.activesCache[cacheKey] = &activesCacheEntry{
		actives:        rawToActives(activeList, c.activeFetchMax, false),
		timestamp:      now,
		backoffCount:   0,
		firstBackoffAt: time.Time{},
	}
	c.cacheMu.Unlock()

	return rawToActives(activeList, c.activeFetchMax, false), nil
}

func (c *Client) GetSignDetail(mobile, password string, activityID int64) (SignDetail, error) {
	s, err := c.ensureSession(mobile, password)
	if err != nil {
		return SignDetail{}, err
	}
	cli := *c.http
	cli.Jar = s.Jar
	u := fmt.Sprintf("https://mobilelearn.chaoxing.com/newsign/signDetail?activePrimaryId=%d&type=1", activityID)
	req, _ := http.NewRequest(http.MethodGet, u, nil)
	req.Header.Set("User-Agent", c.mobileUA)
	resp, err := cli.Do(req)
	if err != nil {
		return SignDetail{}, err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return SignDetail{}, err
	}
	var payload map[string]interface{}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return SignDetail{}, err
	}
	end := parseTimeMillis(payload["endTime"])
	if end == 0 {
		end = 64060559999000
	}
	return SignDetail{
		StartTime:    parseTimeMillis(payload["startTime"]),
		EndTime:      end,
		SignType:     int(int64FromAny(payload["otherId"])),
		IfRefreshEWM: boolFromAny(payload["ifRefreshEwm"]),
		IfPhoto:      boolFromAny(deepFindFirst(payload, "ifphoto", "ifPhoto")),
	}, nil
}

func (c *Client) PreSign(mobile, password string, fixed FixedParams, code, enc string) error {
	s, err := c.ensureSession(mobile, password)
	if err != nil {
		return err
	}
	cli := *c.http
	cli.Jar = s.Jar

	vals := url.Values{}
	vals.Set("courseId", strconv.FormatInt(fixed.CourseID, 10))
	vals.Set("classId", strconv.FormatInt(fixed.ClassID, 10))
	vals.Set("activePrimaryId", strconv.FormatInt(fixed.ActiveID, 10))
	vals.Set("general", "1")
	vals.Set("sys", "1")
	vals.Set("ls", "1")
	vals.Set("appType", "15")
	vals.Set("uid", strconv.FormatInt(fixed.UID, 10))
	vals.Set("isTeacherViewOpen", "0")
	if fixed.IfRefreshEWM {
		rcode := fmt.Sprintf("SIGNIN:aid=%d&source=15&Code=%s&enc=%s", fixed.ActiveID, code, enc)
		vals.Set("rcode", url.QueryEscape(rcode))
	}

	req, _ := http.NewRequest(http.MethodGet, "https://mobilelearn.chaoxing.com/newsign/preSign?"+vals.Encode(), nil)
	req.Header.Set("User-Agent", c.mobileUA)
	resp, err := cli.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)

	a1 := fmt.Sprintf("https://mobilelearn.chaoxing.com/pptSign/analysis?vs=1&DB_STRATEGY=RANDOM&aid=%d", fixed.ActiveID)
	req2, _ := http.NewRequest(http.MethodGet, a1, nil)
	req2.Header.Set("User-Agent", c.mobileUA)
	resp2, err := cli.Do(req2)
	if err != nil {
		return err
	}
	defer resp2.Body.Close()
	body2, _ := io.ReadAll(resp2.Body)
	m := regexp.MustCompile(`code='\\+'(.*?)'`).FindSubmatch(body2)
	if len(m) < 2 {
		return nil
	}
	code2 := string(m[1])
	a2 := "https://mobilelearn.chaoxing.com/pptSign/analysis2?DB_STRATEGY=RANDOM&code=" + url.QueryEscape(code2)
	req3, _ := http.NewRequest(http.MethodGet, a2, nil)
	req3.Header.Set("User-Agent", c.mobileUA)
	resp3, err := cli.Do(req3)
	if err == nil {
		defer resp3.Body.Close()
		_, _ = io.Copy(io.Discard, resp3.Body)
	}
	return nil
}

func (c *Client) SignPhoto(mobile, password string, fixed FixedParams, objectID string) (string, error) {
	objectID = strings.TrimSpace(objectID)
	if objectID == "" {
		return "", fmt.Errorf("missing photo object_id")
	}
	return c.Sign(mobile, password, fixed, SignNormal, map[string]interface{}{"object_id": objectID})
}

func (c *Client) Sign(mobile, password string, fixed FixedParams, signType int, special map[string]interface{}) (string, error) {
	s, err := c.ensureSession(mobile, password)
	if err != nil {
		return "", err
	}
	cli := *c.http
	cli.Jar = s.Jar

	params := url.Values{}
	params.Set("activeId", strconv.FormatInt(fixed.ActiveID, 10))
	params.Set("uid", strconv.FormatInt(fixed.UID, 10))
	params.Set("clientip", "")
	params.Set("appType", "15")
	params.Set("fid", "")
	params.Set("name", s.Name)
	if objectID := strings.TrimSpace(strVal(firstNonNil(special["object_id"], special["objectId"]))); objectID != "" {
		params.Set("objectId", objectID)
		params.Set("useragent", "")
		params.Set("latitude", "-1")
		params.Set("longitude", "-1")
	}
	// 先空 validate 发起一次请求；仅在学习通明确要求时再走验证码。
	params.Set("validate", "")

	switch signType {
	case SignQRCode:
		enc := strVal(special["enc"])
		if enc == "" {
			return "", fmt.Errorf("缺少二维码 enc 参数")
		}
		params.Set("enc", enc)
		if locationJSON, ok := buildQRCodeLocationParam(special); ok {
			params.Set("location", locationJSON)
		}
		params.Set("useragent", "")
		params.Set("latitude", "-1")
		params.Set("longitude", "-1")
	case SignGesture, SignCode:
		signCode := strVal(special["sign_code"])
		if signCode == "" {
			return "", fmt.Errorf("缺少 sign_code 参数")
		}
		if signType == SignGesture {
			checkURL := fmt.Sprintf("https://mobilelearn.chaoxing.com/widget/sign/pcStuSignController/checkSignCode?activeId=%d&signCode=%s", fixed.ActiveID, url.QueryEscape(signCode))
			reqC, _ := http.NewRequest(http.MethodGet, checkURL, nil)
			reqC.Header.Set("User-Agent", c.mobileUA)
			respC, err := cli.Do(reqC)
			if err == nil {
				defer respC.Body.Close()
				var check struct {
					Result   int    `json:"result"`
					ErrorMsg string `json:"errorMsg"`
				}
				_ = json.NewDecoder(respC.Body).Decode(&check)
				if check.Result != 1 {
					if check.ErrorMsg == "" {
						check.ErrorMsg = "手势码校验失败"
					}
					return "", fmt.Errorf("%s", check.ErrorMsg)
				}
			}
		}
		params.Set("signCode", signCode)
		params.Set("latitude", "")
		params.Set("longitude", "")
	case SignLocation:
		params.Set("address", strVal(special["description"]))
		params.Set("latitude", strVal(special["latitude"]))
		params.Set("longitude", strVal(special["longitude"]))
		params.Set("ifTiJiao", "1")
	default:
		params.Set("latitude", "-1")
		params.Set("longitude", "-1")
	}

	if signType == SignQRCode {
		validate, err := c.fetchCaptchaValidate(fixed)
		if err != nil {
			log.Printf("captcha fetch failed before qrcode sign: activity=%d uid=%d err=%v", fixed.ActiveID, fixed.UID, err)
		} else {
			params.Set("validate", validate)
		}
		return c.doStuSignRequest(&cli, params)
	}

	result, err := c.doStuSignRequest(&cli, params)
	if err != nil {
		return "", err
	}
	if result != "validate" {
		return result, nil
	}

	validate, err := c.fetchCaptchaValidate(fixed)
	if err != nil {
		log.Printf("captcha fetch failed: activity=%d uid=%d err=%v", fixed.ActiveID, fixed.UID, err)
		return "validate", nil
	}
	params.Set("validate", validate)
	return c.doStuSignRequest(&cli, params)
}

func (c *Client) doStuSignRequest(cli *http.Client, params url.Values) (string, error) {
	u := "https://mobilelearn.chaoxing.com/pptSign/stuSignajax?" + params.Encode()
	req, _ := http.NewRequest(http.MethodGet, u, nil)
	req.Header.Set("User-Agent", c.mobileUA)
	resp, err := cli.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	return strings.TrimSpace(string(body)), nil
}

func sanitizeMultipartFilename(filename string) string {
	filename = strings.TrimSpace(filename)
	if filename == "" {
		return "photo.jpg"
	}
	filename = strings.ReplaceAll(filename, "\\", "_")
	filename = strings.ReplaceAll(filename, "/", "_")
	filename = strings.ReplaceAll(filename, "\x00", "")
	return filename
}

func escapeMultipartFilename(filename string) string {
	return strings.NewReplacer("\\", "\\\\", `"`, "\\\"").Replace(filename)
}

func buildQRCodeLocationParam(special map[string]interface{}) (string, bool) {
	if locRaw, ok := special["location"]; ok && locRaw != nil {
		switch v := locRaw.(type) {
		case string:
			if strings.TrimSpace(v) != "" {
				return v, true
			}
		default:
			if b, err := json.Marshal(v); err == nil && string(b) != "null" && string(b) != `""` {
				return string(b), true
			}
		}
	}

	latStr := strings.TrimSpace(strVal(special["latitude"]))
	lngStr := strings.TrimSpace(strVal(special["longitude"]))
	desc := strings.TrimSpace(strVal(special["description"]))
	if latStr == "" && lngStr == "" && desc == "" {
		return "", false
	}

	location := map[string]interface{}{
		"result":  1,
		"address": desc,
	}
	if lat, err := strconv.ParseFloat(latStr, 64); err == nil {
		location["latitude"] = lat
	} else if latStr != "" {
		location["latitude"] = latStr
	}
	if lng, err := strconv.ParseFloat(lngStr, 64); err == nil {
		location["longitude"] = lng
	} else if lngStr != "" {
		location["longitude"] = lngStr
	}
	if desc != "" {
		location["mockData"] = map[string]interface{}{
			"description": desc,
		}
	}

	b, err := json.Marshal(location)
	if err != nil || string(b) == "{}" {
		return "", false
	}
	return string(b), true
}

// QuickAnswer 提交抢答 — 使用超星 v2 API (基于真实抓包)
// 优化：跳过页面预加载，直接调 API（节省一次 HTTP 往返 ~200-500ms）
// 抓包分析: POST/GET /v2/apis/answer/stuAnswer?classId=&courseId=&activeId=&enterAnswer=
// 返回: {"result":1, "data": {...}} 成功; {"result":1, "data":1} 抢答人数已满; {"result":0, "errorMsg":"..."} 失败
func (c *Client) QuickAnswer(mobile, password string, courseID, classID, activeID int64) (string, error) {
	s, err := c.ensureSession(mobile, password)
	if err != nil {
		return "", fmt.Errorf("抢答登录失败: %v", err)
	}
	cli := *c.http
	cli.Jar = s.Jar

	// 构造 Referer（模拟从页面发起，但不实际加载页面）
	pageURL := fmt.Sprintf(
		"https://mobilelearn.chaoxing.com/page/answer/stuAnswer?courseId=%d&classId=%d&activeId=%d&fid=0&timetable=0",
		courseID, classID, activeID,
	)

	apiURL := fmt.Sprintf(
		"https://mobilelearn.chaoxing.com/v2/apis/answer/stuAnswer?classId=%d&courseId=%d&activeId=%d&enterAnswer=",
		classID, courseID, activeID,
	)
	reqAPI, _ := http.NewRequest(http.MethodGet, apiURL, nil)
	reqAPI.Header.Set("User-Agent", c.mobileUA)
	reqAPI.Header.Set("Accept", "application/json, text/javascript, */*; q=0.01")
	reqAPI.Header.Set("X-Requested-With", "XMLHttpRequest")
	reqAPI.Header.Set("Referer", pageURL)

	respAPI, err := cli.Do(reqAPI)
	if err != nil {
		return "", fmt.Errorf("提交抢答请求失败: %v", err)
	}
	defer respAPI.Body.Close()

	body, _ := io.ReadAll(respAPI.Body)
	result := strings.TrimSpace(string(body))

	if strings.Contains(result, "<!DOCTYPE html") || strings.HasPrefix(result, "<") {
		log.Printf("QuickAnswer auth/html fallback: course=%d class=%d active=%d body_prefix=%s",
			courseID, classID, activeID, truncateForLog(result, 120))
		return "", fmt.Errorf("抢答鉴权失败（会话可能已过期）")
	}
	return result, nil
}

// AnswerAttendInfoResult 活动详情 + 抢答状态（抓包: /v2/apis/answer/getAnswerAttendInfo）
type AnswerAttendInfoResult struct {
	Result   int    `json:"result"`
	ErrorMsg string `json:"errorMsg"`
	Data     struct {
		AttendList []interface{} `json:"attendList"`
		AttendNum  int           `json:"attendNum"`
		PptActive  struct {
			ID           int64  `json:"id"`
			Title        string `json:"title"`
			Status       int    `json:"status"`       // 1=进行中 2=已结束
			StartTime    int64  `json:"starttime"`    // 毫秒时间戳
			EndTime      int64  `json:"endtime"`      // 毫秒时间戳
			TimerSeconds int64  `json:"timerSeconds"` // 倒计时秒数
			ConfigJson   string `json:"configJson"`   // JSON 字符串: {ifWatiStuInPosition, allowAnswerStuNum, ifAnswerNeedEnter}
			Servertime   int64  `json:"servertime"`   // 服务器时间
		} `json:"pptActive"`
		MyAnswer *struct {
			Status int    `json:"status"`
			Uid    int64  `json:"uid"`
			Name   string `json:"name"`
		} `json:"myAnswer"`
	} `json:"data"`
}

// IsEnded 活动是否已结束
func (r *AnswerAttendInfoResult) IsEnded() bool {
	return r.Data.PptActive.Status == 2
}

// AlreadyAnswered 当前学生是否已抢答
func (r *AnswerAttendInfoResult) AlreadyAnswered() bool {
	return r.Data.MyAnswer != nil
}

// IsAnswerFull 抢答人数是否已达上限
func (r *AnswerAttendInfoResult) IsAnswerFull() bool {
	// allowAnswerStuNum > 0 且 attendNum >= allowAnswerStuNum
	configJson := r.Data.PptActive.ConfigJson
	if configJson == "" {
		return false
	}
	var cfg struct {
		AllowAnswerStuNum int `json:"allowAnswerStuNum"`
	}
	if err := json.Unmarshal([]byte(configJson), &cfg); err == nil {
		if cfg.AllowAnswerStuNum > 0 && r.Data.AttendNum >= cfg.AllowAnswerStuNum {
			return true
		}
	}
	return false
}

// NeedWaitForReady 是否需要"等待学生就位"模式
func (r *AnswerAttendInfoResult) NeedWaitForReady() bool {
	configJson := r.Data.PptActive.ConfigJson
	if configJson == "" {
		return false
	}
	var cfg struct {
		IfWatiStuInPosition int `json:"ifWatiStuInPosition"`
	}
	if err := json.Unmarshal([]byte(configJson), &cfg); err == nil {
		return cfg.IfWatiStuInPosition == 1
	}
	return false
}

// GetAnswerAttendInfo 获取活动详情+抢答状态（从抓包页面 created() 钩子提取）
// 接口: /v2/apis/answer/getAnswerAttendInfo?classId=&courseId=&activeId=&role=0
func (c *Client) GetAnswerAttendInfo(mobile, password string, courseID, classID, activeID int64) (*AnswerAttendInfoResult, error) {
	s, err := c.ensureSession(mobile, password)
	if err != nil {
		return nil, fmt.Errorf("getAnswerAttendInfo 登录失败: %v", err)
	}
	cli := *c.http
	cli.Jar = s.Jar

	pageURL := fmt.Sprintf(
		"https://mobilelearn.chaoxing.com/page/answer/stuAnswer?courseId=%d&classId=%d&activeId=%d&fid=0&timetable=0",
		courseID, classID, activeID,
	)

	apiURL := fmt.Sprintf(
		"https://mobilelearn.chaoxing.com/v2/apis/answer/getAnswerAttendInfo?classId=%d&courseId=%d&activeId=%d&role=0",
		classID, courseID, activeID,
	)
	req, _ := http.NewRequest(http.MethodGet, apiURL, nil)
	req.Header.Set("User-Agent", c.mobileUA)
	req.Header.Set("Accept", "application/json, text/javascript, */*; q=0.01")
	req.Header.Set("X-Requested-With", "XMLHttpRequest")
	req.Header.Set("Referer", pageURL)

	resp, err := cli.Do(req)
	if err != nil {
		return nil, fmt.Errorf("getAnswerAttendInfo 请求失败: %v", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	var result AnswerAttendInfoResult
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("getAnswerAttendInfo 解析失败: %v", err)
	}
	if result.Result != 1 {
		return &result, fmt.Errorf("getAnswerAttendInfo 返回错误: %s", result.ErrorMsg)
	}
	return &result, nil
}

// StuAnswerPrepare 学生准备就位（抓包: /v2/apis/answer/stuAnswerPrepare）
// 用于教师开启"等待学生就位"模式的抢答，学生需先确认准备，等教师开启后再抢答
func (c *Client) StuAnswerPrepare(mobile, password string, courseID, classID, activeID int64) (string, error) {
	s, err := c.ensureSession(mobile, password)
	if err != nil {
		return "", fmt.Errorf("stuAnswerPrepare 登录失败: %v", err)
	}
	cli := *c.http
	cli.Jar = s.Jar

	pageURL := fmt.Sprintf(
		"https://mobilelearn.chaoxing.com/page/answer/stuAnswer?courseId=%d&classId=%d&activeId=%d&fid=0&timetable=0",
		courseID, classID, activeID,
	)

	apiURL := fmt.Sprintf(
		"https://mobilelearn.chaoxing.com/v2/apis/answer/stuAnswerPrepare?DB_STRATEGY=PRIMARY_KEY&STRATEGY_PARA=activeId&classId=%d&courseId=%d&activeId=%d&enterAnswer=",
		classID, courseID, activeID,
	)
	req, _ := http.NewRequest(http.MethodGet, apiURL, nil)
	req.Header.Set("User-Agent", c.mobileUA)
	req.Header.Set("Accept", "application/json, text/javascript, */*; q=0.01")
	req.Header.Set("X-Requested-With", "XMLHttpRequest")
	req.Header.Set("Referer", pageURL)

	resp, err := cli.Do(req)
	if err != nil {
		return "", fmt.Errorf("stuAnswerPrepare 请求失败: %v", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	return strings.TrimSpace(string(body)), nil
}

// GetTeacherIfOpenAnswer 轮询教师是否开启抢答（抓包: /v2/apis/answer/getTeacherIfOpenAnswer）
// 教师开启后返回 data=1；每 1s 轮询一次（抓包中的间隔）
func (c *Client) GetTeacherIfOpenAnswer(mobile, password string, courseID, classID, activeID int64) (bool, error) {
	s, err := c.ensureSession(mobile, password)
	if err != nil {
		return false, fmt.Errorf("getTeacherIfOpenAnswer 登录失败: %v", err)
	}
	cli := *c.http
	cli.Jar = s.Jar

	apiURL := fmt.Sprintf(
		"https://mobilelearn.chaoxing.com/v2/apis/answer/getTeacherIfOpenAnswer?DB_STRATEGY=PRIMARY_KEY&STRATEGY_PARA=activeId&classId=%d&courseId=%d&activeId=%d&t=%d",
		classID, courseID, activeID, time.Now().UnixMilli(),
	)
	req, _ := http.NewRequest(http.MethodGet, apiURL, nil)
	req.Header.Set("User-Agent", c.mobileUA)
	req.Header.Set("Accept", "application/json, text/javascript, */*; q=0.01")
	req.Header.Set("X-Requested-With", "XMLHttpRequest")

	resp, err := cli.Do(req)
	if err != nil {
		return false, fmt.Errorf("getTeacherIfOpenAnswer 请求失败: %v", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	var result struct {
		Result int `json:"result"`
		Data   int `json:"data"` // 1=教师已开启
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return false, nil
	}
	return result.Result == 1 && result.Data == 1, nil
}

// GetPanUploadToken 获取超星 Pan 上传 token
func (c *Client) GetPanUploadToken(mobile, password string) (string, error) {
	s, err := c.ensureSession(mobile, password)
	if err != nil {
		return "", err
	}
	cli := *c.http
	cli.Jar = s.Jar

	req, _ := http.NewRequest(http.MethodGet, "https://pan-yz.chaoxing.com/api/token/uservalid", nil)
	req.Header.Set("User-Agent", c.mobileUA)
	resp, err := cli.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	var payload interface{}
	if err := json.Unmarshal(body, &payload); err != nil {
		return "", fmt.Errorf("pan token decode failed: %w", err)
	}
	token := strings.TrimSpace(strVal(deepFindFirst(payload, "_token", "token")))
	if token == "" {
		return "", fmt.Errorf("pan token missing: %s", truncateForLog(string(body), 200))
	}
	return token, nil
}

// UploadPanFile 上传照片文件到超星 Pan 存储，返回 objectId 用于拍照签到
func (c *Client) UploadPanFile(mobile, password, filename, contentType string, data []byte) (string, error) {
	if len(data) == 0 {
		return "", fmt.Errorf("photo file is empty")
	}
	s, err := c.ensureSession(mobile, password)
	if err != nil {
		return "", err
	}
	token, err := c.GetPanUploadToken(mobile, password)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(filename) == "" {
		filename = "photo.jpg"
	}
	filename = sanitizeMultipartFilename(filename)
	if strings.TrimSpace(contentType) == "" {
		contentType = "application/octet-stream"
	}

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	partHeader := textproto.MIMEHeader{}
	partHeader.Set("Content-Disposition", fmt.Sprintf(`form-data; name="file"; filename="%s"`, escapeMultipartFilename(filename)))
	partHeader.Set("Content-Type", contentType)
	part, err := writer.CreatePart(partHeader)
	if err != nil {
		return "", err
	}
	if _, err := part.Write(data); err != nil {
		return "", err
	}
	if err := writer.WriteField("puid", strconv.FormatInt(s.UID, 10)); err != nil {
		return "", err
	}
	if err := writer.Close(); err != nil {
		return "", err
	}

	cli := *c.http
	cli.Jar = s.Jar
	uploadURL := "https://pan-yz.chaoxing.com/upload?_from=mobilelearn&_token=" + url.QueryEscape(token)
	req, _ := http.NewRequest(http.MethodPost, uploadURL, &body)
	req.Header.Set("User-Agent", c.mobileUA)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	resp, err := cli.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("pan upload failed: http %d %s", resp.StatusCode, truncateForLog(string(respBody), 200))
	}

	var payload interface{}
	if err := json.Unmarshal(respBody, &payload); err != nil {
		return "", fmt.Errorf("pan upload decode failed: %w", err)
	}
	objectID := strings.TrimSpace(strVal(deepFindFirst(payload, "objectId", "objectid")))
	if objectID == "" {
		return "", fmt.Errorf("pan upload objectId missing: %s", truncateForLog(string(respBody), 200))
	}
	return objectID, nil
}
