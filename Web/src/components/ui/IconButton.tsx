import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Button } from './Button';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  label?: string;
}

export const IconButton = ({ icon, label, className = '', ...props }: IconButtonProps) => {
  return (
    <Button
      variant="ghost"
      size="sm"
      className={`btn-circle ${className}`}
      aria-label={label}
      {...props}
    >
      {icon}
    </Button>
  );
};
