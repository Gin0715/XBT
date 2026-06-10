package handler

import (
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"xbt2/server/internal/common"
	"xbt2/server/internal/dto"
	"xbt2/server/internal/model"
	"xbt2/server/internal/service"
	"xbt2/server/internal/xxt"
)

type CourseHandler struct {
	db          *gorm.DB
	xxt         *xxt.Client
	cc          *service.CredentialCrypto
	courseCache *service.CourseCache
}

func NewCourseHandler(db *gorm.DB, xxtClient *xxt.Client, cc *service.CredentialCrypto, courseCache *service.CourseCache) *CourseHandler {
	return &CourseHandler{db: db, xxt: xxtClient, cc: cc, courseCache: courseCache}
}

func (h *CourseHandler) List(c *gin.Context) {
	uid := common.GetUserUID(c)
	var rows []struct {
		ClassID    int64  `json:"class_id"`
		CourseID   int64  `json:"course_id"`
		Name       string `json:"name"`
		Teacher    string `json:"teacher"`
		Icon       string `json:"icon"`
		IsSelected bool   `json:"is_selected"`
	}
	err := h.db.Table("user_courses uc").
		Select("c.class_id, c.course_id, c.name, c.teacher, c.icon, uc.is_selected").
		Joins("join courses c on uc.course_id = c.course_id and uc.class_id = c.class_id").
		Where("uc.user_uid = ?", uid).
		Order("uc.is_selected desc, c.name asc").
		Scan(&rows).Error
	if err != nil {
		common.Fail(c, 500, "query courses failed")
		return
	}
	common.Success(c, rows)
}

func (h *CourseHandler) Sync(c *gin.Context) {
	uid := common.GetUserUID(c)
	var user model.User
	if err := h.db.Where("uid = ?", uid).First(&user).Error; err != nil {
		common.Fail(c, 404, "user not found")
		return
	}
	password, err := h.cc.Decrypt(user.CredentialCipher)
	if err != nil {
		common.Fail(c, 400, "credential expired, please login again")
		return
	}
	courses, err := h.xxt.GetCourses(user.Mobile, password)
	if err != nil {
		if isXXTAuthError(err) {
			common.Fail(c, 401, "学习通登录已失效，请使用新密码重新登录")
			return
		}
		common.Fail(c, 500, "sync courses failed: "+err.Error())
		return
	}

	// 收集本次同步的有效课程集合
	syncedSet := make(map[string]struct{}, len(courses))
	for _, course := range courses {
		icon := course.Icon
		// 将 HTTP 图片 URL 升级为 HTTPS（解决 Android 混合内容阻止问题）
		if strings.HasPrefix(icon, "http://") {
			icon = "https://" + icon[7:]
		}
		co := model.Course{CourseID: course.CourseID, ClassID: course.ClassID, Name: course.Name, Teacher: course.Teacher, Icon: icon}
		_ = h.db.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "course_id"}, {Name: "class_id"}},
			DoUpdates: clause.AssignmentColumns([]string{"name", "teacher", "icon", "updated_at"}),
		}).Create(&co).Error

		uc := model.UserCourse{UserUID: uid, CourseID: course.CourseID, ClassID: course.ClassID, IsSelected: false}
		_ = h.db.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "user_uid"}, {Name: "course_id"}, {Name: "class_id"}}, DoNothing: true}).Create(&uc).Error

		key := fmt.Sprintf("%d:%d", course.CourseID, course.ClassID)
		syncedSet[key] = struct{}{}

		// 写入课程缓存，供签到/抢答模块共享
		h.courseCache.Set(course.CourseID, course.ClassID, course.Name, course.Teacher, icon)
	}

	// 删除该用户在超星上已移除的课程关联
	var staleRecords []model.UserCourse
	h.db.Where("user_uid = ?", uid).Find(&staleRecords)
	for _, rec := range staleRecords {
		key := fmt.Sprintf("%d:%d", rec.CourseID, rec.ClassID)
		if _, ok := syncedSet[key]; !ok {
			h.db.Where("user_uid = ? AND course_id = ? AND class_id = ?",
				uid, rec.CourseID, rec.ClassID).Delete(&model.UserCourse{})
		}
	}

	// 清理已无任何用户引用的孤立课程记录
	h.db.Exec(`
		DELETE FROM courses
		WHERE (course_id, class_id) NOT IN (
			SELECT course_id, class_id FROM user_courses
		)
	`)

	common.Success(c, gin.H{"count": len(courses)})
}

func isXXTAuthError(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.TrimSpace(err.Error())
	return strings.Contains(msg, "账号或密码错误")
}

func (h *CourseHandler) UpdateSelection(c *gin.Context) {
	uid := common.GetUserUID(c)
	var req dto.UpdateCourseSelectionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.Fail(c, 400, "invalid request")
		return
	}
	if err := h.db.Model(&model.UserCourse{}).Where("user_uid = ?", uid).Update("is_selected", false).Error; err != nil {
		common.Fail(c, 500, "reset selection failed")
		return
	}
	if len(req.CourseIDs) > 0 {
		if err := h.db.Model(&model.UserCourse{}).
			Where("user_uid = ? AND course_id IN ?", uid, req.CourseIDs).
			Update("is_selected", true).Error; err != nil {
			common.Fail(c, 500, "update selection failed")
			return
		}
	}
	common.Success(c, gin.H{"selected_count": len(req.CourseIDs)})
}

// ================= 课程图片代理 =================

var iconFetchHTTP = &http.Client{Timeout: 10 * time.Second}

// Icon 课程图标代理 — 作为直接 CDN 图片加载失败时的回退方案
// 优先使用 CourseCache 获取图标 URL，未命中时回退数据库
func (h *CourseHandler) Icon(c *gin.Context) {
	courseID := strings.TrimSpace(c.Query("course_id"))
	classID := strings.TrimSpace(c.Query("class_id"))
	if courseID == "" || classID == "" {
		c.Status(http.StatusBadRequest)
		return
	}

	// 从共享课程缓存获取图标 URL（缓存优先，未命中回退 DB）
	var iconURL string
	cid, _ := strconv.ParseInt(courseID, 10, 64)
	clid, _ := strconv.ParseInt(classID, 10, 64)
	if _, _, cachedIcon, ok := h.courseCache.Get(cid, clid); ok && cachedIcon != "" {
		iconURL = cachedIcon
	} else {
		var course model.Course
		if err := h.db.Select("icon").Where("course_id = ? AND class_id = ?", courseID, classID).Take(&course).Error; err != nil {
			c.Status(http.StatusNotFound)
			return
		}
		iconURL = strings.TrimSpace(course.Icon)
	}
	if iconURL == "" {
		c.Status(http.StatusNotFound)
		return
	}
	// 升级 HTTP→HTTPS
	if strings.HasPrefix(iconURL, "http://") {
		iconURL = "https://" + iconURL[7:]
	}

	// 服务端拉取（绕过 CDN 客户端限制）
	resp, err := iconFetchHTTP.Get(iconURL)
	if err != nil {
		_ = c.Error(err)
		c.Status(http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		_ = c.Error(err)
		c.Status(http.StatusBadGateway)
		return
	}
	contentType := resp.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "image/jpeg"
	}

	c.Header("Cache-Control", "public, max-age=3600")
	c.Header("Content-Type", contentType)
	_, _ = c.Writer.Write(data)
}
