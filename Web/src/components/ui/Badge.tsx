import type { HTMLAttributes, ReactNode } from 'react';

interface BadgeProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info';
}

const variantClassName: Record<NonNullable<BadgeProps['variant']>, string> = {
  default: 'badge-soft',
  success: 'badge-success',
  warning: 'badge-warning',
  danger: 'badge-danger',
  info: 'badge-info',
};

export const Badge = ({ children, variant = 'default', className = '', ...props }: BadgeProps) => {
  return (
    <div className={`badge ${variantClassName[variant]} ${className}`} {...props}>
      {children}
    </div>
  );
};
