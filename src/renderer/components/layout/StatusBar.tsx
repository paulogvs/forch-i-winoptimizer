import React from 'react';
import { useOperationStatus } from '../../hooks/useOperationStatus';

interface StatusBarProps {
  version: string;
  windowsVersion: string;
  lastScan: Date | null;
}

/**
 * Honest status bar (Fase B): the indicator derives from the real global
 * operation lock instead of a hardcoded "Ready/online". Shows Working while
 * an operation owns the lock, Ready when idle, plus the last scan when known.
 */
export const StatusBar: React.FC<StatusBarProps> = ({ version, windowsVersion, lastScan }) => {
  const operation = useOperationStatus();

  return (
    <footer className="status-bar">
      <div className="status-bar-left">
        <span>v{version}</span>
        <span>{windowsVersion}</span>
        <a
          className="brand-badge"
          href="https://github.com/forchia-ecosystem"
          target="_blank"
          rel="noopener noreferrer"
          title="Built with FORCH.i by Paulo Velasco"
        >
          FORCH.i
        </a>
      </div>
      <div className="status-bar-right">
        <div className="status-indicator" data-state={operation.busy ? 'working' : 'ready'}>
          <span
            className={`status-dot ${operation.busy ? 'status-dot-busy' : 'status-dot-online'}`}
            aria-hidden="true"
          />
          <span role="status">
            {operation.busy
              ? `Working${operation.queued > 0 ? ` (+${operation.queued})` : ''}…`
              : 'Ready'}
          </span>
        </div>
        {lastScan && !operation.busy && <span>Last scan: {lastScan.toLocaleDateString()}</span>}
      </div>
    </footer>
  );
};
