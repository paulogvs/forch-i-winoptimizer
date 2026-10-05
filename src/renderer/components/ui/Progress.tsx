import React from 'react';

export interface ProgressProps {
  value?: number;
  max?: number;
  variant?: 'primary' | 'success' | 'warning' | 'error';
  label?: string;
  showValue?: boolean;
  className?: string;
  /**
   * Honest indeterminate mode (Fase 0.5): the backend reports no real
   * percent, so no fake percent is shown. Renders an animated bar with
   * `aria-valuetext` instead of a fabricated `aria-valuenow`.
   */
  indeterminate?: boolean;
}

export const Progress: React.FC<ProgressProps> = ({
  value = 0,
  max = 100,
  variant = 'primary',
  label,
  showValue = false,
  className = '',
  indeterminate = false,
}) => {
  const percent = Math.min(100, Math.max(0, (value / max) * 100));
  const variantClass = `progress-bar-${variant}`;

  if (indeterminate) {
    return (
      <div className={className}>
        {label && <div className="progress-label">{label}</div>}
        <div
          className="progress progress-indeterminate"
          role="progressbar"
          aria-label={label}
          aria-valuetext="in progress"
        >
          <div className={`progress-bar ${variantClass} progress-bar-animated`} />
        </div>
      </div>
    );
  }

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
