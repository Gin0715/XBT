import type { ButtonHTMLAttributes, ReactNode } from 'react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: ReactNode;
}

const variantClasses: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: 'bg-gradient-to-r from-[#165DFF] to-[#4f39d0] text-white shadow-[0_16px_36px_rgba(22,93,255,0.18)] hover:shadow-[0_16px_36px_rgba(22,93,255,0.28)]',
  secondary: 'bg-white/90 text-[#1E293B] border border-slate-200 hover:bg-slate-50',
  ghost: 'bg-transparent text-[#165DFF] hover:bg-slate-100',
  danger: 'bg-gradient-to-r from-[#F53F3F] to-[#FB923C] text-white shadow-[0_16px_36px_rgba(245,63,63,0.18)] hover:shadow-[0_16px_36px_rgba(245,63,63,0.28)]',
};

const sizeClasses: Record<NonNullable<ButtonProps['size']>, string> = {
  sm: 'px-3 py-2 text-sm',
  md: 'px-4 py-3 text-sm',
  lg: 'px-5 py-4 text-base',
};

export const Button = ({
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  ...props
}: ButtonProps) => {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-2xl font-semibold transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#165DFF]/40 disabled:cursor-not-allowed disabled:opacity-60 ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
};
