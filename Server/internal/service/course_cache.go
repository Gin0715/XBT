package service

import (
	"fmt"
	"sync"
	"time"

	"gorm.io/gorm"
	"xbt2/server/internal/model"
)

// CourseCacheItem 缓存的课程信息
type CourseCacheItem struct {
	Name      string
	Teacher   string
	Icon      string
	FetchedAt time.Time
}

const courseCacheTTL = 1 * time.Hour

// CourseCache 课程数据缓存（内存），供签到/抢答模块共享使用
type CourseCache struct {
	db  *gorm.DB
	mu  sync.RWMutex
	m   map[string]*CourseCacheItem // key: "courseID:classID"
}

// NewCourseCache 创建课程缓存，可选从 DB 预加载
func NewCourseCache(db *gorm.DB) *CourseCache {
	c := &CourseCache{
		db: db,
		m:  make(map[string]*CourseCacheItem),
	}
	return c
}

func cacheKey(courseID, classID int64) string {
	return fmt.Sprintf("%d:%d", courseID, classID)
}

// Get 获取课程缓存，缓存未命中时回退到 DB 查询
func (cc *CourseCache) Get(courseID, classID int64) (name, teacher, icon string, ok bool) {
	if courseID == 0 {
		return "", "", "", false
	}
	key := cacheKey(courseID, classID)

	cc.mu.RLock()
	item, exists := cc.m[key]
	cc.mu.RUnlock()

	if exists && time.Since(item.FetchedAt) < courseCacheTTL {
		return item.Name, item.Teacher, item.Icon, true
	}

	// 缓存未命中或过期 → 查 DB
	if exists {
		cc.mu.Lock()
		delete(cc.m, key)
		cc.mu.Unlock()
	}

	var course model.Course
	if err := cc.db.Select("name, teacher, icon").
		Where("course_id = ? AND class_id = ?", courseID, classID).
		Take(&course).Error; err != nil {
		return "", "", "", false
	}

	item = &CourseCacheItem{
		Name:      course.Name,
		Teacher:   course.Teacher,
		Icon:      course.Icon,
		FetchedAt: time.Now(),
	}
	cc.mu.Lock()
	cc.m[key] = item
	cc.mu.Unlock()

	return item.Name, item.Teacher, item.Icon, true
}

// Set 写入课程缓存
func (cc *CourseCache) Set(courseID, classID int64, name, teacher, icon string) {
	key := cacheKey(courseID, classID)
	cc.mu.Lock()
	cc.m[key] = &CourseCacheItem{
		Name:      name,
		Teacher:   teacher,
		Icon:      icon,
		FetchedAt: time.Now(),
	}
	cc.mu.Unlock()
}

// Delete 删除课程缓存
func (cc *CourseCache) Delete(courseID, classID int64) {
	key := cacheKey(courseID, classID)
	cc.mu.Lock()
	delete(cc.m, key)
	cc.mu.Unlock()
}

// WarmUp 从数据库预热所有课程数据到缓存
func (cc *CourseCache) WarmUp() error {
	var courses []model.Course
	if err := cc.db.Select("course_id, class_id, name, teacher, icon").
		Find(&courses).Error; err != nil {
		return err
	}
	cc.mu.Lock()
	defer cc.mu.Unlock()
	for _, c := range courses {
		key := cacheKey(c.CourseID, c.ClassID)
		cc.m[key] = &CourseCacheItem{
			Name:      c.Name,
			Teacher:   c.Teacher,
			Icon:      c.Icon,
			FetchedAt: time.Now(),
		}
	}
	return nil
}

// BatchSet 批量写入课程缓存（同步完成后调用）
func (cc *CourseCache) BatchSet(items map[string]*CourseCacheItem) {
	cc.mu.Lock()
	defer cc.mu.Unlock()
	for k, v := range items {
		cc.m[k] = v
	}
}

// Clear 清空缓存
func (cc *CourseCache) Clear() {
	cc.mu.Lock()
	defer cc.mu.Unlock()
	cc.m = make(map[string]*CourseCacheItem)
}
