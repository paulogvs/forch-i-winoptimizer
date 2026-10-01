import React from 'react';
import type { Theme } from '@shared/types';
import { WindowControls } from './WindowControls';
import { useOperationStatus } from '../../hooks/useOperationStatus';

interface HeaderProps {
  theme: Theme;
  onThemeToggle: () => void;
  onSearch: (query: string) => void;
  searchQuery: string;
}

/** Human-readable labels for the mutating IPC channels (P0.3). */
const OPERATION_LABELS: Record<string, string> = {
  'tweaks:apply': 'Applying tweak',
  'tweaks:restore': 'Restoring tweak',
  'tweaks:apply-many': 'Applying tweaks',
  'tweaks:restore-many': 'Restoring tweaks',
  'bundles:install': 'Installing app',
  'bundles:install-multiple': 'Installing apps',
  'bundles:uninstall': 'Uninstalling app',
  'apps:uninstall': 'Uninstalling app',
  'services:toggle': 'Changing service',
  'services:set-start-type': 'Changing service',
  'cleaner:delete': 'Deleting files',
  'cleaning:run-now': 'Running cleanup',
  'privacy:apply-setting': 'Applying privacy setting',
  'privacy:apply-all': 'Applying privacy settings',
  'security:run-action': 'Running security action',
  'dns:set': 'Setting DNS',
  'drivers:install': 'Installing driver',
  'drivers:rollback': 'Rolling back driver',
  'drivers:create-restore-point': 'Creating restore point',
  'network:fix': 'Fixing network',
  'network:fix-0x00000709': 'Fixing printer mapping',
  'startup:toggle': 'Changing startup app',
  'drift:reapply': 'Reapplying tweak',
  'drift:reapply-all': 'Reapplying tweaks',
};

function operationLabel(channel: string | null): string {
  if (!channel) return 'Working';
  return OPERATION_LABELS[channel] ?? 'Working';
}

/**
 * Titlebar + header. The bar itself is the OS drag region; interactive
 * children opt out with `no-drag` (see layout.css) and the window controls sit
 * at the far right (P0.1).
 *
 * Shows the global operation-lock badge while another operation owns the
 * backend lock (P0.3).
 */
export const Header: React.FC<HeaderProps> = ({ theme, onThemeToggle, onSearch, searchQuery }) => {
  const operation = useOperationStatus();

  return (
    <header className="header titlebar">
      <div className="header-left no-drag">
        <div className="search-box">
          <input
            type="search"
            className="input"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => onSearch(e.target.value)}
            aria-label="Search"
          />
        </div>
      </div>
      <div className="header-right no-drag">
        {operation.busy && (
          <div className="badge badge-info" role="status" aria-live="polite" data-testid="op-status">
            <span className="status-dot status-dot-online" aria-hidden="true" />
            <span>{operationLabel(operation.current)}</span>
            {operation.queued > 0 && <span>+{operation.queued} queued</span>}
          </div>
        )}
        <button
          className="btn btn-ghost btn-sm"
          onClick={onThemeToggle}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        >
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
        <button className="btn btn-ghost btn-sm" aria-label="Settings">
          ⚙️
        </button>
        <div className="user-avatar" aria-label="User profile">
          <span>PV</span>
        </div>
        <WindowControls />
      </div>
    </header>
  );
};
