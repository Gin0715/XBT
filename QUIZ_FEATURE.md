# 抢答功能模块说明文档

## 模块概述

抢答功能是 XBT 项目的一个独立模块，用于自动监控和参与超星学习通的课堂抢答活动。该模块采用独立的三层架构设计，不侵入原有业务代码。

---

## 一、架构设计

### 模块结构

```
internal/quiz/
├── model/
│   └── models.go          # 数据模型层
├── service/
│   └── monitor.go         # 业务逻辑层
└── handler/
    └── quiz.go            # HTTP接口层
```

### 设计原则

1. **独立模块**: 所有抢答相关代码位于独立目录，不修改原有业务代码
2. **自动迁移**: 启动时自动创建数据库表，无需手动执行SQL
3. **权限复用**: 复用现有JWT认证中间件，登录即可使用
4. **非侵入式**: 通过路由注册集成，原有功能完全不受影响

---

## 二、数据模型

### 1. QuizConfig - 抢答配置

每个用户独立的抢答配置：

| 字段 | 类型 | 说明 | 默认值 |
|------|------|------|--------|
| user_uid | bigint | 用户ID (唯一) | - |
| enabled | bool | 功能总开关 | true |
| auto_answer | bool | 自动抢答开关 | false |
| monitor_courses | text | JSON数组，监控的课程ID | '[]' |
| delay_ms | int | 抢答延迟(毫秒) | 0 |

### 2. QuizActivity - 抢答活动

检测到的抢答活动记录：

| 字段 | 类型 | 说明 |
|------|------|------|
| activity_id | bigint | 学习通活动ID |
| course_id | bigint | 课程ID |
| class_id | bigint | 班级ID |
| course_name | varchar | 课程名称 |
| title | varchar | 活动标题 |
| start_time | bigint | 开始时间戳 |
| end_time | bigint | 结束时间戳 |
| status | int | 活动状态 |
| auto_answer | bool | 是否自动抢答 |

### 3. QuizRecord - 抢答记录

每次抢答的详细记录：

| 字段 | 类型 | 说明 |
|------|------|------|
| user_uid | bigint | 用户ID |
| activity_id | bigint | 活动ID |
| user_name | varchar | 用户名 |
| course_name | varchar | 课程名称 |
| answer_time | int | 抢答耗时(毫秒) |
| rank | int | 抢答排名 |
| success | bool | 是否成功 |
| message | text | 结果消息 |

### 4. QuizMonitorStatus - 监控状态

运行时状态结构体：

| 字段 | 类型 | 说明 |
|------|------|------|
| user_uid | bigint | 用户ID |
| is_running | bool | 是否运行中 |
| connected | bool | 是否已连接 |
| last_check | int64 | 最后检测时间 |
| activity_count | int | 已检测活动数 |

---

## 三、核心服务

### QuizMonitorService

抢答监控核心服务，采用 goroutine 后台轮询模式：

#### 主要方法：

```go
// 启动用户的抢答监控
StartMonitor(userUID int64) error

// 停止用户的抢答监控
StopMonitor(userUID int64) error

// 获取监控状态
GetMonitorStatus(userUID int64) *QuizMonitorStatus

// 获取/更新用户配置
GetConfig(userUID int64) (*QuizConfig, error)
UpdateConfig(userUID int64, config *QuizConfig) error
```

#### 监控流程：

1. **启动监控**: 创建独立 goroutine
2. **轮询检测**: 每 2 秒查询一次活动列表
3. **活动识别**: 识别抢答类型的活动
4. **自动抢答**: 如启用自动抢答，立即提交
5. **记录保存**: 保存抢答结果到数据库

---

## 四、API 接口

所有接口均需要 JWT 认证（登录后自动携带）。

### 1. 配置管理

#### 获取配置
```http
GET /api/quiz/config
```

**响应**:
```json
{
  "code": 0,
  "data": {
    "id": 1,
    "user_uid": 123456,
    "enabled": true,
    "auto_answer": true,
    "monitor_courses": "[]",
    "delay_ms": 100,
    "created_at": "2024-01-01T00:00:00Z",
    "updated_at": "2024-01-01T00:00:00Z"
  }
}
```

#### 更新配置
```http
PUT /api/quiz/config
Content-Type: application/json

{
  "enabled": true,
  "auto_answer": true,
  "delay_ms": 100,
  "monitor_courses": "[123456, 789012]"
}
```

### 2. 监控控制

#### 启动监控
```http
POST /api/quiz/monitor/start
```

#### 停止监控
```http
POST /api/quiz/monitor/stop
```

#### 获取状态
```http
GET /api/quiz/status
```

