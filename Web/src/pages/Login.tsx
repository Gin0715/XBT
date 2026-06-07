import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Phone, Lock, Eye, EyeOff, Loader2, ChevronLeft } from 'lucide-react';
import toast from 'react-hot-toast';
import client from '../api/client';
import { useAuthStore } from '../store/auth';
import type { ApiResponse, AuthResponse } from '../types';

const Login = () => {
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  const { addAccount, accounts } = useAuthStore();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mobile || !password) {
      toast.error('请填写手机号和密码');
      return;
    }

    setIsLoading(true);
    try {
      const response = await client.post<ApiResponse<AuthResponse>>('/auth/login', {
        mobile,
        password,
      });

      const { token, user } = response.data.data;
      addAccount(user, token);
      toast.success('登录成功');
      navigate('/', { replace: true });
    } catch (error: any) {
      toast.error(error.message || '登录失败，请检查账号密码');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col p-8 justify-center relative bg-transparent">
      {accounts.length > 0 && (
        <button
          onClick={() => navigate(-1)}
          className="absolute top-[calc(var(--spacing)*4.5+var(--sat))] left-2 p-2 rounded-xl transition-all duration-200 hover:bg-white/50"
          style={{ color: '#64748B' }}
        >
          <ChevronLeft size={24} />
        </button>
      )}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full"
      >
        {/* Logo */}
        <div className="mb-10 text-center">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl mb-4 overflow-hidden shadow-xl"
            style={{
              background: 'linear-gradient(135deg, #165DFF, #722ED1)',
              boxShadow: '0 8px 32px rgba(22,93,255,0.25)',
            }}>
            <img src="/favicon.jpg" alt="Logo" className="w-full h-full object-cover" />
          </div>
          <h1 className="text-3xl font-extrabold mb-2">
            <span style={{
              background: 'linear-gradient(135deg, #165DFF, #722ED1)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}>学不通 2.0</span>
          </h1>
          <p className="text-text-secondary font-medium">一人签到，全寝睡觉</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-5">
          {/* Mobile */}
          <div className="space-y-1.5">
            <label className="text-sm font-semibold ml-1" style={{ color: '#334155' }}>手机号</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none" style={{ color: '#94A3B8' }}>
                <Phone size={18} />
              </div>
              <input
                type="tel"
                value={mobile}
                onChange={(e) => setMobile(e.target.value)}
                placeholder="学习通绑定手机号"
                className="block w-full pl-10 pr-4 py-3.5 rounded-xl transition-all duration-200 font-medium placeholder:text-slate-300 focus:outline-none"
                style={{
                  background: 'rgba(248,250,252,0.8)',
                  border: '1px solid rgba(226,232,240,0.8)',
                }}
                autoComplete="username"
              />
            </div>
          </div>

          {/* Password */}
          <div className="space-y-1.5">
            <label className="text-sm font-semibold ml-1" style={{ color: '#334155' }}>密码</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none" style={{ color: '#94A3B8' }}>
                <Lock size={18} />
              </div>
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="学习通密码"
                className="block w-full pl-10 pr-12 py-3.5 rounded-xl transition-all duration-200 font-medium placeholder:text-slate-300 focus:outline-none"
                style={{
                  background: 'rgba(248,250,252,0.8)',
                  border: '1px solid rgba(226,232,240,0.8)',
                }}
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 pr-3.5 flex items-center transition-colors duration-200"
                style={{ color: '#94A3B8' }}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {/* Submit */}
          <motion.button
            whileTap={{ scale: 0.95 }}
            whileHover={{ scale: 1.02 }}
            type="submit"
            disabled={isLoading}
            className="w-full flex items-center justify-center py-4 px-4 text-white font-semibold rounded-xl shadow-lg transition-all duration-200 disabled:opacity-50 disabled:scale-100"
            style={{
              background: 'linear-gradient(135deg, #165DFF, #4f39d0)',
              boxShadow: '0 4px 20px rgba(22,93,255,0.35)',
            }}
          >
            {isLoading ? (
              <Loader2 className="animate-spin mr-2" size={20} />
            ) : (
              '登录 / 注册'
            )}
          </motion.button>
        </form>

        <div className="mt-12 text-center" style={{ color: '#94A3B8', fontSize: '11px', lineHeight: '1.6' }}>
          <p>注册即代表同意本网站收集您的第三方网站隐私信息。其中包括:
            姓名，手机号，密码，课程信息等。您的密码将仅用于登录第三方网站。</p>
        </div>
      </motion.div>
    </div>
  );
};

export default Login;
