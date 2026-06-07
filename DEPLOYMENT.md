# XBT 项目部署说明文档

## 项目概述

XBT 是一个基于 Go + React 的超星学习通自动化工具，现已集成**课堂抢答功能**。

### 技术栈
- **后端**: Go 1.22 + Gin + GORM + PostgreSQL + JWT
- **前端**: React 19 + TypeScript + Vite + TailwindCSS
- **部署**: Docker + Docker Compose

---

## 一、快速部署

### 1. 环境要求
- Docker 20.10+
- Docker Compose v2+
- 至少 2GB 可用内存
- 至少 5GB 可用磁盘空间

### 2. 一键部署

```bash
# 1. 克隆项目
git clone https://github.com/EnderWolf006/XBT.git
cd XBT

# 2. 启动服务
docker-compose up -d

# 3. 查看服务状态
docker-compose ps

# 4. 查看日志
docker-compose logs -f
```

### 3. 访问地址
- 前端界面: http://localhost
- 后端API: http://localhost:8080
- 数据库: localhost:5432

---

## 二、抢答功能说明

### 功能特性

✅ **实时监控**: 自动检测课堂抢答活动
✅ **自动抢答**: 检测到活动后毫秒级自动提交
✅ **手动抢答**: 支持手动触发抢答
✅ **延迟配置**: 可设置抢答延迟避免被检测
✅ **课程过滤**: 支持指定监控特定课程
✅ **历史记录**: 完整的抢答历史记录
✅ **状态监控**: 实时显示监控运行状态

### 使用方法

1. **登录系统**: 使用超星学习通账号登录
2. **进入抢答功能**: 点击首页顶部的 ⚡ 抢答图标
3. **启动监控**: 在"控制"页面点击"启动监控"
4. **配置选项** (可选):
   - 启用/禁用自动抢答
   - 设置抢答延迟 (建议 50-200ms)
   - 配置监控的课程列表

### API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/quiz/config` | 获取抢答配置 |
| PUT | `/api/quiz/config` | 更新抢答配置 |
| POST | `/api/quiz/monitor/start` | 启动监控 |
| POST | `/api/monitor/stop` | 停止监控 |
| GET | `/api/quiz/status` | 获取监控状态 |
| GET | `/api/quiz/records` | 获取抢答记录 |
| GET | `/api/quiz/activities` | 获取抢答活动 |
| POST | `/api/quiz/answer` | 手动抢答 |

---

## 三、配置说明

### 环境变量配置

复制 `.env.example` 为 `.env` 并修改：

```bash
cp .env.example .env
# 编辑 .env 文件
```

**重要配置项**:

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `JWT_SECRET` | JWT签名密钥 | **生产环境必须修改** |
| `CREDENTIAL_SECRET` | 凭证加密密钥 | **生产环境必须修改** |
| `DB_PASSWORD` | 数据库密码 | 建议修改 |
| `APP_ENV` | 运行环境 | production |

### 抢答配置说明

- **delay_ms**: 抢答延迟毫秒数，建议 50-200
- **auto_answer**: 是否自动抢答
- **monitor_courses**: JSON数组，指定监控的课程ID，空数组监控全部
- **enabled**: 抢答功能总开关

---

## 四、文件结构

### 新增文件 (抢答功能模块)

```
XBT/Server/internal/quiz/
├── model/
│   └── models.go              # 数据模型定义
├── service/
│   └── monitor.go             # 抢答监控服务
└── handler/
    └── quiz.go                # HTTP处理器

XBT/Web/src/
├── api/
│   └── quiz.ts                # API客户端
└── pages/
    └── Quiz.tsx               # 抢答功能页面
```

### 修改文件

```
XBT/Server/
├── cmd/server/main.go         # 集成抢答路由
├── go.mod                     # Go版本适配
└── Dockerfile                 # 后端Docker配置

XBT/Web/
├── src/App.tsx                # 添加抢答路由
├── src/pages/Lobby.tsx        # 添加抢答入口
├── Dockerfile                 # 前端Docker配置
└── nginx.conf                 # Nginx配置

XBT/
├── docker-compose.yml         # 编排配置
├── .env.example               # 环境变量示例
├── DEPLOYMENT.md              # 部署说明
└── QUIZ_FEATURE.md            # 抢答功能说明
```

---

## 五、数据库表结构

抢答功能自动创建以下表：

### quiz_configs - 抢答配置表
```sql
CREATE TABLE quiz_configs (
  id SERIAL PRIMARY KEY,
  user_uid BIGINT NOT NULL UNIQUE,
  enabled BOOLEAN DEFAULT true,
  auto_answer BOOLEAN DEFAULT false,
  monitor_courses TEXT DEFAULT '[]',
  delay_ms INTEGER DEFAULT 0,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

### quiz_activities - 抢答活动表
```sql
CREATE TABLE quiz_activities (
  id SERIAL PRIMARY KEY,
  activity_id BIGINT NOT NULL,
  course_id BIGINT,
  class_id BIGINT,
  course_name VARCHAR(255),
  title VARCHAR(255),
  start_time BIGINT,
  end_time BIGINT,
  status INTEGER,
  auto_answer BOOLEAN,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

### quiz_records - 抢答记录表
```sql
CREATE TABLE quiz_records (
  id SERIAL PRIMARY KEY,
  user_uid BIGINT NOT NULL,
  activity_id BIGINT,
  user_name VARCHAR(100),
  course_name VARCHAR(255),
  answer_time INTEGER,
  rank INTEGER,
  success BOOLEAN,
  message TEXT,
  created_at TIMESTAMP
);
```

---

## 六、常见问题

### 1. 服务启动失败
```bash
# 查看具体服务日志
docker-compose logs xbt-server
docker-compose logs postgres
```

### 2. 数据库连接失败
- 确保 PostgreSQL 容器正常启动
- 检查 docker-compose.yml 中的数据库配置
- 等待数据库初始化完成（约10-30秒）

### 3. 抢答功能不工作
- 确认已登录系统
- 检查监控状态是否为"运行中"
- 确认已启用自动抢答
- 查看后端日志排查问题

### 4. 更新版本
```bash
# 拉取最新代码
git pull

# 重新构建并启动
docker-compose up -d --build
```

---

## 七、安全建议

1. **修改默认密钥**: 生产环境务必修改 `JWT_SECRET` 和 `CREDENTIAL_SECRET`
2. **使用HTTPS**: 生产环境建议配置反向代理启用HTTPS
3. **限制访问**: 配置防火墙限制数据库端口访问
4. **定期备份**: 定期备份 PostgreSQL 数据
5. **合理延迟**: 设置适当的抢答延迟降低被检测风险

---

## 八、数据持久化

数据库数据通过 Docker Volume 持久化：
- 数据卷: `xbt_postgres_data`
- 备份命令:
```bash
# 备份数据库
docker exec xbt-postgres pg_dump -U xbt xbt > backup.sql

# 恢复数据库
docker exec -i xbt-postgres psql -U xbt xbt < backup.sql
```
