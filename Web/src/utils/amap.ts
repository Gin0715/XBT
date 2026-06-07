/**
 * 高德地图 (AMap) JS API 集成模块
 *
 * 使用方式：
 *   1. 在 .env 中设置 VITE_AMAP_KEY=你的高德Key
 *   2. 调用 initAMap() 初始化（自动动态加载 SDK）
 *   3. 使用 getCurrentPosition() / reverseGeocode() 等函数
 *
 * 无 SDK 时所有函数降级为浏览器原生 API，不会报错。
 */

// ---- 类型定义 ----

export interface AMapPosition {
  lat: number;
  lng: number;
  accuracy?: number;
}

export interface AMapAddress {
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

export interface AMapPOI {
  id: string;
  name: string;
  address: string;
  location: { lat: number; lng: number };
  distance: number;
}

// ---- AMap SDK 引用 ----

let amapLoaded = false;
let amapGeo: any = null;
let amapGeocoder: any = null;
let initPromise: Promise<boolean> | null = null;

/**
 * 动态加载 AMap JS API SDK
 * Key 从 .env 的 VITE_AMAP_KEY 读取，无需修改代码
 */
function loadAMapScript(): Promise<boolean> {
  return new Promise((resolve) => {
    const w = window as any;

    // 已加载
    if (w.AMap) {
      resolve(true);
      return;
    }

    const key = import.meta.env.VITE_AMAP_KEY || '';
    if (!key || key === 'YOUR_AMAP_KEY') {
      console.warn('[AMap] 未配置 VITE_AMAP_KEY，将使用浏览器原生定位');
      resolve(false);
      return;
    }

    // 避免重复加载
    const existing = document.querySelector('script[data-amap]');
    if (existing) {
      existing.addEventListener('load', () => resolve(!!w.AMap));
      existing.addEventListener('error', () => resolve(false));
      return;
    }

    const script = document.createElement('script');
    script.setAttribute('data-amap', '1');
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}&plugin=AMap.Geolocation,AMap.Geocoder,AMap.PlaceSearch`;
    script.onload = () => {
      if (w.AMap) {
        console.log('[AMap] SDK 动态加载成功');
        resolve(true);
      } else {
        console.warn('[AMap] SDK 加载完成但 AMap 不可用');
        resolve(false);
      }
    };
    script.onerror = () => {
      console.warn('[AMap] SDK 加载失败，降级为浏览器定位');
      resolve(false);
    };
    document.head.appendChild(script);
  });
}

/**
 * 初始化高德地图 SDK（自动从 .env 读取 Key 并动态加载）
 * 可在应用启动时调用，多次调用安全
 */
export async function initAMap(): Promise<boolean> {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const loaded = await loadAMapScript();
      if (!loaded) return false;

      const w = window as any;
      if (!w.AMap) return false;

      amapGeo = new w.AMap.Geolocation({ enableHighAccuracy: true, timeout: 10000 });
      amapGeocoder = new w.AMap.Geocoder();
      amapLoaded = true;
      console.log('[AMap] 初始化成功');
      return true;
    } catch (e) {
      console.warn('[AMap] 初始化失败，降级为浏览器定位', e);
      return false;
    }
  })();

  return initPromise;
}

/**
 * 获取当前位置（优先 AMap.Geolocation，降级浏览器 GPS）
 */
export function getCurrentPosition(): Promise<AMapPosition> {
  // 尝试 AMap 定位
  if (amapLoaded && amapGeo) {
    return new Promise((resolve, reject) => {
      amapGeo.getCurrentPosition((status: string, result: any) => {
        if (status === 'complete' && result.position) {
          resolve({
            lat: result.position.lat,
            lng: result.position.lng,
            accuracy: result.position.accuracy,
          });
        } else {
          reject(new Error(result?.message || 'AMap 定位失败'));
        }
      });
    });
  }

  // 降级：浏览器原生定位
  return new Promise((resolve, reject) => {
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
}

/**
 * 逆地理编码：坐标 → 地址（优先 AMap.Geocoder，降级返回坐标字符串）
 */
export async function reverseGeocode(lat: number, lng: number): Promise<AMapAddress> {
  if (amapLoaded && amapGeocoder) {
    return new Promise((resolve, reject) => {
      amapGeocoder.getAddress(
        [lng, lat],
        (status: string, result: any) => {
          if (status === 'complete' && result.regeocode) {
            const rc = result.regeocode;
            const comp = rc.addressComponent;
            const pois = rc.pois || [];
            resolve({
              formattedAddress: rc.formattedAddress || '',
              province: comp.province || '',
              city: comp.city || comp.province || '',
              district: comp.district || '',
              township: comp.township || '',
              street: comp.streetNumber?.street || '',
              number: comp.streetNumber?.number || '',
              poiName: pois.length > 0 ? pois[0].name : '',
              adcode: comp.adcode || '',
            });
          } else {
            reject(new Error('逆地理编码失败'));
          }
        }
      );
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
 * 搜索周边 POI（优先 AMap.PlaceSearch，降级返回空数组）
 */
export async function searchNearbyPOI(
  keyword: string,
  center: { lat: number; lng: number },
  radius: number = 1000
): Promise<AMapPOI[]> {
  const w = window as any;
  if (amapLoaded && w.AMap?.PlaceSearch) {
    return new Promise((resolve) => {
      const placeSearch = new w.AMap.PlaceSearch({
        pageSize: 10,
        pageIndex: 1,
        citylimit: false,
      });
      placeSearch.searchNearBy(
        keyword,
        [center.lng, center.lat],
        radius,
        (status: string, result: any) => {
          if (status === 'complete' && result.poiList) {
            resolve(
              result.poiList.pois.map((p: any) => ({
                id: p.id,
                name: p.name,
                address: p.address,
                location: { lat: p.location.lat, lng: p.location.lng },
                distance: p.distance,
              }))
            );
          } else {
            resolve([]);
          }
        }
      );
    });
  }
  return [];
}

/**
 * 检查 AMap SDK 是否已加载
 */
export function isAMapReady(): boolean {
  return amapLoaded;
}
