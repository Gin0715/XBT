# XBT 项目优化路线图

> 基于对项目代码的完整审查，按优先级和影响面整理的后续优化方向。

---

## 🔴 P0 — 安全与稳定（应立即处理）

### 1. 密钥硬编码风险

**现状：** `docker-compose.yml` 中暴露了明文密钥：
```yaml
JWT_SECRET: your_jwt_secret_key_here_please_change_in_production
CREDENTIAL_SECRET: your_credential_secret_key_here_please_change
CHAOXING_AES_KEY: u2oh6Vu^HWe40fj
```
**风险：** 任何拿到仓库的人都能伪造 JWT、解密用户密码。  
**建议：**
- 使用 Docker secrets 或 `.env` 文件注入（`.env` 已在 `.gitignore` 中）
- `CHAOXING_AES_KEY` 不应硬编码在 compose 文件中
- 添加部署前密钥检查脚本

### 2. 密码传输安全

**现状：** 登录接口 `POST /api/auth/login` 通过 HTTP 明文传输 `mobile` + `password`，仅依赖 AES 加密存储。  
**风险：** 中间人攻击可截获明文密码。  
**建议：**
- 前端对密码做一次非对称加密（RSA 公钥）再发送
- 生产环境强制 HTTPS，后端添加 `Secure` + `HttpOnly` cookie
- 登录接口添加速率限制（防止暴力破解）

### 3. JWT Token 安全

**现状：** `docker-compose.yml` 中 `JWT_SECRET` 默认值未强制要求修改，无 token 过期/刷新机制。  
**建议：**
- 添加 `exp` 过期时间（建议 24h）
- 实现 refresh token 机制
- 启动时检查 `JWT_SECRET` 是否为默认值，若是则拒绝启动

### 4. 数据库密码暴露

**现状：** `docker-compose.yml` 中 PostgreSQL 密码明文写在环境变量中。  
**建议：** 使用 Docker secrets 或 `.env` 文件管理数据库密码。

---

## 🟠 P1 — 重要优化（短期 1-2 周）

### 5. 错误处理与用户体验

**现状：**
- 前端错误提示使用 `error.message` 直接展示，部分后端错误信息泄露内部细节
- `FullScanner.tsx` 中相机启动失败仅有 toast 提示，未提供重试入口
- `Quiz.tsx` token 无效时弹 `window.location.reload()` 体验生硬

**建议：**
- 定义错误码枚举（前端 `ErrorCode` + 后端统一错误码），前端根据错误码展示友好提示
- 相机失败时显示「重试」按钮而非仅 toast
- Token 过期时静默跳转登录页而非整页刷新

### 6. 移动端性能优化

**现状：**
- `index.css` 约 569 行，其中部分 CSS 变量和动画未按需加载
- `framer-motion` 全局引入，但实际上很多页面已迁移到纯 CSS 动画
- `html5-qrcode` 库体积较大（~200KB gzipped），仅 `FullScanner.tsx` 使用

**建议：**
- `html5-qrcode` 改为动态 `import()` 懒加载，仅在进入扫码页时加载
- `framer-motion` 评估是否可完全替换为纯 CSS 动画（`btn-tap` 等工具类已就位）
- 对 `index.css` 做 tree-shaking 拆分（基础样式 / 页面专属样式）

### 7. 状态管理规范化

**现状：**
- `Quiz.tsx` 中使用 30+ 个 `useRef`/`useState` 管理复杂抢答状态，逻辑散落在 ~1400 行单文件中
- 照片传递使用 `sessionStorage` + base64（`photoTransfer.ts`），大照片有性能风险
- 缓存数据使用 `localStorage` 直接存取，无版本管理，格式变更时可能崩溃

**建议：**
- `Quiz.tsx` 拆分为 3 个 Tab 子组件 + 1 个共享 Hook（`useQuizMonitor`）
- 照片传递改为 IndexedDB，支持大文件
- localStorage 添加版本号 `__schema_version__`，版本不匹配时自动清理

### 8. 后端 Goroutine 生命周期管理

**现状：**
- `monitor.go` 中每个用户的监控 goroutine 在 `StartMonitor` 时创建，但没有全局优雅关闭机制
- 如果用户未手动停止监控就关闭服务端，goroutine 可能泄漏

**建议：**
- `QuizMonitorService` 添加 `Shutdown()` 方法，遍历所有监控实例执行 `safeStop()`
- `main.go` 中监听 `SIGINT`/`SIGTERM` 信号，调用 `Shutdown()` 后再退出

### 9. 后端日志规范化

