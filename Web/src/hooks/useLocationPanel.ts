import { useState, useCallback, useRef } from 'react';
import toast from 'react-hot-toast';
import { getLocations, createLocation, updateLocation, deleteLocation, type LocationPreset } from '../api/location';
import { getCurrentPosition, reverseGeocode, type BMapAddress, hasBMapKey, reloadBMapWithKey, getBMapKey, clearBMapKey } from '../utils/bmap';
import { validateCoord } from '../utils/coords';

// ---- 定位缓存 (5 分钟) ----
const CACHE_KEY = 'xbt_gps_cache';
const CACHE_TTL = 5 * 60 * 1000; // 5 分钟

interface GPSCache {
  position: { lat: number; lng: number };
  address: BMapAddress | null;
  timestamp: number;
}

function readGPSCache(): GPSCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cache: GPSCache = JSON.parse(raw);
    if (Date.now() - cache.timestamp > CACHE_TTL) {
      localStorage.removeItem(CACHE_KEY);
      return null;
    }
    return cache;
  } catch { return null; }
}

function writeGPSCache(position: { lat: number; lng: number }, address: BMapAddress | null) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ position, address, timestamp: Date.now() }));
  } catch { /* ignore */ }
}

export interface LocationFormData {
  name: string;
  lat: string;
  lng: string;
  description: string;
}

export interface UseLocationPanelOptions {
  /** 定位成功后是否自动填入新增表单 */
  autoFillForm?: boolean;
}

