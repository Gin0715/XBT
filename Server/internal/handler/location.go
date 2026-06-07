package handler

import (
	"fmt"
	"strconv"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"xbt2/server/internal/common"
	"xbt2/server/internal/model"
)

type LocationHandler struct {
	db *gorm.DB
}

func NewLocationHandler(db *gorm.DB) *LocationHandler {
	return &LocationHandler{db: db}
}

// validateCoord 验证经纬度范围
// 经度: -180 ~ 180, 纬度: -90 ~ 90
func validateCoord(latStr, lngStr string) error {
	lat, err := strconv.ParseFloat(latStr, 64)
	if err != nil {
		return fmt.Errorf("纬度格式不正确: %s", latStr)
	}
	lng, err := strconv.ParseFloat(lngStr, 64)
	if err != nil {
		return fmt.Errorf("经度格式不正确: %s", lngStr)
	}
	if lng < -180 || lng > 180 {
		return fmt.Errorf("经度超出范围（-180° ~ 180°），当前值: %.6f", lng)
	}
	if lat < -90 || lat > 90 {
		return fmt.Errorf("纬度超出范围（-90° ~ 90°），当前值: %.6f", lat)
	}
	return nil
}

// List 获取位置预设列表（全局 + 当前用户私有）
func (h *LocationHandler) List(c *gin.Context) {
	uid := common.GetUserUID(c)
	var presets []model.LocationPreset
	// 查询全局预设 (user_uid=0) 以及当前用户的私有预设
	h.db.Where("user_uid = 0 OR user_uid = ?", uid).
		Order("user_uid asc, sort_order asc, id asc").
		Find(&presets)
	common.Success(c, presets)
}

// Create 新增位置预设
func (h *LocationHandler) Create(c *gin.Context) {
	uid := common.GetUserUID(c)
	var preset model.LocationPreset
	if err := c.ShouldBindJSON(&preset); err != nil {
		common.Fail(c, 400, "参数错误: "+err.Error())
		return
	}
	if preset.Name == "" || preset.Latitude == "" || preset.Longitude == "" {
		common.Fail(c, 400, "名称、经度、纬度不能为空")
		return
	}
	if err := validateCoord(preset.Latitude, preset.Longitude); err != nil {
		common.Fail(c, 400, err.Error())
		return
	}
	preset.ID = 0
	preset.UserUID = uid
	if err := h.db.Create(&preset).Error; err != nil {
		common.Fail(c, 500, "保存位置预设失败")
		return
	}
	common.Success(c, preset)
}

// Update 更新位置预设
func (h *LocationHandler) Update(c *gin.Context) {
	uid := common.GetUserUID(c)
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		common.Fail(c, 400, "无效的 ID")
		return
	}

	var preset model.LocationPreset
	if err := h.db.First(&preset, id).Error; err != nil {
		common.Fail(c, 404, "位置预设不存在")
		return
	}
	// 只能修改自己的预设；全局预设只有管理员能改
	if preset.UserUID != 0 && preset.UserUID != uid {
		common.Fail(c, 403, "无权修改他人的位置预设")
		return
	}
	// 普通用户不能修改全局预设
	if preset.UserUID == 0 && common.GetPermission(c) < 2 {
		common.Fail(c, 403, "仅管理员可修改全局预设")
		return
	}

	var update model.LocationPreset
	if err := c.ShouldBindJSON(&update); err != nil {
		common.Fail(c, 400, "参数错误: "+err.Error())
		return
	}
	if update.Latitude != "" || update.Longitude != "" {
		lat := update.Latitude
		lng := update.Longitude
		// 如果只更新其中一个字段，用数据库已有值补全验证
		if lat == "" {
			lat = preset.Latitude
		}
		if lng == "" {
			lng = preset.Longitude
		}
		if err := validateCoord(lat, lng); err != nil {
			common.Fail(c, 400, err.Error())
			return
		}
	}
	updates := map[string]interface{}{
		"name":        update.Name,
		"latitude":    update.Latitude,
		"longitude":   update.Longitude,
		"description": update.Description,
		"sort_order":  update.SortOrder,
	}
	if err := h.db.Model(&preset).Updates(updates).Error; err != nil {
		common.Fail(c, 500, "更新位置预设失败")
		return
	}
	common.Success(c, preset)
}

// Delete 删除位置预设
func (h *LocationHandler) Delete(c *gin.Context) {
	uid := common.GetUserUID(c)
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		common.Fail(c, 400, "无效的 ID")
		return
	}

	var preset model.LocationPreset
	if err := h.db.First(&preset, id).Error; err != nil {
		common.Fail(c, 404, "位置预设不存在")
		return
	}
	// 只能删除自己的预设
	if preset.UserUID != 0 && preset.UserUID != uid {
		common.Fail(c, 403, "无权删除他人的位置预设")
		return
	}
	// 普通用户不能删除全局预设
	if preset.UserUID == 0 && common.GetPermission(c) < 2 {
		common.Fail(c, 403, "仅管理员可删除全局预设")
		return
	}

	if err := h.db.Delete(&preset).Error; err != nil {
		common.Fail(c, 500, "删除位置预设失败")
		return
	}
	common.Success(c, nil)
}

