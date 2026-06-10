package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"xbt2/server/internal/config"
	"xbt2/server/internal/db"
	"xbt2/server/internal/handler"
	"xbt2/server/internal/middleware"
	quizhandler "xbt2/server/internal/quiz/handler"
	quizmodel "xbt2/server/internal/quiz/model"
	quizsvc "xbt2/server/internal/quiz/service"
	"xbt2/server/internal/service"
	"xbt2/server/internal/xxt"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
)

func main() {
	cfg := config.Load()
	gin.SetMode(resolveGinMode(cfg.AppEnv))

	database, err := db.New(cfg)
	if err != nil {
		log.Fatalf("db init failed: %v", err)
	}

	// 自动迁移抢答功能相关数据库表
	if err := database.AutoMigrate(&quizmodel.QuizConfig{}, &quizmodel.QuizRecord{}, &quizmodel.QuizActivity{}); err != nil {
		log.Printf("quiz auto migrate failed: %v", err)
	}

	jwtSvc := service.NewJWTService(cfg.JWTSecret)
	credentialCrypto := service.NewCredentialCrypto(cfg.CredentialSecret)
	xxtClient := xxt.New(cfg.ChaoxingAESKey, cfg.ChaoxingUserAgent, cfg.AllowInsecureTLS, cfg.ActivityListLimit+1)

	// 创建课程共享缓存（从 DB 预热）
	courseCache := service.NewCourseCache(database)
	if err := courseCache.WarmUp(); err != nil {
		log.Printf("course cache warmup failed: %v", err)
	}

	authHandler := handler.NewAuthHandler(database, jwtSvc, credentialCrypto, xxtClient)
	courseHandler := handler.NewCourseHandler(database, xxtClient, credentialCrypto, courseCache)
	signSvc := service.NewSignService(database, xxtClient, credentialCrypto)
	signHandler := handler.NewSignHandler(database, xxtClient, credentialCrypto, signSvc, cfg.ActivityListLimit)
	whitelistHandler := handler.NewWhitelistHandler(database)
	locationHandler := handler.NewLocationHandler(database)

	// 清理旧版硬编码默认地址
	if err := locationHandler.CleanupLegacyDefaults(); err != nil {
		log.Printf("cleanup legacy location defaults failed: %v", err)
	}

	// 初始化 MonitorService 并传入 QuizHandler
	quizSvc := quizsvc.NewQuizService(database, xxtClient, credentialCrypto, courseCache)
	quizHandler := quizhandler.NewQuizHandler(database, xxtClient, credentialCrypto, quizSvc)
	// 将 Monitor 注册到 WS Hub（WS 断开时自动停止监控）
	quizsvc.DefaultWSHub.SetMonitor(quizSvc.Monitor)

	redisClient := redis.NewClient(&redis.Options{
		Addr:     cfg.RedisAddr,
		Password: cfg.RedisPassword,
		DB:       cfg.RedisDB,
	})
	if err := redisClient.Ping(context.Background()).Err(); err != nil {
		log.Fatalf("redis init failed: %v", err)
	}

	bmapHandler := handler.NewBMapHandler(redisClient, cfg.BaiduMapAK)

	r := gin.Default()

	api := r.Group("/api")
	{
		api.GET("/health", func(c *gin.Context) {
			c.JSON(200, gin.H{"code": 0, "message": "ok", "data": gin.H{"service": "xbt2-server"}})
		})
		api.POST("/auth/login", authHandler.Login)

		authed := api.Group("")
		authed.Use(middleware.Auth(jwtSvc))
		{
			authed.GET("/courses", courseHandler.List)
			authed.POST("/courses/sync", courseHandler.Sync)
			authed.GET("/courses/icon", courseHandler.Icon)
			authed.GET("/bmap/search", bmapHandler.Search)
			authed.PUT("/courses/selection", courseHandler.UpdateSelection)

			authed.GET("/sign/activities", signHandler.Activities)
			authed.GET("/sign/classmates", signHandler.Classmates)
			authed.POST("/sign/check", signHandler.Check)
			authed.POST("/sign/execute", signHandler.Execute)
			authed.POST("/sign/photo", signHandler.Photo)

			// 地址库管理
			authed.GET("/locations", locationHandler.List)
			authed.POST("/locations", locationHandler.Create)
			authed.PUT("/locations/:id", locationHandler.Update)
			authed.DELETE("/locations/:id", locationHandler.Delete)

			// == 抢答功能路由 ==
			authed.GET("/quiz/config", quizHandler.GetConfig)
			authed.PUT("/quiz/config", quizHandler.UpdateConfig)
			authed.GET("/quiz/records", quizHandler.GetRecords)
			authed.DELETE("/quiz/records", quizHandler.ClearRecords)
			authed.GET("/quiz/activities", quizHandler.GetActivities)
			authed.POST("/quiz/answer", quizHandler.SubmitAnswer)
			authed.POST("/quiz/submit", quizHandler.SubmitAnswer)                // 前端兼容别名
			authed.POST("/quiz/one-click-answer", quizHandler.ToggleMonitor)     // 统一一键抢答
			authed.GET("/quiz/status", quizHandler.GetStatus)                   // 统一状态查询
			authed.POST("/quiz/monitor/start", quizHandler.StartMonitor)         // 兼容旧版
			authed.POST("/quiz/monitor/stop", quizHandler.StopMonitor)           // 兼容旧版
			authed.GET("/quiz/events", quizHandler.Events)                      // SSE 实时事件推送
			authed.GET("/quiz/ws", quizHandler.WS)                             // WebSocket 实时推送

			admin := authed.Group("/admin")
			admin.Use(middleware.AdminOnly())
			{
				admin.GET("/whitelist/users", whitelistHandler.ListUsers)
				admin.POST("/whitelist/users", whitelistHandler.CreateUser)
				admin.POST("/whitelist/users/import", whitelistHandler.BatchImportUsers)
				admin.DELETE("/whitelist/users/:id", whitelistHandler.DeleteUser)
			}
		}
	}

	// ================= 优雅关闭：信号监听 =================
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	// 启动 HTTP 服务（在 goroutine 中）
	go func() {
		log.Printf("xbt2 server listening on %s (app_env=%s, gin_mode=%s)", cfg.HTTPAddr, cfg.AppEnv, gin.Mode())
		if err := r.Run(cfg.HTTPAddr); err != nil {
			log.Fatalf("server start failed: %v", err)
		}
	}()

	// 等待退出信号
	sig := <-quit
	log.Printf("收到退出信号: %v，开始优雅关闭...", sig)

	// 1. 停止所有监控 Goroutine
	quizSvc.Shutdown()

	// 2. 关闭数据库连接
	sqlDB, err := database.DB()
	if err == nil {
		sqlDB.SetMaxOpenConns(10) // 降低连接数后关闭
		_ = sqlDB.Close()
		log.Printf("数据库连接已关闭")
	}

	// 3. 关闭 Redis
	if err := redisClient.Close(); err != nil {
		log.Printf("redis 关闭异常: %v", err)
	} else {
		log.Printf("Redis 连接已关闭")
	}

	// 4. 等待异步资源释放
	time.Sleep(500 * time.Millisecond)

	log.Printf("✅ 服务已安全关闭")
}

func resolveGinMode(appEnv string) string {
	switch strings.ToLower(strings.TrimSpace(appEnv)) {
	case "prod", "production":
		return gin.ReleaseMode
	case "test", "testing":
		return gin.TestMode
	case "dev", "development":
		fallthrough
	default:
		return gin.DebugMode
	}
}
