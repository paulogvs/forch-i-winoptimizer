import React from 'react';
import type { Theme } from '@shared/types';
import { WindowControls } from './WindowControls';

interface HeaderProps {
  theme: Theme;
  onThemeToggle: () => void;
  onSearch: (query: string) => void;
  searchQuery: string;
}

/**
 * Titlebar + header. The bar itself is the OS drag region; interactive
 * children opt out with `no-drag` (see layout.css) and the window controls sit
 * at the far right (P0.1).
 */
export const Header: React.FC<HeaderProps> = ({ theme, onThemeToggle, onSearch, searchQuery }) => {
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
