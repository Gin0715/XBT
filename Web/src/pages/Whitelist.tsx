import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronLeft,
  Plus,
  Trash2,
  UserPlus,
  Upload,
  Search,
  Shield,
  Loader2,
  X
} from 'lucide-react';
import toast from 'react-hot-toast';
import client from '../api/client';
import type { ApiResponse, WhitelistItem } from '../types';
import { Button } from '../components/ui/Button';
import { IconButton } from '../components/ui/IconButton';
import { GlassPanel } from '../components/ui/GlassPanel';
import { GlassCard } from '../components/ui/GlassCard';

const Whitelist = () => {
  const navigate = useNavigate();
  const [list, setList] = useState<WhitelistItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [showAddModal, setShowAddModal] = useState(false);
  const [showBatchModal, setShowBatchModal] = useState(false);

  const [newMobile, setNewMobile] = useState('');
  const [batchMobiles, setBatchMobiles] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchList = async () => {
    setIsLoading(true);
    try {
      const response = await client.get<ApiResponse<WhitelistItem[]>>('/admin/whitelist/users');
      setList(response.data.data);
    } catch (error: any) {
      toast.error(error.message || '获取白名单失败');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchList();
  }, []);

  const handleAdd = async () => {
    if (!newMobile) return;
    setIsSubmitting(true);
    try {
      await client.post('/admin/whitelist/users', { mobile: newMobile });
      toast.success('已添加');
      setShowAddModal(false);
      setNewMobile('');
      fetchList();
    } catch (error: any) {
      toast.error(error.message || '添加失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBatchAdd = async () => {
    if (!batchMobiles) return;
    setIsSubmitting(true);
    try {
      await client.post('/admin/whitelist/users/import', { mobiles: batchMobiles });
      toast.success('批量同步成功');
      setShowBatchModal(false);
      setBatchMobiles('');
      fetchList();
    } catch (error: any) {
      toast.error(error.message || '导入失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: number, mobile: string) => {
    if (!confirm(`确定要删除 ${mobile} 吗？`)) return;
    try {
      await client.delete(`/admin/whitelist/users/${id}`);
      toast.success('已删除');
      fetchList();
    } catch (error: any) {
      toast.error(error.message || '删除失败');
    }
  };

  const filteredList = list.filter(item =>
    item.mobile_masked.includes(search)
  );

  return (
    <div className="h-full flex flex-col bg-transparent relative overflow-hidden">
      <GlassPanel className="page-header-sticky flex items-center justify-between shrink-0 px-4"
        style={{
          height: 'calc(80px + var(--sat))',
          paddingTop: 'var(--sat)',
        }}>
        <div className="flex items-center">
          <IconButton
            icon={<ChevronLeft size={24} />}
            label="返回"
            className="text-slate-600"
            onClick={() => navigate(-1)}
          />
          <h2 className="ml-2 font-bold text-text-primary text-lg">白名单管理</h2>
        </div>
        <div className="flex space-x-1">
          <IconButton
            icon={<Upload size={20} />}
            label="批量导入"
            className="text-[#165DFF]"
            onClick={() => setShowBatchModal(true)}
          />
          <IconButton
            icon={<Plus size={24} />}
            label="添加单个"
            className="text-[#165DFF]"
            onClick={() => setShowAddModal(true)}
          />
        </div>
      </GlassPanel>

      <div className="flex-1 overflow-y-auto p-4 pb-[calc(40px+var(--sab))] custom-scrollbar">
        <div className="relative mb-6">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted" size={18} />
          <input
            type="text"
            placeholder="搜索手机号..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="form-input pl-10"
          />
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map(i => <div key={i} className="h-16 rounded-2xl animate-shimmer" />)}
          </div>
        ) : (
          <div className="space-y-2.5">
            {filteredList.map((item) => (
              <GlassCard
                key={item.id}
                className="flex items-center justify-between p-4 rounded-[28px] border shadow-sm"
                style={{
                  background: 'rgba(255,255,255,0.85)',
                  borderColor: 'rgba(226,232,240,0.4)',
                }}
              >
                <div className="flex items-center space-x-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-sm ${
                    item.permission >= 2 ? '' : ''
                  }`}
                    style={{
                      background: item.permission >= 2
                        ? 'linear-gradient(135deg, rgba(255,125,0,0.12), rgba(251,146,60,0.12))'
                        : 'linear-gradient(135deg, rgba(22,93,255,0.08), rgba(79,57,208,0.06))',
                      color: item.permission >= 2 ? '#FF7D00' : '#165DFF',
                    }}>
                    {item.permission >= 2 ? <Shield size={20} /> : <UserPlus size={20} />}
                  </div>
                  <div>
                    <div className="font-bold text-text-primary">{item.mobile_masked}</div>
                    <div className="text-xs text-text-secondary font-medium">
                      {item.permission >= 2 ? '管理员' : '普通用户'}
                    </div>
                  </div>
                </div>
                {item.permission < 2 && (
                  <IconButton
                    icon={<Trash2 size={18} />}
                    label="删除白名单"
                    className="text-slate-400 hover:text-error-500"
                    onClick={() => handleDelete(item.id, item.mobile_masked)}
                  />
                )}
              </GlassCard>
            ))}
          </div>
        )}
      </div>

      {/* Add Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6"
          style={{ background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}>
          <div className="w-full max-w-sm rounded-3xl p-6 shadow-2xl border"
            style={{
              background: 'rgba(255,255,255,0.95)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              borderColor: 'rgba(226,232,240,0.4)',
            }}>
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-extrabold text-text-primary">添加用户</h3>
              <IconButton
                icon={<X size={20} />}
                label="关闭"
                className="text-text-muted"
                onClick={() => setShowAddModal(false)}
              />
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-xs text-text-secondary ml-1 font-semibold">手机号</label>
                <input
                  type="tel"
                  value={newMobile}
                  onChange={(e) => setNewMobile(e.target.value)}
                  className="form-input mt-1.5"
                  placeholder="13800000000"
                />
              </div>
              <Button
                onClick={handleAdd}
                disabled={isSubmitting}
                className="w-full"
                size="lg"
              >
                {isSubmitting ? <Loader2 className="animate-spin mx-auto" /> : '确认添加'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Batch Modal */}
      {showBatchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6"
          style={{ background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}>
          <div className="w-full max-w-sm rounded-3xl p-6 shadow-2xl border"
            style={{
              background: 'rgba(255,255,255,0.95)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              borderColor: 'rgba(226,232,240,0.4)',
            }}>
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-extrabold text-text-primary">批量导入</h3>
              <IconButton
                icon={<X size={20} />}
                label="关闭"
                className="text-text-muted"
                onClick={() => setShowBatchModal(false)}
              />
            </div>
            <div className="space-y-4">
              <p className="text-xs text-text-secondary font-medium">支持换行、逗号、空格分隔手机号</p>
              <textarea
                value={batchMobiles}
                onChange={(e) => setBatchMobiles(e.target.value)}
                className="form-input min-h-[170px] resize-none"
                placeholder={"13800000001\n13800000002,13800000003"}
              />
              <Button
                onClick={handleBatchAdd}
                disabled={isSubmitting}
                className="w-full"
                size="lg"
              >
                {isSubmitting ? <Loader2 className="animate-spin mx-auto" /> : '开始导入'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Whitelist;
