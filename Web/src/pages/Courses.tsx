import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, RefreshCw, Check, Loader2, Book } from 'lucide-react';
import toast from 'react-hot-toast';
import client from '../api/client';
import type { ApiResponse, Course } from '../types';
import PullToRefresh from '../components/PullToRefresh';
import { Button } from '../components/ui/Button';
import { GlassPanel } from '../components/ui/GlassPanel';

const Courses = () => {
  const navigate = useNavigate();
  const [courses, setCourses] = useState<Course[]>([]);
  const [initialCourses, setInitialCourses] = useState<Course[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [hasAttemptedSync, setHasAttemptedSync] = useState(false);
  const [showExitConfirm, setShowExitConfirm] = useState(false);

  const isDirty = JSON.stringify(courses.map(c => c.is_selected)) !== JSON.stringify(initialCourses.map(c => c.is_selected));

  const fetchCourses = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await client.get<ApiResponse<Course[]>>('/courses');
      const data = response.data.data || [];
      setCourses(data);
      setInitialCourses(JSON.parse(JSON.stringify(data)));
    } catch (error: any) {
      toast.error(error.message || '获取课程失败');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCourses();
  }, []);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  const handleBack = () => {
    if (isDirty) {
      setShowExitConfirm(true);
    } else {
      navigate(-1);
    }
  };

  useEffect(() => {
    if (!isLoading && courses && courses.length === 0 && !hasAttemptedSync && !isSyncing) {
      setHasAttemptedSync(true);
      handleSync();
    }
  }, [isLoading, courses, hasAttemptedSync, isSyncing]);

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      await client.post('/courses/sync');
      toast.success('同步成功');
      fetchCourses();
    } catch (error: any) {
      toast.error(error.message || '同步失败');
    } finally {
      setIsSyncing(false);
    }
  };

  const toggleSelection = (classId: number) => {
    setCourses(prev => (prev || []).map(c =>
      c.class_id === classId ? { ...c, is_selected: !c.is_selected } : c
    ));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const selectedIds = (courses || [])
        .filter(c => c.is_selected)
        .map(c => c.course_id);

      await client.put('/courses/selection', { course_ids: selectedIds });
      toast.success('设置已保存');
      setInitialCourses(JSON.parse(JSON.stringify(courses)));
      navigate('/');
    } catch (error: any) {
      toast.error(error.message || '保存失败');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-transparent relative overflow-hidden">
      {/* Header */}
      <GlassPanel className="page-header-sticky flex items-center justify-between shrink-0 px-4"
        style={{
          height: 'calc(80px + var(--sat))',
          paddingTop: 'var(--sat)',
        }}>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleBack}
          className="p-2 -ml-2 text-slate-600"
        >
          <ChevronLeft size={24} />
        </Button>
        <h2 className="font-bold text-text-primary text-lg">我的课程</h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleSync}
          disabled={isSyncing}
          className="p-2 -mr-2 text-[#165DFF]"
        >
          <RefreshCw size={20} className={isSyncing ? 'animate-smooth-spin' : ''} />
        </Button>
      </GlassPanel>

      <PullToRefresh
        onRefresh={fetchCourses}
        isRefreshing={isLoading}
        className="p-4"
      >
        <div className="space-y-3 pb-[calc(100px+var(--sab))]">
          <p className="text-sm text-text-secondary px-1 mb-4 font-medium">
            选择你想要进行签到监控的课程。只有勾选的课程才会出现在首页活动列表中。
          </p>

          {isLoading && courses.length === 0 ? (
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className="h-20 rounded-2xl animate-shimmer" />
              ))}
            </div>
          ) : (
            (courses || []).map((course) => (
              <div
                key={course.class_id}
                onClick={() => toggleSelection(course.class_id)}
                className={`btn-tap-sm p-4 rounded-[28px] border cursor-pointer flex items-center space-x-4 transition-all duration-200 ${
                  course.is_selected
                    ? 'shadow-md'
                    : 'shadow-sm hover:border-slate-200'
                }`}
                style={course.is_selected ? {
                  background: 'rgba(22,93,255,0.06)',
                  borderColor: 'rgba(22,93,255,0.25)',
                  boxShadow: '0 2px 12px rgba(22,93,255,0.08)',
                } : {
                  background: 'rgba(255,255,255,0.85)',
                  borderColor: 'rgba(226,232,240,0.4)',
                }}
              >
                <div className="relative w-12 h-12 flex-shrink-0">
                  {course.icon ? (
                    <img src={course.icon} alt={course.name} referrerPolicy="no-referrer" className="w-full h-full rounded-xl object-cover" />
                  ) : (
                    <div className="w-full h-full rounded-xl flex items-center justify-center"
                      style={{
                        background: 'linear-gradient(135deg, #f1f5f9, #e2e8f0)',
                        border: '1px solid rgba(226,232,240,0.5)',
                      }}>
                      <Book size={20} className="text-slate-300" />
                    </div>
                  )}
                  <AnimatePresence>
                    {course.is_selected && (
                      <motion.div
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0, opacity: 0 }}
                        transition={{ type: "spring", stiffness: 500, damping: 25 }}
                        className="absolute -top-1 -right-1 text-white rounded-full p-0.5 border-2 border-white z-10 shadow-sm"
                        style={{ background: 'linear-gradient(135deg, #165DFF, #4f39d0)' }}
                      >
                        <Check size={10} />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                <div className="flex-1 min-w-0">
                  <div className={`font-bold truncate transition-colors ${course.is_selected ? 'text-brand-700' : 'text-text-primary'}`}>
                    {course.name}
                  </div>
                  <div className="text-xs text-text-secondary mt-1 font-medium">{course.teacher}</div>
                </div>
              </div>
            ))
          )}
        </div>
      </PullToRefresh>

      {/* Save button */}
      <div className="fixed bottom-0 left-0 right-0 p-4 max-w-[420px] mx-auto z-30"
        style={{
          background: 'rgba(255,255,255,0.85)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          borderTop: '1px solid rgba(226,232,240,0.4)',
        }}
      >
        <Button
          onClick={handleSave}
          disabled={isSaving || isLoading}
          className="w-full"
          size="lg"
        >
          {isSaving ? <Loader2 className="animate-spin mr-2" /> : '保存设置'}
        </Button>
      </div>

      {/* Exit Confirmation Modal */}
      <AnimatePresence>
        {showExitConfirm && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6"
            style={{ background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}>
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-xs rounded-3xl p-6 shadow-2xl border"
              style={{
                background: 'rgba(255,255,255,0.95)',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                borderColor: 'rgba(226,232,240,0.4)',
              }}
            >
              <h3 className="text-lg font-extrabold text-text-primary mb-2">未保存的更改</h3>
              <p className="text-text-secondary text-sm mb-6">您有未保存的课程选择，确定要离开吗？</p>
              <div className="grid grid-cols-2 gap-3">
                <Button
                  variant="secondary"
                  onClick={() => setShowExitConfirm(false)}
                  className="py-3 font-semibold rounded-xl"
                >
                  取消
                </Button>
                <Button
                  variant="danger"
                  onClick={() => navigate(-1)}
                  className="py-3 font-semibold rounded-xl"
                >
                  确定离开
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Courses;
