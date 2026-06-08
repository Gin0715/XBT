import { useEffect, useState, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronLeft,
  Users,
  MapPin,
  QrCode,
  CheckCircle2,
  Circle,
  Loader2,
  BookOpen,
  User,
  Camera,
  Fingerprint,
  RectangleEllipsis,
  Plus,
  Trash2,
  Edit3,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import client from '../api/client';
import { useAuthStore } from '../store/auth';
import type { ApiResponse, Classmate, SignActivity, CourseActivities, SignStatusMessage, SignCheckItem } from '../types';
import { useLocationPanel, type LocationFormData } from '../hooks/useLocationPanel';
import { LocationForm } from '../components/location/LocationForm';
import BMapKeyConfig from '../components/location/BMapKeyConfig';
import LiveLocationCard from '../components/location/LiveLocationCard';

import { GestureInput } from '../components/sign/GestureInput';
import { PinInput } from '../components/sign/PinInput';
import { LocationInput } from '../components/sign/LocationInput';
import { QrInput } from '../components/sign/QrInput';
import { NormalInput } from '../components/sign/NormalInput';
import { PhotoInput } from '../components/sign/PhotoInput';
import { ProgressCard } from '../components/sign/ProgressCard';

const MAX_PHOTO_UPLOAD_BYTES = 20 * 1024 * 1024;

const isImageFile = (file: File) => (
  file.type.startsWith('image/')
  || /\.(png|jpe?g|gif|webp|bmp|heic|heif)$/i.test(file.name)
);

function shuffleItems<T>(items: T[]) {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

const buildPhotoAssignments = (targetUids: number[], files: File[]) => {
  const assignments = new Map<number, File>();
  if (files.length === 0) return assignments;

  if (files.length >= targetUids.length) {
    const shuffledFiles = shuffleItems(files);
    targetUids.forEach((uid, index) => {
      assignments.set(uid, shuffledFiles[index]);
    });
    return assignments;
  }

  let shuffledCycle = shuffleItems(files);
  targetUids.forEach((uid, index) => {
    if (index > 0 && index % files.length === 0) {
      shuffledCycle = shuffleItems(files);
    }
    assignments.set(uid, shuffledCycle[index % files.length]);
  });
  return assignments;
};

const SignDetail = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user: currentUser } = useAuthStore();

  const activity = location.state?.activity as SignActivity;
  const course = location.state?.course as CourseActivities;

  const [classmates, setClassmates] = useState<Classmate[]>([]);
  const [selectedUids, setSelectedUids] = useState<number[]>([]);
  const [isLoadingClassmates, setIsLoadingClassmates] = useState(true);
  const [isExecuting, setIsExecuting] = useState(false);

  const [signCode, setSignCode] = useState('');
  const [isLocationPickerOpen, setIsLocationPickerOpen] = useState(false);

  const {
    locationPresets,
    isLoadingLocations,
    fetchLocations,
    currentPosition,
    geoAddress,
    isLocating,
    isGeocoding,
    locateSuccess,
    handleLocate,
    isAddingLocation,
    setIsAddingLocation,
    editingLocation,
    setEditingLocation,
    newLocationForm: newLocForm,
    setNewLocationForm: setNewLocForm,
    handleAddLocation,
    handleUpdateLocation,
    handleDeleteLocation,
    // 统一选中位置（替代原有的 lat/lng/locationStr 本地状态）
    selectedLat: lat,
    selectedLng: lng,
    selectedAddress: locationStr,
    setSelectedLat: setLat,
    setSelectedLng: setLng,
    setSelectedAddress: setLocationStr,
  } = useLocationPanel({ autoFillForm: true });

  const [showProgress, setShowProgress] = useState(false);
  const [signStatuses, setSignStatuses] = useState<Record<number, Partial<SignStatusMessage>>>({});
  const [classmateSignStates, setClassmateSignStates] = useState<Record<number, SignCheckItem>>({});

  // Photo sign-in state
  const isPhotoSign = activity?.if_photo ?? false;
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [photoPreviewUrls, setPhotoPreviewUrls] = useState<string[]>([]);

  const isExecutingRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const photoPreviewUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    if (showProgress) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
      if (isExecutingRef.current) {
        isExecutingRef.current = false;
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
          abortControllerRef.current = null;
        }
        setIsExecuting(false);
      }
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [showProgress]);

  useEffect(() => {
    const returnedPhotos = location.state?.returnedPhotos as File[];
    if (returnedPhotos && returnedPhotos.length > 0) {
      handlePhotoAdd(returnedPhotos);
      // Clean up the returnedPhotos from location state to prevent double adding
      window.history.replaceState({ ...location.state, returnedPhotos: undefined }, '');
    }
  }, [location.state]);

  useEffect(() => {
    photoPreviewUrlsRef.current = photoPreviewUrls;
  }, [photoPreviewUrls]);

  useEffect(() => () => {
    photoPreviewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const sortedClassmates = useMemo(() => {
    if (!currentUser) return classmates;
    return [...classmates].sort((a, b) => {
      if (a.uid === currentUser.uid) return -1;
      if (b.uid === currentUser.uid) return 1;
      return 0;
    });
  }, [classmates, currentUser]);

  const getSignStateLabel = (targetUid: number, source: number, name: string) => {
    if (source === -1) return '学习通签到';
    if (source === targetUid) return '本人签到';
    return `${name}代签`;
  };

  const loadClassmateSignStates = async (students: Classmate[]) => {
    if (!activity || students.length === 0) {
      setClassmateSignStates({});
      return;
    }

    const response = await client.post<ApiResponse<{ items: SignCheckItem[] }>>('/sign/check', {
      activity_id: activity.active_id,
      user_ids: students.map((student) => student.uid),
    });

    const nextStates = response.data.data.items.reduce<Record<number, SignCheckItem>>((acc, item) => {
      if (item.user_id !== currentUser?.uid) {
        acc[item.user_id] = item;
      }
      return acc;
    }, {});

    setClassmateSignStates(nextStates);
  };

  useEffect(() => {
    if (!activity) {
      navigate('/');
      return;
    }
    const fetchClassmates = async () => {
      try {
        const response = await client.get<ApiResponse<Classmate[]>>(`/sign/classmates`, {
          params: { course_id: activity.course_id, class_id: activity.class_id }
        });
        const data = response.data.data || [];
        setClassmates(data);
        setSelectedUids(data.map(c => c.uid));
        await loadClassmateSignStates(data);
      } catch (error: any) {
        toast.error(error.message || '获取同学列表失败');
      } finally {
        setIsLoadingClassmates(false);
      }
    };
    fetchClassmates();
    fetchLocations();
  }, [activity, navigate]);

  const handlePhotoAdd = (files: File[]) => {
    const acceptedFiles: File[] = [];
    let invalidTypeCount = 0;
    let oversizeCount = 0;

    files.forEach((file) => {
      if (!isImageFile(file)) {
        invalidTypeCount += 1;
        return;
      }

      if (file.size > MAX_PHOTO_UPLOAD_BYTES) {
        oversizeCount += 1;
        return;
      }

      acceptedFiles.push(file);
    });

    if (invalidTypeCount > 0) {
      toast.error(`${invalidTypeCount} 个文件不是图片，已跳过`);
    }
    if (oversizeCount > 0) {
      toast.error(`${oversizeCount} 张照片超过 20MB，已跳过`);
    }
    if (acceptedFiles.length === 0) return;

    const nextUrls = acceptedFiles.map((file) => URL.createObjectURL(file));
    setPhotoFiles(prev => [...prev, ...acceptedFiles]);
    setPhotoPreviewUrls(prev => [...prev, ...nextUrls]);
  };

  const removePhoto = (index: number) => {
    const url = photoPreviewUrls[index];
    if (url) URL.revokeObjectURL(url);
    setPhotoFiles((prev) => prev.filter((_, i) => i !== index));
    setPhotoPreviewUrls((prev) => prev.filter((_, i) => i !== index));
  };

  const clearPhotos = () => {
    photoPreviewUrls.forEach((url) => URL.revokeObjectURL(url));
    setPhotoFiles([]);
    setPhotoPreviewUrls([]);
  };

  const toggleClassmate = (uid: number) => {
    setSelectedUids(prev => prev.includes(uid) ? prev.filter(id => id !== uid) : [...prev, uid]);
  };

  const selectAll = () => {
    if (!classmates) return;
    setSelectedUids(selectedUids.length === classmates.length ? [] : classmates.map(c => c.uid));
  };

  const handleExecute = async () => {
    const selectedPhotoFiles = [...photoFiles];

    if ((activity.sign_type === 3 || activity.sign_type === 5) && (!signCode || signCode.length < 4)) {
      toast.error('请输入正确位数的签到码 / 手势');
      return;
    }

    if (activity.sign_type === 4 && (!lat || !lng)) {
      toast.error('请先选择签到地点');
      return;
    }

    if (isPhotoSign && selectedPhotoFiles.length === 0) {
      toast.error('请先拍照或选择照片');
      return;
    }

    setIsExecuting(true);
    isExecutingRef.current = true;
    setShowProgress(true);
    setSignStatuses({});

    abortControllerRef.current = new AbortController();

    const targetUids = Array.from(new Set([currentUser?.uid, ...selectedUids].filter(Boolean) as number[]));
    const photoAssignments = isPhotoSign ? buildPhotoAssignments(targetUids, selectedPhotoFiles) : new Map<number, File>();
    const initialStatuses: Record<number, any> = {};
    targetUids.forEach(uid => initialStatuses[uid] = { status: 'pending', message: '等待中' });
    setSignStatuses(initialStatuses);

    try {
      const checkResp = await client.post<ApiResponse<{ items: any[] }>>('/sign/check', {
        activity_id: activity.active_id,
        user_ids: selectedUids
      });

      const checkItems = checkResp.data.data.items as SignCheckItem[];
      setClassmateSignStates(prev => {
        const next = { ...prev };
        checkItems.forEach(item => {
          if (item.user_id !== currentUser?.uid) {
            next[item.user_id] = item;
          }
        });
        return next;
      });
      const signedUids = new Set(checkItems.filter(item => item.signed).map(item => item.user_id));

      checkItems.forEach(item => {
        if (item.signed) {
          setSignStatuses(prev => ({ ...prev, [item.user_id]: { status: 'success', message: item.message || '已签到' } }));
        }
      });

      const toSignUids = targetUids.filter(uid => !signedUids.has(uid));
      if (toSignUids.length === 0) {
        toast.success('所有用户均已签到');
        setIsExecuting(false);
        return;
      }

      await Promise.all(toSignUids.map(async (uid) => {
        const MAX_RETRIES = 5;
        let lastError = '';

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          if (!isExecutingRef.current) return;

          setSignStatuses(prev => ({
            ...prev,
            [uid]: {
              ...prev[uid],
              status: attempt === 0 ? 'signing' : 'retrying',
              attempt,
              message: attempt === 0 ? '正在尝试签到' : (prev[uid]?.message || '正在重试')
            }
          }));

          try {
            const assignedPhotoFile = isPhotoSign ? photoAssignments.get(uid) : null;
            if (isPhotoSign && !assignedPhotoFile) {
              lastError = '未找到可上传照片';
              setSignStatuses(prev => ({ ...prev, [uid]: { ...prev[uid], message: lastError } }));
              continue;
            }

            const special_params: Record<string, any> = {};
            if (activity.sign_type === 3 || activity.sign_type === 5) special_params.sign_code = signCode;
            else if (activity.sign_type === 4) {
              special_params.latitude = lat;
              special_params.longitude = lng;
              special_params.description = locationStr;
            }

            const execResp = isPhotoSign && assignedPhotoFile
              ? await client.post<ApiResponse<any>>('/sign/photo', (() => {
                const formData = new FormData();
                formData.append('activity_id', String(activity.active_id));
                formData.append('course_id', String(activity.course_id));
                formData.append('class_id', String(activity.class_id));
                formData.append('target_uid', String(uid));
                formData.append('if_refresh_ewm', String(activity.if_refresh_ewm));
                formData.append('file', assignedPhotoFile);
                return formData;
              })(), {
                signal: abortControllerRef.current?.signal
              })
              : await client.post<ApiResponse<any>>('/sign/execute', {
                activity_id: activity.active_id, target_uid: uid, sign_type: activity.sign_type,
                course_id: activity.course_id, class_id: activity.class_id, if_refresh_ewm: activity.if_refresh_ewm,
                special_params
              }, {
                signal: abortControllerRef.current?.signal
              });

            const res = execResp.data.data;
            if (res.success || res.already_signed) {
              if (uid !== currentUser?.uid) {
                setClassmateSignStates(prev => ({
                  ...prev,
                  [uid]: {
                    user_id: uid,
                    signed: true,
                    record_source: res.record_source,
                    record_source_name: res.record_source_name,
                    message: res.message || '已签到',
                  },
                }));
              }
              setSignStatuses(prev => ({ ...prev, [uid]: { status: 'success', message: res.message || '签到成功' } }));
              return;
            }
            lastError = res.message || '签到失败';
            setSignStatuses(prev => ({ ...prev, [uid]: { ...prev[uid], message: lastError } }));
          } catch (err: any) {
            if (err.name === 'CanceledError' || err.name === 'AbortError') return;
            lastError = err.message || '网络连接异常';
            setSignStatuses(prev => ({ ...prev, [uid]: { ...prev[uid], message: lastError } }));
          }

          if (attempt < MAX_RETRIES) {
            let delay = 0;
            if (attempt === 2) delay = 1000;
            else if (attempt >= 3) delay = 2000;
            if (delay > 0) {
              for (let i = 0; i < delay; i += 100) {
                if (!isExecutingRef.current) return;
                await new Promise(resolve => setTimeout(resolve, 100));
              }
            }
          } else {
            setSignStatuses(prev => ({
              ...prev,
              [uid]: {
                status: 'failed',
                message: lastError || '多次重试后失败'
              }
            }));
          }
        }
      }));
    } catch (error: any) {
      if (error.name !== 'CanceledError' && error.name !== 'AbortError') {
        toast.error(error.message || '执行过程出错');
      }
    } finally {
      if (isExecutingRef.current) {
        setIsExecuting(false);
        isExecutingRef.current = false;
        abortControllerRef.current = null;
      }
    }
  };

  if (!activity) return null;

  const getSignTypeName = () => {
    if (isPhotoSign) return '拍照签到';

    switch (activity.sign_type) {
      case 0: return '普通签到';
      case 2: return '二维码签到';
      case 3: return '手势签到';
      case 4: return '位置签到';
      case 5: return '签到码签到';
      default: return '其他签到';
    }
  };

  const getSignIcon = (size: number = 24) => {
    if (isPhotoSign) return <Camera size={size} />;

    switch (activity.sign_type) {
      case 2: return <QrCode size={size} />;
      case 3: return <Fingerprint size={size} />;
      case 4: return <MapPin size={size} />;
      case 5: return <RectangleEllipsis size={size} />;
      default: return <CheckCircle2 size={size} />;
    }
  };

  const isEnded = Date.now() > activity.end_time;
  const formatSmartTime = (ts: number) => {
    const d = new Date(ts);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const timeStr = d.toTimeString().split(' ')[0];
    if (isToday) return timeStr;
    return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')} ${timeStr}`;
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-transparent">
      {/* AppBar — glass */}
      <div className="glass sticky top-0 z-10 border-b px-4 flex items-center shrink-0 overflow-hidden"
        style={{
          height: 'calc(80px + var(--sat))',
          paddingTop: 'var(--sat)',
          borderColor: 'rgba(226,232,240,0.4)',
          boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
        }}>
        <button onClick={() => navigate(-1)} className="p-2 -ml-2 rounded-xl transition-colors relative z-10 hover:bg-slate-50"
          style={{ color: '#64748B' }}>
          <ChevronLeft size={24} />
        </button>
        <div className="ml-2 flex-1 min-w-0 relative z-10">
          <h2 className="font-bold text-text-primary truncate">{getSignTypeName()}</h2>
          <p className="text-[10px] font-medium text-text-muted truncate tracking-wide">{activity.course_name}</p>
        </div>
        <div className="absolute -right-8 -bottom-4 opacity-10 pointer-events-none transform rotate-12" style={{ color: '#165DFF' }}>
          {getSignIcon(120)}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto touch-pan-y px-6 py-4 space-y-5 custom-scrollbar pb-safe-6">
        {/* Activity Briefing */}
        <div className="flex items-center justify-between px-1 mt-1">
          <div className="flex items-center gap-4 min-w-0">
            <div className="relative">
              <div className="absolute inset-0 rounded-2xl bg-blue-100 blur-md opacity-30" />
              <div className="relative w-14 h-14 rounded-2xl overflow-hidden shrink-0 shadow-sm border ring-2 ring-white"
                style={{ background: 'rgba(255,255,255,0.9)', borderColor: 'rgba(226,232,240,0.5)' }}>
                {course?.icon ? <img src={course.icon} className="w-full h-full object-cover" referrerPolicy="no-referrer" /> : <div className="w-full h-full flex items-center justify-center text-slate-300"><BookOpen size={24} /></div>}
              </div>
            </div>
            <div className="space-y-0.5 min-w-0">
              <h2 className="text-lg font-extrabold text-text-primary tracking-tight truncate leading-tight">{activity.activity_name}</h2>
              <div className="flex items-center gap-1.5 text-[11px] text-text-secondary font-bold truncate">
                <User size={12} className="text-text-muted shrink-0" />
                <span>{course?.course_teacher || activity.course_teacher || '未知'}</span>
              </div>
            </div>
          </div>
          <div className="text-right shrink-0 ml-4">
            <div className={`text-sm font-extrabold px-3 py-1 rounded-xl inline-block shadow-sm ${
              isEnded
                ? 'bg-slate-100 text-slate-400 border border-slate-200'
                : 'text-brand-600 border shadow-md'
            }`}
              style={!isEnded ? {
                background: 'linear-gradient(135deg, rgba(239,244,255,0.9), rgba(238,242,255,0.9))',
                borderColor: 'rgba(22,93,255,0.25)',
                boxShadow: '0 2px 8px rgba(22,93,255,0.1)',
              } : {}}
            >
              {isEnded ? '已结束' : '进行中'}
            </div>
            <p className="text-[10px] text-text-muted font-mono font-bold tracking-tighter mt-0.5">
              {formatSmartTime(activity.end_time)} 截止
            </p>
          </div>
        </div>

        {/* Integrated Panel */}
        <div className="rounded-[2rem] border overflow-hidden flex flex-col"
          style={{
            background: 'rgba(255,255,255,0.85)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            borderColor: 'rgba(226,232,240,0.5)',
            boxShadow: '0 4px 24px rgba(0,0,0,0.05)',
          }}>
          <div className="p-5 pb-4">
            {activity.sign_type === 3 && <GestureInput value={signCode} onChange={setSignCode} />}
            {activity.sign_type === 5 && <PinInput value={signCode} onChange={setSignCode} />}
            {activity.sign_type === 4 && <LocationInput name={locationPresets.find((p) => p.lat === lat)?.name || ''} description={locationStr} lat={lat} lng={lng} onOpen={() => setIsLocationPickerOpen(true)} />}
            {activity.sign_type === 2 && <QrInput />}
            {activity.sign_type === 0 && !isPhotoSign && <NormalInput />}
          </div>

          {isPhotoSign && (
            <div className="px-5 pb-4">
              <PhotoInput
                files={photoFiles}
                previewUrls={photoPreviewUrls}
                disabled={isExecuting}
                onAdd={handlePhotoAdd}
                onRemove={removePhoto}
                onClear={clearPhotos}
                onOpenCamera={() => navigate('/photo-capture', { state: { activity, course, selectedUids, classmates, existingPhotos: photoFiles } })}
              />
            </div>
          )}

          <div className="px-5 py-4 bg-slate-50 border-t border-slate-100 mt-auto shrink-0">
            <button
              onClick={activity.sign_type === 2
                ? () => navigate('/scanner', { state: { activity, course, selectedUids, classmates } })
                : handleExecute
              }
              disabled={isExecuting}
              className="w-full py-3.5 rounded-xl font-bold text-sm shadow-lg transition-all duration-200 active:scale-[0.97] flex items-center justify-center gap-3 text-white disabled:opacity-50"
              style={{
                background: isExecuting ? '#94a3b8' : 'linear-gradient(135deg, #165DFF, #4f39d0)',
                boxShadow: isExecuting ? 'none' : '0 4px 16px rgba(22,93,255,0.3)',
              }}
            >
              {isExecuting ? (
                <Loader2 className="animate-spin" size={18} />
              ) : activity.sign_type === 2 ? (
                <><QrCode size={18} /> 去扫码签到</>
              ) : (
                <>{selectedUids.length > 0 ? `立即签到 (${selectedUids.length + 1})` : "立即签到"}</>
              )}
            </button>
          </div>
        </div>

        {/* Classmate Selection */}
        <div className="space-y-4 pt-1">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <Users size={16} className="text-text-primary" />
              <h3 className="font-bold text-sm text-text-primary">代他人签到</h3>
              <span className="text-[10px] px-2 py-0.5 rounded font-bold"
                style={{ background: 'rgba(226,232,240,0.6)', color: '#64748B' }}>
                {selectedUids.length}/{classmates.length}
              </span>
            </div>
            <button onClick={selectAll} className="text-[11px] font-bold text-brand-600 transition-colors">
              {selectedUids.length === classmates.length ? '取消全选' : '全选'}
            </button>
          </div>
          {isLoadingClassmates ? (<div className="space-y-2">{[1, 2].map(i => <div key={i} className="h-16 rounded-[1.25rem] animate-shimmer" />)}</div>) : (
            <div className="grid grid-cols-1 gap-2.5">
              {sortedClassmates.map(student => (
                <div key={student.uid} onClick={() => toggleClassmate(student.uid)}
                  className={`p-3 px-4 rounded-[1.25rem] border-2 transition-all duration-200 flex items-center justify-between cursor-pointer active:scale-[0.98] ${
                    selectedUids.includes(student.uid)
                      ? 'shadow-md'
                      : 'shadow-sm hover:shadow-md hover:-translate-y-0.5'
                  }`}
                  style={selectedUids.includes(student.uid) ? {
                    borderColor: 'rgba(22,93,255,0.3)',
                    background: 'linear-gradient(135deg, rgba(239,244,255,0.8), rgba(238,242,255,0.8))',
                    boxShadow: '0 2px 12px rgba(22,93,255,0.1)',
                  } : {
                    borderColor: 'rgba(226,232,240,0.4)',
                    background: 'rgba(255,255,255,0.85)',
                  }}>
                  <div className="flex items-center gap-4">
                    <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-white font-bold text-lg transition-colors shrink-0 overflow-hidden shadow-sm ${
                      selectedUids.includes(student.uid) ? '' : ''
                    }`}
                      style={{
                        background: selectedUids.includes(student.uid)
                          ? 'linear-gradient(135deg, #165DFF, #4f39d0)'
                          : 'linear-gradient(135deg, #94a3b8, #64748b)',
                      }}>
                      {student.avatar ? <img src={student.avatar} referrerPolicy="no-referrer" className="w-full h-full object-cover" /> : student.name[0]}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-0.5 min-w-0">
                        <p className="font-bold text-base text-text-primary leading-tight truncate">{student.name}</p>
                        {classmateSignStates[student.uid]?.signed && (
                          <span className="max-w-[140px] truncate text-[10px] px-1.5 py-0.5 rounded-md font-semibold shrink-0"
                            style={{ background: 'rgba(0,180,42,0.1)', color: '#15803d' }}
                            title={getSignStateLabel(student.uid, classmateSignStates[student.uid].record_source, classmateSignStates[student.uid].record_source_name)}>
                            {getSignStateLabel(student.uid, classmateSignStates[student.uid].record_source, classmateSignStates[student.uid].record_source_name)}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-text-muted font-mono font-bold tracking-tighter">{student.mobile_masked}</p>
                    </div>
                  </div>
                  <div className="transition-all shrink-0" style={{ color: selectedUids.includes(student.uid) ? '#165DFF' : '#cbd5e1' }}>
                    {selectedUids.includes(student.uid) ? <CheckCircle2 size={24} /> : <Circle size={24} />}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Location picker */}
      <AnimatePresence>
        {isLocationPickerOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center"
            style={{ background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
            onClick={() => setIsLocationPickerOpen(false)}>
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 250 }}
              className="w-full sm:max-w-[460px] md:max-w-[500px] rounded-t-[2.5rem] p-4 sm:p-8 overflow-hidden flex flex-col max-h-[85vh] max-h-[85dvh] sm:max-h-[80vh] sm:max-h-[80dvh]"
              style={{
                background: 'rgba(255,255,255,0.97)',
                backdropFilter: 'blur(24px)',
                WebkitBackdropFilter: 'blur(24px)',
                boxShadow: '0 -8px 40px rgba(0,0,0,0.12)',
                border: '1px solid rgba(255,255,255,0.4)',
              }}
              onClick={(e) => e.stopPropagation()}>
              <div className="w-12 h-1.5 bg-slate-200 rounded-full mx-auto mb-4 sm:mb-8 shrink-0" />
              <div className="flex items-center justify-between mb-4 sm:mb-6 shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="relative shrink-0">
                    <div className="absolute inset-0 rounded-2xl blur-md opacity-40"
                      style={{ background: 'linear-gradient(135deg, #36D399, #0d9488)' }} />
                    <div className="relative w-11 h-11 rounded-2xl flex items-center justify-center shadow-lg ring-2 ring-emerald-100"
                      style={{ background: 'linear-gradient(135deg, #36D399, #0d9488)' }}>
                      <MapPin className="w-5 h-5 text-white" strokeWidth={2.5} />
                    </div>
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-lg font-extrabold text-text-primary tracking-tight">选择签到位置</h3>
                    <p className="text-[10px] text-text-muted font-medium">地址库 · 位置签到</p>
                  </div>
                </div>
                <button onClick={() => setIsLocationPickerOpen(false)}
                  className="w-9 h-9 flex items-center justify-center rounded-full transition-all active:scale-90 hover:bg-white/80 shrink-0"
                  style={{ color: '#94A3B8' }}>
                  <X size={18} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto space-y-4 pr-1 pb-safe-6 custom-scrollbar px-1">
                {/* 百度地图 Key 配置状态 */}
                <BMapKeyConfig fullWidth />

                {/* 复用 LiveLocationCard 实时定位卡片 */}
                <LiveLocationCard
                  data={{
                    currentPosition,
                    geoAddress,
                    isLocating,
                    isGeocoding,
                    locateSuccess,
                    onLocate: handleLocate,
                  }}
                />

                {/* 定位成功后显示「使用此位置签到」按钮 */}
                {currentPosition && (
                  <button
                    onClick={() => {
                      setLat(currentPosition.lat.toFixed(6));
                      setLng(currentPosition.lng.toFixed(6));
                      setLocationStr(
                        geoAddress?.formattedAddress
                        || geoAddress?.poiName
                        || `${currentPosition.lng.toFixed(6)}, ${currentPosition.lat.toFixed(6)}`
                      );
                      setIsLocationPickerOpen(false);
                      toast.success('已选择当前位置');
                    }}
                    className="w-full py-3 rounded-2xl text-sm font-bold text-white shadow-lg flex items-center justify-center gap-2 transition-all active:scale-[0.97] btn-tap"
                    style={{
                      background: 'linear-gradient(135deg, #00B42A, #36D399)',
                      boxShadow: '0 4px 20px rgba(0,180,42,0.3)',
                    }}
                  >
                    <CheckCircle2 size={16} /> 使用此位置签到
                  </button>
                )}

                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#36D399' }} />
                    <span className="text-xs text-text-muted font-bold">{locationPresets.length} 个位置</span>
                  </div>
                  <button
                    onClick={() => { setIsAddingLocation(true); setEditingLocation(null); setNewLocForm({ name: '', lat: '', lng: '', description: '' }); }}
                    className="flex items-center gap-1 text-xs font-bold text-white px-3.5 py-2 rounded-xl shadow-md transition-all duration-200 active:scale-95"
                    style={{
                      background: 'linear-gradient(135deg, #165DFF, #4f39d0)',
                      boxShadow: '0 2px 8px rgba(22,93,255,0.3)',
                    }}>
                    <Plus size={14} strokeWidth={2.5} /> 新增
                  </button>
                </div>

                <AnimatePresence>
                  {isAddingLocation && (
                    <LocationForm
                      mode="add"
                      form={newLocForm}
                      onChange={(f: LocationFormData) => setNewLocForm(f)}
                      onSave={() => handleAddLocation(newLocForm)}
                      onCancel={() => setIsAddingLocation(false)}
                    />
                  )}
                </AnimatePresence>

                {isLoadingLocations && locationPresets.length === 0 && (
                  <div className="text-center py-12">
                    <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3 border shadow-sm"
                      style={{
                        background: 'linear-gradient(135deg, #f1f5f9, #e2e8f0)',
                        borderColor: 'rgba(226,232,240,0.5)',
                      }}>
                      <Loader2 className="w-6 h-6 animate-spin text-slate-300" />
                    </div>
                    <p className="text-sm font-bold" style={{ color: '#94A3B8' }}>加载位置预设中…</p>
                  </div>
                )}

                <div
                  onClick={() => { setLat(''); setLng(''); setLocationStr(''); setIsLocationPickerOpen(false); }}
                  className={`btn-tap p-4 rounded-[1.5rem] border-2 transition-all cursor-pointer flex items-center gap-3 ${
                    !lat ? 'shadow-md' : 'shadow-sm hover:bg-slate-50 hover:border-slate-200'
                  }`}
                  style={!lat ? {
                    borderColor: 'rgba(22,93,255,0.3)',
                    background: 'linear-gradient(135deg, rgba(239,244,255,0.8), rgba(238,242,255,0.8))',
                    boxShadow: '0 2px 12px rgba(22,93,255,0.1)',
                  } : {
                    borderColor: 'rgba(226,232,240,0.4)',
                    background: 'rgba(255,255,255,0.85)',
                  }}>
                  <div className={`w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0 transition-all shadow-sm ${
                    !lat ? 'text-white' : 'text-slate-400'
                  }`}
                    style={!lat ? {
                      background: 'linear-gradient(135deg, #165DFF, #4f39d0)',
                    } : { background: 'rgba(241,245,249,0.8)' }}>
                    <X size={18} strokeWidth={2.5} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-text-primary text-sm">不使用位置</div>
                    <div className="text-[10px] text-text-muted font-medium mt-0.5">不发送地理位置信息进行签到</div>
                  </div>
                  {!lat && <CheckCircle2 size={20} className="text-brand-600 shrink-0" />}
                </div>

                {locationPresets.map((p, i) => {
                  const isSelected = p.lat === lat && p.lng === lng;
                  const isEditing = editingLocation?.id === p.id;
                  const palette = [
                    { from: '#36D399', to: '#0d9488' },
                    { from: '#165DFF', to: '#4f39d0' },
                    { from: '#722ED1', to: '#a855f7' },
                    { from: '#FF7D00', to: '#f43f5e' },
                    { from: '#06b6d4', to: '#0ea5e9' },
                  ];
                  const color = palette[i % palette.length];
                  return (
                    <div key={p.id}
                      className={`anim-slide-up rounded-[1.5rem] border-2 transition-all duration-300 overflow-hidden gpu-layer ${
                        isSelected ? 'shadow-md' : 'shadow-sm hover:border-slate-200 hover:shadow-md hover:-translate-y-0.5'
                      }`}
                      style={{
                        animationDelay: `${i * 0.04}s`,
                        ...(isSelected ? {
                          borderColor: 'rgba(22,93,255,0.3)',
                          background: 'linear-gradient(135deg, rgba(239,244,255,0.8), rgba(238,242,255,0.8))',
                          boxShadow: '0 4px 20px rgba(22,93,255,0.12)',
                        } : {
                          borderColor: 'rgba(226,232,240,0.4)',
                          background: 'rgba(255,255,255,0.85)',
                        })
                      }}>
                      {isEditing ? (
                        <LocationForm
                          mode="edit"
                          form={{ name: editingLocation.name, lat: editingLocation.lat, lng: editingLocation.lng, description: editingLocation.description }}
                          onChange={(f: LocationFormData) => setEditingLocation({ ...editingLocation, name: f.name, lat: f.lat, lng: f.lng, description: f.description })}
                          onSave={() => handleUpdateLocation(editingLocation)}
                          onCancel={() => setEditingLocation(null)}
                        />
                      ) : (
                        <div className="flex items-center">
                          <div
                            onClick={() => { setLat(p.lat); setLng(p.lng); setLocationStr(p.description); setIsLocationPickerOpen(false); }}
                            className="btn-tap flex-1 min-w-0 p-4 pr-2 cursor-pointer flex items-center gap-3">
                            <div className="relative">
                              <div className="absolute inset-0 rounded-2xl blur-sm opacity-25"
                                style={{ background: `linear-gradient(135deg, ${color.from}, ${color.to})` }} />
                              <div className="relative w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0 shadow-md ring-1"
                                style={{
                                  background: `linear-gradient(135deg, ${color.from}, ${color.to})`,
                                  boxShadow: `0 0 0 1px ${color.from}33`,
                                }}>
                                <span className="text-white font-extrabold text-xs">{i + 1}</span>
                              </div>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="font-bold text-text-primary text-sm">{p.name}</div>
                              <div className="text-[10px] text-text-muted font-medium font-mono mt-1 tracking-tight">{p.lng}, {p.lat}</div>
                              {p.description && <div className="text-[10px] text-text-muted font-medium truncate mt-0.5 opacity-60">{p.description}</div>}
                            </div>
                          </div>
                          {isSelected && <CheckCircle2 size={20} className="text-brand-600 shrink-0 mr-2" />}
                          <div className="flex items-center gap-0.5 pr-2 shrink-0" onClick={e => e.stopPropagation()}>
                            <button onClick={() => { setEditingLocation(p); setIsAddingLocation(false); }}
                              className="p-2 text-slate-400 hover:text-brand-600 rounded-lg transition-colors"
                              style={{ minWidth: '44px', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                              title="编辑">
                              <Edit3 size={14} />
                            </button>
                            <button onClick={() => handleDeleteLocation(p.id)}
                              className="p-2 text-slate-400 hover:text-error-500 rounded-lg transition-colors"
                              style={{ minWidth: '44px', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                              title="删除">
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
                {!isLoadingLocations && locationPresets.length === 0 && (
                  <div className="text-center py-14">
                    <div className="relative w-20 h-20 mx-auto mb-5">
                      <div className="absolute inset-0 rounded-3xl rotate-6 shadow-sm"
                        style={{ background: 'linear-gradient(135deg, #e2e8f0, #cbd5e1)' }} />
                      <div className="absolute inset-0 rounded-3xl -rotate-3 flex items-center justify-center border-2 border-dashed shadow-sm"
                        style={{ background: 'linear-gradient(135deg, #fff, #f8fafc)', borderColor: 'rgba(226,232,240,0.6)' }}>
                        <MapPin size={30} className="text-slate-300" />
                      </div>
                      <div className="absolute -top-1 -right-1 w-7 h-7 rounded-lg flex items-center justify-center shadow-md animate-pulse"
                        style={{ background: 'linear-gradient(135deg, #36D399, #0d9488)' }}>
                        <Plus size={12} className="text-white" strokeWidth={2.5} />
                      </div>
                    </div>
                    <p className="text-sm font-bold" style={{ color: '#94A3B8' }}>暂无位置预设</p>
                    <p className="text-xs mt-1.5 leading-relaxed" style={{ color: '#c0c8d4' }}>点击右上角「新增」添加签到位置</p>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
        {showProgress && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-end justify-center p-0"
            style={{ background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
            onClick={() => setShowProgress(false)}>
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              className="w-full sm:max-w-[420px] rounded-t-[2.5rem] px-4 sm:px-8 pt-6 sm:pt-10 pb-0 flex flex-col max-h-[85vh] max-h-[85dvh] relative"
              style={{
                background: 'rgba(255,255,255,0.97)',
                backdropFilter: 'blur(24px)',
                WebkitBackdropFilter: 'blur(24px)',
                boxShadow: '0 -8px 40px rgba(0,0,0,0.12)',
                border: '1px solid rgba(255,255,255,0.4)',
              }}
              onClick={(e) => e.stopPropagation()}>
              <div className="absolute top-full left-0 right-0 h-screen bg-white" />
              <div className="flex items-center justify-between mb-8 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl flex items-center justify-center shadow-md"
                    style={{ background: 'linear-gradient(135deg, #165DFF, #4f39d0)' }}>
                    <Loader2 size={20} className="text-white animate-spin" />
                  </div>
                  <h3 className="text-xl font-bold text-text-primary">执行进度</h3>
                </div>
                <button onClick={() => setShowProgress(false)}
                  className="w-10 h-10 flex items-center justify-center rounded-full transition-all active:scale-90 hover:bg-slate-100"
                  style={{ color: '#94A3B8' }}>
                  <X size={18} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto space-y-1 pr-2 custom-scrollbar pb-safe-6">
                <ProgressCard name={currentUser?.name || "本人"} avatar={currentUser?.avatar} mobile={currentUser?.mobile || ""} isHost statusObj={signStatuses[currentUser?.uid || 0]} />
                {selectedUids.filter(uid => uid !== currentUser?.uid).map(uid => {
                  const student = classmates.find(m => m.uid === uid);
                  return <ProgressCard key={uid} name={student?.name || "未知"} avatar={student?.avatar} mobile={student?.mobile_masked || ""} statusObj={signStatuses[uid]} />;
                })}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default SignDetail;
