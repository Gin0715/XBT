import { memo, useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Loader2, CheckCircle, BookOpen, Save, RefreshCw } from 'lucide-react';
import type { QuizConfig } from '../hooks/useQuizMonitor';

interface CoursePair {
  course_id: number;
  class_id: number;
}

interface QuizControlsProps {
  config: QuizConfig;
  courses: any[];
  selectedCourse: any | null;
  loading: Record<string, boolean>;
  saveSuccess: boolean;
  onConfigChange: (cfg: Partial<QuizConfig>) => void;
  onCourseSelect: (course: any) => void;
  onSave: () => void;
  onSyncCourses?: () => Promise<any>;
}

function parseCourseIDs(jsonStr: string): CoursePair[] {
  if (!jsonStr) return [];
  try {
    const parsed = JSON.parse(jsonStr);
    if (Array.isArray(parsed)) return parsed;
  } catch { /* ignore */ }
  return [];
}

function QuizControlsInner({
  config,
  courses,
  selectedCourse: _unused,
  loading,
  saveSuccess,
  onConfigChange,
  onCourseSelect: _onCourseSelect,
  onSave,
  onSyncCourses,
}: QuizControlsProps) {
  // 本地多选状态：从 config.course_ids 初始化
  const [selectedIds, setSelectedIds] = useState<CoursePair[]>(() => {
    const fromIDs = parseCourseIDs(config.course_ids || '');
    if (fromIDs.length > 0) return fromIDs;
    // 降级到旧的单课程模式
    if (config.course_id && config.class_id) {
      return [{ course_id: config.course_id, class_id: config.class_id }];
    }
    return [];
  });

  // 当外部 config 变化时同步本地状态
  useEffect(() => {
    const fromIDs = parseCourseIDs(config.course_ids || '');
    if (fromIDs.length > 0) {
      setSelectedIds(fromIDs);
    } else if (config.course_id && config.class_id) {
      setSelectedIds([{ course_id: config.course_id, class_id: config.class_id }]);
    }
  }, [config.course_ids, config.course_id, config.class_id]);

  const isSelected = (courseId: number, classId: number): boolean => {
    return selectedIds.some(s => s.course_id === courseId && s.class_id === classId);
  };

  const handleToggle = (course: any) => {
    const cid = course.course_id || course.id || 0;
    const clid = course.class_id || 0;

    let newSelected: CoursePair[];
    if (isSelected(cid, clid)) {
      // 已选中 → 取消选择
      newSelected = selectedIds.filter(s => !(s.course_id === cid && s.class_id === clid));
    } else {
      // 未选中 → 添加
      newSelected = [...selectedIds, { course_id: cid, class_id: clid }];
    }

    setSelectedIds(newSelected);

    // 同步到 config（用于保存）
    if (newSelected.length > 0) {
      const courseIDsStr = JSON.stringify(newSelected);
      onConfigChange({
        course_ids: courseIDsStr,
        course_id: newSelected[0].course_id,
        class_id: newSelected[0].class_id,
      });
    } else {
      // 全部取消 → 设为空数组，表示检测所有课程
      onConfigChange({
        course_ids: '[]',
        course_id: 0,
        class_id: 0,
      });
    }
  };

  // 选择全部课程
  const handleSelectAll = () => {
    if (selectedIds.length === courses.length) {
      // 已全选 → 全部取消
      setSelectedIds([]);
      onConfigChange({ course_ids: '[]', course_id: 0, class_id: 0 });
    } else {
      // 全选
      const all = courses.map((c: any) => ({
        course_id: c.course_id || c.id || 0,
        class_id: c.class_id || 0,
      }));
      setSelectedIds(all);
      const courseIDsStr = JSON.stringify(all);
      onConfigChange({
        course_ids: courseIDsStr,
        course_id: all[0].course_id,
        class_id: all[0].class_id,
      });
    }
  };

  return (
    <>
      {/* Course selection */}
      <div className="rounded-2xl border overflow-hidden"
        style={{ background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(12px)', borderColor: 'rgba(226,232,240,0.6)', boxShadow: '0 2px 16px rgba(0,0,0,0.04)' }}
      >
        <div className="p-4 border-b flex items-center gap-3" style={{ borderColor: 'rgba(226,232,240,0.5)' }}>
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #f3e8ff, #e9d5ff)' }}>
            <BookOpen className="w-4 h-4 text-info-500" />
          </div>
          <div>
            <h3 className="font-semibold text-sm text-text-primary">监控课程</h3>
            <p className="text-[10px] text-text-muted">
              {selectedIds.length === 0
                ? '未选择任何课程（将自动检测全部课程）'
                : `已选择 ${selectedIds.length} 门课程`}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {loading.syncCourses && <Loader2 className="w-4 h-4 animate-spin" style={{ color: '#722ED1' }} />}
            {onSyncCourses && (
              <button onClick={onSyncCourses} disabled={loading.syncCourses}
                className="btn-tap-sm text-[11px] font-semibold flex items-center gap-1 px-2.5 py-1.5 rounded-lg transition-all disabled:opacity-50"
                style={{ color: '#722ED1', background: 'rgba(114,46,209,0.08)' }}
                title="从超星同步最新课程"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading.syncCourses ? 'animate-spin' : ''}`} />
                同步
              </button>
            )}
            {loading.courses && <Loader2 className="w-4 h-4 animate-spin" style={{ color: '#722ED1' }} />}
          </div>
        </div>

        <div className="max-h-72 overflow-y-auto custom-scrollbar">
          {courses.length === 0 ? (
            <div className="py-12 text-center text-text-muted">
              {loading.courses ? (
                <><Loader2 className="w-6 h-6 mx-auto animate-spin mb-2" /><p className="text-xs">加载中</p></>
              ) : (
                <div>
                  <p className="text-sm mb-3">暂无课程，请同步课程</p>
                  {onSyncCourses && (
                    <button onClick={onSyncCourses} disabled={loading.syncCourses}
                      className="btn-tap text-xs font-semibold px-4 py-2 rounded-xl text-white transition-all disabled:opacity-50"
                      style={{ background: 'linear-gradient(135deg, #722ED1, #165DFF)' }}
                    >
                      {loading.syncCourses ? <><Loader2 className="w-3 h-3 inline animate-spin mr-1" />同步中...</> : <><RefreshCw className="w-3 h-3 inline mr-1" />一键同步课程</>}
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <>
              {/* 全选/取消按钮 */}
              <div className="px-3 pt-2 pb-1 flex justify-between items-center border-b" style={{ borderColor: 'rgba(226,232,240,0.3)' }}>
                <span className="text-[10px] font-medium text-text-muted">点击课程多选，再次点击取消</span>
                <button onClick={handleSelectAll}
                  className="text-[10px] font-semibold px-2 py-1 rounded-lg transition-all"
                  style={{ color: '#165DFF', background: 'rgba(22,93,255,0.08)' }}>
                  {selectedIds.length === courses.length ? '取消全选' : '全选'}
                </button>
              </div>
              <div className="p-3 space-y-2">
                {courses.map((course: any) => {
                  const cid = course.course_id || course.id;
                  const clid = course.class_id || 0;
                  const sel = isSelected(cid, clid);
                  return (
                    <div key={`${cid}-${clid}`}
                      onClick={() => handleToggle(course)}
                      className={`btn-tap-sm p-3 rounded-2xl cursor-pointer flex items-center gap-3 transition-all duration-200 ${
                        sel ? 'border-2 shadow-sm' : 'border-2 border-transparent hover:bg-white hover:border-slate-100'
                      }`}
                      style={sel ? { background: 'rgba(22,93,255,0.05)', borderColor: 'rgba(22,93,255,0.3)' } : { background: 'rgba(248,250,252,0.5)' }}
                    >
                      <div className="w-11 h-11 rounded-xl shadow-sm overflow-hidden flex-shrink-0 flex items-center justify-center border border-slate-100" style={{ background: 'linear-gradient(135deg, #f1f5f9, #e2e8f0)' }}>
                        {course.icon ? (
                          <img src={course.icon} referrerPolicy="no-referrer" alt=""
                            className="w-full h-full object-cover"
                            onError={e => {
                              const target = e.target as HTMLImageElement;
                              if (!target.dataset.fallback) {
                                target.dataset.fallback = '1';
                                target.src = `/api/courses/icon?course_id=${course.course_id}&class_id=${course.class_id}`;
                              }
                            }}
                          />
                        ) : (
                          <BookOpen className="w-5 h-5 text-slate-300" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm text-text-primary truncate">{course.name}</p>
                        <p className="text-[11px] text-text-muted truncate">{course.teacher || ''}</p>
                      </div>
                      {/* Checkbox indicator */}
                      <div className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 transition-all ${
                        sel ? 'text-white' : 'border-2 border-slate-200'
                      }`}
                        style={sel ? { background: 'linear-gradient(135deg, #165DFF, #4f39d0)' } : {}}>
                        {sel && (
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Settings: delay */}
      <div className="rounded-2xl border overflow-hidden"
        style={{ background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(12px)', borderColor: 'rgba(226,232,240,0.6)', boxShadow: '0 2px 16px rgba(0,0,0,0.04)' }}
      >
        <div className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="font-semibold text-sm text-text-primary">抢答延迟</p>
              <p className="text-[11px] text-text-muted mt-0.5">毫秒，避开风控检测</p>
            </div>
            <div className="flex items-center gap-1.5">
              <input type="number" min="0" max="5000" step="1" value={config.delay_ms || 0}
                onChange={e => { const v = Math.max(0, Math.min(5000, Number(e.target.value) || 0)); onConfigChange({ delay_ms: v }); }}
                className="w-16 h-8 text-sm font-semibold text-text-primary text-center rounded-lg outline-none tabular-nums input-glass"
                style={{ background: 'rgba(248,250,252,0.8)', border: '1px solid rgba(226,232,240,0.8)' }} />
              <span className="text-xs font-semibold text-text-muted">ms</span>
            </div>
          </div>
          <input type="range" min="0" max="2000" step="10"
            value={Math.min(config.delay_ms || 0, 2000)}
            onChange={e => onConfigChange({ delay_ms: Number(e.target.value) })}
            className="quiz-delay-slider w-full" />
          <div className="flex justify-between mt-1.5">
            <span className="text-[9px] font-medium text-text-muted">0</span>
            <span className="text-[9px] font-medium text-text-muted">500</span>
            <span className="text-[9px] font-medium text-text-muted">1000</span>
            <span className="text-[9px] font-medium text-text-muted">1500</span>
            <span className="text-[9px] font-medium text-text-muted">2000</span>
          </div>
        </div>

        <div className="px-4 pb-4">
          <button onClick={onSave} disabled={loading.save}
            className="btn-tap w-full py-3 rounded-2xl font-semibold text-sm flex items-center justify-center gap-2 text-white transition-all disabled:opacity-50 shadow-lg"
            style={{ background: 'linear-gradient(135deg, #165DFF, #4f39d0)', boxShadow: '0 4px 16px rgba(22,93,255,0.3)' }}
          >
            {loading.save ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            保存配置
            {saveSuccess && <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }}><CheckCircle className="w-4 h-4" /></motion.span>}
          </button>
        </div>
      </div>

      <style>{`
        .quiz-delay-slider {
          -webkit-appearance: none; appearance: none;
          height: 6px; border-radius: 3px;
          background: linear-gradient(to right, #165DFF 0%, #165DFF ${Math.min((config.delay_ms || 0) / 2000 * 100, 100)}%, #e2e8f0 ${Math.min((config.delay_ms || 0) / 2000 * 100, 100)}%, #e2e8f0 100%);
          outline: none; cursor: pointer;
        }
        .quiz-delay-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 20px; height: 20px;
          border-radius: 50%; background: #fff;
          border: 2px solid #165DFF;
          box-shadow: 0 2px 6px rgba(22,93,255,0.3);
          cursor: pointer;
        }
      `}</style>
    </>
  );
}

export const QuizControls = memo(QuizControlsInner);