export function useLocationPanel(options: UseLocationPanelOptions = {}) {
  const { autoFillForm = true } = options;

  // ---- 地址库状态 ----
  const [locationPresets, setLocationPresets] = useState<LocationPreset[]>([]);
  const [isLoadingLocations, setIsLoadingLocations] = useState(false);

  // ---- 实时定位状态 ----
  const [currentPosition, setCurrentPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [geoAddress, setGeoAddress] = useState<BMapAddress | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [locateSuccess, setLocateSuccess] = useState(false);

  // ---- 新增/编辑表单状态 ----
  const [isAddingLocation, setIsAddingLocation] = useState(false);
  const [editingLocation, setEditingLocation] = useState<LocationPreset | null>(null);
  const [newLocationForm, setNewLocationForm] = useState<LocationFormData>({ name: '', lat: '', lng: '', description: '' });

  // ---- 百度地图 Key 管理 ----
  const [bmapKeyInput, setBmapKeyInput] = useState('');
  const [isKeyConfigOpen, setIsKeyConfigOpen] = useState(false);
  const [isSavingKey, setIsSavingKey] = useState(false);

  // ---- 选中位置状态（统一管理，消除跨页面重复） ----
  const [selectedLat, setSelectedLat] = useState('');
  const [selectedLng, setSelectedLng] = useState('');
  const [selectedAddress, setSelectedAddress] = useState('');

  const setSelectedLocation = useCallback((lat: string, lng: string, address: string) => {
    setSelectedLat(lat);
    setSelectedLng(lng);
    setSelectedAddress(address);
  }, []);

  const clearSelectedLocation = useCallback(() => {
    setSelectedLat('');
    setSelectedLng('');
    setSelectedAddress('');
  }, []);

  const locateSuccessTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ============ 地址库 CRUD ============

  const fetchLocations = useCallback(async () => {
    setIsLoadingLocations(true);
    try {
      const response = await getLocations();
      const data = (response.data as any)?.data || response.data || [];
      setLocationPresets(Array.isArray(data) ? data : []);
    } catch (err: any) {
      console.error('加载位置预设失败', err);
    } finally {
      setIsLoadingLocations(false);
    }
  }, []);

  const handleLocate = useCallback(async () => {
    // 1. 检查 5 分钟缓存
    const cached = readGPSCache();
    if (cached) {
      setCurrentPosition(cached.position);
      setGeoAddress(cached.address);
      setLocateSuccess(true);
      locateSuccessTimer.current = setTimeout(() => setLocateSuccess(false), 1500);
      toast.success('使用缓存定位（5 分钟内有效）');
      return cached.position;
    }

    // 2. 检查百度地图 AK 是否已配置
    if (!hasBMapKey()) {
      toast.error('请先在地址库面板中配置百度地图 API Key', { duration: 4000 });
      setIsLocating(false);
      return null;
    }

    setIsLocating(true);
    setGeoAddress(null);
    setLocateSuccess(false);
    if (locateSuccessTimer.current) clearTimeout(locateSuccessTimer.current);

    try {
      const pos = await getCurrentPosition();
      setCurrentPosition(pos);
      setLocateSuccess(true);
      locateSuccessTimer.current = setTimeout(() => setLocateSuccess(false), 1500);
      toast.success('定位成功');

      setIsGeocoding(true);
      let resolvedAddress: BMapAddress | null = null;
      try {
        resolvedAddress = await reverseGeocode(pos.lat, pos.lng);
        setGeoAddress(resolvedAddress);

        // 自动填入新增表单
        if (autoFillForm && isAddingLocation) {
          setNewLocationForm(f => ({
            ...f,
            lat: pos.lat.toFixed(6),
            lng: pos.lng.toFixed(6),
            name: f.name || resolvedAddress?.poiName || '',
            description: f.description || resolvedAddress?.formattedAddress || '',
          }));
        }
      } catch {
        // 逆地理编码失败 — 降级显示坐标
        const fallback: BMapAddress = {
          formattedAddress: `${pos.lat.toFixed(6)}, ${pos.lng.toFixed(6)}`,
          province: '', city: '', district: '', township: '', street: '', number: '',
          poiName: '地址解析暂不可用', adcode: '',
        };
        setGeoAddress(fallback);
        resolvedAddress = fallback;
      } finally {
        setIsGeocoding(false);
      }

      // 3. 写入缓存
      writeGPSCache(pos, resolvedAddress);

      return pos;
    } catch (err: any) {
      // 检查是否因为 AK 问题导致
      const msg = err.message || '';
      if (msg.includes('AK') || msg.includes('key') || msg.includes('Key')) {
        toast.error('百度地图 Key 可能无效，请在地址库面板中重新配置', { duration: 5000 });
      } else {
        toast.error('定位失败: ' + msg);
      }
      return null;
    } finally {
      setIsLocating(false);
    }
  }, [autoFillForm, isAddingLocation]);

  const resetAddForm = useCallback(() => {
    setNewLocationForm({ name: '', lat: '', lng: '', description: '' });
    setIsAddingLocation(false);
  }, []);

  const handleAddLocation = useCallback(async (form: LocationFormData) => {
    if (!form.name || !form.lat || !form.lng) {
      toast.error('名称、经度、纬度不能为空');
      return false;
    }
    const coordCheck = validateCoord(form.lat, form.lng);
    if (!coordCheck.valid) { toast.error(coordCheck.error!); return false; }
    try {
      const response = await createLocation(form);
      const created = (response.data as any)?.data || response.data;
      setLocationPresets(prev => [...prev, created]);
      resetAddForm();
      toast.success('地址已添加');
      return true;
    } catch (err: any) {
      toast.error(err.message || '添加地址失败');
      return false;
    }
  }, [resetAddForm]);

  const handleUpdateLocation = useCallback(async (preset: LocationPreset) => {
    const coordCheck = validateCoord(preset.lat, preset.lng);
    if (!coordCheck.valid) { toast.error(coordCheck.error!); return false; }
    try {
      const response = await updateLocation(preset.id, {
        name: preset.name,
        lat: preset.lat,
        lng: preset.lng,
        description: preset.description,
      });
      const updated = (response.data as any)?.data || response.data;
      setLocationPresets(prev => prev.map(p => p.id === preset.id ? { ...p, ...updated } : p));
      setEditingLocation(null);
      toast.success('地址已更新');
      return true;
    } catch (err: any) {
      toast.error(err.message || '更新地址失败');
      return false;
    }
  }, []);

  const handleDeleteLocation = useCallback(async (id: number) => {
    try {
      await deleteLocation(id);
      setLocationPresets(prev => prev.filter(p => p.id !== id));
      toast.success('地址已删除');
    } catch (err: any) {
      toast.error(err.message || '删除地址失败');
    }
  }, []);

  // ============ 百度地图 Key 管理 ============

  const bmapKeyConfigured = hasBMapKey();

  const handleOpenKeyConfig = useCallback(() => {
    setBmapKeyInput(getBMapKey());
    setIsKeyConfigOpen(true);
  }, []);

  const handleSaveBMapKey = useCallback(async () => {
    if (!bmapKeyInput.trim()) {
      toast.error('请输入百度地图 API Key');
      return;
    }
    setIsSavingKey(true);
    try {
      const ready = await reloadBMapWithKey(bmapKeyInput.trim());
      if (ready) {
        toast.success('百度地图 Key 已配置并加载成功');
      } else {
        toast.success('Key 已保存，但地图加载可能需要刷新页面');
      }
      setIsKeyConfigOpen(false);
    } catch (err: any) {
      toast.error('Key 保存失败: ' + (err.message || '未知错误'));
    } finally {
      setIsSavingKey(false);
    }
  }, [bmapKeyInput]);

  const handleClearBMapKey = useCallback(async () => {
    clearBMapKey();
    setBmapKeyInput('');
    setIsKeyConfigOpen(false);
    toast.success('百度地图 Key 已清除');
    // 重新加载（将使用 .env 或空 Key）
    await reloadBMapWithKey('');
  }, []);

  return {
    // 地址库
    locationPresets,
    isLoadingLocations,
    fetchLocations,

    // 实时定位
    currentPosition,
    geoAddress,
    isLocating,
    isGeocoding,
    locateSuccess,
    handleLocate,

    // 新增/编辑
    isAddingLocation,
    setIsAddingLocation,
    editingLocation,
    setEditingLocation,
    newLocationForm,
    setNewLocationForm,
    resetAddForm,
    handleAddLocation,
    handleUpdateLocation,
    handleDeleteLocation,

    // Key 管理
    bmapKeyConfigured,
    bmapKeyInput,
    setBmapKeyInput,
    isKeyConfigOpen,
    setIsKeyConfigOpen,
    isSavingKey,
    handleOpenKeyConfig,
    handleSaveBMapKey,
    handleClearBMapKey,

    // 选中位置（统一跨页面状态）
    selectedLat,
    selectedLng,
    selectedAddress,
    setSelectedLat,
    setSelectedLng,
    setSelectedAddress,
    setSelectedLocation,
    clearSelectedLocation,
  } as const;
}
