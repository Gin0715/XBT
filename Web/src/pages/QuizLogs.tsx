import { memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap, Download } from 'lucide-react';
import type { AnswerLog } from '../hooks/useQuizMonitor';

interface QuizLogsProps {
  answerLogs: AnswerLog[];
  onExport: () => void;
}

function QuizLogsInner({ answerLogs, onExport }: QuizLogsProps) {
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
                {/* Timeline dot */}
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

export const QuizLogs = memo(QuizLogsInner);
