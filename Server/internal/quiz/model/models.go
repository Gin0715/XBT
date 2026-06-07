package model

import "time"

// QuizActivity 抢答活动模型
type QuizActivity struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	UserUID     int64     `gorm:"not null;uniqueIndex:idx_quiz_act_uid;index" json:"user_uid"`
	ActivityID  int64     `gorm:"not null;uniqueIndex:idx_quiz_act_uid" json:"activity_id"`
	CourseID    int64     `gorm:"not null;index" json:"course_id"`
	ClassID     int64     `gorm:"not null" json:"class_id"`
	CourseName  string    `gorm:"size:255" json:"course_name"`
	Title       string    `gorm:"size:255" json:"title"`
	StartTime   int64     `gorm:"not null" json:"start_time"`
	EndTime     int64     `gorm:"not null" json:"end_time"`
	Status      int       `gorm:"not null;default:0" json:"status"` // 0:待开始 1:进行中 2:已结束
	AutoAnswer  bool      `gorm:"not null;default:false" json:"auto_answer"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// QuizRecord 抢答记录模型
type QuizRecord struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	UserUID     int64     `gorm:"not null;index" json:"user_uid"`
	ActivityID  int64     `gorm:"not null;index" json:"activity_id"`
	UserName    string    `gorm:"size:128" json:"user_name"`
	CourseName  string    `gorm:"size:255" json:"course_name"`
	AnswerTime  int64     `gorm:"not null" json:"answer_time"` // 抢答耗时(毫秒)
	Rank        int       `gorm:"not null;default:0" json:"rank"`
	Success     bool      `gorm:"not null;default:false" json:"success"`
	Message     string    `gorm:"size:512" json:"message"`
	CreatedAt   time.Time `json:"created_at"`
}

// QuizConfig 抢答配置模型
type QuizConfig struct {
	ID             uint      `gorm:"primaryKey" json:"id"`
	UserUID        int64     `gorm:"not null;uniqueIndex" json:"user_uid"`
	Enabled        bool      `gorm:"not null;default:false" json:"enabled"`
	AutoAnswer     bool      `gorm:"not null;default:true" json:"auto_answer"`
	MonitorCourses string    `gorm:"type:text" json:"monitor_courses"` // JSON数组，监控的课程ID
	CourseID       int64     `gorm:"not null;default:0" json:"course_id"`        // 当前监控课程
	ClassID        int64     `gorm:"not null;default:0" json:"class_id"`         // 当前监控班级
	DelayMs        int       `gorm:"not null;default:0" json:"delay_ms"`         // 抢答延迟(毫秒)
	WSEnabled      bool      `gorm:"not null;default:true" json:"ws_enabled"`    // 是否启用 WebSocket
	WSUrl          string    `gorm:"size:512" json:"ws_url"`                     // 自定义 WS URL（空=自动发现）
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

// QuizMonitorStatus 抢答监控状态
type QuizMonitorStatus struct {
	UserUID       int64 `json:"user_uid"`
	IsRunning     bool  `json:"is_running"`
	Connected     bool  `json:"connected"`
	LastCheck     int64 `json:"last_check"`
	ActivityCount int   `json:"activity_count"`
}