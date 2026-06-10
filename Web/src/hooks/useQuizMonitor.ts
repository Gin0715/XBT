import { useReducer, useEffect, useRef, useCallback } from 'react';
import { useAuthStore } from '../store/auth';
import { getQuizConfig, updateQuizConfig, clearQuizRecords, manualAnswer, getQuizStatus, toggleQuizMonitor } from '../api/quiz';
import client from '../api/client';

// ================= 类型定义 =================

export type MonitorMode = 'off' | 'prewarming';

export interface QuizConfig {
  auto_answer: boolean;
  delay_ms: number;
  enabled: boolean;
  course_id: number;
  class_id: number;
  course_ids: string;        // JSON: [{"course_id":123,"class_id":456},...]
}

export interface AnswerLog {
  id: string;
  time: string;
  activityName: string;
  activeId: string;
  status: 'success' | 'failed' | 'pending';
  message: string;
}

export interface ActivityItem {
  id?: number;
  activity_id?: number;
  title?: string;
  name?: string;
  course_name?: string;
  teacher?: string;
  icon?: string;
  start_time?: number;
  end_time?: number;
  status?: number;
  class_id?: number;
  course_id?: number;
  _answerStatus?: 'pending' | 'success' | 'failed';
  _answerMsg?: string;
  _elapsed?: number;
  created_at?: string;
}

interface QuizState {
  config: QuizConfig;
  mode: MonitorMode;
  activities: ActivityItem[];
  records: any[];
  answerLogs: AnswerLog[];
  courses: any[];
  selectedCourse: any | null;
  error: string | null;
  loading: Record<string, boolean>;
  stats: { success: number; fail: number };
  isWSConnected: boolean;
}

type QuizAction =
  | { type: 'SET_CONFIG'; payload: Partial<QuizConfig> }
  | { type: 'SET_MODE'; payload: MonitorMode }
  | { type: 'SET_ACTIVITIES'; payload: ActivityItem[] }
  | { type: 'UPDATE_ACTIVITY'; payload: { id: string; updates: Partial<ActivityItem> } }
  | { type: 'SET_RECORDS'; payload: any[] }
  | { type: 'SET_LOG'; payload: AnswerLog[] }
  | { type: 'PREPEND_LOG'; payload: AnswerLog }
  | { type: 'REPLACE_LOG_BY_ACTIVITY'; payload: AnswerLog }
  | { type: 'SET_COURSES'; payload: any[] }
  | { type: 'SET_SELECTED_COURSE'; payload: any }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'SET_LOADING'; payload: Record<string, boolean> }
  | { type: 'SET_STATS'; payload: { success: number; fail: number } }
  | { type: 'SET_WS_CONNECTED'; payload: boolean }
  | { type: 'CLEAR_ALL' };

const DEFAULT_CONFIG: QuizConfig = {
  auto_answer: true,
  delay_ms: 100,
  enabled: false,
  course_id: 0,
  class_id: 0,
  course_ids: '',
};

const initialQuizState: QuizState = {
  config: { ...DEFAULT_CONFIG },
  mode: 'off',
  activities: [],
  records: [],
  answerLogs: [],
  courses: [],
  selectedCourse: null,
  error: null,
  loading: {},
  stats: { success: 0, fail: 0 },
  isWSConnected: false,
};

// ================= Reducer =================

