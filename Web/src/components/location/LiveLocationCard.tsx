import React from 'react';
import { Satellite, MapPin, Radio, Compass, LocateFixed } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { BMapAddress } from '../../utils/bmap';

export interface LiveLocationData {
  currentPosition: { lat: number; lng: number } | null;
  geoAddress: BMapAddress | null;
  isLocating: boolean;
  isGeocoding: boolean;
  locateSuccess: boolean;
  onLocate: () => void;
}

interface LiveLocationCardProps {
  data: LiveLocationData;
  /** 定位后按钮文本（默认"重新定位"） */
  locateLabel?: string;
}

/* ============================================================
   实时定位卡片 — 精密仪器 / 航空仪表盘 设计语言
   深色玻璃拟态 + 坐标精密显示 + 三态自适应
   ============================================================ */

// 坐标方格背景 (SVG Data URI)
const GRID_SVG = `url("data:image/svg+xml,%3Csvg width='48' height='48' xmlns='http://www.w3.org/2000/svg'%3E%3Cdefs%3E%3Cpattern id='g' width='12' height='12' patternUnits='userSpaceOnUse'%3E%3Cpath d='M 12 0 L 0 0 0 12' fill='none' stroke='rgba(255,255,255,0.04)' stroke-width='0.5'/%3E%3C/pattern%3E%3C/defs%3E%3Crect width='100%25' height='100%25' fill='url(%23g)'/%3E%3C/svg%3E")`;

const LiveLocationCard: React.FC<LiveLocationCardProps> = ({ data, locateLabel = '重新定位' }) => {
  const { currentPosition, geoAddress, isLocating, isGeocoding, locateSuccess, onLocate } = data;
  const hasPosition = !!currentPosition;
  const isSearching = isLocating && !hasPosition;

  return (
    <div
      className="relative overflow-hidden rounded-3xl text-white shadow-2xl gpu-layer"
      style={{
        background: 'linear-gradient(160deg, #080e1a 0%, #0f1f3a 40%, #162a4a 65%, #0d1a2e 100%)',
        boxShadow: '0 8px 40px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.06)',
      }}
    >
      {/* ===== 装饰层 ===== */}
      <Decorations />

      {/* ===== 定位成功波纹 ===== */}
      <AnimatePresence>
        {locateSuccess && (
          <motion.div
            key="ripple"
            initial={{ opacity: 0.4, scale: 0.3 }}
            animate={{ opacity: 0, scale: 3.5 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.2, ease: 'easeOut' }}
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-12 h-12 rounded-full border-2 pointer-events-none z-10"
            style={{ borderColor: 'rgba(52,211,153,0.5)' }}
          />
        )}
      </AnimatePresence>

      <div className="relative p-4 sm:p-5">
        {/* ===== 顶部：标题 + 定位按钮 ===== */}
        <Header hasPosition={hasPosition} isLocating={isLocating} locateLabel={locateLabel} onLocate={onLocate} />

        {/* ===== 主体：三态切换 ===== */}
        {isSearching ? (
          <LocatingState />
        ) : !hasPosition ? (
          <EmptyState />
        ) : (
          <PositionedState
            lat={currentPosition.lat}
            lng={currentPosition.lng}
            geoAddress={geoAddress}
            isGeocoding={isGeocoding}
          />
        )}
      </div>
    </div>
  );
};

// ===================== 装饰背景层 =====================
const Decorations = () => (
  <>
    {/* 主光晕 — 右上 */}
    <div
      className="absolute -top-24 -right-24 w-72 h-72 rounded-full pointer-events-none opacity-25"
      style={{
        background: 'radial-gradient(circle, rgba(52,211,153,0.2) 0%, rgba(6,182,212,0.08) 40%, transparent 70%)',
        animation: 'pulse-glow 4s ease-in-out infinite',
      }}
    />
    {/* 辅光晕 — 左下 */}
    <div
      className="absolute -bottom-20 -left-20 w-56 h-56 rounded-full pointer-events-none opacity-15"
      style={{
        background: 'radial-gradient(circle, rgba(99,102,241,0.15) 0%, rgba(139,92,246,0.05) 40%, transparent 70%)',
      }}
    />
    {/* 坐标网格纹理 */}
    <div
      className="absolute inset-0 pointer-events-none opacity-[0.04]"
      style={{ backgroundImage: GRID_SVG }}
    />
    {/* 顶部边缘高光 */}
    <div className="absolute top-0 left-[15%] right-[15%] h-px pointer-events-none"
      style={{
        background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent)',
      }}
    />
  </>
);

