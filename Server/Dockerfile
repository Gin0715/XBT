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

# 【修复】注释掉下面这行，因为项目里找不到这个文件。
# 配置文件建议在 docker-compose.yml 中通过 volumes 挂载进来。
# COPY --from=builder /app/config.example.yaml ./config.yaml

# 暴露端口
EXPOSE 8080

# 启动服务
CMD ["./xbt-server"]