function quizReducer(state: QuizState, action: QuizAction): QuizState {
  switch (action.type) {
    case 'SET_CONFIG':
      return { ...state, config: { ...state.config, ...action.payload } };
    case 'SET_MODE':
      return { ...state, mode: action.payload };
    case 'SET_ACTIVITIES':
      return { ...state, activities: action.payload };
    case 'UPDATE_ACTIVITY': {
      return {
        ...state,
        activities: state.activities.map(a => {
          const aId = String(a.activity_id || a.id || '');
          if (aId === action.payload.id) {
            return { ...a, ...action.payload.updates };
          }
          return a;
        }),
      };
    }
    case 'SET_RECORDS':
      return { ...state, records: action.payload };
    case 'SET_LOG':
      return { ...state, answerLogs: action.payload };
    case 'PREPEND_LOG':
      return { ...state, answerLogs: [action.payload, ...state.answerLogs].slice(0, 5) };
    case 'REPLACE_LOG_BY_ACTIVITY': {
      const filtered = state.answerLogs.filter(
        l => l.activeId !== action.payload.activeId || l.status !== 'pending'
      );
      return { ...state, answerLogs: [action.payload, ...filtered].slice(0, 5) };
    }
    case 'SET_COURSES':
      return { ...state, courses: action.payload };
    case 'SET_SELECTED_COURSE':
      return { ...state, selectedCourse: action.payload };
    case 'SET_ERROR':
      return { ...state, error: action.payload };
    case 'SET_LOADING':
      return { ...state, loading: { ...state.loading, ...action.payload } };
    case 'SET_STATS':
      return { ...state, stats: action.payload };
    case 'SET_WS_CONNECTED':
      return { ...state, isWSConnected: action.payload };
    case 'CLEAR_ALL':
      return { ...initialQuizState, config: state.config, courses: state.courses, selectedCourse: state.selectedCourse, isWSConnected: state.isWSConnected };
    default:
      return state;
  }
}

// ================= localStorage 工具 =================

const getConfigKey = (uid: number) => `quiz_config_${uid}`;