// ===================== Header =====================
const Header = ({
  hasPosition, isLocating, locateLabel, onLocate,
}: {
  hasPosition: boolean; isLocating: boolean; locateLabel: string; onLocate: () => void;
}) => (
  <div className="flex items-center justify-between mb-3.5">
    {/* 左侧：图标 + 标题 */}
    <div className="flex items-center gap-2.5 min-w-0">
      <div className="relative shrink-0">
        <div
          className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl flex items-center justify-center shadow-lg"
          style={{
            background: 'linear-gradient(135deg, rgba(52,211,153,0.18), rgba(6,182,212,0.12))',
            border: '1px solid rgba(52,211,153,0.15)',
            backdropFilter: 'blur(8px)',
          }}
        >
          <Satellite size={16} className="text-emerald-400" />
        </div>
        {/* 实时脉动绿点 */}
        <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
          <span className="relative inline-flex rounded-full w-2.5 h-2.5 bg-emerald-500 ring-2 ring-[#080e1a]" />
        </div>
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 sm:gap-2">
          <h4 className="font-extrabold text-sm sm:text-base text-white/95">实时定位</h4>
          <span
            className="text-[7px] sm:text-[8px] px-1.5 py-0.5 rounded-md font-bold uppercase tracking-[0.12em]"
            style={{
              background: 'linear-gradient(135deg, rgba(52,211,153,0.15), rgba(52,211,153,0.05))',
              color: '#6ee7b7',
              border: '1px solid rgba(52,211,153,0.2)',
            }}
          >
            LIVE
          </span>
        </div>
        <p className="text-[8px] sm:text-[9px] text-slate-600 mt-0.5 font-medium tracking-wider flex items-center gap-1">
          <Compass size={9} className="text-slate-600" />
          {hasPosition ? '坐标已锁定' : '等待定位'}
        </p>
      </div>
    </div>

    {/* 右侧：定位按钮 */}
    <button
      onClick={onLocate}
      disabled={isLocating}
      className="relative flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl text-[10px] sm:text-[11px] font-bold transition-all duration-200 disabled:opacity-50 btn-tap-sm overflow-hidden group shrink-0"
      style={{
        background: hasPosition
          ? 'rgba(255,255,255,0.06)'
          : 'linear-gradient(135deg, #059669, #10b981)',
        border: hasPosition
          ? '1px solid rgba(255,255,255,0.08)'
          : '1px solid rgba(52,211,153,0.25)',
        boxShadow: hasPosition ? 'none' : '0 4px 20px rgba(5,150,105,0.3)',
      }}
    >
      {isLocating ? (
        <><div className="w-3 h-3 rounded-full border-2 border-white/30 border-t-white animate-spin" />定位中</>
      ) : (
        <><LocateFixed size={13} className={hasPosition ? '' : 'drop-shadow-sm'} />{hasPosition ? locateLabel : '获取定位'}</>
      )}
      {/* hover 光晕 */}
      {!hasPosition && (
        <div
          className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"
          style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.12), transparent)' }}
        />
      )}
    </button>
  </div>
);

