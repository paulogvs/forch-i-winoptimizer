import { useEffect, useState } from 'react';
import type { OperationStatus } from '@shared/electron-api';

const IDLE: OperationStatus = { busy: false, current: null, queued: 0, startedAt: null };

/**
 * Track the global operation lock (P0.3).
 *
 * Subscribes to `system:op-changed` pushes from the main process and fetches
 * the current status once on mount, so the UI can show a busy indicator and
 * disable action buttons while another operation (tweak, install, uninstall,
 * cleaner…) owns the lock. Safe when the preload bridge is absent.
 */
export function useOperationStatus(): OperationStatus {
  const [status, setStatus] = useState<OperationStatus>(IDLE);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;

    let alive = true;

    if (typeof api.getOperationStatus === 'function') {
      api
        .getOperationStatus()
        .then((initial) => {
          if (alive && initial) setStatus(initial);
        })
        .catch(() => {
          /* bridge unavailable: stay idle */
        });
    }

    if (typeof api.onOperationStatus !== 'function') return;

    const unsubscribe = api.onOperationStatus((incoming) => {
      if (alive) setStatus(incoming);
    });

    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  return status;
}
