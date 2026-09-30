import React from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { StatusBar } from './StatusBar';
import { PageId, Theme } from '@shared/types';

interface LayoutProps {
  currentPage: PageId;
  onNavigate: (page: PageId) => void;
  theme: Theme;
  onThemeToggle: () => void;
  onSearch: (query: string) => void;
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
  version,
  windowsVersion,
  lastScan,
  children,
}) => {
  return (
    <div className="app-shell">
      <Sidebar currentPage={currentPage} onNavigate={onNavigate} />
      <div className="main-area">
        <Header theme={theme} onThemeToggle={onThemeToggle} onSearch={onSearch} />
        <main className="main-content">{children}</main>
        <StatusBar version={version} windowsVersion={windowsVersion} lastScan={lastScan} />
      </div>
    </div>
  );
};
