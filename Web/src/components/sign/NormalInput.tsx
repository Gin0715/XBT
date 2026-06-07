import React from 'react';
import { CheckCircle2 } from 'lucide-react';

export const NormalInput: React.FC = () => (
  <div className="text-center py-2 space-y-4">
    <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto shadow-sm"
      style={{
        background: 'linear-gradient(135deg, rgba(22,93,255,0.08), rgba(79,57,208,0.06))',
        color: '#165DFF',
      }}>
      <CheckCircle2 size={32} />
    </div>
    <div>
      <h3 className="text-lg font-extrabold uppercase tracking-widest" style={{ color: '#334155' }}>普通签到</h3>
      <p className="text-xs text-text-muted font-medium mt-2">直接点击下方按钮签到</p>
    </div>
  </div>
);
