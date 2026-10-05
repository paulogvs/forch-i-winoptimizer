import React from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { StatusBar } from './StatusBar';
import type { PageId, Theme } from '@shared/types';

interface LayoutProps {
  currentPage: PageId;
  onNavigate: (page: PageId) => void;
  theme: Theme;
  onThemeToggle: () => void;
  onSearch: (query: string) => void;
  searchQuery: string;
  version: string;
  windowsVersion: string;
  lastScan: Date | null;
  children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({
  currentPage,
  onNavigate,
  theme,
  onThemeToggle,
  onSearch,
  searchQuery,
  version,
  windowsVersion,
  lastScan,
  children,
}) => {
  return (
    <div className="app-shell">
      <Sidebar currentPage={currentPage} onNavigate={onNavigate} />
      <div className="main-area">
        <Header
          theme={theme}
          onThemeToggle={onThemeToggle}
          onSearch={onSearch}
          searchQuery={searchQuery}
          onNavigate={onNavigate}
        />
        <main className="main-content">{children}</main>
        <StatusBar version={version} windowsVersion={windowsVersion} lastScan={lastScan} />
      </div>
    </div>
  );
};
