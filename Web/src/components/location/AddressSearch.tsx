import React, { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, MapPin, Loader2, X, Navigation, Crosshair, ExternalLink } from 'lucide-react';
import { searchPlaces, type BMapPlaceResult } from '../../utils/bmap';

interface AddressSearchProps {
  /** 是否显示 */
  open: boolean;
  /** 关闭回调 */
  onClose: () => void;
  /** 确认选择回调 */
  onConfirm: (lat: number, lng: number, address: string, name: string) => void;
  /** 搜索提示文本 */
  placeholder?: string;
}

const AddressSearch: React.FC<AddressSearchProps> = ({
  open,
  onClose,
  onConfirm,
  placeholder = '搜索地址、地标、POI…',
}) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<BMapPlaceResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);

  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  // 打开时自动聚焦
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 350);
    } else {
      // 关闭时重置状态
      setQuery('');
      setResults([]);
      setHasSearched(false);
      setSelectedIndex(-1);
    }
  }, [open]);

  // 防抖搜索
  const doSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed || trimmed.length < 2) {
      setResults([]);
      setHasSearched(false);
      return;
    }

    setIsSearching(true);
    setHasSearched(true);
    setSelectedIndex(-1);

    try {
      const places = await searchPlaces(trimmed);
      setResults(places || []);
    } catch (err) {
      console.warn('[AddressSearch] 搜索失败', err);
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  }, []);

  const handleQueryChange = useCallback((value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(value), 300);
  }, [doSearch]);

  // 键盘导航
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, -1));
    } else if (e.key === 'Enter' && selectedIndex >= 0 && results[selectedIndex]) {
      e.preventDefault();
      const place = results[selectedIndex];
      onConfirm(place.lat, place.lng, place.address || place.name, place.name);
      onClose();
    } else if (e.key === 'Escape') {
      onClose();
    }
  }, [results, selectedIndex, onConfirm, onClose]);

  // 选择结果
  const handleSelect = useCallback((place: BMapPlaceResult) => {
    const addr = place.address || place.name || `${place.lng.toFixed(6)}, ${place.lat.toFixed(6)}`;
    onConfirm(place.lat, place.lng, addr, place.name);
    onClose();
  }, [onConfirm, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[200] flex flex-col"
          style={{
            background: 'rgba(15,23,42,0.5)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
          }}
          onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 250 }}
            className="mt-auto w-full sm:max-w-[460px] md:max-w-[500px] mx-auto rounded-t-[2.5rem] overflow-hidden flex flex-col max-h-[85vh] max-h-[85dvh] glass-sheet"
            onClick={e => e.stopPropagation()}
          >
            {/* Drag handle */}
            <div className="w-10 h-1.5 bg-slate-200 rounded-full mx-auto mt-4 shrink-0" />

            {/* Header */}
            <div className="px-6 pt-4 pb-2 shrink-0 flex items-center justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-2xl flex items-center justify-center shadow-md shrink-0"
                  style={{ background: 'linear-gradient(135deg, #3388ff, #1a56db)' }}>
                  <Search size={16} className="text-white" strokeWidth={2.5} />
                </div>
                <div className="min-w-0">
                  <h3 className="text-base font-extrabold text-text-primary tracking-tight">搜索地址</h3>
                  <p className="text-[10px] text-text-muted font-medium">百度地图 · 输入关键词搜索地点</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="w-9 h-9 flex items-center justify-center rounded-full transition-all hover:bg-slate-100 active:scale-90 shrink-0"
                style={{ color: '#94A3B8' }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Search input */}
            <div className="px-4 sm:px-6 pt-3 pb-2 shrink-0">
              <div
                className="relative flex items-center rounded-2xl border-2 transition-all duration-200"
                style={{
                  borderColor: query ? 'rgba(51,136,255,0.4)' : 'rgba(226,232,240,0.8)',
                  background: 'rgba(248,250,252,0.9)',
                }}
              >
                <Search size={16} className="ml-3.5 shrink-0" style={{ color: query ? '#3388ff' : '#94A3B8' }} />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={e => handleQueryChange(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={placeholder}
                  className="flex-1 min-w-0 px-3 py-3.5 text-sm font-semibold bg-transparent outline-none placeholder:text-slate-300"
                  autoComplete="off"
                  spellCheck={false}
                />
                {query && (
                  <button
                    onClick={() => { setQuery(''); setResults([]); setHasSearched(false); inputRef.current?.focus(); }}
                    className="mr-2 p-1.5 rounded-lg hover:bg-slate-200/50 transition-colors"
                  >
                    <X size={14} className="text-slate-400" />
                  </button>
                )}
                {isSearching && (
                  <Loader2 size={16} className="mr-3.5 animate-spin shrink-0" style={{ color: '#3388ff' }} />
                )}
              </div>
            </div>

            {/* Results area */}
            <div ref={searchContainerRef} className="flex-1 overflow-y-auto px-4 sm:px-6 pb-safe-8 custom-scrollbar">
              {/* 初始状态 */}
              {!hasSearched && (
                <div className="flex flex-col items-center py-10 text-center space-y-3">
                  <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
                    style={{ background: 'rgba(239,244,255,0.8)' }}>
                    <MapPin size={22} style={{ color: '#3388ff' }} />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-text-primary">搜索想添加的地址</p>
                    <p className="text-xs text-text-muted mt-1 max-w-[240px] mx-auto leading-relaxed">
                      输入学校、公司、小区或任意位置名称<br />
                      从搜索结果中选择即可填入坐标
                    </p>
                  </div>
                </div>
              )}

              {/* 搜索中 */}
              {isSearching && (
                <div className="flex items-center justify-center py-10 gap-2.5">
                  <Loader2 size={16} className="animate-spin" style={{ color: '#3388ff' }} />
                  <span className="text-sm text-text-muted font-medium">正在搜索…</span>
                </div>
              )}

              {/* 无结果 */}
              {hasSearched && !isSearching && results.length === 0 && (
                <div className="flex flex-col items-center py-10 text-center space-y-2">
                  <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
                    style={{ background: 'rgba(241,245,249,0.8)' }}>
                    <Crosshair size={20} className="text-slate-300" />
                  </div>
                  <p className="text-sm font-bold text-text-primary">没有找到匹配的地点</p>
                  <p className="text-xs text-text-muted">试试其他关键词，或使用地图选点</p>
                </div>
              )}

              {/* 结果列表 */}
              {hasSearched && !isSearching && results.length > 0 && (
                <div className="space-y-2 py-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-bold text-text-muted tracking-wide">
                      找到 {results.length} 个结果
                    </span>
                    <span className="text-[9px] text-text-muted">点击选择</span>
                  </div>
                  <AnimatePresence>
                    {results.map((place, idx) => (
                      <motion.button
                        key={`${place.lat}-${place.lng}-${idx}`}
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: idx * 0.04, duration: 0.2 }}
                        onClick={() => handleSelect(place)}
                        className={`w-full text-left rounded-2xl p-3.5 border-2 transition-all duration-200 btn-tap-sm ${
                          selectedIndex === idx ? 'ring-2 ring-blue-400' : ''
                        }`}
                        style={{
                          background: selectedIndex === idx
                            ? 'rgba(51,136,255,0.06)'
                            : 'rgba(255,255,255,0.8)',
                          borderColor: selectedIndex === idx
                            ? 'rgba(51,136,255,0.3)'
                            : 'rgba(226,232,240,0.5)',
                        }}
                      >
                        <div className="flex items-start gap-3">
                          <div
                            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5 shadow-sm"
                            style={{ background: 'rgba(51,136,255,0.1)' }}
                          >
                            <MapPin size={15} style={{ color: '#3388ff' }} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-bold text-text-primary leading-snug truncate">
                                {place.name}
                              </span>
                              <span className="text-[9px] px-1.5 py-0.5 rounded-md font-semibold shrink-0"
                                style={{ background: 'rgba(51,136,255,0.08)', color: '#3388ff' }}>
                                POI
                              </span>
                            </div>
                            {place.address && (
                              <p className="text-[12px] text-text-secondary mt-1 leading-relaxed line-clamp-1">
                                📍 {place.address}
                              </p>
                            )}
                            <div className="flex items-center gap-2 mt-1.5">
                              <span className="text-[10px] font-mono font-bold text-text-muted">
                                {place.lng.toFixed(6)}, {place.lat.toFixed(6)}
                              </span>
                              {(place.city || place.district) && (
                                <span className="text-[9px] text-text-muted">
                                  {place.city}{place.district ? ` · ${place.district}` : ''}
                                </span>
                              )}
                            </div>
                          </div>
                          <div
                            className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 self-center transition-colors"
                            style={{ background: 'rgba(51,136,255,0.08)' }}
                          >
                            <Navigation size={12} style={{ color: '#3388ff' }} />
                          </div>
                        </div>
                      </motion.button>
                    ))}
                  </AnimatePresence>

                  {/* 底部提示 */}
                  <div className="text-center pt-4 pb-2">
                    <p className="text-[9px] text-text-muted">
                      搜索不精确？试试
                      <button
                        onClick={onClose}
                        className="font-bold mx-1 underline underline-offset-2"
                        style={{ color: '#3388ff' }}
                      >地图选点</button>
                      或
                      <a
                        href="https://lbs.baidu.com/maptool/getpoint"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-bold mx-1 underline underline-offset-2 inline-flex items-center gap-0.5"
                        style={{ color: '#3388ff' }}
                      >百度坐标拾取器<ExternalLink size={8} /></a>
                    </p>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
};

export default AddressSearch;
