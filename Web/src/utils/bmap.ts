/**
 * 百度地图 (Baidu Map) JS API 集成模块
 *
 * 使用方式：
 *   1. 在 .env 中设置 VITE_BAIDU_MAP_KEY=你的百度地图AK，或
 *   2. 在运行时调用 setBMapKey(key) 将密钥保存到 localStorage（UI 可配置）
 *   3. 调用 initBMap() 初始化（自动动态加载 SDK）
 *   4. 使用 getCurrentPosition() / reverseGeocode() 等函数
 *
 * 无 SDK 时所有函数降级为浏览器原生 API，不会报错。
 *
 * 百度地图坐标拾取工具：https://lbs.baidu.com/maptool/getpoint
 */

// ---- localStorage key ----
const STORAGE_KEY = 'baidu_map_key';

/**
 * 获取百度地图 API Key，优先级：localStorage > .env
 */
export function getBMapKey(): string {
  return localStorage.getItem(STORAGE_KEY) || import.meta.env.VITE_BAIDU_MAP_KEY || '';
}

/**
 * 在运行时设置/更新百度地图 API Key（保存到 localStorage）
 */
export function setBMapKey(key: string): void {
  if (key) {
    localStorage.setItem(STORAGE_KEY, key);
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

/**
 * 清除 localStorage 中保存的百度地图 API Key
 */
export function clearBMapKey(): void {
  localStorage.removeItem(STORAGE_KEY);
}

// ---- 类型定义 ----

export interface BMapPosition {
  lat: number;
  lng: number;
  accuracy?: number;
}

export interface BMapAddress {
  formattedAddress: string;  // 完整地址
  province: string;
  city: string;
  district: string;
  township: string;
  street: string;
  number: string;
  poiName: string;          // 附近 POI 名称
  adcode: string;
}

export interface BMapPOI {
  id: string;
  name: string;
  address: string;
  location: { lat: number; lng: number };
  distance: number;
}

// ---- BMap SDK 引用 ----

let bmapLoaded = false;
let initPromise: Promise<boolean> | null = null;

/**
 * 动态加载百度地图 JS API SDK
 * Key 从 getBMapKey() 获取（localStorage > .env）
 */
/**
 * 使用新 Key 重新加载百度地图 SDK（用户在 UI 修改 Key 后调用）
 * 会清除旧的 SDK 状态并重新动态加载
 */
export async function reloadBMapWithKey(key: string): Promise<boolean> {
  // 清除旧状态
  const w = window as any;
  const existing = document.querySelector('script[data-bmap]');
  if (existing) existing.remove();

  // 清除 BMap 全局对象
  delete w.BMap;

  bmapLoaded = false;
  initPromise = null;

  // 保存新 Key
  setBMapKey(key);

  // 重新初始化
  return initBMap();
}

function loadBMapScript(): Promise<boolean> {
  return new Promise((resolve) => {
    const w = window as any;

    // 已加载
    if (w.BMap && w.BMap.Map) {
      resolve(true);
      return;
    }

    const key = getBMapKey();
    if (!key) {
      console.warn('[BMap] 未配置百度地图 API Key，将使用浏览器原生定位。可在地址库面板中配置密钥');
      resolve(false);
      return;
    }

    // 避免重复加载
    const existing = document.querySelector('script[data-bmap]');
    if (existing) {
      existing.addEventListener('load', () => resolve(!!(w.BMap && w.BMap.Map)));
      existing.addEventListener('error', () => resolve(false));
      return;
    }

    // 使用 callback 方式加载百度地图 SDK
    const callbackName = '_bmap_init_' + Math.random().toString(36).slice(2);
    (w as any)[callbackName] = () => {
      delete (w as any)[callbackName];
      if (w.BMap && w.BMap.Map) {
        console.log('[BMap] SDK 动态加载成功');
        resolve(true);
      } else {
        console.warn('[BMap] SDK 加载完成但 BMap 不可用');
        resolve(false);
      }
    };

    const script = document.createElement('script');
    script.setAttribute('data-bmap', '1');
    script.src = `https://api.map.baidu.com/api?v=3.0&ak=${encodeURIComponent(key)}&callback=${callbackName}`;
    script.onerror = () => {
      delete (w as any)[callbackName];
      console.warn('[BMap] SDK 加载失败，降级为浏览器定位');
      resolve(false);
    };
    document.head.appendChild(script);
  });
}

/**
 * 初始化百度地图 SDK（自动从 .env 读取 Key 并动态加载）
 * 可在应用启动时调用，多次调用安全
 */
export async function initBMap(): Promise<boolean> {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const loaded = await loadBMapScript();
      if (!loaded) return false;

      const w = window as any;
      if (!w.BMap) return false;

      bmapLoaded = true;
      console.log('[BMap] 初始化成功');
      return true;
    } catch (e) {
      console.warn('[BMap] 初始化失败，降级为浏览器定位', e);
      return false;
    }
  })();

  return initPromise;
}

