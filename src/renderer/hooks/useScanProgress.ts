import { useEffect, useState } from 'react';
import type { ScanProgressEvent } from '@shared/scan-progress';

/**
 * Subscribe to progress events for a single module (P0.3).
 * Safe when the preload bridge is absent (browser/E2E): returns null.
 */
export function useScanProgress(module: string): ScanProgressEvent | null {
  const [event, setEvent] = useState<ScanProgressEvent | null>(null);

  useEffect(() => {
    const onProgress = window.electronAPI?.onScanProgress;
    if (typeof onProgress !== 'function') return;
    return onProgress((incoming) => {
      if (incoming.module === module) setEvent(incoming);
    });
  }, [module]);

  return event;
}

/**
 * Toggle a global `data-scanning` attribute on <html> while any module is
 * scanning, so CSS can pause decorative animations (P3) without competing with
 * the actual work. Tracks concurrent modules so one finishing early does not
 * clear the flag for another.
 */
export function useScanningIndicator(): void {
  useEffect(() => {
    const onProgress = window.electronAPI?.onScanProgress;
    if (typeof onProgress !== 'function') return;

    const root = document.documentElement;
    const active = new Set<string>();

    const unsubscribe = onProgress((incoming) => {
      const scanning = incoming.stage !== 'done' && incoming.stage !== 'error';
      if (scanning) {
        active.add(incoming.module);
      } else {
        active.delete(incoming.module);
      }
      if (active.size > 0) {
        root.setAttribute('data-scanning', 'true');
      } else {
        root.removeAttribute('data-scanning');
      }
    });

    return () => {
      unsubscribe();
      root.removeAttribute('data-scanning');
    };
  }, []);
}
