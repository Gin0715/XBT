import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Plus, Edit3, Save, Crosshair, MapPin } from 'lucide-react';
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
        {isAdd && (
          <>
            {onFillGPS && (
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={onFillGPS}
                disabled={!hasLocation}
                className="px-2 sm:px-3 py-3 text-xs font-bold rounded-xl disabled:opacity-30 flex-shrink-0 flex items-center gap-0.5 sm:gap-1 transition-colors active:scale-90"
                style={{
                  color: '#00B42A',
                  background: 'rgba(0,180,42,0.08)',
                  border: '1px solid rgba(0,180,42,0.2)',
                }}
                title="填入当前定位"
              >
                <Crosshair size={14} />
                <span className="hidden sm:inline text-[11px]">定位</span>
              </motion.button>
            )}
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={() => setShowMapPicker(true)}
              className="px-2 sm:px-3 py-3 text-xs font-bold rounded-xl flex-shrink-0 flex items-center gap-0.5 sm:gap-1 transition-colors active:scale-90"
              style={{
                color: '#3388ff',
                background: 'rgba(51,136,255,0.08)',
                border: '1px solid rgba(51,136,255,0.2)',
              }}
              title="百度地图选点"
            >
              <MapPin size={14} />
              <span className="hidden sm:inline text-[11px]">选点</span>
            </motion.button>
          </>
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
        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={onSave}
          className="px-5 py-2.5 text-xs font-semibold text-white rounded-xl shadow-lg flex items-center gap-1.5 transition-all duration-200"
          style={{
            background: accentColors.btnBg,
            boxShadow: accentColors.btnShadow,
          }}
        >
          <Save size={13} strokeWidth={2.5} />
          {isAdd ? '保存地址' : '保存修改'}
        </motion.button>
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
