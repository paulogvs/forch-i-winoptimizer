import React, { useEffect, useState } from 'react';
import { useOperationStatus } from '../../hooks/useOperationStatus';

/** Delay before the global veil appears (quick ops only flash the badge). */
export const BUSY_OVERLAY_DELAY_MS = 800;

/**
 * Elite "thinking" indicator (Fase C, CSS-only). Appears only for long
 * operations: a lightweight non-blocking veil (`pointer-events: none`, so it
 * can never trap input) with a GPU spinner + honest label. Quick operations
 * surface solely through the header badge.
 */
export const GlobalBusyOverlay: React.FC = () => {
  const operation = useOperationStatus();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!operation.busy) {
      setVisible(false);
      return;
    }
    const timer = window.setTimeout(() => setVisible(true), BUSY_OVERLAY_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [operation.busy]);

  if (!operation.busy || !visible) return null;

  return (
    <div className="busy-overlay" data-testid="global-busy" role="status" aria-live="polite">
      <div className="busy-card">
        <span className="busy-spinner" aria-hidden="true" />
        <span className="busy-label">
          Working{operation.queued > 0 ? ` (+${operation.queued} queued)` : ''}…
        </span>
      </div>
    </div>
  );
};
