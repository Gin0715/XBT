# XBT 项目修改文件清单

## 概述

本文件列出了为集成**抢答功能**而新增和修改的所有文件。

---

## 一、新增文件

### 后端 - 抢答功能模块

#### 1. 数据模型层
```
XBT/Server/internal/quiz/model/models.go
```
- 定义 QuizConfig, QuizActivity, QuizRecord, QuizMonitorStatus 数据结构
- 包含所有数据库表的GORM模型定义

#### 2. 业务服务层
```
XBT/Server/internal/quiz/service/monitor.go
```
- QuizMonitorService 核心监控服务实现
- 抢答监控 goroutine 管理
- 配置管理和数据查询
- 自动抢答逻辑实现

#### 3. HTTP处理器层
```
XBT/Server/internal/quiz/handler/quiz.go
```
- QuizHandler HTTP接口处理器
- 8个RESTful API端点实现
- 数据库自动迁移方法
- 请求参数验证和响应封装

### 前端 - 抢答功能页面

#### 4. API客户端
```
XBT/Web/src/api/quiz.ts
```
- TypeScript类型定义
- 所有API调用封装
- 请求和响应类型声明

#### 5. 抢答功能页面
```
XBT/Web/src/pages/Quiz.tsx
```
- 完整的抢答功能UI
- 三个Tab页：控制、配置、记录
- 实时状态刷新
- 响应式设计和动画效果

### Docker部署配置

#### 6. 后端Dockerfile
```
XBT/Server/Dockerfile
```
- 多阶段构建优化
- Go 1.22 Alpine 基础镜像
- 时区和证书配置

#### 7. 前端Dockerfile
```
XBT/Web/Dockerfile
```
- Node 20 构建 + Nginx 运行
- 静态资源优化配置

#### 8. Nginx配置
```
XBT/Web/nginx.conf
```
- SPA路由支持
- API反向代理配置
- Gzip压缩和缓存策略
- 安全头配置

#### 9. Docker Compose编排
```
XBT/docker-compose.yml
```
- PostgreSQL 15 数据库服务
- 后端服务健康检查
- 前端Nginx服务
- 网络和数据卷配置

#### 10. 环境变量示例
```
XBT/.env.example
```
- 所有可配置环境变量
- 生产环境建议修改项标注

### 文档文件

#### 11. 部署说明文档
```
XBT/DEPLOYMENT.md
```
- 快速部署指南
- 功能特性说明
- 配置详解
- 常见问题排查
- 数据备份方案

#### 12. 抢答功能说明
```
XBT/QUIZ_FEATURE.md
```
- 模块架构设计
- 数据模型详解
- API接口文档
- 核心服务说明
- 集成方式指南

#### 13. 修改文件清单
```
XBT/CHANGES.md
```
- 本文件，所有变更记录

---

## 二、修改文件

### 后端修改

#### 1. 主程序入口
```
XBT/Server/cmd/server/main.go
```
**修改内容**:
- 导入 quizhandler 包
- 创建 QuizHandler 实例
- 添加数据库自动迁移调用
- 在认证路由组中注册8个抢答API端点

**变更点**:
- 新增 import: `quizhandler "xbt2/server/internal/quiz/handler"`
- 新增: `quizHandler := quizhandler.NewQuizHandler(database, xxtClient)`
- 新增: `quizHandler.AutoMigrate()` 自动迁移
- 新增8个路由端点

#### 2. Go模块配置
```
XBT/Server/go.mod
```
**修改内容**:
- Go版本从 1.25.5 降级为 1.22
- 适配构建环境的Go版本

### 前端修改

#### 3. 应用路由配置
```
XBT/Web/src/App.tsx
```
**修改内容**:
- 导入 Quiz 页面组件
- 在受保护路由组中添加 `/quiz` 路由

#### 4. 首页入口
```
XBT/Web/src/pages/Lobby.tsx
```
**修改内容**:
- 导入 Zap 图标组件
- 在顶部功能按钮区添加抢答功能入口按钮
- 点击跳转到 `/quiz` 页面

---

## 三、文件统计

