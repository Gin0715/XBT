# 多阶段构建 - 后端服务
FROM golang:1.25-alpine AS builder

WORKDIR /app

# 替换 builder 阶段的 Alpine 软件源为阿里云镜像
RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories

# 安装必要依赖
RUN apk add --no-cache git ca-certificates tzdata

# 复制go mod文件
COPY go.mod go.sum ./

# 设置 Go 模块代理（多源容灾：goproxy.cn → goproxy.io → direct）
ENV GOPROXY=https://goproxy.cn,https://goproxy.io,https://proxy.golang.org,direct

RUN go mod download

# 复制源代码
COPY . .

# 确保 config.yaml 存在（构建上下文中没有则生成一份 Docker 环境默认配置）
RUN if [ ! -f config.yaml ]; then \
        echo "*** Warning: config.yaml not found, generating Docker-optimized default ***"; \
        printf 'app_env: prod\nhttp_addr: ":8080"\njwt_secret: "change_me_in_production"\ncredential_secret: "change_me_in_production"\nallow_insecure_tls: true\nchaoxing_aes_key: "u2oh6Vu^HWe4_AES"\nchaoxing_user_agent: "Dalvik/2.1.0 (Linux; U; Android 14; Redmi K20 Pro Build/UKQ1.230804.001) (schild:0945de15614364966e17460057ab5aa6) (device:Redmi K20 Pro) Language/zh_CN com.chaoxing.mobile/ChaoXingStudy_3_6.4.8_android_phone_10834_264 (@Kalimdor)_aa664e5fbb1d46df8e5aa65f62a438d8"\nactivity_list_limit: 5\npostgres_dsn: "host=postgres port=5432 user=xbt password=xbt_password_2024 dbname=xbt sslmode=disable TimeZone=Asia/Shanghai"\nredis_addr: "redis:6379"\nredis_password: ""\nredis_db: 0\nbaidu_map_ak: ""\n' > config.yaml; \
    fi && \
    echo "=== config.yaml ==" && cat config.yaml

# 构建应用（GOFLAGS=-mod=mod 允许 go build 自动填充 go.sum 缺失条目）
RUN GOFLAGS=-mod=mod CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o xbt-server ./cmd/server/main.go

# ================= 最终镜像 =================
FROM alpine:latest

WORKDIR /app

# 替换最终镜像阶段的 Alpine 软件源
RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories

# 安装必要工具
RUN apk add --no-cache ca-certificates tzdata

# 设置时区
ENV TZ=Asia/Shanghai

# 从构建阶段复制二进制文件
COPY --from=builder /app/xbt-server .

# 将配置文件打入镜像作为兜底
# 优先级：docker-compose volumes 挂载 > 镜像内默认文件
# 如果 Windows 网络驱动器挂载失败，容器仍能使用镜像内的默认配置启动
COPY --from=builder /app/config.yaml ./config.yaml

# 暴露端口
EXPOSE 8080

# 启动服务
CMD ["./xbt-server"]