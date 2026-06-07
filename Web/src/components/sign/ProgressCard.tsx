import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { SignStatusMessage } from '../../types';

interface ProgressCardProps {
  name: string;
  avatar?: string;
  mobile: string;
  isHost?: boolean;
  statusObj?: Partial<SignStatusMessage>;
}

export const ProgressCard: React.FC<ProgressCardProps> = ({
  name,
  avatar,
  mobile,
  isHost = false,
  statusObj
}) => {
  const status = statusObj?.status || 'pending';
  const message = statusObj?.message || '等待中...';

  const theme = {
    pending: { bg: "rgba(248,250,252,0.5)", border: "rgba(226,232,240,0.4)", text: "#94a3b8" },
    signing: { bg: "rgba(239,244,255,0.5)", border: "rgba(147,187,253,0.3)", text: "#165DFF" },
    retrying: { bg: "rgba(255,251,235,0.5)", border: "rgba(253,230,138,0.3)", text: "#d97706" },
    success: { bg: "rgba(236,253,245,0.5)", border: "rgba(110,231,183,0.3)", text: "#059669" },
    failed: { bg: "rgba(255,241,242,0.5)", border: "rgba(254,205,211,0.3)", text: "#e11d48" }
  }[status];

  const tagText = {
    pending: "等待中",
    signing: "签到中",
    retrying: `重试中(${statusObj?.attempt || 0})`,
    success: "成功",
    failed: "失败"
  }[status];

  return (
    <motion.div
      layout
      animate={{
        backgroundColor: theme.bg,
        borderColor: theme.border,
      }}
      transition={{ duration: 0.3 }}
      className="relative overflow-hidden p-3 px-4 rounded-2xl border mb-3"
      style={{
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
      }}
    >
      <div className="relative z-10 flex items-center space-x-3">
        <div className="w-12 h-12 rounded-xl overflow-hidden shrink-0 shadow-sm"
          style={{
            border: '2px solid rgba(255,255,255,0.9)',
            background: 'linear-gradient(135deg, #f1f5f9, #e2e8f0)',
          }}>
          {avatar ? (
            <img src={avatar} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-slate-300 font-bold text-lg">{name[0]}</div>
          )}
        </div>

        <div className="flex-1 min-w-0 flex flex-col justify-center space-y-1">
          <div className="flex items-center justify-between">
            <div className="font-bold text-text-primary text-base truncate leading-tight flex items-center">
              {name}
              {isHost && <span className="text-[10px] text-text-muted font-bold ml-1.5 uppercase tracking-tighter">(我)</span>}
            </div>

            <div className="shrink-0 ml-2">
              <AnimatePresence initial={false} mode="wait">
                <motion.div
                  key={tagText}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="text-[12px] font-extrabold px-1.5 py-0 rounded-md border whitespace-nowrap leading-normal"
                  style={{
                    background: 'rgba(255,255,255,0.85)',
                    borderColor: theme.text + '40',
                    color: theme.text,
                  }}
                >
                  {tagText}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>

          <div className="flex items-center justify-between mt-auto">
            <div className="text-[10px] text-text-muted font-mono font-bold tracking-tighter opacity-70">
              {mobile}
            </div>

            <div className="shrink-0 ml-4 max-w-[60%] text-right overflow-hidden">
              <AnimatePresence initial={false} mode="wait">
                <motion.div
                  key={message}
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  className="text-[10px] font-extrabold opacity-85 truncate tracking-tight"
                  style={{ color: theme.text }}
                  title={message}
                >
                  {message}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
};
