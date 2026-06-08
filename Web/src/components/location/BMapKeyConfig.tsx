import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { KeyRound, CheckCircle2, XCircle, ExternalLink, Loader2, Eye, EyeOff, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { useBMapKey } from '../../hooks/useBMapKey';

interface BMapKeyConfigProps {
  /** 紧凑模式：仅显示状态指示器按钮 */
  compact?: boolean;
  /** 全宽模式：在面板顶部以卡片形式展示配置区 */
  fullWidth?: boolean;
  /** 配置完成后回调 */
  onConfigured?: () => void;
}

/**
 * 百度地图 API Key 配置组件
 *
 * - compact: 仅显示状态圆点按钮，点击弹出弹窗
 * - fullWidth: 在父容器中以全宽卡片展示完整配置区（未配置时突出显示）
 * - 默认: 内联状态指示器 + 弹窗
 *
 * Key 状态跨组件同步：同一页面内多个实例自动保持状态一致
 */
const BMapKeyConfig: React.FC<BMapKeyConfigProps> = ({ compact = false, fullWidth = false, onConfigured }) => {
  const { key: savedKey, configured, saving, save, clear } = useBMapKey();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [keyInput, setKeyInput] = useState(savedKey);
  const [showKey, setShowKey] = useState(false);
  const [testResult, setTestResult] = useState<'idle' | 'success' | 'error'>('idle');
  const inputRef = useRef<HTMLInputElement>(null);

  // 当外部 key 变化时同步到输入框（例如其他面板保存了 key）
  useEffect(() => { setKeyInput(savedKey); }, [savedKey]);

  const hasInput = keyInput.trim().length > 0;

  const handleSave = async () => {
    if (!hasInput) return;
    setTestResult('idle');
    try {
      const ready = await save(keyInput.trim());
      if (ready) {
        setTestResult('success');
        setOpen(false);
        setExpanded(false);
        setTimeout(() => setTestResult('idle'), 2000);
        onConfigured?.();
      } else {
        setTestResult('error');
      }
    } catch {
      setTestResult('error');
    }
  };

  const handleClear = async () => {
    await clear();
    setKeyInput('');
    setTestResult('idle');
    setExpanded(true);
  };

  // ---- 紧凑状态按钮 ----
  if (compact) {
    return (
      <>
        <button
          onClick={() => { setKeyInput(savedKey); setOpen(true); }}
          className="relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[10px] font-bold transition-all duration-200 active:scale-90 hover:scale-105"
          style={{
            background: configured
              ? 'linear-gradient(135deg, rgba(0,180,42,0.12), rgba(54,211,153,0.08))'
              : 'linear-gradient(135deg, rgba(245,63,63,0.12), rgba(251,146,60,0.08))',
            color: configured ? '#00B42A' : '#F53F3F',
            boxShadow: configured
              ? '0 0 12px rgba(0,180,42,0.15)'
              : '0 0 12px rgba(245,63,63,0.12)',
          }}
          title={configured ? '百度地图 Key 已配置，点击修改' : '未配置百度地图 Key，点击设置'}
        >
          <span className="relative flex h-2 w-2">
            <span className={`absolute inline-flex h-full w-full rounded-full ${configured ? 'bg-green-400' : 'bg-red-400'} opacity-75 ${configured ? '' : 'animate-ping'}`} />
            <span className={`relative inline-flex rounded-full h-2 w-2 ${configured ? 'bg-green-500' : 'bg-red-500'}`} />
          </span>
          <span>Key</span>
        </button>

        <AnimatePresence>
          {open && (
            <KeyConfigModal
              keyInput={keyInput}
              setKeyInput={setKeyInput}
              showKey={showKey}
              setShowKey={setShowKey}
              saving={saving}
              configured={configured}
              testResult={testResult}
              onSave={handleSave}
              onClear={handleClear}
              onClose={() => setOpen(false)}
              inputRef={inputRef}
            />
          )}
        </AnimatePresence>
      </>
    );
  }

  // ---- 全宽模式：用于面板顶部 ----
  if (fullWidth) {
    return (
      <div className="space-y-3">
        {configured ? (
          /* ---- 已配置：折叠式状态栏 ---- */
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative overflow-hidden rounded-2xl border p-3.5"
            style={{
              background: 'linear-gradient(135deg, rgba(0,180,42,0.05), rgba(54,211,153,0.03))',
              borderColor: 'rgba(0,180,42,0.2)',
              boxShadow: '0 2px 12px rgba(0,180,42,0.06)',
            }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center shadow-sm"
                  style={{
                    background: 'linear-gradient(135deg, #00B42A, #36D399)',
                    boxShadow: '0 2px 8px rgba(0,180,42,0.25)',
                  }}>
                  <CheckCircle2 size={16} className="text-white" strokeWidth={2.5} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-text-primary">百度地图已就绪</span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded-md font-bold"
                      style={{ background: 'rgba(0,180,42,0.1)', color: '#00B42A' }}>
                      已配置
                    </span>
                  </div>
                  <p className="text-[9px] text-text-muted mt-0.5">地图选点 · 逆地理编码 · GPS 定位</p>
                </div>
              </div>
              <button
                onClick={() => setExpanded(!expanded)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all active:scale-90 hover:bg-white/50"
                style={{ color: '#64748B' }}
              >
                {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                {expanded ? '收起' : '修改'}
              </button>
            </div>

            <AnimatePresence>
              {expanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="pt-3 mt-3 border-t space-y-3"
                    style={{ borderColor: 'rgba(0,180,42,0.1)' }}>
                    <InlineKeyInput
                      keyInput={keyInput}
                      setKeyInput={setKeyInput}
                      showKey={showKey}
                      setShowKey={setShowKey}
                      saving={saving}
                      configured={configured}
                      testResult={testResult}
                      onSave={handleSave}
                      onClear={handleClear}
                      inputRef={inputRef}
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        ) : (
          /* ---- 未配置：突出显示配置引导 ---- */
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative overflow-hidden rounded-2xl border-2 p-5"
            style={{
              background: 'linear-gradient(135deg, rgba(245,63,63,0.04), rgba(251,146,60,0.03), rgba(255,255,255,0.8))',
              borderColor: 'rgba(245,63,63,0.2)',
              boxShadow: '0 4px 20px rgba(245,63,63,0.06)',
            }}
          >
            {/* 装饰性背景元素 */}
            <div className="absolute top-0 right-0 w-32 h-32 rounded-full -mr-12 -mt-12 pointer-events-none opacity-30"
              style={{ background: 'radial-gradient(circle, rgba(245,63,63,0.15), transparent 70%)' }} />
            <div className="absolute bottom-0 left-0 w-24 h-24 rounded-full -ml-8 -mb-8 pointer-events-none opacity-20"
              style={{ background: 'radial-gradient(circle, rgba(251,146,60,0.15), transparent 70%)' }} />

            <div className="relative space-y-4">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg shrink-0"
                  style={{
                    background: 'linear-gradient(135deg, #F53F3F, #FB923C)',
                    boxShadow: '0 4px 16px rgba(245,63,63,0.3)',
                  }}>
                  <KeyRound size={20} className="text-white" strokeWidth={2.5} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="text-sm font-extrabold text-text-primary">配置百度地图 API Key</h4>
                    <span className="text-[9px] px-2 py-0.5 rounded-md font-bold whitespace-nowrap"
                      style={{ background: 'rgba(245,63,63,0.1)', color: '#F53F3F' }}>
                      必填
                    </span>
                  </div>
                  <p className="text-[11px] text-text-muted mt-1 leading-relaxed">
                    地图选点、自动定位、逆地理编码功能需要百度地图 API Key 才能正常使用
                  </p>
                </div>
              </div>

              <InlineKeyInput
                keyInput={keyInput}
                setKeyInput={setKeyInput}
                showKey={showKey}
                setShowKey={setShowKey}
                saving={saving}
                configured={configured}
                testResult={testResult}
                onSave={handleSave}
                onClear={handleClear}
                inputRef={inputRef}
              />
            </div>
          </motion.div>
        )}
      </div>
    );
  }

  // ---- 默认：内联状态指示器 ----
  return (
    <>
      <div className="flex items-center gap-2">
        <button
          onClick={() => { setKeyInput(savedKey); setOpen(true); }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold transition-all duration-200 active:scale-90 hover:scale-105"
          style={{
            background: configured
              ? 'linear-gradient(135deg, rgba(0,180,42,0.1), rgba(54,211,153,0.06))'
              : 'linear-gradient(135deg, rgba(245,63,63,0.1), rgba(251,146,60,0.06))',
            color: configured ? '#00B42A' : '#F53F3F',
          }}
        >
          <span className="relative flex h-2 w-2">
            <span className={`absolute inline-flex h-full w-full rounded-full ${configured ? 'bg-green-400' : 'bg-red-400'} opacity-75 ${configured ? '' : 'animate-ping'}`} />
            <span className={`relative inline-flex rounded-full h-2 w-2 ${configured ? 'bg-green-500' : 'bg-red-500'}`} />
          </span>
          百度地图 {configured ? '已配置' : '未配置'}
        </button>
        {!configured && (
          <span className="text-[10px] text-text-muted hidden sm:inline">地图选点需配置 Key</span>
        )}
      </div>

      <AnimatePresence>
        {open && (
          <KeyConfigModal
            keyInput={keyInput}
            setKeyInput={setKeyInput}
            showKey={showKey}
            setShowKey={setShowKey}
            saving={saving}
            configured={configured}
            testResult={testResult}
            onSave={handleSave}
            onClear={handleClear}
            onClose={() => setOpen(false)}
            inputRef={inputRef}
          />
        )}
      </AnimatePresence>
    </>
  );
};

// ============== 内联 Key 输入表单 ==============
interface InlineKeyInputProps {
  keyInput: string;
  setKeyInput: (v: string) => void;
  showKey: boolean;
  setShowKey: (v: boolean) => void;
  saving: boolean;
  configured: boolean;
  testResult: 'idle' | 'success' | 'error';
  onSave: () => void;
  onClear: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}

const InlineKeyInput: React.FC<InlineKeyInputProps> = ({
  keyInput, setKeyInput, showKey, setShowKey, saving, configured, testResult, onSave, onClear, inputRef,
}) => (
  <div className="space-y-3">
    {/* 输入行 */}
    <div className="relative group">
      <div className="absolute -inset-0.5 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 blur-sm"
        style={{
          background: keyInput.trim()
            ? 'linear-gradient(135deg, #3388ff, #36D399)'
            : 'linear-gradient(135deg, #e2e8f0, #cbd5e1)',
        }}
      />
      <div className="relative flex items-center gap-0">
        <input
          ref={inputRef}
          type={showKey ? 'text' : 'password'}
          value={keyInput}
          onChange={e => setKeyInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && keyInput.trim()) onSave(); }}
          placeholder="输入你的百度地图 API Key（AK）"
          className="flex-1 px-4 py-3.5 text-sm font-mono border rounded-xl outline-none transition-all duration-200 bg-white/90 backdrop-blur"
          style={{
            borderColor: testResult === 'error'
              ? 'rgba(245,63,63,0.5)'
              : testResult === 'success'
                ? 'rgba(0,180,42,0.5)'
                : keyInput.trim()
                  ? 'rgba(51,136,255,0.3)'
                  : 'rgba(226,232,240,0.8)',
            boxShadow: testResult === 'error'
              ? '0 0 0 3px rgba(245,63,63,0.08)'
              : testResult === 'success'
                ? '0 0 0 3px rgba(0,180,42,0.08)'
                : keyInput.trim()
                  ? '0 0 0 3px rgba(51,136,255,0.06)'
                  : 'none',
          }}
          autoFocus
        />
        <button
          onClick={() => setShowKey(!showKey)}
          className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all"
        >
          {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </div>
    </div>

    {/* 状态反馈 */}
    <AnimatePresence>
      {testResult === 'success' && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-[11px] font-bold"
          style={{ background: 'rgba(0,180,42,0.08)', color: '#00B42A' }}>
          <CheckCircle2 size={14} />
          Key 配置成功，地图 SDK 已加载
        </motion.div>
      )}
      {testResult === 'error' && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-[11px] font-bold"
          style={{ background: 'rgba(245,63,63,0.08)', color: '#F53F3F' }}>
          <XCircle size={14} />
          Key 无效或 SDK 加载失败，请检查
        </motion.div>
      )}
    </AnimatePresence>

    {/* 操作按钮 */}
    <div className="flex items-center gap-2.5">
      <a
        href="https://lbsyun.baidu.com/apiconsole/key"
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-[11px] font-bold transition-all active:scale-95 hover:scale-105"
        style={{
          background: 'rgba(51,136,255,0.08)',
          color: '#3388ff',
        }}
      >
        <ExternalLink size={12} />
        申请密钥
      </a>

      <div className="flex-1" />

      {configured && (
        <button
          onClick={onClear}
          className="px-3.5 py-2.5 rounded-xl text-[11px] font-bold transition-all active:scale-90 hover:scale-105"
          style={{ color: '#F53F3F', background: 'rgba(245,63,63,0.08)' }}
        >
          清除
        </button>
      )}

      <button
        onClick={onSave}
        disabled={saving || !keyInput.trim()}
        className="btn-tap-sm relative px-5 py-2.5 rounded-xl text-[11px] font-bold text-white shadow-lg flex items-center gap-2 transition-all duration-200 disabled:opacity-40 disabled:shadow-none"
        style={{
          background: saving
            ? 'linear-gradient(135deg, #64748b, #94a3b8)'
            : 'linear-gradient(135deg, #3388ff, #1a56db)',
          boxShadow: saving ? 'none' : '0 4px 16px rgba(51,136,255,0.3)',
        }}
      >
        {saving ? (
          <><Loader2 size={13} className="animate-spin" />加载中…</>
        ) : (
          <><RefreshCw size={13} />{configured ? '更新并重载' : '保存并加载'}</>
        )}
      </button>
    </div>
  </div>
);

// ============== 弹窗模式（compact 使用） ==============
interface KeyConfigModalProps {
  keyInput: string;
  setKeyInput: (v: string) => void;
  showKey: boolean;
  setShowKey: (v: boolean) => void;
  saving: boolean;
  configured: boolean;
  testResult: 'idle' | 'success' | 'error';
  onSave: () => void;
  onClear: () => void;
  onClose: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}

const KeyConfigModal: React.FC<KeyConfigModalProps> = (props) => {
  const { onClose } = props;
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: -8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: -8 }}
      className="fixed inset-0 z-[300] flex items-center justify-center p-4 sm:p-6"
      style={{
        background: 'rgba(15,23,42,0.5)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
      }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.92 }}
        animate={{ scale: 1 }}
        exit={{ scale: 0.92 }}
        onClick={e => e.stopPropagation()}
        className="relative w-full max-w-md overflow-hidden rounded-3xl border shadow-2xl"
        style={{
          background: 'rgba(255,255,255,0.97)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          borderColor: 'rgba(226,232,240,0.4)',
          boxShadow: '0 24px 80px rgba(0,0,0,0.15)',
        }}
      >
        {/* 装饰头部 */}
        <div className="relative h-2 w-full"
          style={{
            background: 'linear-gradient(90deg, #3388ff, #36D399, #3388ff)',
            backgroundSize: '200% 100%',
          }}
        />

        <div className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl flex items-center justify-center shadow-lg"
              style={{
                background: 'linear-gradient(135deg, #3388ff, #1a56db)',
                boxShadow: '0 4px 12px rgba(51,136,255,0.3)',
              }}>
              <KeyRound size={18} className="text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-extrabold text-text-primary">百度地图 API Key</h3>
              <p className="text-[10px] text-text-muted mt-0.5">配置后可使用地图选点 &amp; 逆地理编码</p>
            </div>
            <button onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 transition-colors"
              style={{ color: '#94A3B8' }}>
              <XCircle size={16} />
            </button>
          </div>

          <InlineKeyInput {...props} />
        </div>
      </motion.div>
    </motion.div>
  );
};

export default BMapKeyConfig;
