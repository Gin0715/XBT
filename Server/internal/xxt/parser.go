package xxt

import (
	"encoding/json"
	"strings"
)

// QuickAnswerResult 统一抢答结果结构体
type QuickAnswerResult struct {
	Raw      string `json:"-"`                // 原始返回内容
	Result   int    `json:"result"`            // 超星 result: 0=失败, 1=成功
	Msg      string `json:"msg,omitempty"`     // 消息文本
	ErrorMsg string `json:"errorMsg,omitempty"` // 错误消息
	Data     json.RawMessage `json:"data,omitempty"` // 数据载荷
}

// ParseQuickAnswerResult 解析 QuickAnswer API 返回
// 返回值: (isSuccess, message, isFinal, parsedResult)
// - isSuccess: 是否抢答成功
// - message: 人类可读的消息
// - isFinal: 是否为终态（无需重试）
// - parsedResult: 详细的结构化结果
func ParseQuickAnswerResult(rawResult string) (isSuccess bool, message string, isFinal bool, parsed *QuickAnswerResult) {
	if rawResult == "" {
		return false, "空响应", false, nil
	}

	res := &QuickAnswerResult{Raw: rawResult}

	// 尝试 JSON 解析
	if err := json.Unmarshal([]byte(rawResult), res); err == nil {
		if res.ErrorMsg != "" {
			message = res.ErrorMsg
		} else if res.Msg != "" {
			message = res.Msg
		}

		if res.Result == 1 {
			// result=1: data=1 表示人数已满，否则成功
			if string(res.Data) == "1" {
				isSuccess = false
				message = "抢答人数已达上限"
			} else {
				isSuccess = true
				if message == "" {
					message = "抢答成功！"
				}
			}
		} else {
			if message == "" {
				message = "抢答失败"
			}
		}
	} else {
		// 非 JSON 响应，用文本匹配
		lower := strings.ToLower(rawResult)
		if strings.Contains(lower, "抢答成功") ||
			strings.Contains(lower, "success") ||
			strings.Contains(rawResult, `"result":1`) {
			isSuccess = true
			message = "抢答成功！"
		} else if strings.Contains(lower, "已过期") ||
			strings.Contains(lower, "已结束") ||
			strings.Contains(lower, "学生已抢答") ||
			strings.Contains(lower, "已抢答") {
			message = rawResult
			// 终态但不成功
		} else {
			message = rawResult
		}
	}

	// 终态判断（无论是否成功，只要是终态就不需要重试）
	lowerMsg := strings.ToLower(message)
	isFinal = isSuccess ||
		strings.Contains(lowerMsg, "已过期") ||
		strings.Contains(lowerMsg, "已结束") ||
		strings.Contains(lowerMsg, "学生已抢答") ||
		strings.Contains(lowerMsg, "已抢答") ||
		strings.Contains(lowerMsg, "人数已达上限") ||
		strings.Contains(lowerMsg, "已达上限") ||
		strings.Contains(rawResult, `"result":1`)

	return
}

// IsAntiCrawlResponse 判断是否为风控类响应
// 返回风控等级: 0=正常, 1=轻度风控(需降频), 2=严重风控(需暂停)
func IsAntiCrawlResponse(rawResult string) int {
	if rawResult == "" {
		return 0
	}
	lower := strings.ToLower(rawResult)

	// 严重风控：会话过期、被拦截、验证码要求
	if strings.Contains(rawResult, "<!DOCTYPE html") ||
		strings.HasPrefix(rawResult, "<") ||
		strings.Contains(lower, "请勿频繁操作") ||
		strings.Contains(lower, "频率过高") ||
		strings.Contains(lower, "too many") ||
		strings.Contains(lower, "captcha") ||
		strings.Contains(lower, "验证码") ||
		strings.Contains(lower, "需要验证") {
		return 2
	}

	// 轻度风控：请求成功但返回异常
	if strings.Contains(lower, "request limit") ||
		strings.Contains(lower, "请稍后") ||
		strings.Contains(lower, "请稍候") {
		return 1
	}

	return 0
}

// IsFinalResult 快速判断 QuickAnswer 返回是否已到终态（用于自动重试判断）
func IsFinalResult(rawResult string) bool {
	if rawResult == "" {
		return false
	}
	lower := strings.ToLower(rawResult)
	return strings.Contains(lower, "已过期") ||
		strings.Contains(lower, "已结束") ||
		strings.Contains(lower, "学生已抢答") ||
		strings.Contains(lower, "已抢答") ||
		strings.Contains(lower, "人数已达上限") ||
		strings.Contains(lower, "已达上限") ||
		strings.Contains(rawResult, `"result":1`)
}

// ExtractAnswerServerTime 尝试从 QuickAnswer 响应中提取服务端记录的真实抢答时间(毫秒时间戳)
// 超星 API 成功响应 data 字段可能包含 answerTime/submitTime 等服务端时间
func ExtractAnswerServerTime(rawResult string) int64 {
	if rawResult == "" {
		return 0
	}
	var res QuickAnswerResult
	if err := json.Unmarshal([]byte(rawResult), &res); err != nil {
		return 0
	}
	if res.Result != 1 {
		return 0
	}
	if len(res.Data) == 0 || string(res.Data) == "1" || string(res.Data) == `"1"` {
		return 0
	}
	// 尝试将 data 解析为对象并提取常见时间字段
	var data map[string]any
	if err := json.Unmarshal(res.Data, &data); err != nil {
		return 0
	}
	for _, key := range []string{"answerTime", "submitTime", "serverTime", "timestamp", "subtime"} {
		if v, ok := data[key]; ok {
			switch val := v.(type) {
			case float64:
				return int64(val)
			case int64:
				return val
			case json.Number:
				if n, err := val.Int64(); err == nil {
					return n
				}
			}
		}
	}
	return 0
}

// IsQuizActivity 检查活动名称是否为抢答类活动
func IsQuizActivity(name string) bool {
	lower := strings.ToLower(name)
	return strings.Contains(lower, "抢答") ||
		strings.Contains(lower, "问答") ||
		strings.Contains(lower, "答题") ||
		strings.Contains(lower, "测验") ||
		strings.Contains(lower, "互动") ||
		strings.Contains(lower, "测试") ||
		strings.Contains(lower, "exam") ||
		strings.Contains(lower, "quiz") ||
		strings.Contains(lower, "answer")
}

// IsQuizActivityByType 根据 activeType 判断是否为抢答/答题类活动
// 超星常见活动类型: 2=签到, 3=抢答/问答, 4=投票, 5=问卷
func IsQuizActivityByType(activeType int) bool {
	return activeType == 3 || activeType == 6 || activeType == 8
}

// TruncateString 截断字符串用于日志
func TruncateString(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}
