import React from 'react';

export interface ProgressProps {
  value: number;
  max?: number;
  variant?: 'primary' | 'success' | 'warning' | 'error';
  label?: string;
  showValue?: boolean;
  className?: string;
}

export const Progress: React.FC<ProgressProps> = ({
  value,
  max = 100,
  variant = 'primary',
  label,
  showValue = false,
  className = '',
}) => {
  const percent = Math.min(100, Math.max(0, (value / max) * 100));
  const variantClass = `progress-bar-${variant}`;

  return (
    <div className={className}>
      {(label || showValue) && (
        <div className="progress-label">
          {label && <span>{label}</span>}
          {showValue && <span>{Math.round(percent)}%</span>}
        </div>
      )}
      <div
        className="progress"
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={label}
      >
        <div className={`progress-bar ${variantClass}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
};