// ===================== 空状态：引导定位 =====================
const EmptyState = () => (
  <div
    className="backdrop-blur rounded-2xl p-5 sm:p-6 text-center border gpu-layer"
    style={{
      background: 'linear-gradient(135deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))',
      borderColor: 'rgba(255,255,255,0.05)',
    }}
  >
    <div
      className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl flex items-center justify-center mx-auto mb-3.5 sm:mb-4"
      style={{
        background: 'linear-gradient(135deg, rgba(52,211,153,0.1), rgba(99,102,241,0.06))',
        border: '1px solid rgba(52,211,153,0.1)',
      }}
    >
      <Radio size={22} className="text-emerald-400/60" />
    </div>
    <p className="text-sm sm:text-base font-bold text-slate-300 tracking-wide">点击「获取定位」</p>
    <p className="text-[10px] sm:text-[11px] text-slate-600 mt-2 leading-relaxed max-w-[220px] mx-auto">
      自动获取当前位置并解析详细地址
    </p>
    <div className="flex items-center justify-center gap-4 mt-3 text-[8px] text-slate-700 font-medium">
      <span className="flex items-center gap-1"><div className="w-1 h-1 rounded-full bg-emerald-500/40" />GPS</span>
      <span className="flex items-center gap-1"><div className="w-1 h-1 rounded-full bg-emerald-500/40" />基站</span>
      <span className="flex items-center gap-1"><div className="w-1 h-1 rounded-full bg-emerald-500/40" />北斗</span>
    </div>
  </div>
);

// ===================== 定位中 =====================
const LocatingState = () => (
  <div
    className="flex items-center gap-4 backdrop-blur rounded-2xl p-4 border"
    style={{
      background: 'rgba(255,255,255,0.03)',
      borderColor: 'rgba(255,255,255,0.05)',
    }}
  >
    <div className="relative w-11 h-11 sm:w-12 sm:h-12 shrink-0">
      <div className="absolute inset-0 rounded-2xl bg-emerald-500/10 animate-ping" />
      <div
        className="absolute inset-0 rounded-2xl flex items-center justify-center"
        style={{ background: 'rgba(52,211,153,0.1)' }}
      >
        <Satellite size={18} className="text-emerald-400" />
      </div>
    </div>
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2.5">
        <p className="text-sm font-bold text-slate-200">正在定位</p>
        <span className="flex gap-0.5">
          <span className="w-1 h-1 rounded-full bg-emerald-400 animate-bounce" style={{ animationDelay: '0ms' }} />
          <span className="w-1 h-1 rounded-full bg-emerald-400 animate-bounce" style={{ animationDelay: '150ms' }} />
          <span className="w-1 h-1 rounded-full bg-emerald-400 animate-bounce" style={{ animationDelay: '300ms' }} />
        </span>
      </div>
      <p className="text-[10px] text-slate-600 mt-0.5">搜索卫星信号 · 获取位置信息</p>
    </div>
  </div>
);

// ===================== 定位后：坐标 + 地址 =====================
const PositionedState = ({
  lat, lng, geoAddress, isGeocoding,
}: {
  lat: number; lng: number; geoAddress: BMapAddress | null; isGeocoding: boolean;
}) => (
  <div className="space-y-2.5 anim-slide-up">
    {/* — 坐标双栏：精密仪表风格 — */}
    <div className="grid grid-cols-2 gap-2 sm:gap-2.5">
      {/* 纬度 */}
      <div
        className="backdrop-blur rounded-2xl p-3 sm:p-3.5 border relative overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))',
          borderColor: 'rgba(255,255,255,0.06)',
        }}
      >
        {/* 顶部装饰线 */}
        <div className="absolute top-0 left-3 right-3 h-px"
          style={{ background: 'linear-gradient(90deg, transparent, rgba(6,182,212,0.3), transparent)' }} />
        <div className="flex items-center gap-1.5 mb-1.5">
          <div
            className="w-5 h-5 rounded-lg flex items-center justify-center"
            style={{ background: 'rgba(6,182,212,0.15)' }}
          >
            <span className="text-[7px] font-black text-cyan-400 tracking-wide">N</span>
          </div>
          <span className="text-[8px] sm:text-[9px] text-slate-500 font-semibold tracking-widest uppercase">纬度</span>
        </div>
        <div className="font-mono font-bold text-sm sm:text-base tracking-tight text-white/90">
          {lat.toFixed(6)}°
        </div>
      </div>

      {/* 经度 */}
      <div
        className="backdrop-blur rounded-2xl p-3 sm:p-3.5 border relative overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))',
          borderColor: 'rgba(255,255,255,0.06)',
        }}
      >
        <div className="absolute top-0 left-3 right-3 h-px"
          style={{ background: 'linear-gradient(90deg, transparent, rgba(251,191,36,0.3), transparent)' }} />
        <div className="flex items-center gap-1.5 mb-1.5">
          <div
            className="w-5 h-5 rounded-lg flex items-center justify-center"
            style={{ background: 'rgba(251,191,36,0.15)' }}
          >
            <span className="text-[7px] font-black text-amber-400 tracking-wide">E</span>
          </div>
          <span className="text-[8px] sm:text-[9px] text-slate-500 font-semibold tracking-widest uppercase">经度</span>
        </div>
        <div className="font-mono font-bold text-sm sm:text-base tracking-tight text-white/90">
          {lng.toFixed(6)}°
        </div>
      </div>
    </div>

    {/* — 地址解析 — */}
    {isGeocoding ? (
      <GeocodingLoader />
    ) : geoAddress ? (
      <AddressDisplay address={geoAddress} />
    ) : null}
  </div>
);

