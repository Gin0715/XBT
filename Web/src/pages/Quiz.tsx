import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertCircle, Zap, Loader2, Activity, Settings } from 'lucide-react';
import { useAuthStore } from '../store/auth';
import { useQuizMonitor } from '../hooks/useQuizMonitor';
import { QuizList } from './QuizList';
import { QuizLogs } from './QuizLogs';
import { QuizControls } from './QuizControls';

type TabType = 'activities' | 'settings';

export default function Quiz() {
  const { isAuthenticated } = useAuthStore();
  const [activeTab, setActiveTab] = useState<TabType>('activities');
  const [saveSuccess, setSaveSuccess] = useState(false);

  const {
    config,
    activities,
    answerLogs,
    courses,
    selectedCourse,
    error,
    loading,
    stats,
    setConfig,
    setError,
    setSelectedCourse,
    saveConfig,
    toggleMonitor,
    refreshStatus,
    syncCourses,
    isWSConnected,
    doManualAnswer,
  } = useQuizMonitor();

  useEffect(() => {
    if (isAuthenticated) refreshStatus();
  }, [isAuthenticated]);

  const handleOneClick = useCallback(async () => {
    await toggleMonitor();
  }, [toggleMonitor]);

  const handleSaveConfig = useCallback(async () => {
    await saveConfig();
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2000);
  }, [saveConfig]);

  const isLoading = !!loading.toggle;

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-transparent">
      {/* Error banner */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="mx-4 mt-3 p-3.5 rounded-2xl flex items-center gap-3 text-sm font-medium shadow-lg"
            style={{ background: 'rgba(254,242,242,0.9)', backdropFilter: 'blur(12px)', border: '1px solid rgba(245,63,63,0.2)', color: '#991b1b' }}
          >
            <AlertCircle className="w-4 h-4 flex-shrink-0 text-error-500" />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} className="text-error-400 hover:text-error-600 font-bold text-lg leading-none px-1">×</button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header card */}
      <div className="flex items-center mx-4 mt-3 p-3 rounded-2xl border shadow-lg"
        style={{ background: 'rgba(255,255,255,0.9)', backdropFilter: 'blur(16px)', borderColor: 'rgba(226,232,240,0.6)' }}
      >
        <div className="flex items-center gap-3 flex-1">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #165DFF, #4f39d0)' }}>
            <Zap className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="font-bold text-sm text-text-primary">课堂抢答</h2>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-[10px] font-medium text-text-muted">点击下方按钮一键抢答</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* WS 连接状态指示 */}
          <div className="flex items-center gap-1 px-2 py-1 rounded-lg" style={{ background: isWSConnected ? 'rgba(0,180,42,0.08)' : 'rgba(245,63,63,0.08)' }}>
            <span className={`w-1.5 h-1.5 rounded-full ${isWSConnected ? 'bg-green-500' : 'bg-red-400'}`} />
            <span className="text-[9px] font-semibold" style={{ color: isWSConnected ? '#00B42A' : '#F53F3F' }}>{isWSConnected ? '已连接' : '断开'}</span>
          </div>
          <div className="px-3 py-1.5 rounded-lg" style={{ background: 'rgba(0,180,42,0.08)' }}>
            <span className="text-[11px] font-bold text-success-500">✅ {stats.success}</span>
          </div>
          <div className="px-3 py-1.5 rounded-lg" style={{ background: 'rgba(245,63,63,0.08)' }}>
            <span className="text-[11px] font-bold text-error-500">❌ {stats.fail}</span>
          </div>
        </div>
      </div>

      {/* Main content area */}
      <div className="flex-1 overflow-y-auto px-4 py-4 pb-[calc(24px+var(--sab))] space-y-4 custom-scrollbar">
        {!isAuthenticated && (
          <div className="p-4 rounded-2xl text-center text-sm font-medium border" style={{ background: 'rgba(239,244,255,0.8)', borderColor: 'rgba(22,93,255,0.2)', color: '#165DFF' }}>
            ⚠️ 请先登录账号
          </div>
        )}

        {/* 一键抢答按钮 */}
        <button onClick={handleOneClick} disabled={isLoading || !config.course_id}
          className="btn-tap w-full py-4 rounded-2xl font-bold text-base flex items-center justify-center gap-3 text-white transition-all duration-200 disabled:opacity-50 shadow-lg relative overflow-hidden"
          style={{
            background: 'linear-gradient(135deg, #FF7D00, #FF4D4F)',
            boxShadow: '0 4px 20px rgba(255,77,79,0.35)',
          }}
        >
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.2),transparent_70%)] pointer-events-none" />
          {isLoading ? (
            <><Loader2 className="w-5 h-5 animate-spin" />抢答中...</>
          ) : (
            <><Zap className="w-5 h-5" />一键抢答</>
          )}
        </button>

        {/* Tab navigation */}
        <div className="flex rounded-2xl overflow-hidden border shadow-sm"
          style={{ background: 'rgba(241,245,249,0.6)', borderColor: 'rgba(226,232,240,0.5)' }}
        >
          <button onClick={() => setActiveTab('activities')}
            className={`flex-1 py-2.5 text-xs font-semibold flex items-center justify-center gap-2 transition-all duration-200 ${
              activeTab === 'activities'
                ? 'text-white shadow-sm'
                : 'text-text-muted hover:text-text-primary'
            }`}
            style={activeTab === 'activities' ? { background: 'linear-gradient(135deg, #165DFF, #4f39d0)', borderRadius: '12px' } : {}}
          >
            <Activity className="w-3.5 h-3.5" />
            抢答活动
            {activities.length > 0 && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full"
                style={{ background: activeTab === 'activities' ? 'rgba(255,255,255,0.2)' : 'rgba(22,93,255,0.1)', color: activeTab === 'activities' ? '#fff' : '#165DFF' }}>
                {Math.min(activities.length, 5)}
              </span>
            )}
          </button>
          <button onClick={() => setActiveTab('settings')}
            className={`flex-1 py-2.5 text-xs font-semibold flex items-center justify-center gap-2 transition-all duration-200 ${
              activeTab === 'settings'
                ? 'text-white shadow-sm'
                : 'text-text-muted hover:text-text-primary'
            }`}
            style={activeTab === 'settings' ? { background: 'linear-gradient(135deg, #165DFF, #4f39d0)', borderRadius: '12px' } : {}}
          >
            <Settings className="w-3.5 h-3.5" />
            课程设置
          </button>
        </div>

        {/* Tab content */}
        {activeTab === 'activities' ? (
          <>
            <QuizList
              activities={activities}
              config={config}
              selectedCourse={selectedCourse}
              onShowSettings={() => setActiveTab('settings')}
              onRetry={(activityId, courseId, classId) => doManualAnswer(activityId, courseId, classId)}
            />

            {answerLogs.length > 0 && (
              <QuizLogs answerLogs={answerLogs} onExport={() => {}} />
            )}
          </>
        ) : (
          <QuizControls
            config={config}
            courses={courses}
            selectedCourse={selectedCourse}
            loading={loading}
            saveSuccess={saveSuccess}
            onConfigChange={setConfig}
            onCourseSelect={setSelectedCourse}
            onSave={handleSaveConfig}
            onSyncCourses={syncCourses}
          />
        )}
      </div>
    </div>
  );
}
