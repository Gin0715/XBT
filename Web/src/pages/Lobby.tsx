import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion';
import {
  User as UserIcon,
  Settings,
  ShieldCheck,
  RefreshCw,
  Clock,
  ChevronRight,
  ChevronDown,
  Activity,
  QrCode,
  MapPin,
  Fingerprint,
  BookOpen,
  CheckCircle2,
  RectangleEllipsis,
  Zap,
  Navigation,
  Plus,
  Trash2,
  Edit3,
  X,
  Loader2,
  Crosshair
} from 'lucide-react';
import toast from 'react-hot-toast';
import client from '../api/client';
import { useAuthStore } from '../store/auth';
import { getChineseStringByDatetime } from '../utils/datetime';
import type { ApiResponse, CourseActivities } from '../types';
import PullToRefresh from '../components/PullToRefresh';
import { getLocations, createLocation, updateLocation, deleteLocation, type LocationPreset } from '../api/location';
import { getCurrentPosition, reverseGeocode, type AMapAddress } from '../utils/amap';
import { validateCoord } from '../utils/coords';
import { LocationForm, type LocationFormData } from '../components/location/LocationForm';

type PendingActivityEntry = {
  activity: CourseActivities['activities'][number];
  course: CourseActivities;
};

const RefreshIndicator = ({ spinning }: { spinning: boolean }) => {
  const rafRef = useRef<number | null>(null);
  const angleRef = useRef(0);
  const [angle, setAngle] = useState(0);

  const stopRaf = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  useEffect(() => {
    if (spinning) {
      stopRaf();
      let last = performance.now();
      const tick = (now: number) => {
        const delta = now - last;
        last = now;
        angleRef.current = (angleRef.current + delta * 0.36) % 360;
        setAngle(angleRef.current);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
      return () => stopRaf();
    }

    stopRaf();
    const current = ((angleRef.current % 360) + 360) % 360;
    if (current < 0.5) {
      angleRef.current = 0;
      setAngle(0);
      return;
    }

    const remain = 360 - current;
    const duration = Math.max(140, Math.min(260, (remain / 360) * 260));
    const start = performance.now();
    const settle = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = current + remain * eased;
      angleRef.current = next % 360;
      setAngle(angleRef.current);

      if (t < 1) {
        rafRef.current = requestAnimationFrame(settle);
      } else {
        angleRef.current = 0;
        setAngle(0);
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(settle);
    return () => stopRaf();
  }, [spinning]);

  useEffect(() => () => stopRaf(), []);

  return <RefreshCw size={20} style={{ transform: `rotate(${angle}deg)` }} />;
};

const Lobby = () => {
  const { user, activeUid } = useAuthStore();
  const navigate = useNavigate();

  const [activities, setActivities] = useState<CourseActivities[]>(() => {
    const cached = localStorage.getItem(`cached_activities_${activeUid}`);
    return cached ? JSON.parse(cached) : [];
  });

  const [isLoading, setIsLoading] = useState(false);
  const [expandedCourses, setExpandedCourses] = useState<Record<string, boolean>>({});
  const [now, setNow] = useState(Date.now());
  const [pendingEntry, setPendingEntry] = useState<PendingActivityEntry | null>(null);

  const [isLocationPanelOpen, setIsLocationPanelOpen] = useState(false);
  const [locationPresets, setLocationPresets] = useState<LocationPreset[]>([]);
  const [currentPosition, setCurrentPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [geoAddress, setGeoAddress] = useState<AMapAddress | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [editingLoc, setEditingLoc] = useState<LocationPreset | null>(null);
  const [isAddingLoc, setIsAddingLoc] = useState(false);
  const [locForm, setLocForm] = useState({ name: '', lat: '', lng: '', description: '' });
  const [locateSuccess, setLocateSuccess] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const fetchLocations = async () => {
    try {
      const res = await getLocations();
      const data = (res.data as any)?.data || res.data || [];
      setLocationPresets(Array.isArray(data) ? data : []);
    } catch (e) {}
  };

  const handleLocate = async () => {
    setIsLocating(true);
    setGeoAddress(null);
    setLocateSuccess(false);
    try {
      const pos = await getCurrentPosition();
      setCurrentPosition(pos);
      setLocForm(f => ({ ...f, lat: pos.lat.toFixed(6), lng: pos.lng.toFixed(6) }));
      setLocateSuccess(true);
      setTimeout(() => setLocateSuccess(false), 1500);
      toast.success('定位成功');

      setIsGeocoding(true);
      try {
        const addr = await reverseGeocode(pos.lat, pos.lng);
        setGeoAddress(addr);
        if (!locForm.name && addr.poiName) setLocForm(f => ({ ...f, name: addr.poiName }));
        if (!locForm.description && addr.formattedAddress) setLocForm(f => ({ ...f, description: addr.formattedAddress }));
      } catch { /* 逆地理编码失败不报错 */ }
      finally { setIsGeocoding(false); }
    } catch (err: any) {
      toast.error('定位失败: ' + (err.message || '未知错误'));
    } finally {
      setIsLocating(false);
    }
  };

  const handleAddLocation = async () => {
    if (!locForm.name || !locForm.lat || !locForm.lng) { toast.error('请填写名称和坐标'); return; }
    const coordCheck = validateCoord(locForm.lat, locForm.lng);
    if (!coordCheck.valid) { toast.error(coordCheck.error!); return; }
    try {
      const res = await createLocation(locForm);
      const created = (res.data as any)?.data || res.data;
      setLocationPresets(p => [...p, created]);
      setLocForm({ name: '', lat: '', lng: '', description: '' });
      setIsAddingLoc(false);
      toast.success('地址已添加');
    } catch (e: any) { toast.error(e.message || '添加失败'); }
  };

  const handleUpdateLocation = async (preset: LocationPreset) => {
    const coordCheck = validateCoord(preset.lat, preset.lng);
    if (!coordCheck.valid) { toast.error(coordCheck.error!); return; }
    try {
      await updateLocation(preset.id, { name: preset.name, lat: preset.lat, lng: preset.lng, description: preset.description });
      setLocationPresets(p => p.map(l => l.id === preset.id ? preset : l));
      setEditingLoc(null);
      toast.success('已更新');
    } catch (e: any) { toast.error(e.message || '更新失败'); }
  };

  const handleDeleteLocation = async (id: number) => {
    if (!confirm('删除该地址？')) return;
    try { await deleteLocation(id); setLocationPresets(p => p.filter(l => l.id !== id)); toast.success('已删除'); }
    catch (e: any) { toast.error(e.message || '删除失败'); }
  };

  const fetchActivities = useCallback(async () => {
    if (isLoading) return;
    setIsLoading(true);
    try {
      const response = await client.get<ApiResponse<CourseActivities[]>>('/sign/activities');
      const data = response.data.data;
      setActivities(data || []);
      if (activeUid && data) {
        localStorage.setItem(`cached_activities_${activeUid}`, JSON.stringify(data));
      }
    } catch (error: any) {
      toast.error(error.message || '获取签到活动失败');
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, activeUid]);

  useEffect(() => {
    fetchActivities();
  }, [activeUid]);

  const toggleCourse = (courseId: number, classId: number) => {
    const key = `${courseId}-${classId}`;
    setExpandedCourses(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  const getSignTypeIcon = (type: number) => {
    switch (type) {
      case 2: return <QrCode size={18} />;
      case 3: return <Fingerprint size={18} />;
      case 4: return <MapPin size={18} />;
      case 5: return <RectangleEllipsis size={18} />;
      default: return <CheckCircle2 size={18} />;
    }
  };

  const getSignTypeName = (type: number) => {
    switch (type) {
      case 2: return '二维码';
      case 3: return '手势';
      case 4: return '位置';
      case 5: return '签到码';
      default: return '普通';
    }
  };

  const getSignState = (source: number, name: string) => {
    if (source === -1) return '学习通签到';
    if (source === user?.uid) return `本人签到`;
    return `${name}代签`;
  };

  const enterActivity = (activity: CourseActivities['activities'][number], course: CourseActivities) => {
    navigate(`/sign/${activity.active_id}`, { state: { activity, course } });
  };

  const handleActivityClick = (activity: CourseActivities['activities'][number], course: CourseActivities, shouldHighlight: boolean) => {
    if (shouldHighlight) {
      enterActivity(activity, course);
      return;
    }
    setPendingEntry({ activity, course });
  };

  return (
    <div className="flex-1 flex flex-col bg-transparent relative overflow-hidden">
      {/* ===== Header — glass effect ===== */}
      <div className="glass sticky top-0 z-10 border-b px-4 flex items-center shrink-0"
        style={{
          height: 'calc(80px + var(--sat))',
          paddingTop: 'var(--sat)',
          borderColor: 'rgba(226,232,240,0.4)',
          boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
        }}
      >
        <div className="flex items-center justify-between w-full">
          {/* User info */}
          <motion.div
            whileTap={{ scale: 0.94 }}
            onClick={() => navigate('/accounts')}
            className="flex items-center space-x-3 cursor-pointer group"
          >
            <div className="w-11 h-11 rounded-2xl overflow-hidden flex-shrink-0 ring-2 ring-white shadow-sm"
              style={{ border: '2px solid rgba(255,255,255,0.8)' }}>
              {user?.avatar ? (
                <img src={user.avatar} alt={user.name} referrerPolicy="no-referrer" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center"
                  style={{ background: 'linear-gradient(135deg, #e2e8f0, #cbd5e1)' }}>
                  <UserIcon size={24} className="text-white" />
                </div>
              )}
            </div>
            <div>
              <h2 className="font-bold text-text-primary flex items-center group-hover:text-brand-600 transition-colors">
                {user?.name || '未登录'}
                <ChevronRight size={14} className="ml-1 text-text-muted group-hover:text-brand-400 transition-colors" />
              </h2>
              <p className="text-xs text-text-secondary font-medium">{user?.mobile}</p>
            </div>
          </motion.div>

          {/* Action buttons */}
          <div className="flex items-center gap-0.5">
            <motion.button
              whileTap={{ scale: 0.92 }}
              whileHover={{ scale: 1.08 }}
              onClick={() => { setIsLocationPanelOpen(true); fetchLocations(); }}
              className="p-2.5 rounded-xl transition-all duration-200 min-w-[44px] min-h-[44px] flex items-center justify-center"
              style={{ color: '#00B42A' }}
              title="地址库"
            >
              <MapPin size={20} />
            </motion.button>

            <motion.button
              whileTap={{ scale: 0.92 }}
              whileHover={{ scale: 1.08 }}
              onClick={() => navigate('/quiz')}
              className="p-2.5 rounded-xl transition-all duration-200 min-w-[44px] min-h-[44px] flex items-center justify-center"
              style={{ color: '#FF7D00' }}
              title="抢答功能"
            >
              <Zap size={20} />
            </motion.button>

            <motion.button
              whileTap={{ scale: 0.92 }}
              whileHover={{ scale: 1.08 }}
              onClick={() => navigate('/courses')}
              className="p-2.5 rounded-xl transition-all duration-200 min-w-[44px] min-h-[44px] flex items-center justify-center text-text-secondary"
              title="课程配置"
            >
              <Settings size={20} />
            </motion.button>

            <motion.button
              whileTap={{ scale: 0.92 }}
              whileHover={{ scale: 1.08 }}
              onClick={fetchActivities}
              className="p-2.5 rounded-xl transition-all duration-200 min-w-[44px] min-h-[44px] flex items-center justify-center text-text-secondary"
              title="刷新活动"
            >
              <RefreshIndicator spinning={isLoading} />
            </motion.button>

            {user && user.permission >= 2 && (
              <motion.button
                whileTap={{ scale: 0.92 }}
                whileHover={{ scale: 1.08 }}
                onClick={() => navigate('/admin/whitelist')}
                className="p-2.5 rounded-xl transition-all duration-200 min-w-[44px] min-h-[44px] flex items-center justify-center text-text-secondary"
                title="白名单管理"
              >
                <ShieldCheck size={20} />
              </motion.button>
            )}
          </div>
        </div>
      </div>

      {/* ===== Main Content ===== */}
      <PullToRefresh
        onRefresh={fetchActivities}
        isRefreshing={isLoading}
        className="p-4"
      >
        <div className="pb-[calc(80px+var(--sab))] space-y-4">
          {isLoading && activities.length === 0 ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-24 rounded-3xl animate-shimmer border overflow-hidden"
                  style={{ borderColor: 'rgba(226,232,240,0.4)' }}>
                  <div className="p-4 flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-slate-100 flex-shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 bg-slate-100 rounded-lg w-2/3" />
                      <div className="h-3 bg-slate-50 rounded-lg w-1/3" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : !isLoading && activities.length === 0 ? (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
              className="flex flex-col items-center justify-center py-20 rounded-3xl border border-dashed shadow-sm"
              style={{
                borderColor: 'rgba(226,232,240,0.6)',
                background: 'rgba(255,255,255,0.7)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
              }}
            >
              <div className="relative mb-6">
                <div className="absolute inset-0 rounded-2xl bg-slate-100 blur-xl opacity-30" />
                <div className="relative w-20 h-20 rounded-2xl flex items-center justify-center border"
                  style={{
                    background: 'linear-gradient(135deg, #f1f5f9, #e2e8f0)',
                    borderColor: 'rgba(226,232,240,0.5)',
                  }}>
                  <Clock size={40} className="text-slate-300" />
                </div>
              </div>
              <p className="font-semibold text-sm" style={{ color: '#94A3B8' }}>暂无正在进行的签到</p>
              <p className="text-xs mt-1.5" style={{ color: '#c0c8d4' }}>下拉刷新或点击右上角刷新按钮获取最新活动</p>
              {/* Quick action button */}
              <motion.button
                whileTap={{ scale: 0.95 }}
                whileHover={{ scale: 1.03 }}
                onClick={() => navigate('/courses')}
                className="mt-6 px-5 py-2.5 rounded-xl text-sm font-semibold text-white shadow-lg transition-all duration-200"
                style={{
                  background: 'linear-gradient(135deg, #165DFF, #4f39d0)',
                  boxShadow: '0 4px 16px rgba(22,93,255,0.3)',
                }}
              >
                添加课程
              </motion.button>
            </motion.div>
          ) : (
            <LayoutGroup>
              {activities.map((course) => {
                const key = `${course.course_id}-${course.class_id}`;
                const isExpanded = expandedCourses[key];
                const activeCount = course.activities.filter(a =>
                  now < a.end_time && !a.record_source_name
                ).length;

                const latestActivityTime = course.activities.length > 0
                  ? Math.max(...course.activities.map(a => a.start_time))
                  : null;

                return (
                  <motion.div
                    layout
                    key={key}
                    className="card-glass overflow-hidden"
                  >
                    {/* Course Header */}
                    <motion.div
                      layout="position"
                      onClick={() => toggleCourse(course.course_id, course.class_id)}
                      className={`p-4 flex items-center justify-between cursor-pointer transition-colors ${
                        isExpanded ? 'bg-slate-50/50' : ''
                      }`}
                    >
                      <div className="flex items-center space-x-4 flex-1 min-w-0">
                        <div className="relative flex-shrink-0">
                          <div className="w-12 h-12 rounded-xl overflow-hidden shadow-sm"
                            style={{
                              background: 'linear-gradient(135deg, #f1f5f9, #e2e8f0)',
                              border: '1px solid rgba(226,232,240,0.5)',
                            }}>
                            {course.icon ? (
                              <img src={course.icon} referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-slate-300">
                                <BookOpen size={20} />
                              </div>
                            )}
                          </div>
                          {activeCount > 0 && (
                            <div className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] rounded-full flex items-center justify-center text-[13px] text-white font-bold px-0.5 z-10 shadow-sm"
                              style={{ background: 'linear-gradient(135deg, #F53F3F, #F87171)' }}>
                              {activeCount}
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-bold text-text-primary leading-tight truncate">{course.course_name}</h3>
                          <div className="flex items-center space-x-2 mt-1">
                            <p className="text-xs text-text-secondary truncate flex-1">{course.course_teacher}</p>
                            {latestActivityTime && !isExpanded && (
                              <span className={`text-[10px] font-semibold whitespace-nowrap flex-shrink-0 ${
                                activeCount > 0 ? 'text-brand-600' : 'text-text-muted'
                              }`}>
                                {getChineseStringByDatetime(latestActivityTime)}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <motion.div
                        animate={{ rotate: isExpanded ? 180 : 0 }}
                        transition={{ duration: 0.2 }}
                        className="text-slate-300 flex items-center ml-2 flex-shrink-0"
                      >
                        <ChevronDown size={20} />
                      </motion.div>
                    </motion.div>

                    {/* Activities List */}
                    <AnimatePresence initial={false}>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2, ease: "circOut" }}
                          className="overflow-hidden"
                        >
                          <div className="px-4 pb-4 space-y-2 border-t pt-3"
                            style={{ borderColor: 'rgba(226,232,240,0.4)' }}>
                            {course.activities.length > 0 ? (
                              course.activities.map((activity) => {
                                const isOngoing = now < activity.end_time;
                                const isFinished = !!activity.record_source_name;
                                const shouldHighlight = isOngoing && !isFinished;

                                let countdownStr = "";
                                if (shouldHighlight) {
                                  const diff = Math.max(0, activity.end_time - now);
                                  const mins = Math.floor(diff / 60000);
                                  const secs = Math.floor((diff % 60000) / 1000);
                                  countdownStr = `${mins}:${secs.toString().padStart(2, '0')}`;
                                }

                                return (
                                  <motion.div
                                    key={activity.active_id}
                                    layout
                                    whileTap={{ scale: 0.97 }}
                                    whileHover={{ scale: 1.01 }}
                                    onClick={() => handleActivityClick(activity, course, shouldHighlight)}
                                    className={`flex items-center justify-between p-3.5 rounded-2xl border transition-all group cursor-pointer ${
                                      shouldHighlight
                                        ? 'shadow-md'
                                        : 'hover:bg-white hover:border-slate-200 hover:shadow-sm'
                                    }`}
                                    style={shouldHighlight ? {
                                      background: 'linear-gradient(135deg, rgba(114,46,209,0.06), rgba(167,139,250,0.04))',
                                      borderColor: 'rgba(114,46,209,0.25)',
                                      boxShadow: '0 4px 16px rgba(114,46,209,0.1)',
                                    } : {
                                      background: 'rgba(248,250,252,0.5)',
                                      borderColor: 'rgba(226,232,240,0.4)',
                                    }}
                                  >
                                    <div className="flex items-center space-x-3 flex-1 min-w-0">
                                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-sm flex-shrink-0 bg-white ${
                                        shouldHighlight ? 'text-info-500' : 'text-brand-600'
                                      }`}>
                                        {getSignTypeIcon(activity.sign_type)}
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <div className="font-bold text-sm truncate text-text-primary">{activity.activity_name}</div>
                                        <div className="flex items-center space-x-2 mt-0.5 overflow-hidden">
                                          <span className="text-[10px] px-1.5 py-0.5 rounded-md font-semibold uppercase flex-shrink-0"
                                            style={{ background: 'rgba(22,93,255,0.08)', color: '#165DFF' }}>
                                            {getSignTypeName(activity.sign_type)}
                                          </span>
                                          {shouldHighlight && (
                                            <span className="text-[10px] px-1.5 py-0.5 rounded-md font-semibold whitespace-nowrap flex-shrink-0"
                                              style={{ background: 'rgba(114,46,209,0.08)', color: '#722ED1' }}>
                                              进行中 {countdownStr}
                                            </span>
                                          )}
                                          {activity.record_source_name && (
                                            <span className="text-[10px] px-1.5 py-0.5 rounded-md font-semibold truncate flex-shrink min-w-0"
                                              style={{ background: 'rgba(0,180,42,0.08)', color: '#15803d' }}>
                                              {getSignState(activity.record_source, activity.record_source_name)}
                                            </span>
                                          )}
                                          <span className="text-[10px] flex items-center flex-shrink-0 text-text-muted">
                                            <Clock size={10} className="mr-1" />
                                            {getChineseStringByDatetime(activity.start_time)}
                                          </span>
                                        </div>
                                      </div>
                                    </div>
                                    <ChevronRight size={18} className="text-slate-300 group-hover:text-brand-500 transition-colors ml-2 flex-shrink-0" />
                                  </motion.div>
                                );
                              })
                            ) : (
                              <div className="py-10 flex flex-col items-center justify-center text-slate-300">
                                <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-3"
                                  style={{ background: 'rgba(241,245,249,0.8)' }}>
                                  <Activity size={24} className="text-slate-300" />
                                </div>
                                <p className="text-xs font-medium text-text-muted">暂无签到活动</p>
                              </div>
                            )}
                            {course.has_more && (
                              <div className="text-center pt-2 pb-1">
                                <span className="text-[11px] text-text-muted font-medium bg-slate-50 px-3 py-1 rounded-full">
                                  仅显示最近 {course.activities.length} 条活动
                                </span>
                              </div>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })}
            </LayoutGroup>
          )}
        </div>
      </PullToRefresh>

      {/* ===== Pending entry dialog ===== */}
      <AnimatePresence>
        {pendingEntry && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-6"
            style={{ background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
            onClick={() => setPendingEntry(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 12 }}
              transition={{ type: 'spring', stiffness: 320, damping: 26 }}
              className="w-full max-w-sm rounded-[2.5rem] p-6 shadow-2xl border"
              style={{
                background: 'rgba(255,255,255,0.95)',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                borderColor: 'rgba(226,232,240,0.4)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="space-y-4">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto ring-4"
                  style={{
                    background: 'linear-gradient(135deg, #fef3c7, #fde68a)',
                    boxShadow: '0 0 0 4px rgba(251,191,36,0.15)',
                  }}>
                  <Clock size={28} style={{ color: '#d97706' }} />
                </div>
                <div className="text-center">
                  <p className="text-lg font-extrabold text-text-primary">温馨提示</p>
                  <p className="text-sm text-text-secondary mt-2 leading-6">
                    当前点击的签到活动（{pendingEntry.activity.activity_name}）已结束或已完成，仍要进入详情页吗？
                  </p>
                </div>
                <div className="flex items-center gap-3 pt-1">
                  <button
                    onClick={() => setPendingEntry(null)}
                    className="flex-1 rounded-xl px-4 py-3 text-sm font-semibold transition-all duration-200 hover:bg-slate-200 active:scale-95"
                    style={{ background: 'rgba(241,245,249,0.8)', color: '#64748B' }}
                  >
                    取消
                  </button>
                  <button
                    onClick={() => {
                      enterActivity(pendingEntry.activity, pendingEntry.course);
                      setPendingEntry(null);
                    }}
                    className="flex-1 rounded-xl px-4 py-3 text-sm font-semibold text-white shadow-lg transition-all duration-200 hover:scale-105 active:scale-95"
                    style={{
                      background: 'linear-gradient(135deg, #165DFF, #4f39d0)',
                      boxShadow: '0 4px 16px rgba(22,93,255,0.35)',
                    }}
                  >
                    确认进入
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ===== Location panel ===== */}
      <AnimatePresence>
        {isLocationPanelOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center"
            style={{ background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
            onClick={() => { setIsLocationPanelOpen(false); setEditingLoc(null); setIsAddingLoc(false); }}
          >
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 26, stiffness: 220 }}
              className="w-full sm:max-w-[420px] rounded-t-[2.5rem] overflow-hidden flex flex-col max-h-[88vh]"
              style={{
                background: 'rgba(255,255,255,0.97)',
                backdropFilter: 'blur(24px)',
                WebkitBackdropFilter: 'blur(24px)',
                boxShadow: '0 -8px 40px rgba(0,0,0,0.12)',
                border: '1px solid rgba(255,255,255,0.4)',
              }}
              onClick={e => e.stopPropagation()}
            >
              {/* Drag handle */}
              <div className="w-10 h-1.5 bg-slate-200 rounded-full mx-auto mt-4 shrink-0" />

              {/* Header */}
              <div className="px-6 pt-4 pb-2 shrink-0">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <div className="absolute inset-0 rounded-2xl blur-md opacity-40"
                        style={{ background: 'linear-gradient(135deg, #36D399, #0d9488)' }} />
                      <div className="relative w-11 h-11 rounded-2xl flex items-center justify-center shadow-lg ring-2 ring-emerald-100"
                        style={{ background: 'linear-gradient(135deg, #36D399, #0d9488)' }}>
                        <MapPin className="w-5 h-5 text-white" strokeWidth={2.5} />
                      </div>
                    </div>
                    <div>
                      <h3 className="text-lg font-extrabold text-text-primary tracking-tight">地址库</h3>
                      <p className="text-[10px] text-text-muted font-medium">高德地图 · 签到位置管理</p>
                    </div>
                  </div>
                  <button onClick={() => { setIsLocationPanelOpen(false); setEditingLoc(null); setIsAddingLoc(false); }}
                    className="w-9 h-9 flex items-center justify-center rounded-full transition-all duration-200 active:scale-90 hover:bg-slate-100"
                    style={{ color: '#94A3B8' }}>
                    <X size={18} />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-6 pb-[calc(24px+var(--sab))] space-y-5 custom-scrollbar">
                {/* Live location card */}
                <motion.div layout
                  className="relative overflow-hidden rounded-3xl text-white shadow-xl"
                  style={{
                    background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
                    boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
                  }}
                >
                  {/* Decorative blobs */}
                  <div className="absolute top-0 right-0 w-40 h-40 rounded-full -mr-16 -mt-16 pointer-events-none"
                    style={{ background: 'radial-gradient(circle, rgba(54,211,153,0.2) 0%, transparent 70%)' }} />
                  <div className="absolute bottom-0 left-0 w-32 h-32 rounded-full -ml-12 -mb-12 pointer-events-none"
                    style={{ background: 'radial-gradient(circle, rgba(13,148,136,0.15) 0%, transparent 70%)' }} />
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 rounded-full pointer-events-none"
                    style={{ background: 'radial-gradient(circle, rgba(6,182,212,0.1) 0%, transparent 70%)' }} />

                  {/* Locate success ripple */}
                  <AnimatePresence>
                    {locateSuccess && (
                      <motion.div
                        initial={{ opacity: 0.6, scale: 0.3 }}
                        animate={{ opacity: 0, scale: 2.5 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 1.2, ease: 'easeOut' }}
                        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-20 h-20 rounded-full border-2 pointer-events-none"
                        style={{ borderColor: 'rgba(54,211,153,0.6)' }}
                      />
                    )}
                  </AnimatePresence>

                  <div className="relative p-5">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h4 className="font-extrabold text-sm flex items-center gap-2">
                          <span className="relative flex h-2.5 w-2.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400" />
                          </span>
                          实时定位
                        </h4>
                        <p className="text-[10px] text-slate-400 mt-0.5 font-medium">AMap · Geolocation + Geocoder</p>
                      </div>
                      <motion.button whileTap={{ scale: 0.9 }} whileHover={{ scale: 1.05 }}
                        onClick={handleLocate} disabled={isLocating}
                        className={`relative flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold transition-all disabled:opacity-60 ${
                          currentPosition
                            ? 'bg-white/15 hover:bg-white/20 text-white backdrop-blur'
                            : 'text-white shadow-lg'
                        }`}
                        style={!currentPosition ? {
                          background: 'linear-gradient(135deg, #00B42A, #36D399)',
                          boxShadow: '0 4px 16px rgba(0,180,42,0.35)',
                        } : {}}
                      >
                        {isLocating ? (
                          <><Loader2 className="w-3.5 h-3.5 animate-spin" />定位中…</>
                        ) : currentPosition ? (
                          <><Navigation className="w-3.5 h-3.5" />重新定位</>
                        ) : (
                          <><Navigation className="w-3.5 h-3.5" />获取定位</>
                        )}
                      </motion.button>
                    </div>

                    {currentPosition ? (
                      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
                        <div className="backdrop-blur rounded-2xl p-3.5 grid grid-cols-2 gap-3 border"
                          style={{
                            background: 'rgba(255,255,255,0.08)',
                            borderColor: 'rgba(255,255,255,0.06)',
                          }}>
                          <div>
                            <div className="text-[10px] text-slate-400 mb-1 font-medium tracking-wide">纬度</div>
                            <div className="font-mono font-bold text-sm tracking-tight">{currentPosition.lat.toFixed(6)}°</div>
                          </div>
                          <div>
                            <div className="text-[10px] text-slate-400 mb-1 font-medium tracking-wide">经度</div>
                            <div className="font-mono font-bold text-sm tracking-tight">{currentPosition.lng.toFixed(6)}°</div>
                          </div>
                        </div>

                        {isGeocoding ? (
                          <div className="backdrop-blur rounded-2xl p-4 flex items-center gap-3 border-dashed"
                            style={{
                              background: 'rgba(255,255,255,0.05)',
                              border: '1px dashed rgba(255,255,255,0.08)',
                            }}>
                            <div className="w-8 h-8 rounded-xl flex items-center justify-center"
                              style={{ background: 'rgba(0,180,42,0.2)' }}>
                              <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                            </div>
                            <div>
                              <p className="text-xs font-bold text-slate-300">正在解析地址…</p>
                              <p className="text-[10px] text-slate-500 mt-0.5">高德逆地理编码查询中</p>
                            </div>
                          </div>
                        ) : geoAddress ? (
                          <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                            className="backdrop-blur rounded-2xl p-4 space-y-3 border"
                            style={{
                              background: 'rgba(255,255,255,0.08)',
                              borderColor: 'rgba(255,255,255,0.06)',
                            }}>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-[10px] px-2 py-0.5 rounded-md font-bold tracking-wide"
                                style={{ background: 'rgba(0,180,42,0.25)', color: '#6ee7b7' }}>
                                逆地理编码
                              </span>
                              {geoAddress.adcode && <span className="text-[10px] text-slate-400 font-mono">{geoAddress.adcode}</span>}
                              {geoAddress.city && <span className="text-[10px] text-slate-400 font-medium">{geoAddress.city}</span>}
                            </div>
                            <div className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.04)' }}>
                              <p className="text-sm font-bold leading-relaxed text-white/95">{geoAddress.formattedAddress}</p>
                            </div>
                            <div className="flex flex-wrap gap-1.5 text-[10px]">
                              {geoAddress.poiName && (
                                <span className="px-2 py-1 rounded-lg font-bold flex items-center gap-1"
                                  style={{ background: 'rgba(255,255,255,0.08)', color: '#6ee7b7' }}>
                                  <MapPin size={10} />{geoAddress.poiName}
                                </span>
                              )}
                              {geoAddress.district && (
                                <span className="px-2 py-1 rounded-lg text-slate-300"
                                  style={{ background: 'rgba(255,255,255,0.06)' }}>{geoAddress.district}</span>
                              )}
                              {geoAddress.township && (
                                <span className="px-2 py-1 rounded-lg text-slate-300"
                                  style={{ background: 'rgba(255,255,255,0.06)' }}>{geoAddress.township}</span>
                              )}
                              {geoAddress.street && (
                                <span className="px-2 py-1 rounded-lg text-slate-300"
                                  style={{ background: 'rgba(255,255,255,0.06)' }}>{geoAddress.street}{geoAddress.number}</span>
                              )}
                            </div>
                          </motion.div>
                        ) : null}
                      </motion.div>
                    ) : (
                      <div className="backdrop-blur rounded-2xl p-6 text-center border-dashed"
                        style={{
                          background: 'rgba(255,255,255,0.04)',
                          border: '1px dashed rgba(255,255,255,0.08)',
                        }}>
                        <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3.5 backdrop-blur"
                          style={{ background: 'rgba(255,255,255,0.06)' }}>
                          <Crosshair size={24} className="text-slate-400" />
                        </div>
                        <p className="text-sm text-slate-300 font-bold">点击获取当前精确位置</p>
                        <p className="text-[10px] text-slate-500 mt-1.5 leading-relaxed">自动调用高德逆地理编码<br />获取详细结构化地址</p>
                      </div>
                    )}
                  </div>
                </motion.div>

                {/* Address management toolbar */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full shadow-sm" style={{ background: '#36D399' }} />
                      <span className="text-xs text-text-muted font-bold">{locationPresets.length} 个已保存</span>
                    </div>
                  </div>
                  <motion.button whileTap={{ scale: 0.95 }} whileHover={{ scale: 1.03 }}
                    onClick={() => { setIsAddingLoc(true); setEditingLoc(null); setLocForm({ name: '', lat: '', lng: '', description: '' }); }}
                    className="flex items-center gap-1.5 text-xs font-bold text-white px-4 py-2.5 rounded-xl shadow-lg transition-all duration-200"
                    style={{
                      background: 'linear-gradient(135deg, #165DFF, #4f39d0)',
                      boxShadow: '0 4px 16px rgba(22,93,255,0.3)',
                    }}>
                    <Plus size={14} strokeWidth={2.5} />新增地址
                  </motion.button>
                </div>

                {/* Add form */}
                <AnimatePresence>
                  {isAddingLoc && (
                    <LocationForm
                      mode="add"
                      form={locForm}
                      onChange={(f: LocationFormData) => setLocForm(f)}
                      onSave={handleAddLocation}
                      onCancel={() => setIsAddingLoc(false)}
                      hasLocation={!!currentPosition}
                      onFillGPS={() => {
                        if (currentPosition) setLocForm(f => ({ ...f, lat: currentPosition.lat.toFixed(6), lng: currentPosition.lng.toFixed(6) }));
                      }}
                    />
                  )}
                </AnimatePresence>

                {/* Address list */}
                <div className="space-y-2.5">
                  <AnimatePresence>
                    {locationPresets.map((p, i) => {
                      const isEditing = editingLoc?.id === p.id;
                      const palette = [
                        { from: '#36D399', to: '#0d9488', bg: 'rgba(54,211,153,0.06)', text: '#0d9488', badge: 'rgba(54,211,153,0.12)', badgeText: '#0d9488' },
                        { from: '#165DFF', to: '#4f39d0', bg: 'rgba(22,93,255,0.06)', text: '#165DFF', badge: 'rgba(22,93,255,0.1)', badgeText: '#165DFF' },
                        { from: '#722ED1', to: '#a855f7', bg: 'rgba(114,46,209,0.06)', text: '#722ED1', badge: 'rgba(114,46,209,0.1)', badgeText: '#722ED1' },
                        { from: '#FF7D00', to: '#f43f5e', bg: 'rgba(255,125,0,0.06)', text: '#FF7D00', badge: 'rgba(255,125,0,0.1)', badgeText: '#FF7D00' },
                        { from: '#06b6d4', to: '#0ea5e9', bg: 'rgba(6,182,212,0.06)', text: '#06b6d4', badge: 'rgba(6,182,212,0.1)', badgeText: '#06b6d4' },
                      ];
                      const color = palette[i % palette.length];
                      return (
                        <motion.div key={p.id} layout
                          initial={{ opacity: 0, y: 16, scale: 0.97 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, x: -60, scale: 0.95 }}
                          transition={{ delay: i * 0.05, type: 'spring', stiffness: 300, damping: 24 }}>
                          {isEditing ? (
                            <LocationForm
                              mode="edit"
                              form={{ name: editingLoc!.name, lat: editingLoc!.lat, lng: editingLoc!.lng, description: editingLoc!.description }}
                              onChange={(f: LocationFormData) => setEditingLoc({ ...editingLoc!, name: f.name, lat: f.lat, lng: f.lng, description: f.description })}
                              onSave={() => handleUpdateLocation(editingLoc!)}
                              onCancel={() => setEditingLoc(null)}
                            />
                          ) : (
                            <div
                              className="relative rounded-2xl border transition-all duration-300 overflow-hidden group shadow-sm hover:shadow-lg hover:-translate-y-0.5"
                              style={{
                                background: 'rgba(255,255,255,0.85)',
                                borderColor: 'rgba(226,232,240,0.4)',
                              }}
                            >
                              <div className="p-3.5 flex items-center gap-3.5">
                                <div className="relative flex-shrink-0">
                                  <div className="absolute inset-0 rounded-2xl blur-lg opacity-25"
                                    style={{ background: `linear-gradient(135deg, ${color.from}, ${color.to})` }} />
                                  <div className="relative w-11 h-11 rounded-2xl flex items-center justify-center shadow-md ring-1"
                                    style={{
                                      background: `linear-gradient(135deg, ${color.from}, ${color.to})`,
                                      boxShadow: `0 0 0 1px ${color.from}33`,
                                    }}>
                                    <span className="text-white font-extrabold text-xs">{i + 1}</span>
                                  </div>
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <p className="font-bold text-sm text-text-primary truncate">{p.name}</p>
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-md font-bold flex-shrink-0"
                                      style={{ background: color.badge, color: color.badgeText }}>
                                      <MapPin size={9} className="inline mr-0.5" />预设
                                    </span>
                                  </div>
                                  <p className="text-[10px] text-text-muted font-mono mt-1 tracking-tight">{p.lng}, {p.lat}</p>
                                  {p.description && (
                                    <p className="text-[10px] text-text-muted truncate mt-0.5 leading-relaxed opacity-60">{p.description}</p>
                                  )}
                                </div>
                                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all duration-300 translate-x-2 group-hover:translate-x-0">
                                  <motion.button whileTap={{ scale: 0.85 }}
                                    onClick={(e) => { e.stopPropagation(); setEditingLoc(p); setIsAddingLoc(false); }}
                                    className="p-2.5 text-slate-400 hover:text-brand-600 rounded-xl transition-colors active:scale-90"
                                    style={{ minWidth: '44px', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <Edit3 size={14} />
                                  </motion.button>
                                  <motion.button whileTap={{ scale: 0.85 }}
                                    onClick={(e) => { e.stopPropagation(); handleDeleteLocation(p.id); }}
                                    className="p-2.5 text-slate-400 hover:text-error-500 rounded-xl transition-colors active:scale-90"
                                    style={{ minWidth: '44px', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <Trash2 size={14} />
                                  </motion.button>
                                </div>
                              </div>
                            </div>
                          )}
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>

                  {/* Empty state */}
                  {locationPresets.length === 0 && !isAddingLoc && (
                    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                      className="py-14 text-center space-y-5">
                      <div className="relative w-24 h-24 mx-auto">
                        <div className="absolute inset-0 rounded-[2rem] rotate-6 shadow-sm"
                          style={{ background: 'linear-gradient(135deg, #e2e8f0, #cbd5e1)' }} />
                        <div className="absolute inset-0 rounded-[2rem] -rotate-3 flex items-center justify-center border-2 border-dashed shadow-sm"
                          style={{ background: 'linear-gradient(135deg, #fff, #f8fafc)', borderColor: 'rgba(226,232,240,0.6)' }}>
                          <MapPin size={36} className="text-slate-300" />
                        </div>
                        <div className="absolute -top-1 -right-1 w-8 h-8 rounded-xl flex items-center justify-center shadow-md animate-pulse"
                          style={{ background: 'linear-gradient(135deg, #36D399, #0d9488)' }}>
                          <Plus size={14} className="text-white" strokeWidth={2.5} />
                        </div>
                      </div>
                      <div>
                        <p className="text-sm font-bold" style={{ color: '#94A3B8' }}>暂无已保存地址</p>
                        <p className="text-xs mt-1.5 leading-relaxed" style={{ color: '#c0c8d4' }}>
                          点击右上角「新增地址」添加签到位置<br />或使用上方实时定位自动填入坐标
                        </p>
                      </div>
                    </motion.div>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Lobby;
