import type { CSSProperties, ReactNode } from 'react';

interface GlassCardProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export const GlassCard = ({ children, className = '', style }: GlassCardProps) => {
  return (
    <div className={`glass-card ${className}`} style={style}>
      {children}
    </div>
  );
};
