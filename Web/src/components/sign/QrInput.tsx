import React from 'react';
import { QrCode } from 'lucide-react';

export const QrInput: React.FC = () => (
  <div className="w-full space-y-4 py-2">
    <div className="text-center">
      <h3 className="text-sm font-bold uppercase tracking-widest" style={{ color: '#334155' }}>请准备扫码签到</h3>
    </div>
    <div className="flex flex-col items-center gap-3 text-center">
      <div className="w-20 h-20 rounded-2xl flex items-center justify-center shadow-inner"
        style={{
          background: 'linear-gradient(135deg, rgba(22,93,255,0.08), rgba(79,57,208,0.06))',
          color: '#165DFF',
          boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.04)',
        }}>
        <QrCode size={40} />
      </div>
      <p className="text-[10px] text-text-muted font-medium">二维码签到需先跳转至扫码界面</p>
    </div>
  </div>
);
