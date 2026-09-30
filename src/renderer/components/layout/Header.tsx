import React from 'react';
import { Theme } from '@shared/types';

interface HeaderProps {
  theme: Theme;
  onThemeToggle: () => void;
  onSearch: (query: string) => void;
}

export const Header: React.FC<HeaderProps> = ({ theme, onThemeToggle, onSearch }) => {
  return (
    <header className="header">
      <div className="header-left">
        <div className="search-box">
          <input
            type="search"
            className="input"
            placeholder="Search..."
            onChange={(e) => onSearch(e.target.value)}
            aria-label="Search"
          />
        </div>
      </div>
      <div className="header-right">
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
      </div>
    </header>
  );
};
