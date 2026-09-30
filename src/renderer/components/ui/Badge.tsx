import React from 'react';

export interface BadgeProps {
  variant?: 'success' | 'warning' | 'error' | 'info' | 'neutral';
  children: React.ReactNode;
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({
  variant = 'neutral',
  children,
  className = '',
}) => {
  const variantClass = `badge-${variant}`;
  const classes = ['badge', variantClass, className].filter(Boolean).join(' ');

  return <span className={classes}>{children}</span>;
};