| 类型 | 数量 | 说明 |
|------|------|------|
| 新增文件 | 13 | 抢答功能模块、部署配置、文档 |
| 修改文件 | 4 | 集成到现有系统 |
| **总计** | **17** | 所有变更文件 |

---

## 四、代码行数统计

| 文件 | 行数 | 说明 |
|------|------|------|
| models.go | ~150 | 数据模型 |
| monitor.go | ~350 | 监控服务 |
| quiz.go | ~250 | HTTP处理器 |
| quiz.ts | ~100 | API客户端 |
| Quiz.tsx | ~350 | 前端页面 |
| 配置文件 | ~200 | Docker相关 |
| 文档 | ~5000 | 说明文档 |
| **总计** | **~6400** | 新增代码 |

---

## 五、兼容性说明

✅ **完全向后兼容**
- 所有原有功能不受影响
- 不修改原有业务代码
- 数据库表独立创建
- 路由独立注册
- 权限系统复用

✅ **无破坏性变更**
- 不修改原有数据库表
- 不改变原有API行为
- 不影响现有用户数据
- 可随时回滚

---

## 六、回滚方案

如需移除抢答功能，只需执行以下操作：

1. **删除新增文件**:
   - 删除 `XBT/Server/internal/quiz/` 目录
   - 删除 `XBT/Web/src/api/quiz.ts`
   - 删除 `XBT/Web/src/pages/Quiz.tsx`
   - 删除 Docker 相关新增文件

2. **恢复修改文件**:
   - 从 `main.go` 移除抢答相关代码
   - 从 `App.tsx` 移除抢答路由
   - 从 `Lobby.tsx` 移除抢答入口按钮

3. **清理数据库** (可选):
```sql
DROP TABLE quiz_configs;
DROP TABLE quiz_activities;
DROP TABLE quiz_records;
```

---

## v2.2 — 2026-06-08

### 新增文件

#### 1. 百度地图 API Key 运行时配置组件
```
Web/src/components/location/BMapKeyConfig.tsx
```
- 三种模式：compact（状态按钮）、fullWidth（全宽卡片）、默认（内联指示器）
- 未配置时醒目红框引导，已配置时绿色状态栏
- 支持显示/隐藏 Key、清除、一键跳转百度开放平台

#### 2. 实时定位卡片
```
Web/src/components/location/LiveLocationCard.tsx
```
- 精密仪器/航空仪表盘设计语言
- 深空蓝黑渐变 + 动态光晕 + SVG 网格纹理
- N/E 角标坐标显示 + 三态切换（空/加载/已定位）

#### 3. 地址库共享 Hook
```
Web/src/hooks/useLocationPanel.ts
```
- 统一管理 CRUD + GPS 定位 + Key 配置
- Lobby + SignDetail 共用，移除 ~170 行重复代码

#### 4. 响应式百度地图 Key 管理 Hook
```
Web/src/hooks/useBMapKey.ts
```
- 三层同步：localStorage 持久化 + storage 事件跨标签页 + 自定义事件同页面
- 同一页面多个 KeyConfig 实例自动保持状态一致

### 修改文件

| 文件 | 变更 |
|------|------|
| `Web/src/utils/bmap.ts` | 新增 `getBMapKey/setBMapKey/clearBMapKey/hasBMapKey/reloadBMapWithKey` |
| `Web/src/pages/Lobby.tsx` | 改用共享 Hook + 新组件，移除 ~70 行 |
| `Web/src/pages/SignDetail.tsx` | 同上，移除 ~100 行 |
| `Web/src/components/sign/PhotoInput.tsx` | 完全重写 — 玻璃效果、hover 预览 |
| `Web/src/pages/FullPhoto.tsx` | 玻璃效果顶部栏 + 照片预览条优化 |
| `Web/src/index.css` | 新增 10+ 性能 CSS 工具类 + 6 种玻璃效果类 |

### 文件统计

| 类型 | 数量 | 说明 |
|------|------|------|
| 新增文件 | 4 | BMapKeyConfig, LiveLocationCard, useLocationPanel, useBMapKey |
| 修改文件 | 6 | bmap, Lobby, SignDetail, PhotoInput, FullPhoto, index.css |
| **总计** | **10** | 本次变更 |
