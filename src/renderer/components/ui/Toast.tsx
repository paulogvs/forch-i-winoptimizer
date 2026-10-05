import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ToastContext, type ToastInput } from './toast-context';

/**
 * In-app toast notifications (Fase 3.4).
 *
 * Replaces the remaining `alert()` calls with a non-blocking, accessible
 * notification: the container is `aria-live="polite"` so screen readers
 * announce the real result, and an optional action link lets the user jump to
 * Statistics. Alerts are toast, never `window.alert`.
 *
 * This module exports ONLY the provider component; the context + `useToast`
 * hook live in `toast-context.ts` (react-refresh rule).
 */

interface ToastItem extends ToastInput {
  id: string;
}

let counter = 0;

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef<Map<string, number>>(new Map());

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const notify = useCallback(
    (input: ToastInput): string => {
      counter += 1;
      const id = `toast-${counter}`;
      setToasts((prev) => [...prev, { ...input, id }]);
      const duration = input.durationMs ?? 6000;
      if (duration > 0) {
        const timer = window.setTimeout(() => dismiss(id), duration);
        timers.current.set(id, timer);
      }
      return id;
    },
    [dismiss]
  );

  // Clear pending timers on unmount so a dismissed app never fires a callback.
  useEffect(
    () => () => {
      timers.current.forEach((timer) => window.clearTimeout(timer));
      timers.current.clear();
    },
    []
  );

  const value = useMemo(() => ({ notify, dismiss }), [notify, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="toast-container"
        data-testid="toast-container"
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map((toast) => {
          const variant = toast.variant ?? 'info';
          return (
            <div
              key={toast.id}
              className={`toast toast-${variant}`}
              data-testid="toast"
              data-variant={variant}
              role="status"
            >
              <div className="toast-content">
                <div className="toast-title">{toast.title}</div>
                {toast.message !== undefined && (
                  <div className="toast-message">{toast.message}</div>
                )}
              </div>
              {toast.action && (
                <button
                  type="button"
                  className="toast-action"
                  onClick={() => {
                    const action = toast.action;
                    if (!action) return;
                    action.onClick();
                    dismiss(toast.id);
                  }}
                >
                  {toast.action.label}
                </button>
              )}
              <button
                type="button"
                className="toast-close"
                aria-label="Dismiss notification"
                onClick={() => dismiss(toast.id)}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
};
