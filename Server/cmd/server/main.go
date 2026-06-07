package main

import (
	"log"
	"strings"

	"github.com/gin-gonic/gin"
	"xbt2/server/internal/config"
	"xbt2/server/internal/db"
	"xbt2/server/internal/handler"
	"xbt2/server/internal/middleware"
	quizhandler "xbt2/server/internal/quiz/handler"
	quizmodel "xbt2/server/internal/quiz/model"
	quizsvc "xbt2/server/internal/quiz/service"
	"xbt2/server/internal/service"
	"xbt2/server/internal/xxt"
)

func main() {
	cfg := config.Load()
	gin.SetMode(resolveGinMode(cfg.AppEnv))

	database, err := db.New(cfg)
	if err != nil {
		log.Fatalf("db init failed: %v", err)
	}

	// ✅ 自动迁移抢答功能相关数据库表
	if err := database.AutoMigrate(&quizmodel.QuizConfig{}, &quizmodel.QuizRecord{}, &quizmodel.QuizActivity{}); err != nil {
		log.Printf("quiz auto migrate failed: %v", err)
	}

	jwtSvc := service.NewJWTService(cfg.JWTSecret)
	credentialCrypto := service.NewCredentialCrypto(cfg.CredentialSecret)
	xxtClient := xxt.New(cfg.ChaoxingAESKey, cfg.ChaoxingUserAgent, cfg.AllowInsecureTLS, cfg.ActivityListLimit+1)

	authHandler := handler.NewAuthHandler(database, jwtSvc, credentialCrypto, xxtClient)
	courseHandler := handler.NewCourseHandler(database, xxtClient, credentialCrypto)
	signSvc := service.NewSignService(database, xxtClient, credentialCrypto)
	signHandler := handler.NewSignHandler(database, xxtClient, credentialCrypto, signSvc, cfg.ActivityListLimit)
	whitelistHandler := handler.NewWhitelistHandler(database)
	locationHandler := handler.NewLocationHandler(database)

	// ✅ 修复：初始化 MonitorService 并传入 QuizHandler
	monitorSvc := quizsvc.NewQuizMonitorService(database, xxtClient, credentialCrypto)
	quizHandler := quizhandler.NewQuizHandler(database, xxtClient, credentialCrypto, monitorSvc)

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
			authed.PUT("/courses/selection", courseHandler.UpdateSelection)

			authed.GET("/sign/activities", signHandler.Activities)
			authed.GET("/sign/classmates", signHandler.Classmates)
			authed.POST("/sign/check", signHandler.Check)
			authed.POST("/sign/execute", signHandler.Execute)

			// 位置预设（地址库）管理路由
			authed.GET("/locations", locationHandler.List)
			authed.POST("/locations", locationHandler.Create)
			authed.PUT("/locations/:id", locationHandler.Update)
			authed.DELETE("/locations/:id", locationHandler.Delete)

			// 抢答功能路由
			authed.GET("/quiz/config", quizHandler.GetConfig)
			authed.PUT("/quiz/config", quizHandler.UpdateConfig)
			authed.POST("/quiz/monitor/start", quizHandler.StartMonitor)
			authed.POST("/quiz/monitor/stop", quizHandler.StopMonitor)
			authed.GET("/quiz/status", quizHandler.GetStatus)
			authed.GET("/quiz/records", quizHandler.GetRecords)
			authed.DELETE("/quiz/records", quizHandler.ClearRecords)
			authed.GET("/quiz/activities", quizHandler.GetActivities)
			authed.POST("/quiz/answer", quizHandler.SubmitAnswer)
			authed.POST("/quiz/submit", quizHandler.SubmitAnswer)  // 前端兼容别名
			authed.GET("/quiz/events", quizHandler.Events)       // SSE 实时事件推送
			authed.GET("/quiz/ws", quizHandler.WS)             // WebSocket 实时推送（前端）

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

	log.Printf("xbt2 server listening on %s (app_env=%s, gin_mode=%s)", cfg.HTTPAddr, cfg.AppEnv, gin.Mode())
	if err := r.Run(cfg.HTTPAddr); err != nil {
		log.Fatalf("server start failed: %v", err)
	}
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