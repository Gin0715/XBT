import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Plus, Edit3, Save, Crosshair, MapPin, CheckCircle2 } from 'lucide-react';
import { sanitizeCoord } from '../../utils/coords';
import BMapPicker from './BMapPicker';

export interface LocationFormData {
  name: string;
  lat: string;
  lng: string;
  description: string;
}

interface LocationFormProps {
  /** 'add' 或 'edit' 模式 */
  mode: 'add' | 'edit';
  /** 表单数据 */
  form: LocationFormData;
  /** 更新表单字段 */
  onChange: (form: LocationFormData) => void;
  /** 保存回调 */
  onSave: () => void;
  /** 取消回调 */
  onCancel: () => void;
  /** 是否有当前 GPS 定位可用 */
  hasLocation?: boolean;
  /** 填入当前 GPS 定位 */
  onFillGPS?: () => void;
}

export const LocationForm: React.FC<LocationFormProps> = ({
  mode,
  form,
  onChange,
  onSave,
  onCancel,
  hasLocation = false,
  onFillGPS,
}) => {
  const isAdd = mode === 'add';
  const [showMapPicker, setShowMapPicker] = useState(false);
  const [fillFeedback, setFillFeedback] = useState<'map' | 'gps' | null>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout>>(null);

  // 坐标填充成功后的视觉反馈（1.5s 后自动消失）
  useEffect(() => {
    if (fillFeedback) {
      if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
      feedbackTimer.current = setTimeout(() => setFillFeedback(null), 1500);
    }
    return () => { if (feedbackTimer.current) clearTimeout(feedbackTimer.current); };
  }, [fillFeedback]);

  const handleMapPick = (lat: number, lng: number, address: string) => {
    const newForm: LocationFormData = {
      ...form,
      lat: lat.toFixed(6),
      lng: lng.toFixed(6),
    };
    if (isAdd) {
      if (!form.description && address) newForm.description = address;
    }
    onChange(newForm);
    setFillFeedback('map');
  };

  const handleFillGPS = () => {
    if (onFillGPS) onFillGPS();
    setFillFeedback('gps');
  };

  const accentColors = isAdd
    ? {
        bg: 'linear-gradient(135deg, rgba(239,244,255,0.9), rgba(255,255,255,0.9), rgba(238,242,255,0.9))',
        border: 'rgba(22,93,255,0.25)',
        shadow: '0 4px 20px rgba(22,93,255,0.1)',
        iconBg: 'linear-gradient(135deg, #165DFF, #4f39d0)',
        titleColor: '#165DFF',
        subtitleColor: '#93a3fd',
        btnBg: 'linear-gradient(135deg, #165DFF, #4f39d0)',
        btnShadow: '0 4px 16px rgba(22,93,255,0.3)',
      }
    : {
        bg: 'linear-gradient(135deg, rgba(255,251,235,0.9), rgba(255,255,255,0.9), rgba(254,249,195,0.9))',
        border: 'rgba(245,158,11,0.3)',
        shadow: '0 4px 20px rgba(245,158,11,0.12)',
        iconBg: 'linear-gradient(135deg, #f59e0b, #f97316)',
        titleColor: '#d97706',
        subtitleColor: '#fbbf24',
        btnBg: 'linear-gradient(135deg, #f59e0b, #f97316)',
        btnShadow: '0 4px 16px rgba(245,158,11,0.3)',
      };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: -8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: -8 }}
      className="rounded-2xl p-4 border-2 space-y-3 shadow-lg"
      style={{
        background: accentColors.bg,
        borderColor: accentColors.border,
        boxShadow: accentColors.shadow,
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2.5">
        <div
          className="w-8 h-8 rounded-xl flex items-center justify-center shadow-md"
          style={{ background: accentColors.iconBg }}
        >
          {isAdd ? (
            <Plus size={15} className="text-white" strokeWidth={2.5} />
          ) : (
            <Edit3 size={14} className="text-white" />
          )}
        </div>
        <div>
          <span className="text-xs font-bold" style={{ color: accentColors.titleColor }}>
            {isAdd ? '新建位置预设' : '编辑位置'}
          </span>
          {isAdd && (
            <p className="text-[9px]" style={{ color: accentColors.subtitleColor }}>
              填写坐标信息保存到地址库
            </p>
          )}
        </div>
      </div>

      {/* Name / 标题 */}
      <input
        placeholder="标题（这是自己看的）"
        value={form.name}
        onChange={(e) => onChange({ ...form, name: e.target.value })}
        className="w-full min-w-0 px-3 sm:px-4 py-3 text-sm border rounded-xl outline-none font-semibold placeholder:text-slate-300 transition-all duration-200 input-glass"
        style={{ borderColor: 'rgba(226,232,240,0.8)', background: 'rgba(255,255,255,0.8)' }}
      />

      {/* Coordinates — min-w-0 prevents flex children from overflowing */}
      <div className="space-y-2 min-w-0">
        <div className="flex sm:flex-row flex-col gap-1.5 sm:gap-2 min-w-0">
          <input
            placeholder="经度 lng *"
            value={form.lng}
            onChange={(e) => onChange({ ...form, lng: sanitizeCoord(e.target.value) })}
            className="flex-1 min-w-0 px-2.5 sm:px-4 py-3 text-[13px] sm:text-sm font-mono border rounded-xl outline-none placeholder:text-slate-300 transition-all duration-200"
            style={{ borderColor: 'rgba(226,232,240,0.8)', background: 'rgba(255,255,255,0.8)' }}
          />
          <input
            placeholder="纬度 lat *"
            value={form.lat}
            onChange={(e) => onChange({ ...form, lat: sanitizeCoord(e.target.value) })}
            className="flex-1 min-w-0 px-2.5 sm:px-4 py-3 text-[13px] sm:text-sm font-mono border rounded-xl outline-none placeholder:text-slate-300 transition-all duration-200"
            style={{ borderColor: 'rgba(226,232,240,0.8)', background: 'rgba(255,255,255,0.8)' }}
          />
        </div>

        {isAdd && (
          <div className="space-y-1.5">
            {/* 快捷获取坐标方式说明 */}
            <div className="flex items-center gap-2">
              <div className="h-px flex-1" style={{ background: 'rgba(226,232,240,0.5)' }} />
              <span className="text-[9px] font-bold tracking-wider text-text-muted/60 uppercase">
                <span className="hidden sm:inline">快捷获取坐标</span>
                <span className="sm:hidden">坐标</span>
              </span>
              <div className="h-px flex-1" style={{ background: 'rgba(226,232,240,0.5)' }} />
            </div>

            <div className="flex gap-1.5 sm:gap-2 min-w-0">
              {/* 地图选点 */}
              <button
                onClick={() => setShowMapPicker(true)}
                className={`flex-1 min-w-0 flex items-center justify-center gap-1 px-2 py-2.5 text-[10px] sm:text-xs font-bold rounded-xl transition-all duration-200 btn-tap-sm ${
                  fillFeedback === 'map' ? 'ring-2' : ''
                }`}
                style={{
                  color: '#3388ff',
                  background: fillFeedback === 'map' ? 'rgba(51,136,255,0.18)' : 'rgba(51,136,255,0.08)',
                  borderColor: fillFeedback === 'map' ? 'rgba(51,136,255,0.5)' : 'rgba(51,136,255,0.2)',
                  borderWidth: 1,
                  borderStyle: 'solid',
                }}
                title="打开百度地图，点击任意位置选取经纬度"
              >
                {fillFeedback === 'map' ? (
                  <CheckCircle2 size={13} className="shrink-0" />
                ) : (
                  <MapPin size={13} className="shrink-0" />
                )}
                <span className="truncate">
                  {fillFeedback === 'map' ? '已填入' : '地图选点'}
                </span>
              </button>

              {/* GPS定位 */}
              {onFillGPS && (
                <button
                  onClick={handleFillGPS}
                  disabled={!hasLocation}
                  className={`flex-1 min-w-0 flex items-center justify-center gap-1 px-2 py-2.5 text-[10px] sm:text-xs font-bold rounded-xl transition-all duration-200 btn-tap-sm disabled:opacity-30 ${
                    fillFeedback === 'gps' ? 'ring-2' : ''
                  }`}
                  style={{
                    color: '#00B42A',
                    background: fillFeedback === 'gps' ? 'rgba(0,180,42,0.18)' : 'rgba(0,180,42,0.08)',
                    borderColor: fillFeedback === 'gps' ? 'rgba(0,180,42,0.5)' : 'rgba(0,180,42,0.2)',
                    borderWidth: 1,
                    borderStyle: 'solid',
                  }}
                  title={`${hasLocation ? '填入当前 GPS 定位坐标' : '暂无定位数据，请先获取定位'}`}
                >
                  {fillFeedback === 'gps' ? (
                    <CheckCircle2 size={13} className="shrink-0" />
                  ) : (
                    <Crosshair size={13} className="shrink-0" />
                  )}
                  <span className="truncate">
                    {fillFeedback === 'gps' ? '已填入' : 'GPS定位'}
                  </span>
                </button>
              )}
            </div>

            {/* 辅助提示 */}
            <p className="text-[9px] text-text-muted/50 text-center leading-relaxed">
              地图点击选精确坐标 · GPS填当前位置
            </p>
          </div>
        )}
      </div>

      {/* Description / 地址名称 */}
      <textarea
        placeholder="地址名称（这是给老师看的）"
        value={form.description}
        onChange={(e) => onChange({ ...form, description: e.target.value })}
        rows={2}
        className="w-full min-w-0 px-3 sm:px-4 py-3 text-sm border rounded-xl outline-none resize-none placeholder:text-slate-300 transition-all duration-200"
        style={{ borderColor: 'rgba(226,232,240,0.8)', background: 'rgba(255,255,255,0.8)' }}
      />

      {/* Actions */}
      <div className="flex gap-2 justify-end pt-1">
        <button
          onClick={onCancel}
          className="px-5 py-2.5 text-xs font-semibold rounded-xl transition-colors active:scale-95"
          style={{ color: '#64748B', background: 'rgba(241,245,249,0.8)' }}
        >
          取消
        </button>
        <button
          
          onClick={onSave}
          className="px-5 py-2.5 text-xs font-semibold text-white rounded-xl shadow-lg flex items-center gap-1.5 transition-all duration-200"
          style={{
            background: accentColors.btnBg,
            boxShadow: accentColors.btnShadow,
          }}
        >
          <Save size={13} strokeWidth={2.5} />
          {isAdd ? '保存地址' : '保存修改'}
        </button>
      </div>

      {/* 百度地图选点器 */}
      <BMapPicker
        open={showMapPicker}
        onClose={() => setShowMapPicker(false)}
        onConfirm={handleMapPick}
        initialLat={form.lat ? parseFloat(form.lat) : undefined}
        initialLng={form.lng ? parseFloat(form.lng) : undefined}
      />
    </motion.div>
  );
};