/**
 * 将 GPS (WGS-84) 坐标转换为百度 (BD-09) 坐标
 * 内部使用 BMap.Convertor
 */
function gpsToBaidu(lat: number, lng: number): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve) => {
    const w = window as any;
    if (!bmapLoaded || !w.BMap || !w.BMap.Convertor) {
      // 无法转换，直接返回原坐标
      resolve({ lat, lng });
      return;
    }

    try {
      const points = [new w.BMap.Point(lng, lat)];
      const convertor = new w.BMap.Convertor();
      convertor.translate(points, 1, 5, (data: any) => {  // 1=GPS, 5=BD09
        if (data && data.points && data.points.length > 0) {
          resolve({ lat: data.points[0].lat, lng: data.points[0].lng });
        } else {
          resolve({ lat, lng });
        }
      });
    } catch {
      resolve({ lat, lng });
    }
  });
}

/**
 * 获取当前位置（浏览器 GPS → 转换为 BD-09）
 */
export async function getCurrentPosition(): Promise<BMapPosition> {
  // 先获取浏览器原生 GPS (WGS-84)
  const rawPosition: { lat: number; lng: number; accuracy?: number } = await new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('浏览器不支持定位'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  });

  // 尝试转换为 BD-09（百度坐标系）
  if (bmapLoaded) {
    try {
      const bdCoord = await gpsToBaidu(rawPosition.lat, rawPosition.lng);
      return { lat: bdCoord.lat, lng: bdCoord.lng, accuracy: rawPosition.accuracy };
    } catch {
      // 转换失败，使用原始坐标
    }
  }

  return rawPosition;
}

/**
 * 逆地理编码：坐标 → 地址（百度 BD-09 坐标系）
 * 降级时返回坐标字符串
 */
export async function reverseGeocode(lat: number, lng: number): Promise<BMapAddress> {
  const w = window as any;

  if (bmapLoaded && w.BMap && w.BMap.Geocoder) {
    return new Promise((resolve, reject) => {
      const geocoder = new w.BMap.Geocoder();
      const point = new w.BMap.Point(lng, lat);
      geocoder.getLocation(point, (result: any) => {
        if (result && result.address) {
          const comp = result.addressComponents || {};
          const pois = result.surroundingPois || [];
          resolve({
            formattedAddress: result.address || '',
            province: comp.province || '',
            city: comp.city || '',
            district: comp.district || '',
            township: comp.town || '',
            street: comp.street || '',
            number: comp.streetNumber || '',
            poiName: pois.length > 0 ? pois[0].title : (result.business || ''),
            adcode: '',
          });
        } else {
          reject(new Error('逆地理编码失败: ' + (result?.message || '未知错误')));
        }
      });
    });
  }

  // 降级：返回坐标字符串
  return {
    formattedAddress: `${lat.toFixed(6)}, ${lng.toFixed(6)}`,
    province: '', city: '', district: '', township: '', street: '', number: '',
    poiName: '', adcode: '',
  };
}

/**
 * 搜索周边 POI（百度地图 LocalSearch）
 * 降级返回空数组
 */
export async function searchNearbyPOI(
  keyword: string,
  center: { lat: number; lng: number },
  radius: number = 1000
): Promise<BMapPOI[]> {
  const w = window as any;
  if (bmapLoaded && w.BMap && w.BMap.LocalSearch) {
    return new Promise((resolve) => {
      const local = new w.BMap.LocalSearch(new w.BMap.Point(center.lng, center.lat), {
        renderOptions: { map: null, autoViewport: false },
        pageCapacity: 10,
      });
      local.searchNearby(keyword, new w.BMap.Point(center.lng, center.lat), radius);
      local.setSearchCompleteCallback((results: any) => {
        if (local.getStatus() === 0) { // BMAP_STATUS_SUCCESS
          resolve(
            (results?.Ar || results || []).map((p: any, idx: number) => ({
              id: p.uid || String(idx),
              name: p.title || p.name || '',
              address: p.address || '',
              location: p.point ? { lat: p.point.lat, lng: p.point.lng } : center,
              distance: 0,
            }))
          );
        } else {
          resolve([]);
        }
      });
    });
  }
  return [];
}

/**
 * 检查百度地图 SDK 是否已加载
 */
export function isBMapReady(): boolean {
  return bmapLoaded;
}

/**
 * 检查百度地图 API Key 是否已配置（localStorage 或 .env）
 */
export function hasBMapKey(): boolean {
  return !!getBMapKey();
}

/**
 * 获取百度地图实例（用于自定义地图操作，如地图选点）
 * 仅在 isBMapReady() 为 true 时可用
 */
export function getBMapInstances() {
  const w = window as any;
  if (!bmapLoaded || !w.BMap) return null;
  return {
    BMap: w.BMap,
    Point: w.BMap.Point,
    Geocoder: w.BMap.Geocoder,
    Map: w.BMap.Map,
    Marker: w.BMap.Marker,
  };
}
