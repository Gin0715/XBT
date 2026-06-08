import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuthStore } from '../store/auth';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play, Pause, Zap, AlertCircle, Save, Loader2,
  CheckCircle, XCircle, Settings, History,
  BookOpen, Activity, Trash2, Clock,
} from 'lucide-react';

const API_BASE = '';

interface LoadingState { toggle?: boolean; save?: boolean; courses?: boolean; }
interface AnswerLog { time: string; activityName: string; activeId: string; status: 'success' | 'failed' | 'pending'; message: string; }

const request = async (url: string, options?: RequestInit) => {
  const token = useAuthStore.getState().token;
  if (token && !token.startsWith('eyJ')) { useAuthStore.getState().logout(); throw new Error('无效的 token'); }
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...((options?.headers as Record<string, string>) || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${url}`, { ...options, headers });
  const isQuizApi = url.includes('/quiz/');
  if (res.status === 401 && !isQuizApi) { useAuthStore.getState().logout(); window.location.reload(); throw new Error('登录已过期'); }
  if (!res.ok) {
    try { const errData = await res.json(); throw new Error(errData.msg || errData.message || `请求失败 (${res.status})`); }
    catch (e: any) { if (e.message && !e.message.startsWith('Unexpected')) throw e; throw new Error(`请求失败 (${res.status})`); }
  }
  return res.json();
};

// ---- localStorage helpers for quiz config (keyed by user) ----
const getConfigKey = (uid: number) => `quiz_config_${uid}`;
const getCachedConfig = (uid: number): any => {
  try {
    const raw = localStorage.getItem(getConfigKey(uid));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
};
const setCachedConfig = (uid: number, cfg: any) => {
  try { localStorage.setItem(getConfigKey(uid), JSON.stringify(cfg)); } catch {}
};

const DEFAULT_CONFIG = { auto_answer: true, delay_ms: 100, enabled: false, course_id: '', class_id: '' };

export default function Quiz() {
  const { token, isAuthenticated } = useAuthStore();
  const activeUid = useAuthStore(s => s.activeUid);

  // Load initial config from localStorage synchronously
  const initConfig = (): any => {
    if (activeUid) {
      const cached = getCachedConfig(activeUid);
      if (cached && cached.course_id) return { ...DEFAULT_CONFIG, ...cached };
    }
    return { ...DEFAULT_CONFIG };
  };

  const [activeTab, setActiveTab] = useState<'control' | 'settings' | 'history'>('control');
  const [status, setStatus] = useState<{ running: boolean }>({ running: false });
  const [config, setConfig] = useState<any>(initConfig);
  const [activities, setActivities] = useState<any[]>([]);
  const [records, setRecords] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<LoadingState>({});
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [courses, setCourses] = useState<any[]>([]);
  const [selectedCourse, setSelectedCourse] = useState<any>(null);
  const [now, setNow] = useState(Date.now());
  const pollTimerRef = useRef<any>(null);
  const [answerLogs, setAnswerLogs] = useState<AnswerLog[]>([]);
  const answerLogsRef = useRef<AnswerLog[]>([]);
  useEffect(() => { answerLogsRef.current = answerLogs; }, [answerLogs]);
  const recordsLoadedRef = useRef(false);
  const coursesLoadedRef = useRef(false);
  const handleTabChange = (tab: string) => {
    setActiveTab(tab as any);
    if (tab === 'settings' && !coursesLoadedRef.current) {
      fetchCourses().then(() => { coursesLoadedRef.current = true; });
    }
    if (tab === 'history' && !recordsLoadedRef.current) {
      fetchRecords().then(() => { recordsLoadedRef.current = true; });
    }
  };
  const answeredSetRef = useRef<Set<string>>(new Set());
  const [highlightedIds, setHighlightedIds] = useState<Set<string>>(new Set());
  const highlightTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const listScrollRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const configRef = useRef(config);
  const statusRef = useRef(status);
  const lastRecordIdRef = useRef<number>(0);
  const logIdCounterRef = useRef<number>(0);
  const wsRef = useRef<WebSocket | null>(null);
  const wsRetryRef = useRef(0);
  const wsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { configRef.current = config; }, [config]);
  useEffect(() => { statusRef.current = status; }, [status]);

  // Persist config to localStorage on every change
  useEffect(() => {
    if (activeUid && config.course_id) {
      setCachedConfig(activeUid, config);
    }
  }, [config, activeUid]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const extractActivities = (data: any): any[] => {
    if (!data) return [];
    if (data.data?.activities) return data.data.activities;
    if (Array.isArray(data.data)) {
      if (data.data.length > 0 && data.data[0].activities) {
        return data.data.flatMap((g: any) => g.activities || []);
      }
      return data.data;
    }
    if (Array.isArray(data)) return data;
    return [];
  };

  const fetchStatus = async () => {
    if (!isAuthenticated || !token) return;
    try {
      const data = await request('/api/quiz/status');
      if (data.code === 0 || data.code === 200 || data.success) {
        const r = data.data?.running || data.data?.is_running || false;
        setStatus({ running: r });
        if (r) startRealtime();
      }
    } catch (e: any) { setError(e.message); }
  };
  const fetchConfig = async () => {
    if (!isAuthenticated || !token) return;
    // Try localStorage first (persists across refreshes, keyed by user)
    if (activeUid) {
      const cached = getCachedConfig(activeUid);
      if (cached?.course_id) {
        setConfig((p: any) => ({ ...p, ...cached }));
        configRef.current = { ...configRef.current, ...cached };
        return; // Don't overwrite local choice with server config
      }
    }
    // Fallback to server config
    try {
      const data = await request('/api/quiz/config');
      if (data.data?.course_id) {
        if (activeUid) setCachedConfig(activeUid, data.data);
        setConfig((p: any) => ({ ...p, ...data.data }));
        configRef.current = { ...configRef.current, ...data.data };
      }
    } catch (e: any) {}
  };

  const syncLogsFromRecords = (newRecords: any[]) => {
    setRecords(newRecords);
    const lastId = lastRecordIdRef.current;
    const fresh = newRecords.filter((r: any) => r.id > lastId);
    if (fresh.length > 0) {
      lastRecordIdRef.current = Math.max(...fresh.map((r: any) => r.id));
      const timeStr = new Date().toLocaleTimeString('zh-CN');
      const newLogs: AnswerLog[] = fresh.map((r: any) => ({
        time: r.created_at ? new Date(r.created_at).toLocaleTimeString('zh-CN') : timeStr,
        activityName: '活动 #' + String(r.activity_id).slice(-6),
        activeId: String(r.activity_id),
        status: r.success ? 'success' : 'failed',
        message: r.message || (r.success ? '抢答成功' : '抢答失败'),
      }));
      setAnswerLogs((prev: AnswerLog[]) => [...newLogs, ...prev].slice(0, 100));
      setActivities(prev => {
        const recordMap = new Map<string, any>();
        fresh.forEach((r: any) => recordMap.set(String(r.activity_id), r));
        return prev.map(act => {
          const aid = String(act.activity_id || act.activeId || act.id || '');
          const rec = recordMap.get(aid);
          if (rec && !act._answerStatus) {
            return {
              ...act,
              _answerStatus: rec.success ? ('success' as const) : ('failed' as const),
              _answerMsg: rec.message || (rec.success ? '抢答成功' : '抢答失败'),
              _elapsed: rec.answer_time || 0,
              _recovered: true,
            };
          }
          return act;
        });
      });
    }
  };

  const fetchRecords = async () => {
    if (!isAuthenticated || !token) return;
    try {
      const data = await request('/api/quiz/records');
      if (Array.isArray(data.data)) syncLogsFromRecords(data.data);
    } catch (e: any) {}
  };

  const fetchCourses = async () => {
    if (!isAuthenticated || !token) return;
    setLoading(p => ({ ...p, courses: true }));
    try {
      const data = await request('/api/courses');
      if (Array.isArray(data.data)) {
        setCourses(data.data);
        // Restore selected course from persisted config
        const savedCourseId = String(configRef.current.course_id || '');
        const savedClassId = String(configRef.current.class_id || '');
        if (savedCourseId) {
          const match = data.data.find((c: any) =>
            String(c.course_id || c.id) === savedCourseId &&
            String(c.class_id || '') === savedClassId
          );
          if (match) setSelectedCourse(match);
          else {
            // Course no longer exists — clear stale selection
            const updated = { ...configRef.current, course_id: '', class_id: '' };
            setConfig(updated);
            configRef.current = updated;
            if (activeUid) setCachedConfig(activeUid, updated);
          }
        }
      }
    } catch (e: any) { setError(e.message); } finally { setLoading(p => ({ ...p, courses: false })); }
  };

  const reconcileActivitiesFromRecords = useCallback((acts: any[], recs: any[]) => {
    if (!acts?.length || !recs?.length) return acts;
    const recordMap = new Map<string, any>();
    recs.forEach((r: any) => {
      const aid = String(r.activity_id || '');
      if (aid) recordMap.set(aid, r);
    });
    return acts.map(act => {
      const actId = String(act.activity_id || act.activeId || act.id || '');
      const rec = recordMap.get(actId);
      if (!rec || act._answerStatus) return act;
      return {
        ...act,
        _answerStatus: rec.success ? ('success' as const) : ('failed' as const),
        _answerMsg: rec.message || (rec.success ? '抢答成功' : '抢答失败'),
        _elapsed: rec.answer_time || 0,
        _recovered: true,
      };
    });
  }, []);

  const generateLogsFromRecords = useCallback((recs: any[]): AnswerLog[] => {
    if (!recs?.length) return [];
    const timeStr = new Date().toLocaleTimeString('zh-CN');
    return recs.slice(0, 50).map((r: any) => ({
      time: r.created_at ? new Date(r.created_at).toLocaleTimeString('zh-CN') : timeStr,
      activityName: '活动 #' + String(r.activity_id || '').slice(-6),
      activeId: String(r.activity_id || ''),
      status: r.success ? 'success' as const : 'failed' as const,
      message: r.message || (r.success ? '抢答成功' : '抢答失败'),
    }));
  }, []);

  const fetchActivities = useCallback(async (options?: { silent?: boolean }) => {
    if (!isAuthenticated || !token) return;
    const cfg = configRef.current;
    try {
      const params = new URLSearchParams();
      if (cfg.course_id) params.append('course_id', String(cfg.course_id));
      if (cfg.class_id) params.append('class_id', String(cfg.class_id));
      const [quizRes, recordsRes] = await Promise.all([
        request(`/api/quiz/activities?${params.toString()}`),
        request('/api/quiz/records').catch(() => null),
      ]);
      const newActs = extractActivities(quizRes);
      const records = Array.isArray(recordsRes?.data) ? recordsRes.data : [];
      const reconciled = reconcileActivitiesFromRecords(newActs, records);
      if (records.length > 0) {
        const maxId = Math.max(...records.map((r: any) => r.id || 0));
        if (maxId > lastRecordIdRef.current) {
          lastRecordIdRef.current = maxId;
        }
      }
      setActivities(prev => {
        const merged = [...reconciled];
        for (const pa of prev) {
          const paid = String(pa.activity_id || pa.activeId || pa.id || '');
          if (paid && (pa._answerStatus || pa._detected_at)) {
            const exists = merged.some(m => String(m.activity_id || m.activeId || m.id || '') === paid);
            if (!exists) merged.push(pa);
            else {
              const idx = merged.findIndex(m => String(m.activity_id || m.activeId || m.id || '') === paid);
              if (idx >= 0 && pa._answerStatus) merged[idx] = { ...merged[idx], _answerStatus: pa._answerStatus, _answerMsg: pa._answerMsg, _detected_at: pa._detected_at, _isManual: pa._isManual, _elapsed: pa._elapsed };
            }
          }
        }
        return merged.slice(0, 50);
      });
      if (!options?.silent && records.length > 0 && answerLogsRef.current.length === 0) {
        const logs = generateLogsFromRecords(records);
        if (logs.length > 0) setAnswerLogs(logs);
      }
    } catch (e: any) {
      if (!options?.silent) console.error('fetchActivities error:', e);
    }
  }, [isAuthenticated, token, reconcileActivitiesFromRecords, generateLogsFromRecords]);

  const toggleMonitor = async () => {
    if (!isAuthenticated || !token) { setError('请先登录'); return; }
    const isRunning = status?.running;
    const url = isRunning ? '/api/quiz/monitor/stop' : '/api/quiz/monitor/start';
    setLoading(p => ({ ...p, toggle: true })); setError(null);
    try {
      const body: any = {}; if (config.course_id) body.course_id = Number(config.course_id); if (config.class_id) body.class_id = Number(config.class_id);
      const data = await request(url, { method: 'POST', body: JSON.stringify(body) });
      if (data.code === 0 || data.code === 200) {
        const next = !isRunning;
        setStatus({ running: next });
        if (next) {
          answeredSetRef.current.clear();
          setAnswerLogs([]);
          lastRecordIdRef.current = 0;
          startRealtime();
        } else {
          stopRealtime();
          setActivities([]);
        }
      } else setError(data.msg || '操作失败');
    } catch (e: any) { setError(`操作失败: ${e.message}`); } finally { setLoading(p => ({ ...p, toggle: false })); }
  };

  const handleSaveConfig = async () => {
    if (!isAuthenticated || !token) { setError('请先登录'); return; }
    setLoading(p => ({ ...p, save: true })); setSaveSuccess(false);
    try {
      await request('/api/quiz/config', { method: 'PUT', body: JSON.stringify(config) });
      setSaveSuccess(true); setTimeout(() => setSaveSuccess(false), 2000);
    } catch (e: any) { setError(`保存失败: ${e.message}`); } finally { setLoading(p => ({ ...p, save: false })); }
  };

  const handleManualAnswer = async (activityId: number) => {
    if (!isAuthenticated || !token) { setError('请先登录'); return; }
    const cfg = configRef.current;
    if (!cfg.course_id || !cfg.class_id) {
      setError('请先在设置中配置课程'); return;
    }
    setLoading(p => ({ ...p, toggle: true })); setError(null);
    const aid = String(activityId);
    setActivities(prev => prev.map(a => {
      const aId = String(a.activity_id || a.activeId || a.id || '');
      if (aId === aid) return { ...a, _answerStatus: 'pending' as const, _isManual: true };
      return a;
    }));
    answeredSetRef.current.add(aid);
    try {
      const data = await request('/api/quiz/answer', {
        method: 'POST',
        body: JSON.stringify({ active_id: activityId, activePrimaryId: activityId, course_id: Number(cfg.course_id), class_id: Number(cfg.class_id) }),
      });
      const isOk = data.code === 0 || data.code === 200;
      const msg = data.data?.message || data.msg || (isOk ? '抢答成功' : '抢答失败');
      setActivities(prev => prev.map(a => {
        const aId = String(a.activity_id || a.activeId || a.id || '');
        if (aId === aid) return { ...a, _answerStatus: isOk ? 'success' as const : 'failed' as const, _answerMsg: msg };
        return a;
      }));
      triggerHighlight(aid);
      const newLog: AnswerLog = {
        time: new Date().toLocaleTimeString('zh-CN'),
        activityName: `活动 #${aid.slice(-6)}`,
        activeId: aid,
        status: isOk ? 'success' : 'failed',
        message: msg + ' [手动]',
      };
      setAnswerLogs(prev => [newLog, ...prev].slice(0, 100));
    } catch (e: any) {
      setError(`手动抢答失败: ${e.message}`);
      setActivities(prev => prev.map(a => {
        const aId = String(a.activity_id || a.activeId || a.id || '');
        if (aId === aid) return { ...a, _answerStatus: 'failed' as const, _answerMsg: e.message };
        return a;
      }));
    } finally { setLoading(p => ({ ...p, toggle: false })); }
  };

  const handleClearRecords = async () => {
    if (!confirm('确定清空所有抢答记录和活动？此操作不可撤销。')) return;
    try {
      await request('/api/quiz/records', { method: 'DELETE' });
      setRecords([]); setActivities([]); setAnswerLogs([]);
      answeredSetRef.current.clear(); lastRecordIdRef.current = 0;
    } catch (e: any) { setError('清空失败: ' + e.message); }
  };

  const triggerHighlight = useCallback((id: string) => {
    const prev = highlightTimersRef.current.get(id);
    if (prev) clearTimeout(prev);
    setHighlightedIds(prev => new Set(prev).add(id));
    const timer = setTimeout(() => {
      setHighlightedIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      highlightTimersRef.current.delete(id);
    }, 3000);
    highlightTimersRef.current.set(id, timer);
    if (listScrollRef.current && !userScrolledUpRef.current) {
      listScrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, []);

  const handleListScroll = useCallback(() => {
    const el = listScrollRef.current;
    if (!el) return;
    userScrolledUpRef.current = el.scrollTop > 80;
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    scrollTimeoutRef.current = setTimeout(() => {
      userScrolledUpRef.current = false;
    }, 4000);
  }, []);

  const handleRealtimeDetected = useCallback((d: any) => {
    let st = 0, et = 0, ast = 1;
    if (d.message) {
      const parts = d.message.split(',');
      st = parseInt(parts[0]) || 0;
      et = parseInt(parts[1]) || 0;
      ast = parseInt(parts[2]) || 1;
    }
    const nowTs = Date.now();
    const endTime = et > 0 ? et : nowTs + 600000;
    logIdCounterRef.current += 1;
    const newLog: AnswerLog = {
      time: new Date().toLocaleTimeString('zh-CN'),
      activityName: d.name || `活动 #${String(d.activity_id).slice(-6)}`,
      activeId: String(d.activity_id),
      status: 'pending',
      message: `发现抢答${d.course_name ? ' · ' + d.course_name : ''}`,
    };
    setAnswerLogs(prev => [newLog, ...prev].slice(0, 100));
    answeredSetRef.current.add(String(d.activity_id));
    setActivities(prev => {
      const exists = prev.some(a => String(a.activity_id || a.activeId || a.id) === String(d.activity_id));
      if (exists) return prev;
      const newAct = {
        activity_id: d.activity_id,
        title: d.name,
        course_name: d.course_name,
        start_time: st > 0 ? st : nowTs,
        end_time: endTime,
        status: ast,
        _detected_at: nowTs,
        _answerStatus: 'pending' as const,
        _isManual: false,
      };
      triggerHighlight(String(d.activity_id));
      return [newAct, ...prev].slice(0, 50);
    });
  }, [triggerHighlight]);

  const handleRealtimeAnswered = useCallback((d: any) => {
    const aid = String(d.activity_id);
    const elapsedStr = d.elapsed ? ` [${d.elapsed}ms]` : '';
    logIdCounterRef.current += 1;
    const newLog: AnswerLog = {
      time: new Date().toLocaleTimeString('zh-CN'),
      activityName: d.name || `活动 #${aid.slice(-6)}`,
      activeId: aid,
      status: d.success ? 'success' : 'failed',
      message: (d.message || (d.success ? '抢答成功' : '抢答失败')) + elapsedStr,
    };
    setAnswerLogs(prev => {
      const filtered = prev.filter(l => l.activeId !== aid || l.status !== 'pending');
      return [newLog, ...filtered].slice(0, 100);
    });
    setActivities(prev => prev.map(a => {
      const aId = String(a.activity_id || a.activeId || a.id || '');
      if (aId === aid) {
        return { ...a, _answerStatus: d.success ? 'success' as const : 'failed' as const, _answerMsg: d.message, _elapsed: d.elapsed };
      }
      return a;
    }));
    triggerHighlight(aid);
    setRecords(prev => [{
      id: logIdCounterRef.current,
      activity_id: d.activity_id,
      success: d.success,
      message: d.message + elapsedStr,
      created_at: new Date().toISOString(),
    }, ...prev].slice(0, 50));
  }, [triggerHighlight]);

  const disconnectWS = () => {
    if (wsTimerRef.current) { clearTimeout(wsTimerRef.current); wsTimerRef.current = null; }
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }
  };

  const startPolling = () => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    fetchActivities({ silent: true });
    pollTimerRef.current = setInterval(() => fetchActivities({ silent: true }), 5000);
  };

  const stopPolling = () => {
    if (pollTimerRef.current) { clearInterval(pollTimerRef.current); pollTimerRef.current = null; }
  };

  const connectWS = () => {
    const t = useAuthStore.getState().token;
    const cfg = configRef.current;
    if (!t || !cfg.course_id || !cfg.class_id) return;
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/quiz/ws?token=${encodeURIComponent(t)}&course_id=${cfg.course_id}&class_id=${cfg.class_id}`;
    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      ws.onopen = () => {
        wsRetryRef.current = 0;
        stopPolling();
      };
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'quiz_activity') {
            handleRealtimeDetected(msg.data);
          } else if (msg.type === 'quiz_record') {
            handleRealtimeAnswered(msg.data);
          }
        } catch {}
      };
      ws.onclose = () => {
        wsRef.current = null;
        if (statusRef.current.running) {
          startPolling();
          if (wsRetryRef.current < 30) {
            wsRetryRef.current += 1;
            wsTimerRef.current = setTimeout(() => {
              if (statusRef.current.running) connectWS();
            }, 3000);
          }
        }
      };
      ws.onerror = () => {};
    } catch {}
  };

  const startRealtime = () => {
    startPolling();
    connectWS();
  };

  const stopRealtime = () => {
    stopPolling();
    disconnectWS();
  };
  useEffect(() => {
    if (isAuthenticated && token) {
      const init = async () => {
        await fetchConfig();
        await fetchRecords().catch(() => {});
        await fetchStatus();
        await fetchCourses();
        coursesLoadedRef.current = true;
        recordsLoadedRef.current = true;
      };
      init();
    }
    return () => {
      stopRealtime();
      highlightTimersRef.current.forEach(t => clearTimeout(t));
      highlightTimersRef.current.clear();
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    };
  }, [isAuthenticated, token]);

  const activeActs = activities.filter(a => a.end_time > 0 && now < a.end_time);
  const stats = { success: records.filter((r: any) => r.success).length, fail: records.filter((r: any) => !r.success).length };

  const formatCountdown = (endTime: number) => {
    const diff = Math.max(0, endTime - now);
    const m = Math.floor(diff / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // ===== Animated stat counter =====
  const [displayStats, setDisplayStats] = useState({ success: 0, fail: 0, active: 0 });
  useEffect(() => {
    const duration = 600;
    const start = performance.now();
    const from = { ...displayStats };
    const to = { success: stats.success, fail: stats.fail, active: activeActs.length };
    const animate = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplayStats({
        success: Math.round(from.success + (to.success - from.success) * eased),
        fail: Math.round(from.fail + (to.fail - from.fail) * eased),
        active: Math.round(from.active + (to.active - from.active) * eased),
      });
      if (t < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }, [stats.success, stats.fail, activeActs.length]);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-transparent">
      {/* ===== Header — blue-purple gradient ===== */}
      <div className="relative shrink-0 overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, #165DFF 0%, #4f39d0 50%, #722ED1 100%)',
          paddingTop: 'calc(14px + var(--sat))',
          paddingBottom: '20px',
          paddingLeft: '16px',
          paddingRight: '16px',
        }}
      >
        {/* Decorative elements */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(255,255,255,0.18),transparent_55%)] pointer-events-none" />
        <div className="absolute bottom-0 right-0 w-48 h-48 rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(105,177,255,0.2) 0%, transparent 70%)' }}
        />

        <div className="relative flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Icon with glass effect */}
            <div className={`w-11 h-11 rounded-2xl flex items-center justify-center transition-all duration-300 ${
              status?.running
                ? 'bg-white/20 ring-2 ring-green-400/60 shadow-lg shadow-green-500/20'
                : 'bg-white/15'
            }`}>
              <Zap className={`w-6 h-6 transition-colors duration-300 ${status?.running ? 'text-yellow-300' : 'text-white/85'}`} />
            </div>
            <div>
              <h2 className="font-bold text-white text-lg tracking-tight">课堂抢答</h2>
              <p className="text-xs text-blue-200/90 font-medium">
                {status?.running ? (
                  <span className="flex items-center gap-1.5">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-green-300" />
                    </span>
                    监控运行中 · 实时推送
                  </span>
                ) : '准备就绪 · 点击启动开始监控'}
              </p>
            </div>
          </div>
          {/* Start/Stop button */}
          <button
            onClick={toggleMonitor}
            disabled={loading.toggle || !isAuthenticated}
            className="btn-tap-sm relative px-5 py-2.5 rounded-2xl font-bold text-sm flex items-center gap-2 transition-all duration-200 disabled:opacity-50 disabled:scale-100"
          >
            {loading.toggle ? <Loader2 className="w-4 h-4 animate-spin" /> : status?.running ? <><Pause className="w-4 h-4" />停止</> : <><Play className="w-4 h-4" />启动监控</>}
          </button>
        </div>
      </div>

      {/* ===== Error banner ===== */}
      <AnimatePresence>
        {error && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="mx-4 mt-3 p-3.5 rounded-2xl flex items-center gap-3 text-sm font-medium shadow-lg"
            style={{
              background: 'rgba(254,242,242,0.9)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              border: '1px solid rgba(245,63,63,0.2)',
              color: '#991b1b',
            }}
          >
            <AlertCircle className="w-4 h-4 flex-shrink-0 text-error-500" />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} className="text-error-400 hover:text-error-600 font-bold text-lg leading-none px-1">×</button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ===== Tab bar — glass card ===== */}
      <div className="flex mx-4 -mt-3 p-1 rounded-2xl relative z-10 border shadow-lg"
        style={{
          background: 'rgba(255,255,255,0.9)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          borderColor: 'rgba(226,232,240,0.6)',
          boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
        }}
      >
        {[
          { key: 'control', label: '活动', icon: <Activity className="w-4 h-4" /> },
          { key: 'settings', label: '设置', icon: <Settings className="w-4 h-4" /> },
          { key: 'history', label: '日志', icon: <History className="w-4 h-4" /> },
        ].map(tab => (
          <button key={tab.key} onClick={() => handleTabChange(tab.key)}
            className={`flex-1 px-3 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-1.5 transition-all duration-200 ${
              activeTab === tab.key
                ? 'text-white shadow-md'
                : 'text-text-muted hover:text-text-secondary hover:bg-slate-50'
            }`}
            style={activeTab === tab.key ? {
              background: 'linear-gradient(135deg, #165DFF, #4f39d0)',
              boxShadow: '0 2px 8px rgba(22,93,255,0.35)',
            } : {}}
          >
            {tab.icon}{tab.label}
          </button>
        ))}
      </div>

      {/* ===== Content area ===== */}
      <div className="flex-1 overflow-y-auto px-4 py-4 pb-[calc(24px+var(--sab))] space-y-4 custom-scrollbar">
        {!isAuthenticated && (
          <div className="p-4 rounded-2xl text-center text-sm font-medium border"
            style={{
              background: 'rgba(239,244,255,0.8)',
              borderColor: 'rgba(22,93,255,0.2)',
              color: '#165DFF',
            }}
          >⚠️ 请先登录账号</div>
        )}

        {/* ========== 活动面板 ========== */}
        {activeTab === 'control' && (
          <>
            {/* Stats cards — 3 glass cards */}
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-2xl p-4 text-center border overflow-hidden relative gpu-layer"
                style={{
                  background: 'rgba(255,255,255,0.85)',
                  backdropFilter: 'blur(12px)',
                  WebkitBackdropFilter: 'blur(12px)',
                  borderColor: 'rgba(0,180,42,0.15)',
                  boxShadow: '0 4px 20px rgba(0,0,0,0.05)',
                }}>
                <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-12 h-1 rounded-full bg-gradient-to-r from-success-400 to-success-500 opacity-40" />
                <CheckCircle className="w-5 h-5 mx-auto mb-1.5" style={{ color: '#00B42A' }} />
                <div className="text-2xl font-extrabold animate-count-up" style={{ color: '#00B42A' }}>{displayStats.success}</div>
                <div className="text-[10px] font-semibold mt-0.5" style={{ color: '#00B42A', opacity: 0.7 }}>成功</div>
              </div>
              <div className="rounded-2xl p-4 text-center border overflow-hidden relative gpu-layer"
                style={{
                  background: 'rgba(255,255,255,0.85)',
                  backdropFilter: 'blur(12px)',
                  WebkitBackdropFilter: 'blur(12px)',
                  borderColor: 'rgba(245,63,63,0.15)',
                  boxShadow: '0 4px 20px rgba(0,0,0,0.05)',
                }}>
                <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-12 h-1 rounded-full bg-gradient-to-r from-error-400 to-error-500 opacity-40" />
                <XCircle className="w-5 h-5 mx-auto mb-1.5" style={{ color: '#F53F3F' }} />
                <div className="text-2xl font-extrabold animate-count-up" style={{ color: '#F53F3F' }}>{displayStats.fail}</div>
                <div className="text-[10px] font-semibold mt-0.5" style={{ color: '#F53F3F', opacity: 0.7 }}>失败</div>
              </div>
              <div className="rounded-2xl p-4 text-center border overflow-hidden relative gpu-layer"
                style={{
                  background: 'rgba(255,255,255,0.85)',
                  backdropFilter: 'blur(12px)',
                  WebkitBackdropFilter: 'blur(12px)',
                  borderColor: 'rgba(22,93,255,0.15)',
                  boxShadow: '0 4px 20px rgba(0,0,0,0.05)',
                }}>
                <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-12 h-1 rounded-full bg-gradient-to-r from-brand-400 to-brand-600 opacity-40" />
                <Activity className="w-5 h-5 mx-auto mb-1.5" style={{ color: '#165DFF' }} />
                <div className="text-2xl font-extrabold animate-count-up" style={{ color: '#165DFF' }}>{displayStats.active}</div>
                <div className="text-[10px] font-semibold mt-0.5" style={{ color: '#165DFF', opacity: 0.7 }}>进行中</div>
              </div>
            </div>

            {/* Course info card */}
            <div className="rounded-2xl p-4 flex items-center gap-3 border gpu-layer"
              style={{
                background: 'rgba(255,255,255,0.85)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                borderColor: 'rgba(226,232,240,0.6)',
                boxShadow: '0 2px 16px rgba(0,0,0,0.04)',
              }}
            >
              <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                style={{ background: 'linear-gradient(135deg, #eff4ff, #dbe8fe)' }}>
                <BookOpen className="w-4 h-4 text-brand-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm text-text-primary truncate">{selectedCourse?.name || '未选择课程'}</p>
              </div>
              <button onClick={() => setActiveTab('settings')}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-all duration-200 hover:scale-105 active:scale-95"
                style={{ color: '#165DFF', background: 'rgba(22,93,255,0.08)' }}>
                切换课程
              </button>
            </div>

            {/* Real-time activity list */}
            <div className="rounded-2xl border overflow-hidden"
              style={{
                background: 'rgba(255,255,255,0.85)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                borderColor: 'rgba(226,232,240,0.6)',
                boxShadow: '0 2px 16px rgba(0,0,0,0.04)',
              }}
            >
              {/* Header */}
              <div className="p-4 flex items-center justify-between border-b"
                style={{ borderColor: 'rgba(226,232,240,0.5)', background: 'linear-gradient(180deg, rgba(248,250,252,0.5), transparent)' }}>
                <div className="flex items-center gap-2.5">
                  <div className={`w-2.5 h-2.5 rounded-full transition-all duration-500 ${
                    status?.running ? 'bg-green-500 shadow-sm shadow-green-300 animate-pulse' : 'bg-slate-300'
                  }`} />
                  <h3 className="font-semibold text-sm text-text-primary">实时活动</h3>
                  {activities.length > 0 && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
                      style={{ background: 'rgba(22,93,255,0.08)', color: '#165DFF' }}>{activities.length}</span>
                  )}
                </div>
                {status?.running && (
                  <span className="text-[10px] font-semibold flex items-center gap-1.5" style={{ color: '#00B42A' }}>
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"/>
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500"/>
                    </span>
                    实时推送
                  </span>
                )}
              </div>

              <div ref={listScrollRef} onScroll={handleListScroll} className="max-h-[55vh] overflow-y-auto custom-scrollbar">
                {/* Skeleton: monitoring but no activities yet */}
                {status?.running && activities.length === 0 ? (
                  <div className="py-10 space-y-4 px-4">
                    {[1,2,3].map(i => (
                      <div key={i} className="animate-shimmer rounded-2xl h-16" />
                    ))}
                    <p className="text-center text-xs font-medium text-text-muted pt-2">⏳ 正在监听抢答活动...</p>
                  </div>
                ) : activities.length === 0 ? (
                  <div className="py-16 flex flex-col items-center">
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
                      className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4 border"
                      style={{
                        background: 'rgba(241,245,249,0.8)',
                        borderColor: 'rgba(226,232,240,0.4)',
                      }}
                    >
                      <Activity size={28} className="text-slate-300" />
                    </motion.div>
                    <p className="text-sm font-semibold text-slate-300">{status?.running ? '等待抢答活动中...' : '点击「启动监控」开始'}</p>
                    {status?.running && <p className="text-xs text-slate-300 mt-1">实时推送抢答事件</p>}
                  </div>
                ) : (
                  (() => {
                    const curCourseId = String(config.course_id || '');
                    const filtered = curCourseId
                      ? activities.filter(a => String(a.course_id || '') === curCourseId || a.course_name === selectedCourse?.name)
                      : activities;
                    const sorted = [...filtered].sort((a, b) => {
                      const da = a._detected_at || (a.created_at ? new Date(a.created_at).getTime() : 0);
                      const db = b._detected_at || (b.created_at ? new Date(b.created_at).getTime() : 0);
                      return db - da;
                    });
                    const nowDate = new Date();
                    const todayStr = `${nowDate.getFullYear()}-${nowDate.getMonth()+1}-${nowDate.getDate()}`;
                    const yesterdayDate = new Date(nowDate);
                    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
                    const yesterdayStr = `${yesterdayDate.getFullYear()}-${yesterdayDate.getMonth()+1}-${yesterdayDate.getDate()}`;

                    const groups: { label: string; items: typeof sorted }[] = [];
                    const todayItems: typeof sorted = [];
                    const yesterdayItems: typeof sorted = [];
                    const olderItems: typeof sorted = [];
                    sorted.forEach(act => {
                      const dt = act._detected_at || (act.created_at ? new Date(act.created_at).getTime() : 0);
                      const d = dt ? new Date(dt) : new Date();
                      const ds = `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
                      if (ds === todayStr) todayItems.push(act);
                      else if (ds === yesterdayStr) yesterdayItems.push(act);
                      else olderItems.push(act);
                    });
                    if (todayItems.length > 0) groups.push({ label: '今天', items: todayItems });
                    if (yesterdayItems.length > 0) groups.push({ label: '昨天', items: yesterdayItems });
                    if (olderItems.length > 0) groups.push({ label: '更早', items: olderItems });

                    return groups.map((group) => (
                      <div key={group.label}>
                        {groups.length > 1 && (
                          <div className="px-4 py-2 sticky top-0 z-10 flex items-center gap-2"
                            style={{
                              background: 'rgba(248,250,252,0.85)',
                              backdropFilter: 'blur(8px)',
                              WebkitBackdropFilter: 'blur(8px)',
                              borderBottom: '1px solid rgba(226,232,240,0.5)',
                            }}
                          >
                            <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider">{group.label}</span>
                            <span className="text-[10px] text-text-muted">· {group.items.length}</span>
                          </div>
                        )}
                        {group.items.map((act, idx) => {
                          const actId = String(act.activity_id || act.activeId || act.active_id || act.id || '');
                          const ansStatus = act._answerStatus;
                          const isPending = ansStatus === 'pending';
                          const isSuccess = ansStatus === 'success';
                          const isFailed = ansStatus === 'failed';
                          const isAnswered = isSuccess || isFailed;
                          const isManual = act._isManual === true;
                          const isHighlighted = highlightedIds.has(actId);

                          const detectedAt = act._detected_at || (act.created_at ? new Date(act.created_at).getTime() : 0);
                          const diffSec = detectedAt ? Math.floor((Date.now() - detectedAt) / 1000) : 0;
                          const relativeTime = diffSec <= 0 ? '刚刚' : diffSec < 60 ? `${diffSec}秒前` : diffSec < 3600 ? `${Math.floor(diffSec/60)}分钟前` : diffSec < 86400 ? `${Math.floor(diffSec/3600)}小时前` : '';

                          const endTime = act.end_time || 0;
                          const isActive = endTime > 0 && now < endTime;
                          const isExpired = endTime > 0 && now >= endTime;

                          // Status color
                          const statusColor = isPending ? '#FF7D00' : isSuccess ? '#00B42A' : isFailed ? '#F53F3F' : isActive ? '#165DFF' : '#94A3B8';

                          return (
                            <div
                              key={actId || `${group.label}-${idx}`}
                              className={`anim-slide-up relative px-4 py-3.5 flex items-center gap-3 transition-all duration-500 border-b last:border-0 hover:bg-slate-50/60 gpu-layer ${
                                isHighlighted ? 'bg-gradient-to-r from-emerald-100/80 via-emerald-50/40 to-transparent' :
                                isPending ? 'bg-gradient-to-r from-amber-50/80 via-amber-50/20 to-transparent' :
                                isSuccess ? 'bg-gradient-to-r from-emerald-50/50 via-white to-transparent' :
                                isFailed ? 'bg-gradient-to-r from-rose-50/50 via-white to-transparent' :
                                isExpired ? 'opacity-50' : ''
                              }`}
                              style={{ borderColor: 'rgba(226,232,240,0.4)' }}
                            >
                              {/* Status dot — timeline style */}
                              <div className="absolute top-4 left-3.5">
                                <div className="w-2.5 h-2.5 rounded-full ring-2 ring-white shadow-sm"
                                  style={{
                                    backgroundColor: statusColor,
                                    animation: isPending || (isActive && !isAnswered) ? 'pulse-glow 2s cubic-bezier(0.4,0,0.2,1) infinite' : undefined,
                                  }}
                                />
                              </div>

                              {/* Status icon */}
                              <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ml-2 transition-all duration-300 shadow-sm"
                                style={{
                                  background: isPending ? 'rgba(255,125,0,0.1)' : isSuccess ? 'rgba(0,180,42,0.1)' : isFailed ? 'rgba(245,63,63,0.1)' : isActive ? 'rgba(22,93,255,0.08)' : 'rgba(148,163,184,0.1)',
                                  border: `1.5px solid ${isPending ? 'rgba(255,125,0,0.3)' : isSuccess ? 'rgba(0,180,42,0.3)' : isFailed ? 'rgba(245,63,63,0.3)' : isActive ? 'rgba(22,93,255,0.2)' : 'rgba(148,163,184,0.15)'}`,
                                }}
                              >
                                {isPending ? (
                                  <Loader2 className="w-4.5 h-4.5 animate-spin" style={{ color: '#FF7D00' }} />
                                ) : isSuccess ? (
                                  <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 400, damping: 15 }}>
                                    <CheckCircle className="w-4.5 h-4.5" style={{ color: '#00B42A' }} />
                                  </motion.div>
                                ) : isFailed ? (
                                  <XCircle className="w-4.5 h-4.5" style={{ color: '#F53F3F' }} />
                                ) : isActive ? (
                                  <Zap className="w-4.5 h-4.5" style={{ color: '#165DFF' }} />
                                ) : (
                                  <Clock className="w-4 h-4 text-slate-400" />
                                )}
                              </div>

                              {/* Content */}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <p className="font-semibold text-sm text-text-primary truncate">抢答</p>
                                  {isAnswered && act._elapsed ? (
                                    <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-md flex-shrink-0"
                                      style={{ background: 'rgba(22,93,255,0.08)', color: '#165DFF' }}>
                                      {act._elapsed}ms
                                    </span>
                                  ) : null}
                                  {isManual && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-md font-bold flex-shrink-0 text-white shadow-sm"
                                      style={{ background: 'linear-gradient(135deg, #165DFF, #4f39d0)' }}>
                                      [手动]
                                    </span>
                                  )}
                                  {isPending && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-md font-bold animate-pulse flex items-center gap-0.5 flex-shrink-0"
                                      style={{ background: 'rgba(255,125,0,0.15)', color: '#c2410c' }}>
                                      <Loader2 className="w-2 h-2 animate-spin" />抢答中
                                    </span>
                                  )}
                                  {isSuccess && (
                                    <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }}
                                      className="text-[10px] px-1.5 py-0.5 rounded-md font-bold flex-shrink-0"
                                      style={{ background: 'rgba(0,180,42,0.15)', color: '#15803d' }}>
                                      ✅ 成功
                                    </motion.span>
                                  )}
                                  {isFailed && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-md font-bold flex-shrink-0"
                                      style={{ background: 'rgba(245,63,63,0.12)', color: '#dc2626' }}>
                                      ❌ 失败
                                    </span>
                                  )}
                                  {!isAnswered && isExpired && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-md font-bold flex-shrink-0 bg-slate-100 text-slate-500">已结束</span>
                                  )}
                                </div>
                                <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                                  {act.course_name && <span className="text-[10px] text-text-muted font-medium">📚 {act.course_name}</span>}
                                  {relativeTime && <span className="text-[10px] text-text-muted">{relativeTime}</span>}
                                  {isActive && !isAnswered && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-md font-bold animate-pulse"
                                      style={{ background: 'rgba(255,125,0,0.12)', color: '#c2410c' }}>
                                      ⏳ {formatCountdown(endTime)}
                                    </span>
                                  )}
                                  {act._answerMsg && isFailed && (
                                    <span className="text-[10px] truncate max-w-[160px]" style={{ color: '#dc2626', opacity: 0.8 }}>{act._answerMsg}</span>
                                  )}
                                </div>
                              </div>

                              {/* Manual answer button */}
                              {!isAnswered && isActive && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleManualAnswer(parseInt(actId)); }}
                                  disabled={loading.toggle}
                                  className="btn-tap-sm px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1 flex-shrink-0 text-white transition-all disabled:opacity-50 shadow-md"
                                  style={{
                                    background: 'linear-gradient(135deg, #165DFF, #4f39d0)',
                                    boxShadow: '0 2px 8px rgba(22,93,255,0.35)',
                                  }}
                                >
                                  <Zap className="w-3 h-3" />抢答
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ));
                  })()
                )}
              </div>
            </div>

            {/* Real-time logs — timeline style */}
            <AnimatePresence>
              {answerLogs.length > 0 && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                  className="rounded-2xl border overflow-hidden"
                  style={{
                    background: 'rgba(255,255,255,0.85)',
                    backdropFilter: 'blur(12px)',
                    WebkitBackdropFilter: 'blur(12px)',
                    borderColor: 'rgba(226,232,240,0.6)',
                    boxShadow: '0 2px 16px rgba(0,0,0,0.04)',
                  }}
                >
                  <div className="p-4 border-b flex items-center justify-between"
                    style={{ borderColor: 'rgba(226,232,240,0.5)', background: 'linear-gradient(180deg, rgba(248,250,252,0.5), transparent)' }}>
                    <h3 className="font-semibold text-sm text-text-primary flex items-center gap-2">
                      <Zap className="w-4 h-4" style={{ color: '#FF7D00' }} />
                      实时日志
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-bold"
                        style={{ background: 'rgba(255,125,0,0.1)', color: '#c2410c' }}>{answerLogs.length}</span>
                    </h3>
                  </div>
                  <div className="max-h-48 overflow-y-auto custom-scrollbar">
                    {answerLogs.map((log, idx) => (
                      <div key={`${log.activeId}-${idx}`}
                        className="px-4 py-3 flex items-start gap-3 border-b last:border-0 transition-colors hover:bg-slate-50/50"
                        style={{ borderColor: 'rgba(226,232,240,0.3)' }}
                      >
                        {/* Timeline dot */}
                        <div className="relative mt-0.5 timeline-dot">
                          <div className="w-3 h-3 rounded-full ring-2 ring-white shadow-sm" style={{
                            backgroundColor: log.status === 'pending' ? '#FF7D00' : log.status === 'success' ? '#00B42A' : '#F53F3F',
                          }} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <p className="text-sm font-semibold text-text-primary">{log.activityName}</p>
                            {log.status === 'pending' && (
                              <span className="text-[10px] font-bold animate-pulse flex items-center gap-0.5"
                                style={{ color: '#FF7D00' }}>抢答中...</span>
                            )}
                          </div>
                          <p className="text-[11px] text-text-muted mt-0.5">{log.time} · {log.message}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}

        {/* ========== 设置面板 ========== */}
        {activeTab === 'settings' && (
          <>
            {/* Course selection */}
            <div className="rounded-2xl border overflow-hidden"
              style={{
                background: 'rgba(255,255,255,0.85)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                borderColor: 'rgba(226,232,240,0.6)',
                boxShadow: '0 2px 16px rgba(0,0,0,0.04)',
              }}
            >
              <div className="p-4 border-b flex items-center gap-3"
                style={{ borderColor: 'rgba(226,232,240,0.5)' }}>
                <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                  style={{ background: 'linear-gradient(135deg, #f3e8ff, #e9d5ff)' }}>
                  <BookOpen className="w-4 h-4 text-info-500" />
                </div>
                <div>
                  <h3 className="font-semibold text-sm text-text-primary">监控课程</h3>
                  <p className="text-[10px] text-text-muted">选择一个课程进行抢答监控</p>
                </div>
                {loading.courses && <Loader2 className="w-4 h-4 animate-spin ml-auto" style={{ color: '#722ED1' }} />}
              </div>
              <div className="max-h-72 overflow-y-auto custom-scrollbar">
                {courses.length === 0 ? (
                  <div className="py-12 text-center text-text-muted">
                    {loading.courses ? (
                      <><Loader2 className="w-6 h-6 mx-auto animate-spin mb-2" /><p className="text-xs">加载中</p></>
                    ) : (<p className="text-sm">暂无课程，请先在主页同步</p>)}
                  </div>
                ) : (
                  <div className="p-3 space-y-2">
                    {courses.map((course: any) => {
                      const cid = course.course_id || course.id;
                      const sel = String(config.course_id) === String(cid) && String(config.class_id) === String(course.class_id);
                      return (
                        <div key={`${cid}-${course.class_id}`}
                          onClick={() => { setSelectedCourse(course); setConfig((p: any) => ({ ...p, course_id: cid, class_id: course.class_id })); }}
                          className={`btn-tap-sm p-3 rounded-2xl cursor-pointer flex items-center gap-3 transition-all duration-200 ${
                            sel
                              ? 'border-2 shadow-sm'
                              : 'border-2 border-transparent hover:bg-white hover:border-slate-100'
                          }`}
                          style={sel ? {
                            background: 'rgba(22,93,255,0.05)',
                            borderColor: 'rgba(22,93,255,0.3)',
                            boxShadow: '0 2px 8px rgba(22,93,255,0.08)',
                          } : { background: 'rgba(248,250,252,0.5)' }}
                        >
                          <div className="w-11 h-11 rounded-xl bg-white shadow-sm overflow-hidden flex-shrink-0 flex items-center justify-center border border-slate-100">
                            {course.icon ? <img src={course.icon} alt="" className="w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} /> : <BookOpen className="w-5 h-5 text-slate-300" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-sm text-text-primary truncate">{course.name}</p>
                            <p className="text-[11px] text-text-muted truncate">{course.teacher || ''}</p>
                          </div>
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-200 ${
                            sel ? 'text-white' : 'border-2 border-slate-200'
                          }`}
                            style={sel ? { background: 'linear-gradient(135deg, #165DFF, #4f39d0)' } : {}}
                          >
                            {sel && <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Settings controls */}
            <div className="rounded-2xl border overflow-hidden"
              style={{
                background: 'rgba(255,255,255,0.85)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                borderColor: 'rgba(226,232,240,0.6)',
                boxShadow: '0 2px 16px rgba(0,0,0,0.04)',
              }}
            >
              {/* Auto answer toggle */}
              <div className="p-4 flex items-center justify-between"
                style={{ borderBottom: '1px solid rgba(226,232,240,0.4)' }}>
                <div>
                  <p className="font-semibold text-sm text-text-primary">自动抢答</p>
                  <p className="text-[11px] text-text-muted mt-0.5">检测到抢答活动后立即提交</p>
                </div>
                <button
                  onClick={() => setConfig({ ...config, auto_answer: !config.auto_answer })}
                  className={`relative w-12 h-7 rounded-full transition-all duration-200 ${
                    config.auto_answer ? 'shadow-md' : ''
                  }`}
                  style={config.auto_answer ? {
                    background: 'linear-gradient(135deg, #00B42A, #36D399)',
                    boxShadow: '0 0 0 3px rgba(0,180,42,0.15)',
                  } : {
                    background: '#cbd5e1',
                  }}
                >
                  <span className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow transition-all duration-200 ${
                    config.auto_answer ? 'left-[22px]' : 'left-0.5'
                  }`} />
                </button>
              </div>

              {/* Delay slider */}
              <div className="p-4" style={{ borderBottom: '1px solid rgba(226,232,240,0.4)' }}>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="font-semibold text-sm text-text-primary">抢答延迟</p>
                    <p className="text-[11px] text-text-muted mt-0.5">毫秒，避开风控检测</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number" min="0" max="5000" step="1"
                      value={config.delay_ms || 0}
                      onChange={e => {
                        const v = Math.max(0, Math.min(5000, Number(e.target.value) || 0));
                        setConfig({ ...config, delay_ms: v });
                      }}
                      className="w-16 h-8 text-sm font-semibold text-text-primary text-center rounded-lg outline-none transition-all duration-200 tabular-nums input-glass"
                      style={{
                        background: 'rgba(248,250,252,0.8)',
                        border: '1px solid rgba(226,232,240,0.8)',
                      }}
                    />
                    <span className="text-xs font-semibold text-text-muted">ms</span>
                  </div>
                </div>
                <div className="relative w-full">
                  {/* Custom styled range slider with visible color fill */}
                  <style>{`
                    .quiz-delay-slider {
                      -webkit-appearance: none;
                      appearance: none;
                      width: 100%;
                      height: 6px;
                      border-radius: 3px;
                      background: linear-gradient(to right, #165DFF 0%, #165DFF ${Math.min((config.delay_ms || 0) / 2000 * 100, 100)}%, #e2e8f0 ${Math.min((config.delay_ms || 0) / 2000 * 100, 100)}%, #e2e8f0 100%);
                      outline: none;
                      cursor: pointer;
                    }
                    .quiz-delay-slider::-webkit-slider-thumb {
                      -webkit-appearance: none;
                      appearance: none;
                      width: 20px;
                      height: 20px;
                      border-radius: 50%;
                      background: #fff;
                      border: 2px solid #165DFF;
                      box-shadow: 0 2px 6px rgba(22,93,255,0.3);
                      cursor: pointer;
                      transition: transform 0.15s ease;
                    }
                    .quiz-delay-slider::-webkit-slider-thumb:hover {
                      transform: scale(1.15);
                    }
                    .quiz-delay-slider::-moz-range-thumb {
                      width: 20px;
                      height: 20px;
                      border-radius: 50%;
                      background: #fff;
                      border: 2px solid #165DFF;
                      box-shadow: 0 2px 6px rgba(22,93,255,0.3);
                      cursor: pointer;
                    }
                    .quiz-delay-slider::-moz-range-progress {
                      background: #165DFF;
                      height: 6px;
                      border-radius: 3px;
                    }
                    .quiz-delay-slider::-moz-range-track {
                      background: #e2e8f0;
                      height: 6px;
                      border-radius: 3px;
                    }
                  `}</style>
                  <input
                    type="range" min="0" max="2000" step="10"
                    value={Math.min(config.delay_ms || 0, 2000)}
                    onChange={e => setConfig({ ...config, delay_ms: Number(e.target.value) })}
                    className="quiz-delay-slider"
                  />
                  {/* Tick marks */}
                  <div className="flex justify-between mt-1.5">
                    <span className="text-[9px] font-medium text-text-muted">0</span>
                    <span className="text-[9px] font-medium text-text-muted">500</span>
                    <span className="text-[9px] font-medium text-text-muted">1000</span>
                    <span className="text-[9px] font-medium text-text-muted">1500</span>
                    <span className="text-[9px] font-medium text-text-muted">2000</span>
                  </div>
                </div>
              </div>

              {/* Save button */}
              <div className="p-4">
                <button
                  onClick={handleSaveConfig}
                  disabled={loading.save}
                  className="btn-tap w-full py-3 rounded-2xl font-semibold text-sm flex items-center justify-center gap-2 text-white transition-all duration-200 disabled:opacity-50 shadow-lg"
                  style={{
                    background: 'linear-gradient(135deg, #165DFF, #4f39d0)',
                    boxShadow: '0 4px 16px rgba(22,93,255,0.3)',
                  }}
                >
                  {loading.save ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}保存配置
                  {saveSuccess && (
                    <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }}>
                      <CheckCircle className="w-4 h-4" />
                    </motion.span>
                  )}
                </button>
              </div>
            </div>
          </>
        )}

        {/* ========== 日志面板 ========== */}
        {activeTab === 'history' && (
          <div className="rounded-2xl border overflow-hidden"
            style={{
              background: 'rgba(255,255,255,0.85)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              borderColor: 'rgba(226,232,240,0.6)',
              boxShadow: '0 2px 16px rgba(0,0,0,0.04)',
            }}
          >
            <div className="p-4 border-b flex items-center justify-between"
              style={{ borderColor: 'rgba(226,232,240,0.5)' }}>
              <h3 className="font-semibold text-sm text-text-primary flex items-center gap-2">
                <History className="w-4 h-4 text-brand-600" />
                全部记录
                <span className="text-[11px] text-text-muted font-normal">{records.length} 条</span>
              </h3>
              {records.length > 0 && (
                <button onClick={handleClearRecords}
                  className="text-xs font-semibold flex items-center gap-1 px-3 py-1.5 rounded-lg transition-all duration-200 hover:scale-105 active:scale-95"
                  style={{ color: '#F53F3F', background: 'rgba(245,63,63,0.06)' }}>
                  <Trash2 className="w-3 h-3" />清空
                </button>
              )}
            </div>
            {records.length === 0 ? (
              <div className="py-16 text-center">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3 border"
                  style={{
                    background: 'rgba(241,245,249,0.8)',
                    borderColor: 'rgba(226,232,240,0.4)',
                  }}>
                  <History size={24} className="text-slate-300" />
                </div>
                <p className="text-sm font-semibold text-slate-300">暂无抢答记录</p>
                <p className="text-xs text-slate-300 mt-1">启动监控后，抢答结果会显示在这里</p>
              </div>
            ) : (
              <div className="divide-y max-h-[60vh] overflow-y-auto custom-scrollbar"
                style={{ borderColor: 'rgba(226,232,240,0.3)' }}>
                {records.map((r: any, idx: number) => (
                  <div key={idx} className="px-4 py-3.5 flex items-center gap-3 hover:bg-slate-50/50 transition-colors">
                    {/* Timeline dot */}
                    <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ring-2 ring-white shadow-sm ${
                      r.success ? 'bg-success-500' : 'bg-error-500'
                    }`} />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm text-text-primary">活动 #{String(r.activity_id).slice(-6)}</p>
                      <p className="text-[11px] text-text-muted mt-0.5">
                        {r.created_at ? new Date(r.created_at).toLocaleString('zh-CN') : ''} · {r.message}
                      </p>
                    </div>
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-lg ${
                      r.success
                        ? 'text-success-500'
                        : 'text-error-500'
                    }`}
                      style={{
                        background: r.success ? 'rgba(0,180,42,0.08)' : 'rgba(245,63,63,0.08)',
                      }}
                    >{r.success ? '成功' : '失败'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
