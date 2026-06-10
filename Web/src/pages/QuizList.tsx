import { memo, useEffect, useState } from 'react';
import { CheckCircle, XCircle, Clock, Activity, BookOpen, Zap } from 'lucide-react';
import type { ActivityItem } from '../hooks/useQuizMonitor';

interface QuizListProps {
  activities: ActivityItem[];
  config: { course_id?: number };
  selectedCourse: { name?: string; icon?: string; course_id?: number; class_id?: number } | null;
  onShowSettings: () => void;
  onRetry?: (activityId: number, courseId: number, classId: number) => void;
}

function QuizListInner({
  activities,
  config,
  selectedCourse,
  onShowSettings,
  onRetry,
}: QuizListProps) {
  const [showAll, setShowAll] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Sort: active first, then by end_time descending; show at most 5
  const sorted = [...activities]
    .sort((a, b) => {
      const aEnd = a.end_time || 0;
      const bEnd = b.end_time || 0;
      const aStatus = a.status ?? -1;
      const bStatus = b.status ?? -1;
      const aActive = aStatus === 1 || (aEnd > 0 && now < aEnd);
      const bActive = bStatus === 1 || (bEnd > 0 && now < bEnd);
      if (aActive !== bActive) return aActive ? -1 : 1;
      return bEnd - aEnd;
    })
    .slice(0, showAll ? activities.length : 5);

  if (!config.course_id) {
    return (
      <div className="rounded-2xl p-6 text-center border" style={{ background: 'rgba(255,255,255,0.85)', borderColor: 'rgba(226,232,240,0.6)' }}>
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-3" style={{ background: 'rgba(241,245,249,0.8)' }}>
          <BookOpen size={22} className="text-slate-300" />
        </div>
        <p className="text-sm font-semibold text-slate-400">请先在设置中配置课程</p>
        <button onClick={onShowSettings} className="mt-3 text-xs font-semibold px-4 py-2 rounded-xl text-white"
          style={{ background: 'linear-gradient(135deg, #165DFF, #4f39d0)' }}>
          前往设置
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border overflow-hidden"
      style={{
        background: 'rgba(255,255,255,0.85)',
        backdropFilter: 'blur(12px)',
        borderColor: 'rgba(226,232,240,0.6)',
        boxShadow: '0 2px 16px rgba(0,0,0,0.04)',
      }}
    >
      {/* Header */}
      <div className="p-4 flex items-center justify-between border-b" style={{ borderColor: 'rgba(226,232,240,0.5)' }}>
        <div className="flex items-center gap-2.5">
          <div className="w-2.5 h-2.5 rounded-full bg-green-500 shadow-sm shadow-green-300 animate-pulse" />
          <h3 className="font-semibold text-sm text-text-primary">抢答活动</h3>
          {activities.length > 0 && (
            <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{ background: 'rgba(22,93,255,0.08)', color: '#165DFF' }}>
              {showAll ? activities.length : Math.min(activities.length, 5)}/{activities.length}
            </span>
          )}
        </div>
        <span className="text-[10px] font-medium text-text-muted">自动检测中</span>
      </div>

      {/* Content */}
      <div className="max-h-[65%] overflow-y-auto custom-scrollbar">
        {/* Course info */}
        <div className="mx-3 mt-3 p-3 flex items-center gap-2.5 rounded-xl border" style={{ background: 'rgba(248,250,252,0.8)', borderColor: 'rgba(226,232,240,0.4)' }}>
          <div className="w-8 h-8 rounded-xl flex items-center justify-center overflow-hidden" style={{ background: 'linear-gradient(135deg, #eff4ff, #dbe8fe)' }}>
            {selectedCourse?.icon ? (
              <img src={selectedCourse.icon} referrerPolicy="no-referrer" alt=""
                className="w-full h-full object-cover"
                onError={e => {
                  const target = e.target as HTMLImageElement;
                  if (!target.dataset.fallback) {
                    target.dataset.fallback = '1';
                    target.src = `/api/courses/icon?course_id=${selectedCourse.course_id}&class_id=${selectedCourse.class_id}`;
                  }
                }}
              />
            ) : (
              <BookOpen className="w-3.5 h-3.5 text-brand-600" />
            )}
          </div>
          <p className="flex-1 text-sm font-semibold text-text-primary truncate">
            {selectedCourse?.name || '未选择课程'}
          </p>
          <button onClick={onShowSettings} className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg" style={{ color: '#165DFF', background: 'rgba(22,93,255,0.08)' }}>
            切换
          </button>
        </div>

        {/* 展开/收起 */}
        {!showAll && sorted.length > 5 && (
          <button onClick={() => setShowAll(true)}
            className="w-full py-2.5 text-xs font-semibold transition-all hover:bg-slate-50/80"
            style={{ color: '#165DFF', borderTop: '1px solid rgba(226,232,240,0.4)', borderBottom: '1px solid rgba(226,232,240,0.2)' }}>
            展开全部 ({activities.length})
          </button>
        )}
        {/* Empty state */}
        
        {activities.length === 0 ? (
          <div className="py-16 flex flex-col items-center">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4 border" style={{ background: 'rgba(241,245,249,0.8)', borderColor: 'rgba(226,232,240,0.4)' }}>
              <Activity size={28} className="text-slate-300" />
            </div>
            <p className="text-sm font-semibold text-slate-300">暂无抢答活动</p>
            <div className="flex items-center gap-2 mt-2">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              <p className="text-xs text-slate-400">点击上方按钮一键抢答</p>
            </div>
          </div>
        ) : (
          sorted.map((act) => {
            const actId = String(act.activity_id || act.id || '');
            const ansStatus = act._answerStatus;
            const isPending = ansStatus === 'pending';
            const isSuccess = ansStatus === 'success';
            const isFailed = ansStatus === 'failed';
            const isAnswered = isSuccess || isFailed;

            const endTime = act.end_time || 0;
            const actStatus = act.status ?? -1;
            const isExpired = actStatus === 2 || (endTime > 0 && now >= endTime);
            const isActive = !isExpired && actStatus === 1;
            const isWaiting = !isExpired && actStatus === 0;

            const statusColor = isPending ? '#FF7D00' : isSuccess ? '#00B42A' : isFailed ? '#F53F3F' : isActive ? '#165DFF' : isWaiting ? '#94A3B8' : '#94A3B8';

            return (
              <div key={actId} className={`px-4 py-3.5 flex items-center gap-3 border-b last:border-0 transition-all ${isPending ? 'bg-gradient-to-r from-amber-50/80 to-transparent' : isSuccess ? 'bg-gradient-to-r from-emerald-50/50 to-transparent' : isFailed ? 'bg-gradient-to-r from-rose-50/50 to-transparent' : isExpired ? 'opacity-50' : ''}`} style={{ borderColor: 'rgba(226,232,240,0.4)' }}>
                {/* Dot */}
                <div className="w-2.5 h-2.5 rounded-full ring-2 ring-white shadow-sm" style={{ backgroundColor: statusColor, animation: isPending || (isActive && !isAnswered && !isExpired) ? 'pulse-glow 2s infinite' : undefined }} />

                {/* Icon */}
                <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm" style={{ background: isPending ? 'rgba(255,125,0,0.1)' : isSuccess ? 'rgba(0,180,42,0.1)' : isFailed ? 'rgba(245,63,63,0.1)' : isActive ? 'rgba(22,93,255,0.08)' : 'rgba(148,163,184,0.1)', border: `1.5px solid ${isPending ? 'rgba(255,125,0,0.3)' : isSuccess ? 'rgba(0,180,42,0.3)' : isFailed ? 'rgba(245,63,63,0.3)' : isActive ? 'rgba(22,93,255,0.2)' : 'rgba(148,163,184,0.15)'}` }}>
                  {isSuccess ? <CheckCircle className="w-4.5 h-4.5 text-success-500" /> : isFailed ? <XCircle className="w-4.5 h-4.5 text-error-500" /> : isActive ? <Zap className="w-4.5 h-4.5 text-brand-500" /> : <Clock className="w-4 h-4 text-slate-400" />}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="font-semibold text-sm text-text-primary truncate">{act.title || '抢答'}</p>
                    {act.start_time ? <span className="text-[10px] text-text-muted font-mono">{new Date(act.start_time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span> : null}
                    {isAnswered && act._elapsed !== undefined && (
                      <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-md" style={{ background: 'rgba(22,93,255,0.08)', color: '#165DFF' }}>{act._elapsed}ms</span>
                    )}
                    {isPending && <span className="text-[10px] px-1.5 py-0.5 rounded-md font-bold animate-pulse" style={{ background: 'rgba(255,125,0,0.15)', color: '#c2410c' }}>⏳ 抢答中</span>}
                    {isSuccess && <span className="text-[10px] px-1.5 py-0.5 rounded-md font-bold" style={{ background: 'rgba(0,180,42,0.15)', color: '#15803d' }}>✅ 成功</span>}
                    {isFailed && (
  <div className="flex items-center gap-1.5">
    <span className="text-[10px] px-1.5 py-0.5 rounded-md font-bold" style={{ background: 'rgba(245,63,63,0.12)', color: '#dc2626' }}>❌ 失败</span>
    {onRetry && act.course_id && (
      <button onClick={(e) => { e.stopPropagation(); onRetry(Number(act.activity_id || act.id), act.course_id!, act.class_id || 0); }}
        className="text-[10px] px-2 py-0.5 rounded-md font-bold transition-all active:scale-90"
        style={{ background: 'rgba(22,93,255,0.1)', color: '#165DFF' }}>
        重试
      </button>
    )}
  </div>
)}
                    {isWaiting && <span className="text-[10px] px-1.5 py-0.5 rounded-md font-bold animate-pulse" style={{ background: 'rgba(148,163,184,0.12)', color: '#64748b' }}>⏳ 待开始</span>}
                    {!isAnswered && isExpired && <span className="text-[10px] px-1.5 py-0.5 rounded-md font-bold bg-slate-100 text-slate-500">已结束</span>}
                  </div>
                  <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                    {act.course_name && <span className="text-[10px] text-text-muted font-medium">📚 {act.course_name}</span>}
                    {isActive && !isAnswered && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-md font-bold" style={{ background: endTime > 0 ? 'rgba(255,125,0,0.12)' : 'rgba(22,93,255,0.12)', color: endTime > 0 ? '#c2410c' : '#165DFF' }}>
                        {endTime > 0 ? `⏳ ${formatCountdown(endTime, now)}` : '⏳ 进行中'}
                      </span>
                    )}
                    {act._answerMsg && isFailed && <span className="text-[10px] truncate max-w-[160px]" style={{ color: '#dc2626', opacity: 0.8 }}>{act._answerMsg}</span>}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function formatCountdown(endTime: number, now: number): string {
  const diff = Math.max(0, endTime - now);
  const m = Math.floor(diff / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export const QuizList = memo(QuizListInner);
