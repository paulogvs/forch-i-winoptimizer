import React from 'react';

interface SkeletonProps {
  width?: string | number;
  height?: number | string;
  radius?: string;
  className?: string;
}

/** Base shimmering placeholder. Shape is always overridable. */
export const Skeleton: React.FC<SkeletonProps> = ({ width = '100%', height = 16, radius, className }) => (
  <span
    className={`skeleton ${className ?? ''}`}
    style={{ width, height, borderRadius: radius }}
    aria-hidden="true"
  />
);

/** A few text lines (list/paragraph skeleton). */
export const SkeletonText: React.FC<{ lines?: number }> = ({ lines = 3 }) => (
  <div className="skeleton-text" aria-hidden="true">
    {Array.from({ length: lines }).map((_, i) => (
      <Skeleton key={i} width={i === lines - 1 ? '60%' : '100%'} height={12} />
    ))}
  </div>
);

/** Table-shaped skeleton (rows x columns). */
export const SkeletonTable: React.FC<{ rows?: number; columns?: number }> = ({ rows = 6, columns = 4 }) => (
  <div className="skeleton-table" aria-hidden="true" data-testid="skeleton-table">
    {Array.from({ length: rows }).map((_, r) => (
      <div className="skeleton-table-row" key={r}>
        {Array.from({ length: columns }).map((__, c) => (
          <Skeleton key={c} height={14} width={c === 0 ? '70%' : '55%'} />
        ))}
      </div>
    ))}
  </div>
);

/** Card grid skeleton. */
export const SkeletonCards: React.FC<{ count?: number }> = ({ count = 3 }) => (
  <div className="grid grid-cols-1 md:grid-cols-3" aria-hidden="true" data-testid="skeleton-cards">
    {Array.from({ length: count }).map((_, i) => (
      <div className="card" key={i}>
        <Skeleton width="40%" height={10} />
        <div style={{ height: 8 }} />
        <Skeleton width="65%" height={28} />
        <div style={{ height: 12 }} />
        <Skeleton width="100%" height={8} />
      </div>
    ))}
  </div>
);

/** Row/list skeleton. */
export const SkeletonList: React.FC<{ rows?: number }> = ({ rows = 6 }) => (
  <div className="skeleton-list" aria-hidden="true" data-testid="skeleton-list">
    {Array.from({ length: rows }).map((_, i) => (
      <div className="skeleton-list-row" key={i}>
        <Skeleton width={28} height={28} radius="var(--radius-md)" />
        <div className="skeleton-list-body">
          <Skeleton width="45%" height={12} />
          <Skeleton width="75%" height={10} />
        </div>
        <Skeleton width={64} height={18} radius="var(--radius-full)" />
      </div>
    ))}
  </div>
);
