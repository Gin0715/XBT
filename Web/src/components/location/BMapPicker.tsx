import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, MapPin, CheckCircle2, Loader2, Crosshair, ExternalLink } from 'lucide-react';
import { getBMapInstances, reverseGeocode } from '../../utils/bmap';

interface BMapPickerProps {
  /** 是否显示 */
  open: boolean;
  /** 关闭回调 */
  onClose: () => void;
  /** 确认选点回调 */
  onConfirm: (lat: number, lng: number, address: string) => void;
  /** 初始经纬度（可选，用于地图中心） */
  initialLat?: number;
  initialLng?: number;
}

const BMapPicker: React.FC<BMapPickerProps> = ({
  open,
  onClose,
  onConfirm,
  initialLat,
  initialLng,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);

  const [selectedPos, setSelectedPos] = useState<{ lat: number; lng: number } | null>(null);
  const [selectedAddr, setSelectedAddr] = useState('');
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [loadError, setLoadError] = useState(false);

  // 初始化地图
  useEffect(() => {
    if (!open || !containerRef.current || mapRef.current) return;

    let destroyed = false;

    const init = async () => {
      const bm = getBMapInstances();
      if (!bm) {
        // SDK 尚未加载，等待加载
        const { initBMap } = await import('../../utils/bmap');
        const ready = await initBMap();
        if (!ready || destroyed) {
          setLoadError(true);
          return;
        }
      }

      const instances = getBMapInstances();
      if (!instances || destroyed) {
        setLoadError(true);
        return;
      }

      const { BMap } = instances;

      // 默认中心点：初始坐标或北京
      const centerLat = initialLat ?? 39.915;
      const centerLng = initialLng ?? 116.404;

      const map = new BMap.Map(containerRef.current!, {
        enableMapClick: true,
      });
      mapRef.current = map;

      const point = new BMap.Point(centerLng, centerLat);
      map.centerAndZoom(point, 16);
      map.enableScrollWheelZoom(true);
      map.addControl(new BMap.NavigationControl());
      map.addControl(new BMap.ScaleControl());

      // 点击地图选点
      map.addEventListener('click', (e: any) => {
        const pt = e.point;
        updateSelected(pt.lat, pt.lng);
      });

      setMapReady(true);
    };

    // 短暂延迟确保 DOM 已渲染
    const timer = setTimeout(init, 200);
    return () => {
      destroyed = true;
      clearTimeout(timer);
    };
  }, [open]);

  // 更新选中点
  const updateSelected = useCallback(async (lat: number, lng: number) => {
    setSelectedPos({ lat, lng });
    setIsGeocoding(true);

    // 在地图上放置/移动标记
    const instances = getBMapInstances();
    if (instances && mapRef.current) {
      const { BMap } = instances;
      const pt = new BMap.Point(lng, lat);
      if (!markerRef.current) {
        markerRef.current = new BMap.Marker(pt);
        mapRef.current.addOverlay(markerRef.current);
      } else {
        markerRef.current.setPosition(pt);
      }
    }

    // 逆地理编码
    try {
      const addr = await reverseGeocode(lat, lng);
      setSelectedAddr(addr.formattedAddress || addr.poiName || `${lng.toFixed(6)}, ${lat.toFixed(6)}`);
    } catch {
      setSelectedAddr(`${lng.toFixed(6)}, ${lat.toFixed(6)}`);
    } finally {
      setIsGeocoding(false);
    }
  }, []);

  // 自动定位到当前 GPS 位置
  const handleAutoLocate = useCallback(async () => {
    const { getCurrentPosition } = await import('../../utils/bmap');
    try {
      const pos = await getCurrentPosition();
      if (mapRef.current) {
        const instances = getBMapInstances();
        if (instances) {
          const { BMap } = instances;
          mapRef.current.centerAndZoom(new BMap.Point(pos.lng, pos.lat), 18);
        }
      }
      updateSelected(pos.lat, pos.lng);
    } catch (err: any) {
      // 定位失败不报错，用户仍可手动选点
      console.warn('[BMapPicker] 自动定位失败', err);
    }
  }, [updateSelected]);

  const handleConfirm = () => {
    if (!selectedPos) return;
    const addr = selectedAddr || `${selectedPos.lng.toFixed(6)}, ${selectedPos.lat.toFixed(6)}`;
    onConfirm(selectedPos.lat, selectedPos.lng, addr);
    onClose();
  };

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[200] flex flex-col"
          style={{
            background: 'rgba(15,23,42,0.6)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
          }}
        >
          {/* Header */}
          <div
            className="shrink-0 flex items-center justify-between px-4 py-3"
            style={{
              background: 'rgba(255,255,255,0.95)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              borderBottom: '1px solid rgba(226,232,240,0.4)',
              paddingTop: 'calc(12px + var(--sat))',
            }}
          >
            <div className="flex items-center gap-3">
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center shadow-md"
                style={{ background: 'linear-gradient(135deg, #3388ff, #1a56db)' }}
              >
                <MapPin size={16} className="text-white" strokeWidth={2.5} />
              </div>
              <div>
                <h3 className="text-sm font-bold text-text-primary">百度地图选点</h3>
                <p className="text-[10px] text-text-muted font-medium">点击地图选取位置坐标</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-9 h-9 flex items-center justify-center rounded-full transition-all active:scale-90 hover:bg-slate-100"
              style={{ color: '#94A3B8' }}
            >
              <X size={18} />
            </button>
          </div>

          {/* Map area */}
          <div className="flex-1 min-h-0 relative">
            {/* Crosshair center indicator */}
            <div
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-10"
              style={{ marginTop: '-20px' }}
            >
              <div className="relative">
                <MapPin
                  size={32}
                  className="text-red-500 drop-shadow-lg"
                  fill="currentColor"
                  strokeWidth={1}
                />
                <div
                  className="absolute top-full left-1/2 -translate-x-1/2 w-1 h-1 rounded-full mt-0.5"
                  style={{ background: '#ef4444', boxShadow: '0 0 6px rgba(239,68,68,0.6)' }}
                />
              </div>
            </div>

            {loadError ? (
              <div className="flex flex-col items-center justify-center h-full p-6 text-center space-y-4">
                <div
                  className="w-16 h-16 rounded-2xl flex items-center justify-center"
                  style={{ background: 'rgba(241,245,249,0.8)' }}
                >
                  <MapPin size={28} className="text-slate-300" />
                </div>
                <div>
                  <p className="text-sm font-bold text-text-primary">地图加载失败</p>
                  <p className="text-xs text-text-muted mt-1">请检查百度地图 API Key 配置</p>
                </div>
                <a
                  href="https://lbs.baidu.com/maptool/getpoint"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold text-white shadow-md transition-all active:scale-95"
                  style={{
                    background: 'linear-gradient(135deg, #3388ff, #1a56db)',
                    boxShadow: '0 4px 12px rgba(51,136,255,0.3)',
                  }}
                >
                  打开百度坐标拾取器 <ExternalLink size={12} />
                </a>
              </div>
            ) : (
              <div ref={containerRef} className="w-full h-full" />
            )}

            {/* Auto-locate button */}
            {mapReady && (
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={handleAutoLocate}
                className="absolute top-3 right-3 z-10 w-10 h-10 rounded-xl flex items-center justify-center shadow-lg backdrop-blur transition-all active:scale-90"
                style={{
                  background: 'rgba(255,255,255,0.9)',
                  border: '1px solid rgba(226,232,240,0.6)',
                }}
                title="定位到当前 GPS 位置"
              >
                <Crosshair size={18} style={{ color: '#3388ff' }} />
              </motion.button>
            )}
          </div>

          {/* Bottom info bar */}
          <div
            className="shrink-0 px-4 pb-4 pt-3 space-y-3"
            style={{
              background: 'rgba(255,255,255,0.95)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              borderTop: '1px solid rgba(226,232,240,0.4)',
              paddingBottom: 'calc(16px + var(--sab))',
            }}
          >
            {/* Selected info */}
            <div
              className="rounded-2xl p-3.5 border min-h-[52px]"
              style={{
                background: 'rgba(248,250,252,0.8)',
                borderColor: selectedPos
                  ? 'rgba(51,136,255,0.25)'
                  : 'rgba(226,232,240,0.5)',
              }}
            >
              {selectedPos ? (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-3">
                    <span
                      className="text-[10px] px-2 py-0.5 rounded-md font-bold"
                      style={{
                        background: 'rgba(51,136,255,0.12)',
                        color: '#3388ff',
                      }}
                    >
                      已选位置
                    </span>
                    <span className="text-[11px] font-mono font-bold text-text-primary">
                      {selectedPos.lng.toFixed(6)}, {selectedPos.lat.toFixed(6)}
                    </span>
                  </div>
                  {isGeocoding ? (
                    <div className="flex items-center gap-2">
                      <Loader2 size={12} className="animate-spin text-slate-400" />
                      <span className="text-[11px] text-slate-400">解析地址中…</span>
                    </div>
                  ) : selectedAddr ? (
                    <p className="text-[12px] text-text-primary font-medium leading-relaxed">
                      📍 {selectedAddr}
                    </p>
                  ) : null}
                </div>
              ) : (
                <div className="flex items-center gap-2 text-slate-400">
                  <MapPin size={14} />
                  <p className="text-[12px] font-medium">点击地图任意位置选取坐标</p>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-2.5">
              <button
                onClick={onClose}
                className="flex-1 py-3 rounded-xl text-xs font-semibold transition-colors active:scale-95"
                style={{
                  color: '#64748B',
                  background: 'rgba(241,245,249,0.8)',
                }}
              >
                取消
              </button>
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={handleConfirm}
                disabled={!selectedPos}
                className={`flex-[2] py-3 rounded-xl text-xs font-semibold text-white shadow-lg flex items-center justify-center gap-1.5 transition-all ${
                  !selectedPos ? 'opacity-40 cursor-not-allowed' : ''
                }`}
                style={{
                  background: selectedPos
                    ? 'linear-gradient(135deg, #3388ff, #1a56db)'
                    : '#94a3b8',
                  boxShadow: selectedPos
                    ? '0 4px 16px rgba(51,136,255,0.3)'
                    : 'none',
                }}
              >
                <CheckCircle2 size={14} strokeWidth={2.5} />
                确认使用此位置
              </motion.button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
};

export default BMapPicker;