**现状：** 使用 Go 标准库 `log` 包，无结构化日志、无日志级别、无上下文追踪。  
**建议：**
- 引入 `slog`（Go 1.21+ 内置）或 `zap`，添加请求 ID 链路追踪
- 关键操作（登录、签到执行、抢答）记录结构化日志
- 添加慢查询日志（GORM 的 `SlowThreshold`）

---

## 🟡 P2 — 架构增强（中期 1-2 月）

### 10. 后端测试覆盖

**现状：** 项目中无任何单元测试或集成测试。  
**建议：**
- 优先为核心模块添加测试：
  - `service/crypto.go` — AES 加解密
  - `service/jwt.go` — JWT 签发/验证
  - `quiz/service/monitor.go` — 抢答检测逻辑
  - `handler/sign.go` — 签到执行逻辑
- 添加 CI 流水线（GitHub Actions），自动运行测试

### 11. API 版本化

**现状：** API 路径为 `/api/*` 无版本前缀，未来接口变更可能不兼容旧版前端。  
**建议：** 路由组添加版本前缀 `/api/v1/*`，为后续 API v2 预留空间。

### 12. 前端组件测试

**现状：** 无任何前端测试。  
**建议：**
- 使用 Vitest + React Testing Library
- 优先覆盖：`PhotoInput`（文件上传逻辑）、`useLocationPanel` Hook、`auth store`

### 13. 数据库迁移管理

**现状：** 使用 GORM `AutoMigrate` 自动迁移，缺乏版本控制和回滚能力。  
**建议：**
- 引入 `golang-migrate` 或 `atlas` 进行数据库版本管理
- 每次 schema 变更生成 up/down 迁移脚本
- CI 中自动执行迁移

### 14. 监控与可观测性

**现状：** 无健康检查 API 无实际检查深度，无 metrics 暴露。  
**建议：**
- `/api/health` 增加 DB 和 Redis 连通性检查
- 添加 Prometheus metrics 端点（请求延迟、错误率、活跃监控数）
- 抢答成功率打点统计

---

## 🟢 P3 — 体验与功能增强（长期 2-3 月）

### 15. PWA 支持

**现状：** 虽然是移动端优先设计，但无离线能力。  
**建议：**
- 添加 `manifest.json` + Service Worker
- 实现静态资源预缓存（Workbox）
- 添加到主屏幕提示

### 16. 多语言支持

**现状：** 全部中文字符串硬编码在组件中。  
**建议：** 引入 `react-i18next`，提取所有文案到翻译文件，为国际化做准备。

### 17. 主题系统

**现状：** 仅有浅色主题，玻璃拟态依赖于浅色背景。  
**建议：**
- 实现暗色主题（深色玻璃拟态 `.glass-dark` 已有基础）
- 使用 CSS 变量 + Tailwind 的 `dark:` 变体
- 支持跟随系统主题自动切换

### 18. 批量操作增强

**现状：** 签到执行是顺序的 `for...of` 循环。  
**建议：**
- 改为并发执行（`Promise.allSettled`），大幅缩短批量签到时间
- 添加可配置的并发数限制（避免触发风控）
- 支持对特定用户暂停/跳过/重试

### 19. Android 原生能力扩展

**现状：** Android 端仅为 WebView 容器 + CameraX 桥接。  
**建议：**
- 添加原生通知推送（抢答活动检测到时推通知）
- 后台 Service 支持抢答监控（即使 WebView 不在前台）
- 利用 Android 原生存储优化照片缓存

### 20. 管理端功能增强

**现状：** 仅支持白名单管理，无数据分析面板。  
**建议：**
- 添加签到统计面板（签到率、签到类型分布、活跃时段）
- 添加抢答排名统计
- 支持导出签到/抢答报表（CSV/Excel）

---

## 📊 优先级矩阵

```
                    影响面
                低        高
           ┌─────────┬─────────┐
      高   │ P0 安全  │ P1 体验  │
  优先级    │ 1-4     │ 5-9     │
           ├─────────┼─────────┤
      低   │ P3 锦上  │ P2 架构  │
           │ 15-20   │ 10-14   │
           └─────────┴─────────┘
```

## 🎯 建议执行顺序

1. **第一周**：P0 安全项（密钥管理、HTTPS、JWT 过期）
2. **第二~三周**：P1 高影响项（错误处理、性能优化、代码拆分）
3. **第 1~2 月**：P2 架构项（测试、CI、数据库迁移、监控）
4. **第 2~3 月**：P3 体验项（PWA、暗色主题、批量并发、推送通知）

---

> 以上建议基于代码审查和常见最佳实践，具体优先级和排期请根据实际需求和资源调整。
