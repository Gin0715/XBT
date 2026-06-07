import React from 'react';
import { motion } from 'framer-motion';
import { MapPin, ChevronRight, Navigation } from 'lucide-react';

interface LocationInputProps {
  name: string;
  description: string;
  lat: string;
  lng: string;
  onOpen: () => void;
}

export const LocationInput: React.FC<LocationInputProps> = ({ name, description, lat, lng, onOpen }) => (
  <div className="w-full space-y-4 px-1">
    <div className="text-center">
      <h3 className="text-sm font-bold uppercase tracking-widest" style={{ color: '#334155' }}>
        学习通位置签到
      </h3>
      <p className="text-[10px] text-text-muted font-medium mt-1">
        选择后将发送经纬度坐标至学习通服务器
      </p>
    </div>
    <motion.div
      whileTap={{ scale: 0.98 }}
      whileHover={{ scale: 1.01 }}
      onClick={onOpen}
      className="w-full p-4 rounded-2xl flex items-center justify-between cursor-pointer group transition-all duration-200 shadow-sm"
      style={{
        background: 'rgba(248,250,252,0.8)',
        border: '1px solid rgba(226,232,240,0.6)',
      }}
    >
      <div className="flex items-center gap-3 min-w-0 px-1">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center shadow-sm flex-shrink-0"
          style={{
            background: 'linear-gradient(135deg, rgba(22,93,255,0.1), rgba(79,57,208,0.08))',
            color: '#165DFF',
          }}>
          <MapPin size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-bold text-text-primary truncate text-sm">
            {name || '点击选择签到地点'}
          </p>
          {lat && lng ? (
            <div className="flex flex-wrap items-center gap-1.5 mt-1">
              <p className="text-[10px] text-text-muted font-medium truncate">{description || '已选位置'}</p>
              <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-md flex-shrink-0"
                style={{
                  background: 'rgba(22,93,255,0.08)',
                  color: '#165DFF',
                }}>
                {lng}, {lat}
              </span>
            </div>
          ) : (
            <p className="text-[10px] text-text-muted font-medium truncate">
              从地址库中选择签到位置，支持 GPS 自动定位
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {!lat && (
          <span className="text-[9px] font-bold px-2 py-1 rounded-lg flex items-center gap-1"
            style={{
              background: 'rgba(0,180,42,0.08)',
              color: '#00B42A',
            }}>
            <Navigation size={10} />
            GPS
          </span>
        )}
        <ChevronRight size={18} className="text-slate-300 group-hover:text-brand-500 transition-colors" />
      </div>
    </motion.div>
  </div>
);
