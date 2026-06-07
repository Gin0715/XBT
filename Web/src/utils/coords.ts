/**
 * 坐标（经纬度）验证工具
 *
 * 经度 (longitude/lng): -180 ~ 180
 * 纬度 (latitude/lat):   -90 ~ 90
 */

export interface CoordValidation {
  valid: boolean;
  error: string | null;
}

/** 验证经纬度是否在合法范围内 */
export function validateCoord(lat: string | number, lng: string | number): CoordValidation {
  const latNum = typeof lat === 'string' ? parseFloat(lat) : lat;
  const lngNum = typeof lng === 'string' ? parseFloat(lng) : lng;

  if (isNaN(latNum)) {
    return { valid: false, error: '纬度格式不正确，请输入有效数字' };
  }
  if (isNaN(lngNum)) {
    return { valid: false, error: '经度格式不正确，请输入有效数字' };
  }

  // 经度范围 -180 ~ 180
  if (lngNum < -180 || lngNum > 180) {
    return { valid: false, error: `经度超出范围（-180° ~ 180°），当前值: ${lngNum}` };
  }

  // 纬度范围 -90 ~ 90
  if (latNum < -90 || latNum > 90) {
    return { valid: false, error: `纬度超出范围（-90° ~ 90°），当前值: ${latNum}` };
  }

  return { valid: true, error: null };
}

/** 格式化坐标字符串，去除首尾空格 */
export function sanitizeCoord(value: string): string {
  return value.trim();
}