const loadConfigFromCache = (uid: number): QuizConfig | null => {
  try {
    const raw = localStorage.getItem(getConfigKey(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed.course_id === 'string') parsed.course_id = Number(parsed.course_id) || 0;
    if (typeof parsed.class_id === 'string') parsed.class_id = Number(parsed.class_id) || 0;
    return parsed;
  } catch {
    return null;
  }
};

const saveConfigToCache = (uid: number, cfg: QuizConfig) => {
  try {
    localStorage.setItem(getConfigKey(uid), JSON.stringify(cfg));
  } catch { /* ignore */ }
};

// ================= Hook =================

export function useQuizMonitor() {
  const { token, isAuthenticated } = useAuthStore();
  const activeUid = useAuthStore(s => s.activeUid);

  const [state, dispatch] = useReducer(quizReducer, initialQuizState);
  const stateRef = useRef(state);
  const wsRef = useRef<WebSocket | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { stateRef.current = state; }, [state]);

  // ===== Config =====

  const fetchConfig = useCallback(async () => {
    if (!isAuthenticated || !token) return;
    if (activeUid) {
      const cached = loadConfigFromCache(activeUid);
      if (cached?.course_id) {
        dispatch({ type: 'SET_CONFIG', payload: cached });
        return;
      }
    }
    try {
      const res = await getQuizConfig();
      const body = res.data as any;
      const serverData = body?.data;
      if (serverData?.course_id) {
        const serverCfg = {
          ...serverData,
          course_id: Number(serverData.course_id) || 0,
          class_id: Number(serverData.class_id) || 0,
        };
        if (activeUid) saveConfigToCache(activeUid, serverCfg);
        dispatch({ type: 'SET_CONFIG', payload: serverCfg });
      }
    } catch { /* ignore */ }
  }, [isAuthenticated, token, activeUid]);

  const fetchCourses = useCallback(async () => {
    if (!isAuthenticated || !token) return;
    dispatch({ type: 'SET_LOADING', payload: { courses: true } });
    try {
      const res = await client.get('/courses');
      const courses = (res.data as any)?.data;
      if (Array.isArray(courses)) {
        dispatch({ type: 'SET_COURSES', payload: courses });
        const savedCourseId = String(stateRef.current.config.course_id || '');
        const savedClassId = String(stateRef.current.config.class_id || '');
        if (savedCourseId) {
          const match = courses.find((c: any) =>
            String(c.course_id || c.id) === savedCourseId &&
            String(c.class_id || '') === savedClassId
          );
          if (match) {
            dispatch({ type: 'SET_SELECTED_COURSE', payload: match });
          }
        }
      }
    } catch { /* ignore */ }
    finally {
      dispatch({ type: 'SET_LOADING', payload: { courses: false } });
    }
  }, [isAuthenticated, token]);

  // ===== Course sync =====

  const syncCourses = useCallback(async () => {
    if (!isAuthenticated || !token) return { count: 0 };
    dispatch({ type: 'SET_LOADING', payload: { syncCourses: true } });
    try {
      const res = await client.post('/courses/sync');
      const body = res.data as any;
      const result = body?.data || { count: 0 };
      await fetchCourses();
      return result;
    } catch (e: any) {
      dispatch({ type: 'SET_ERROR', payload: `同步课程失败: ${e.message}` });
      return { count: 0 };
    } finally {
      dispatch({ type: 'SET_LOADING', payload: { syncCourses: false } });
    }
  }, [isAuthenticated, token, fetchCourses]);

  // ===== Status polling (刷新活动列表和状态) =====

  const pollStatus = useCallback(async () => {
    if (!isAuthenticated || !token) return;
    try {
      const res = await getQuizStatus();
      const data = (res.data as any)?.data;
      if (!data) return;

      dispatch({ type: 'SET_MODE', payload: data.mode || 'off' });

      if (Array.isArray(data.activities)) {
        dispatch({ type: 'SET_ACTIVITIES', payload: data.activities });
      }

      if (typeof data.total_count === 'number') {
        const success = Number(data.success_count) || 0;
        const fail = Number(data.total_count) - success;
        dispatch({ type: 'SET_STATS', payload: { success, fail } });
      }
    } catch { /* ignore */ }
  }, [isAuthenticated, token]);

  // 自适应轮询（已弃用固定 5s，改用 pollStatus 内部重新调度）
  useEffect(() => {
    if (!isAuthenticated || !token) return;
    const hasActive = () => stateRef.current.activities.some(a => a.status === 1);
    const tick = () => {
      pollStatus();
      pollTimerRef.current = setTimeout(tick, hasActive() ? 2000 : 10000);
    };
    pollTimerRef.current = setTimeout(tick, hasActive() ? 2000 : 10000);
    return () => { if (pollTimerRef.current) clearTimeout(pollTimerRef.current); };
  }, [isAuthenticated, token, pollStatus]);

  // ===== 一键抢答（一次性操作） =====

  const toggleMonitor = useCallback(async (): Promise<number> => {
    if (!isAuthenticated || !token) {
      dispatch({ type: 'SET_ERROR', payload: '请先登录' });
      return 0;
    }
    const cfg = stateRef.current.config;
    if (!cfg.course_id || !cfg.class_id) {
      dispatch({ type: 'SET_ERROR', payload: '请先在设置中配置课程' });
      return 0;
    }

    dispatch({ type: 'SET_LOADING', payload: { toggle: true } });

    dispatch({
      type: 'PREPEND_LOG',
      payload: {
        id: `answer-${Date.now()}`,
        time: new Date().toLocaleTimeString('zh-CN'),
        activityName: '一键抢答',
        activeId: 'all',
        status: 'pending',
        message: '正在检测并抢答当前活动...',
      },
    });

    try {
      const res = await toggleQuizMonitor();
      const data = (res.data as any)?.data;
      const detected = Number(data?.detected) || 0;

      if (detected > 0) {
        dispatch({
          type: 'REPLACE_LOG_BY_ACTIVITY',
          payload: {
            id: `answer-${Date.now()}`,
            time: new Date().toLocaleTimeString('zh-CN'),
            activityName: '一键抢答',
            activeId: 'all',
            status: 'pending',
            message: `检测到 ${detected} 个活动，正在抢答...`,
          },
        });
      } else {
        dispatch({
          type: 'REPLACE_LOG_BY_ACTIVITY',
          payload: {
            id: `answer-${Date.now()}`,
            time: new Date().toLocaleTimeString('zh-CN'),
            activityName: '一键抢答',
            activeId: 'all',
            status: 'success',
            message: '暂无进行中的抢答活动',
          },
        });
      }

      await pollStatus();
      return detected;
    } catch (e: any) {
      const errMsg = e.message || '操作失败';
      dispatch({ type: 'SET_ERROR', payload: errMsg });
      return 0;
    } finally {
      dispatch({ type: 'SET_LOADING', payload: { toggle: false } });
    }
  }, [isAuthenticated, token, pollStatus]);

  // 手动单次抢答（保留为 fallback）
  const doManualAnswer = useCallback(async (activityId: number, courseId: number, classId: number) => {
    if (!isAuthenticated || !token) {
      dispatch({ type: 'SET_ERROR', payload: '请先登录' });
      return;
    }
    const aid = String(activityId);

    dispatch({ type: 'UPDATE_ACTIVITY', payload: { id: aid, updates: { _answerStatus: 'pending' } } });
    dispatch({
      type: 'PREPEND_LOG',
      payload: {
        id: `answer-${aid}-${Date.now()}`,
        time: new Date().toLocaleTimeString('zh-CN'),
        activityName: `活动 #${aid.slice(-6)}`,
        activeId: aid,
        status: 'pending',
        message: '抢答中...',
      },
    });

    try {
      const res = await manualAnswer({
        active_id: activityId,
        course_id: courseId,
        class_id: classId,
      });

      const body = res.data || {};
      const data = body.data || {};
      const resultMsg = data.message || '抢答成功';

      dispatch({ type: 'UPDATE_ACTIVITY', payload: { id: aid, updates: { _answerStatus: 'success', _answerMsg: resultMsg, _elapsed: data.elapsed_ms } } });
      dispatch({
        type: 'REPLACE_LOG_BY_ACTIVITY',
        payload: {
          id: `answer-${aid}-${Date.now()}`,
          time: new Date().toLocaleTimeString('zh-CN'),
          activityName: `活动 #${aid.slice(-6)}`,
          activeId: aid,
          status: 'success',
          message: resultMsg + (data.elapsed_ms ? ` [${data.elapsed_ms}ms]` : ''),
        },
      });
      pollStatus();
    } catch (e: any) {
      const errMsg = e.message || '抢答失败';
      dispatch({ type: 'SET_ERROR', payload: `抢答失败: ${errMsg}` });
      dispatch({ type: 'UPDATE_ACTIVITY', payload: { id: aid, updates: { _answerStatus: 'failed', _answerMsg: errMsg } } });
      dispatch({
        type: 'REPLACE_LOG_BY_ACTIVITY',
        payload: {
          id: `answer-${aid}-${Date.now()}`,
          time: new Date().toLocaleTimeString('zh-CN'),
          activityName: `活动 #${aid.slice(-6)}`,
          activeId: aid,
          status: 'failed',
          message: errMsg,
        },
      });
    }
  }, [isAuthenticated, token, pollStatus]);

  // ===== Save config =====

  const saveConfig = useCallback(async () => {
    if (!isAuthenticated || !token) return;
    dispatch({ type: 'SET_LOADING', payload: { save: true } });
    try {
      await updateQuizConfig(stateRef.current.config);
      if (activeUid) saveConfigToCache(activeUid, stateRef.current.config);
      dispatch({ type: 'SET_ERROR', payload: null });
    } catch (e: any) {
      dispatch({ type: 'SET_ERROR', payload: `保存失败: ${e.message}` });
    } finally {
      dispatch({ type: 'SET_LOADING', payload: { save: false } });
    }
  }, [isAuthenticated, token, activeUid]);

  // ===== Clear records =====

  const doClearRecords = useCallback(async () => {
    if (!window.confirm('确定清空所有抢答记录？')) return;
    try {
      await clearQuizRecords();
      dispatch({ type: 'CLEAR_ALL' });
    } catch (e: any) {
      dispatch({ type: 'SET_ERROR', payload: '清空失败: ' + e.message });
    }
  }, []);

  // ===== WebSocket for real-time results =====

  const connectWS = useCallback(() => {
    const t = useAuthStore.getState().token;
    if (!t) return;
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/quiz/ws?token=${encodeURIComponent(t)}`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          const d = msg.data || {};
          const aid = String(d.activity_id || '');

          if (msg.type === 'quiz_record' && d) {
            if (aid) {
              const hasElapsed = d.elapsed !== undefined && d.elapsed !== null && d.elapsed > 0;
              const isSuccess = d.success === true;

              if (hasElapsed || isSuccess || d.success === false) {
                dispatch({ type: 'UPDATE_ACTIVITY', payload: { id: aid, updates: { _answerStatus: isSuccess ? 'success' : 'failed', _answerMsg: d.message, _elapsed: d.elapsed } } });
                dispatch({
                  type: 'REPLACE_LOG_BY_ACTIVITY',
                  payload: {
                    id: `ws-${aid}-${Date.now()}`,
                    time: new Date().toLocaleTimeString('zh-CN'),
                    activityName: d.name || `活动 #${aid.slice(-6)}`,
                    activeId: aid,
                    status: isSuccess ? 'success' : 'failed',
                    message: d.message || (isSuccess ? '抢答成功' : '抢答失败'),
                  },
                });
              } else {
                dispatch({ type: 'UPDATE_ACTIVITY', payload: { id: aid, updates: { _answerStatus: 'pending', _answerMsg: d.message } } });
                dispatch({
                  type: 'PREPEND_LOG',
                  payload: {
                    id: `ws-${aid}-${Date.now()}`,
                    time: new Date().toLocaleTimeString('zh-CN'),
                    activityName: d.name || `活动 #${aid.slice(-6)}`,
                    activeId: aid,
                    status: 'pending',
                    message: d.message || '处理中...',
                  },
                });
              }
            }
          } else if (msg.type === 'quiz_activity' && d) {
            // 新活动出现，刷新状态
            pollStatus();
          }
        } catch { /* ignore */ }
      };

      ws.onopen = () => dispatch({ type: 'SET_WS_CONNECTED', payload: true });

      ws.onclose = () => {
        dispatch({ type: 'SET_WS_CONNECTED', payload: false });
        wsRef.current = null;
        setTimeout(() => { if (useAuthStore.getState().token) connectWS(); }, 5000);
      };
      ws.onerror = () => { ws.close(); };
    } catch { /* ignore */ }
  }, [pollStatus]);

  const disconnectWS = useCallback(() => {
    dispatch({ type: 'SET_WS_CONNECTED', payload: false });
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  // ===== Init =====
  useEffect(() => {
    if (isAuthenticated && token) {
      fetchConfig();
      fetchCourses();
      pollStatus();
      connectWS();
    }
    return () => {
      disconnectWS();
    };
  }, [isAuthenticated, token]);

  // ===== Expose =====
  return {
    config: state.config,
    mode: state.mode,
    activities: state.activities,
    records: state.records,
    answerLogs: state.answerLogs,
    courses: state.courses,
    selectedCourse: state.selectedCourse,
    error: state.error,
    loading: state.loading,
    stats: state.stats,

    dispatch,
    setConfig: (cfg: Partial<QuizConfig>) => dispatch({ type: 'SET_CONFIG', payload: cfg }),
    setError: (err: string | null) => dispatch({ type: 'SET_ERROR', payload: err }),
    setSelectedCourse: (course: any) => {
      dispatch({ type: 'SET_SELECTED_COURSE', payload: course });
      dispatch({
        type: 'SET_CONFIG',
        payload: {
          course_id: Number(course.course_id || course.id || 0),
          class_id: Number(course.class_id || 0),
        },
      });
      const cfg = {
        ...stateRef.current.config,
        course_id: Number(course.course_id || course.id || 0),
        class_id: Number(course.class_id || 0),
      };
      updateQuizConfig(cfg).then(() => {
        if (activeUid) saveConfigToCache(activeUid, cfg);
      }).catch(() => {});
    },

    // 统一一键抢答（替代 doOneClickAnswer 和 start/stopMonitor）
    toggleMonitor,
    // 手动单次抢答（保留 fallback）
    doManualAnswer,
    saveConfig,
    syncCourses,
    clearRecords: doClearRecords,
    // 获取最新活动列表和状态
    refreshStatus: pollStatus,
    fetchCourses,
    isWSConnected: state.isWSConnected,
  };
}
