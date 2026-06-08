import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronLeft,
  LogOut,
  Trash2,
  User as UserIcon,
  Plus
} from 'lucide-react';
import { useAuthStore } from '../store/auth';
import toast from 'react-hot-toast';
import { Button } from '../components/ui/Button';
import { IconButton } from '../components/ui/IconButton';
import { GlassPanel } from '../components/ui/GlassPanel';
import { Badge } from '../components/ui/Badge';

const AccountManagement = () => {
  const navigate = useNavigate();
  const { accounts, activeUid, switchAccount, removeAccount } = useAuthStore();
  const [confirmState, setConfirmState] = useState<{ show: boolean; uid: number | null }>({ show: false, uid: null });

  const sortedAccounts = useMemo(() => {
    return [...accounts].sort((a, b) => {
      if (a.user.uid === activeUid) return -1;
      if (b.user.uid === activeUid) return 1;
      return 0;
    });
  }, [accounts, activeUid]);

  const handleSwitch = (uid: number) => {
    if (uid === activeUid) return;
    switchAccount(uid);
    toast.success('已切换账号');
    navigate('/');
  };

  const handleRemove = (e: React.MouseEvent, uid: number) => {
    e.stopPropagation();
    setConfirmState({ show: true, uid });
  };

  const confirmRemove = () => {
    if (confirmState.uid) {
      removeAccount(confirmState.uid);
      toast.success('已移除账号');
    }
    setConfirmState({ show: false, uid: null });
  };

  return (
    <div className="flex-1 flex flex-col bg-transparent relative overflow-hidden">
      {/* Header */}
      <GlassPanel className="page-header-sticky px-4 flex items-center shrink-0"
        style={{
          height: 'calc(80px + var(--sat))',
          paddingTop: 'var(--sat)',
        }}>
        <IconButton
          icon={<ChevronLeft size={24} />}
          label="返回"
          className="text-slate-600"
          onClick={() => navigate(-1)}
        />
        <h2 className="ml-2 font-bold text-text-primary text-lg">账号管理</h2>
      </GlassPanel>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-[calc(40px+var(--sab))] custom-scrollbar">
        <div className="text-xs font-semibold uppercase tracking-wider px-1" style={{ color: '#94A3B8' }}>
          已保存的账号
        </div>

        <div className="space-y-3">
          <AnimatePresence initial={false}>
            {sortedAccounts.map((account) => (
              <motion.div
                key={account.user.uid}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
              >
              <div
                key={account.user.uid}
                onClick={() => handleSwitch(account.user.uid)}
                className={`p-4 rounded-[28px] border transition-all duration-200 cursor-pointer flex items-center justify-between group ${
                  account.user.uid === activeUid
                    ? 'shadow-md'
                    : 'shadow-sm hover:border-slate-200'
                }`}
                style={account.user.uid === activeUid ? {
                  borderColor: 'rgba(22,93,255,0.3)',
                  background: 'linear-gradient(135deg, rgba(239,244,255,0.8), rgba(238,242,255,0.7))',
                  boxShadow: '0 2px 12px rgba(22,93,255,0.08)',
                } : {
                  borderColor: 'rgba(226,232,240,0.4)',
                  background: 'rgba(255,255,255,0.85)',
                }}
              >
                <div className="flex items-center space-x-4">
                  <div className="w-12 h-12 rounded-xl overflow-hidden shadow-sm ring-2 ring-white"
                    style={{
                      background: 'linear-gradient(135deg, #f1f5f9, #e2e8f0)',
                      border: '2px solid rgba(255,255,255,0.9)',
                    }}>
                    {account.user.avatar ? (
                      <img src={account.user.avatar} alt={account.user.name} referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-slate-400">
                        <UserIcon size={24} />
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="font-bold text-text-primary flex items-center">
                      {account.user.name}
                      {account.user.uid === activeUid && (
                      <Badge variant="info" className="ml-2 text-[10px] uppercase">
                        当前
                      </Badge>
                    )}
                    </div>
                    <div className="text-xs text-text-secondary font-medium mt-0.5">{account.user.mobile}</div>
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <IconButton
                    icon={account.user.uid === activeUid ? <LogOut size={18} /> : <Trash2 size={18} />}
                    label={account.user.uid === activeUid ? '退出登录' : '移除账号'}
                    onClick={(e) => handleRemove(e, account.user.uid)}
                    className={account.user.uid === activeUid ? 'text-error-500' : 'text-slate-300 hover:text-error-500'}
                  />
                </div>
              </div>
              </motion.div>
            ))}
          </AnimatePresence>

          <Button
            variant="secondary"
            onClick={() => navigate('/login')}
            className="w-full p-4 rounded-2xl border-2 border-dashed flex items-center justify-center space-x-2 font-bold"
          >
            <Plus size={20} />
            <span>添加新账号</span>
          </Button>
        </div>

        <div className="pt-8 text-center pb-8">
          <p className="text-xs leading-relaxed px-8" style={{ color: '#94A3B8' }}>
            移除账号仅会从本地清除登录状态，不会影响您的学习通账号数据。
          </p>
        </div>
      </div>

      {/* Confirm Remove Modal */}
      <AnimatePresence>
        {confirmState.show && (
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-6"
            style={{ background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
            onClick={() => setConfirmState({ show: false, uid: null })}
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-sm rounded-3xl p-6 shadow-2xl border"
              style={{
                background: 'rgba(255,255,255,0.95)',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                borderColor: 'rgba(226,232,240,0.4)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-extrabold text-text-primary mb-2">移除账号</h3>
              <p className="text-sm text-text-secondary mb-6">确定要移除此账号吗？移除账号仅会从本地清除登录状态，不会影响您的学习通账号数据。</p>
              
              <div className="flex gap-3">
                <Button
                  variant="secondary"
                  onClick={() => setConfirmState({ show: false, uid: null })}
                  className="flex-1"
                >
                  取消
                </Button>
                <Button
                  onClick={confirmRemove}
                  className="flex-1 bg-error-500 text-white hover:bg-error-600"
                >
                  移除
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AccountManagement;
