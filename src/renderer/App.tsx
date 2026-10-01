import React, { useState, useEffect, useCallback } from 'react';
import { Layout } from './components/layout/Layout';
import { Dashboard } from './pages/Dashboard';
import { Cleaner } from './pages/Cleaner';
import { Boost } from './pages/Boost';
import { Tools } from './pages/Tools';
import { Drivers } from './pages/Drivers';
import { Network } from './pages/Network';
import { Audit } from './pages/Audit';
import { Benchmark } from './pages/Benchmark';
import { Bundles } from './pages/Bundles';
import { Cleaning } from './pages/Cleaning';
import { Tweaks } from './pages/Tweaks';
import { Statistics } from './pages/Statistics';
import { Security } from './pages/Security';
import { Settings } from './pages/Settings';
import { useScanningIndicator } from './hooks/useScanProgress';
import type { PageId, Theme } from '@shared/types';

const App: React.FC = () => {
  useScanningIndicator();

  const [currentPage, setCurrentPage] = useState<PageId>('dashboard');
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('theme');
    if (saved === 'dark' || saved === 'light') return saved;
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [lastScan] = useState<Date | null>(null);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const handleThemeToggle = useCallback(() => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  }, []);

  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
  }, []);

  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard': return <Dashboard />;
      case 'cleaner': return <Cleaner />;
      case 'boost': return <Boost />;
      case 'tools': return <Tools />;
      case 'drivers': return <Drivers />;
      case 'network': return <Network />;
      case 'audit': return <Audit />;
      case 'benchmark': return <Benchmark />;
      case 'bundles': return <Bundles />;
      case 'cleaning': return <Cleaning />;
      case 'tweaks': return <Tweaks />;
      case 'statistics': return <Statistics />;
      case 'security': return <Security />;
      case 'settings': return <Settings theme={theme} onThemeToggle={handleThemeToggle} />;
      default: return <Dashboard />;
    }
  };

  return (
    <Layout
      currentPage={currentPage}
      onNavigate={setCurrentPage}
      theme={theme}
      onThemeToggle={handleThemeToggle}
      onSearch={handleSearch}
      searchQuery={searchQuery}
      version={__APP_VERSION__}
      windowsVersion="Windows 11"
      lastScan={lastScan}
    >
      {renderPage()}
    </Layout>
  );
};

export default App;
