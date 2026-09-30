import React from 'react';

interface StatusBarProps {
  version: string;
  windowsVersion: string;
  lastScan: Date | null;
}

export const StatusBar: React.FC<StatusBarProps> = ({ version, windowsVersion, lastScan }) => {
  return (
    <footer className="status-bar">
      <div className="status-bar-left">
        <span>v{version}</span>
        <span>{windowsVersion}</span>
      </div>
      <div className="status-bar-right">
        <div className="status-indicator">
          <span className="status-dot status-dot-online" />
          <span>Ready</span>
        </div>
        {lastScan && (
          <span>Last scan: {lastScan.toLocaleDateString()}</span>
        )}
      </div>
    </footer>
  );
};