// ===================== 逆地理编码加载 =====================
const GeocodingLoader = () => (
  <div
    className="backdrop-blur rounded-2xl p-3.5 flex items-center gap-3 border"
    style={{
      background: 'rgba(255,255,255,0.03)',
      borderColor: 'rgba(255,255,255,0.05)',
      minHeight: '48px',
    }}
  >
    <div
      className="w-7 h-7 rounded-xl flex items-center justify-center shrink-0"
      style={{ background: 'rgba(52,211,153,0.1)' }}
    >
      <div className="w-3.5 h-3.5 rounded-full border-2 border-emerald-400/20 border-t-emerald-400 animate-spin" />
    </div>
    <div>
      <p className="text-xs font-semibold text-slate-300">正在解析地址…</p>
      <p className="text-[8px] text-slate-600 mt-0.5">逆地理编码查询中</p>
    </div>
  </div>
);

// ===================== 地址显示卡片 =====================
const AddressDisplay = ({ address }: { address: BMapAddress }) => (
  <div
    className="backdrop-blur rounded-2xl p-3.5 sm:p-4 border relative overflow-hidden"
    style={{
      background: 'linear-gradient(135deg, rgba(52,211,153,0.05), rgba(99,102,241,0.02))',
      borderColor: 'rgba(52,211,153,0.1)',
    }}
  >
    {/* 左侧装饰条 */}
    <div className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full"
      style={{ background: 'linear-gradient(180deg, rgba(52,211,153,0.4), rgba(99,102,241,0.2))' }} />

    <div className="flex items-start gap-2.5 pl-1">
      <div
        className="w-7 h-7 rounded-xl flex items-center justify-center shrink-0 mt-0.5"
        style={{ background: 'rgba(52,211,153,0.12)' }}
      >
        <MapPin size={13} className="text-emerald-400" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold leading-snug text-white/95">{address.formattedAddress}</p>

        {(address.poiName || address.district || address.city || address.adcode) && (
          <div className="flex flex-wrap items-center gap-1 mt-2 text-[9px] sm:text-[10px]">
            {address.poiName && (
              <span
                className="px-2 py-0.5 rounded-md font-semibold flex items-center gap-1"
                style={{ background: 'rgba(52,211,153,0.12)', color: '#6ee7b7' }}
              >
                <MapPin size={8} />{address.poiName}
              </span>
            )}
            {address.district && (
              <span
                className="px-2 py-0.5 rounded-md"
                style={{ background: 'rgba(255,255,255,0.04)', color: '#94a3b8' }}
              >
                {address.district}
              </span>
            )}
            {(address.city || address.adcode) && (
              <span className="text-slate-600">
                {address.city}{address.adcode ? ` · ${address.adcode}` : ''}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  </div>
);

export default LiveLocationCard;
