import React from 'react';

interface PinInputProps {
  value: string;
  onChange: (val: string) => void;
}

export const PinInput: React.FC<PinInputProps> = ({ value, onChange }) => (
  <div className="w-full space-y-4">
    <div className="text-center">
      <h3 className="text-sm font-bold uppercase tracking-widest" style={{ color: '#334155' }}>请输入4-8位签到码</h3>
    </div>
    <div className="flex flex-col items-center gap-3">
      <input
        type="text"
        placeholder="请输入签到码"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 8))}
        className="w-full p-4 rounded-2xl border-none text-center text-3xl font-extrabold tracking-[0.4em] transition-all duration-200 focus:outline-none"
        style={{
          background: 'rgba(248,250,252,0.8)',
          border: '1px solid rgba(226,232,240,0.8)',
          color: '#165DFF',
          boxShadow: '0 2px 8px rgba(22,93,255,0.06)',
        }}
      />
    </div>
  </div>
);