**响应**:
```json
{
  "code": 0,
  "data": {
    "user_uid": 123456,
    "is_running": true,
    "connected": true,
    "last_check": 1704067200000,
    "activity_count": 5
  }
}
```

### 3. 数据查询

#### 获取抢答记录
```http
GET /api/quiz/records
```

#### 获取活动列表
```http
GET /api/quiz/activities
```

### 4. 手动抢答

```http
POST /api/quiz/answer
Content-Type: application/json

{
  "activity_id": 123456789
}
```

---

## 五、前端页面

### 页面结构

抢答页面分为三个 Tab：

#### 1. 控制页 (Control)
- 监控状态卡片（运行/停止、活动数、连接状态）
- 启动/停止按钮
- 快捷设置（自动抢答、功能开关）

#### 2. 配置页 (Config)
- 抢答延迟设置
- 监控课程配置（JSON格式）
- 使用说明和注意事项

#### 3. 记录页 (History)
- 抢答历史记录列表
- 显示抢答时间、耗时、排名、结果
- 成功/失败状态标识

### 技术实现

- **状态刷新**: 每 3 秒自动刷新监控状态
- **响应式设计**: 适配移动端和桌面端
- **动画效果**: 使用 framer-motion 实现流畅动画
- **用户体验**: 实时反馈、加载状态、错误提示

---

## 六、集成方式

### 后端集成

在 `main.go` 中：

```go
// 1. 导入包
import quizhandler "xbt2/server/internal/quiz/handler"

// 2. 创建Handler实例
quizHandler := quizhandler.NewQuizHandler(database, xxtClient)

// 3. 自动迁移数据库
if err := quizHandler.AutoMigrate(); err != nil {
    log.Printf("quiz auto migrate failed: %v", err)
}

// 4. 注册路由（在认证路由组内）
authed.GET("/quiz/config", quizHandler.GetConfig)
authed.PUT("/quiz/config", quizHandler.UpdateConfig)
authed.POST("/quiz/monitor/start", quizHandler.StartMonitor)
authed.POST("/quiz/monitor/stop", quizHandler.StopMonitor)
authed.GET("/quiz/status", quizHandler.GetStatus)
authed.GET("/quiz/records", quizHandler.GetRecords)
authed.GET("/quiz/activities", quizHandler.GetActivities)
authed.POST("/quiz/answer", quizHandler.ManualAnswer)
```

### 前端集成

1. **路由配置** (`App.tsx`):
```tsx
import Quiz from './pages/Quiz';

// 在受保护路由中添加
<Route path="/quiz" element={<Quiz />} />
```

2. **入口按钮** (`Lobby.tsx`):
```tsx
// 在顶部功能区添加抢答图标按钮
<motion.button
  whileTap={{ scale: 0.92 }}
  onClick={() => navigate('/quiz')}
  className="p-2 text-slate-600 hover:bg-slate-50 rounded-lg transition-colors"
  title="课堂抢答"
>
  <Zap size={20} />
</motion.button>
```

---

## 七、核心特性

### 1. 并发安全
- 使用 `sync.Map` 管理用户监控 goroutine
- 每个用户独立的监控协程
- 避免重复启动监控

### 2. 错误处理
- 数据库操作错误捕获
- API调用异常处理
- goroutine panic 恢复

### 3. 性能优化
- 轮询间隔可配置（默认2秒）
- 数据库查询优化
- 避免不必要的API调用

### 4. 可扩展性
- 易于添加新的抢答策略
- 支持多种活动类型识别
- 可扩展通知机制

---

## 八、使用建议

### 最佳实践

1. **延迟设置**: 建议设置 50-200ms 延迟，避免被系统检测
2. **合理使用**: 不要过度依赖自动抢答，建议结合手动使用
3. **课程过滤**: 如只需要特定课程，配置 monitor_courses 减少轮询压力
4. **定期检查**: 定期查看抢答记录，确认功能正常工作

### 风险提示

⚠️ **重要提醒**:
- 本功能仅供学习交流使用
- 请遵守学校相关规定和学术诚信
- 过度使用可能导致账号被检测
- 开发者不对使用后果负责

---

## 九、故障排查

### 常见问题

1. **监控不启动**
   - 检查是否已登录
   - 查看浏览器控制台错误
   - 检查后端服务日志

2. **检测不到活动**
   - 确认课程已同步
   - 检查 monitor_courses 配置
   - 确认活动类型为抢答

3. **抢答失败**
   - 检查网络连接
   - 确认活动未结束
   - 查看记录中的错误信息

4. **数据库错误**
   - 确认 AutoMigrate 执行成功
   - 检查数据库连接
   - 查看后端启动日志
