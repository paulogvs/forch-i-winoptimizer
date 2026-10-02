import React, { useCallback, useEffect, useState } from 'react';

interface WindowControlsProps {
  className?: string;
}

/**
 * Windows 11 style window controls for the frameless window (P0.1).
 * Theme-aware, keyboard accessible, no listener leaks (unsubscribe on unmount).
 */
export const WindowControls: React.FC<WindowControlsProps> = ({ className }) => {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const controls = window.electronAPI?.window;
    if (!controls) return;

    let active = true;
    void controls
      .isMaximized()
      .then((value) => {
        if (active) setIsMaximized(Boolean(value));
      })
      .catch(() => {
        /* noop */
      });

    const offMaximized = controls.onMaximized?.(() => setIsMaximized(true));
    const offUnmaximized = controls.onUnmaximized?.(() => setIsMaximized(false));

    return () => {
      active = false;
      offMaximized?.();
      offUnmaximized?.();
    };
  }, []);

  const handleMinimize = useCallback(() => {
    void window.electronAPI?.window?.minimize();
  }, []);

  const handleToggleMaximize = useCallback(() => {
    const controls = window.electronAPI?.window;
    if (!controls) return;
    if (isMaximized) {
      void controls.unmaximize();
    } else {
      void controls.maximize();
    }
  }, [isMaximized]);

  const handleClose = useCallback(() => {
    void window.electronAPI?.window?.close();
  }, []);

  return (
    <div className={`window-controls ${className ?? ''}`} data-testid="window-controls">
      <button
        type="button"
        className="window-control"
        aria-label="Minimize"
        title="Minimize"
        onClick={handleMinimize}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
          <line x1="0" y1="5" x2="10" y2="5" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>

      <button
        type="button"
        className="window-control"
        aria-label={isMaximized ? 'Restore' : 'Maximize'}
        title={isMaximized ? 'Restore' : 'Maximize'}
        aria-pressed={isMaximized}
        onClick={handleToggleMaximize}
      >
        {isMaximized ? (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
            <rect
              x="0.5"
              y="2.5"
              width="7"
              height="7"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
            />
            <path d="M2.5 2.5V0.5H9.5V7.5H7.5" fill="none" stroke="currentColor" strokeWidth="1" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
            <rect
              x="0.5"
              y="0.5"
              width="9"
              height="9"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
            />
          </svg>
        )}
      </button>

      <button
        type="button"
        className="window-control window-control--close"
        aria-label="Close"
        title="Close"
        onClick={handleClose}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
          <line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" strokeWidth="1" />
          <line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>
    </div>
  );
};
