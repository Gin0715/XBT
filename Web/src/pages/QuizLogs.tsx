import { memo, useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap, Download, Trash2, Clock, CheckCircle, XCircle, AlertTriangle, Loader2 } from 'lucide-react';
import { getQuizLogs, clearQuizLogs } from '../api/quiz';
import type { QuizLogItem } from '../api/quiz';

interface QuizLogViewProps {
  visible: boolean;
}

function QuizLogViewInner({ visible }: QuizLogViewProps) {
  const [logs, setLogs] = useState<QuizLogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getQuizLogs();
      const data = (res.data as any)?.data;
      if (Array.isArray(data)) {
        setLogs(data);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) fetchLogs();
  }, [visible, fetchLogs]);

  const handleClear = async () => {
    if (!window.confirm('确定清空所有抢答日志？')) return;
    try {
      await clearQuizLogs();
      setLogs([]);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleExport = () => {
    const header = '时间,类型,状态,活动名称,消息,耗时(ms)\n';
    const rows = logs.map(l =>
      `${l.created_at},${l.type},${l.status},${l.activity_name || ''},${l.message || ''},${l.elapsed_ms || 0}`
    ).join('\n');
    const blob = new Blob(['﻿' + header + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `quiz-logs-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success': return <CheckCircle className="w-3.5 h-3.5 text-green-500" />;
      case 'failed': return <XCircle className="w-3.5 h-3.5 text-red-500" />;
      case 'pending': return <Clock className="w-3.5 h-3.5 text-orange-500" />;
      default: return <AlertTriangle className="w-3.5 h-3.5 text-slate-400" />;
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'answer': return '抢答';
      case 'detect': return '检测';
      case 'warning': return '警告';
      case 'retry': return '重试';
      default: return type;
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'success': return '成功';
      case 'failed': return '失败';
      case 'pending': return '进行中';
      default: return status;
    }
  };

  if (!visible) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border overflow-hidden"
        style={{
          background: 'rgba(255,255,255,0.85)',
          backdropFilter: 'blur(12px)',
          borderColor: 'rgba(226,232,240,0.6)',
          boxShadow: '0 2px 16px rgba(0,0,0,0.04)',
        }}
      >
        {/* Header */}
        <div className="p-4 border-b flex items-center justify-between" style={{ borderColor: 'rgba(226,232,240,0.5)' }}>
          <h3 className="font-semibold text-sm text-text-primary flex items-center gap-2">
            <Zap className="w-4 h-4" style={{ color: '#FF7D00' }} />
            抢答日志
            {logs.length > 0 && (
              <span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{ background: 'rgba(255,125,0,0.1)', color: '#c2410c' }}>
                {logs.length}
              </span>
            )}
          </h3>
          <div className="flex items-center gap-2">
            {loading && <Loader2 className="w-4 h-4 animate-spin" style={{ color: '#165DFF' }} />}
            <button onClick={handleExport}
              className="text-[11px] font-semibold flex items-center gap-1 px-2.5 py-1.5 rounded-lg transition-all duration-200"
              style={{ color: '#165DFF', background: 'rgba(22,93,255,0.08)' }}
              title="导出日志CSV">
              <Download className="w-3 h-3" />
              导出
            </button>
            {logs.length > 0 && (
              <button onClick={handleClear}
                className="text-[11px] font-semibold flex items-center gap-1 px-2.5 py-1.5 rounded-lg transition-all duration-200"
                style={{ color: '#F53F3F', background: 'rgba(245,63,63,0.08)' }}
                title="清空日志">
                <Trash2 className="w-3 h-3" />
                清空
              </button>
            )}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mx-4 mt-3 p-2 rounded-lg text-xs font-medium" style={{ background: 'rgba(254,242,242,0.9)', color: '#991b1b' }}>
            {error}
            <button onClick={() => setError(null)} className="float-right font-bold">×</button>
          </div>
        )}

        {/* Content */}
        <div className="max-h-96 overflow-y-auto custom-scrollbar">
          {logs.length === 0 ? (
            <div className="py-16 flex flex-col items-center">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4 border" style={{ background: 'rgba(241,245,249,0.8)', borderColor: 'rgba(226,232,240,0.4)' }}>
                <Clock size={28} className="text-slate-300" />
              </div>
              <p className="text-sm font-semibold text-slate-300">暂无日志</p>
              <p className="text-xs text-slate-400 mt-1">点击一键抢答后，日志将自动记录在这里</p>
            </div>
          ) : (
            logs.map((log, idx) => (
              <div key={log.id || idx}
                className="px-4 py-3 flex items-start gap-3 border-b last:border-0 transition-colors hover:bg-slate-50/50"
                style={{ borderColor: 'rgba(226,232,240,0.3)' }}>
                {/* Timeline dot */}
                <div className="relative mt-0.5">
                  {getStatusIcon(log.status)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md"
                      style={{
                        background: log.type === 'answer' ? 'rgba(22,93,255,0.1)' : log.type === 'detect' ? 'rgba(255,125,0,0.1)' : 'rgba(148,163,184,0.1)',
                        color: log.type === 'answer' ? '#165DFF' : log.type === 'detect' ? '#c2410c' : '#64748b',
                      }}>
                      {getTypeLabel(log.type)}
                    </span>
                    <span className="text-sm font-semibold text-text-primary">
                      {log.activity_name || `活动 #${log.activity_id}`}
                    </span>
                    {log.elapsed_ms > 0 && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md" style={{ background: 'rgba(22,93,255,0.08)', color: '#165DFF' }}>
                        {log.elapsed_ms}ms
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="text-[10px] font-medium" style={{
                      color: log.status === 'success' ? '#15803d' : log.status === 'failed' ? '#dc2626' : '#c2410c',
                    }}>
                      {getStatusLabel(log.status)}
                    </span>
                    <span className="text-[10px] text-text-muted">
                      {log.created_at ? new Date(log.created_at).toLocaleString('zh-CN') : ''}
                    </span>
                  </div>
                  {log.message && (
                    <p className="text-[11px] text-text-muted mt-0.5 truncate max-w-[300px]">
                      {log.message}
                    </p>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}


// ================= 实时抢答日志（活动 Tab 内嵌） =================

interface RealTimeLogProps {
  answerLogs: Array<{
    id: string;
    time: string;
    activityName: string;
    activeId: string;
    status: 'success' | 'failed' | 'pending';
    message: string;
  }>;
  onExport: () => void;
}

function RealTimeLogInner({ answerLogs, onExport }: RealTimeLogProps) {
  return (
    <AnimatePresence>
      {answerLogs.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border overflow-hidden"
          style={{
            background: 'rgba(255,255,255,0.85)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            borderColor: 'rgba(226,232,240,0.6)',
            boxShadow: '0 2px 16px rgba(0,0,0,0.04)',
          }}
        >
          <div
            className="p-4 border-b flex items-center justify-between"
            style={{ borderColor: 'rgba(226,232,240,0.5)', background: 'linear-gradient(180deg, rgba(248,250,252,0.5), transparent)' }}
          >
            <h3 className="font-semibold text-sm text-text-primary flex items-center gap-2">
              <Zap className="w-4 h-4" style={{ color: '#FF7D00' }} />
              实时日志
              <span
                className="text-[10px] px-2 py-0.5 rounded-full font-bold"
                style={{ background: 'rgba(255,125,0,0.1)', color: '#c2410c' }}
              >
                {answerLogs.length}
              </span>
            </h3>
            <button
              onClick={onExport}
              className="text-[11px] font-semibold flex items-center gap-1 px-2.5 py-1.5 rounded-lg transition-all duration-200 hover:scale-105 active:scale-95"
              style={{ color: '#165DFF', background: 'rgba(22,93,255,0.08)' }}
              title="导出日志"
            >
              <Download className="w-3 h-3" />
              导出
            </button>
          </div>
          <div className="max-h-48 overflow-y-auto custom-scrollbar">
            {answerLogs.map((log, idx) => (
              <div
                key={log.id || `${log.activeId}-${idx}`}
                className="px-4 py-3 flex items-start gap-3 border-b last:border-0 transition-colors hover:bg-slate-50/50"
                style={{ borderColor: 'rgba(226,232,240,0.3)' }}
              >
                <div className="relative mt-0.5 timeline-dot">
                  <div
                    className="w-3 h-3 rounded-full ring-2 ring-white shadow-sm"
                    style={{
                      backgroundColor:
                        log.status === 'pending'
                          ? '#FF7D00'
                          : log.status === 'success'
                            ? '#00B42A'
                            : '#F53F3F',
                    }}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-semibold text-text-primary">{log.activityName}</p>
                    {log.status === 'pending' && (
                      <span className="text-[10px] font-bold animate-pulse flex items-center gap-0.5" style={{ color: '#FF7D00' }}>
                        抢答中...
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-text-muted mt-0.5">
                    {log.time} · {log.message}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export const QuizLogs = memo(RealTimeLogInner);

export const QuizLogView = memo(QuizLogViewInner);
