import React from 'react';
import { PageId } from '@shared/types';

interface SidebarProps {
  currentPage: PageId;
  onNavigate: (page: PageId) => void;
}

const navItems: { id: PageId; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '📊' },
  { id: 'cleaner', label: 'Cleaner', icon: '🧹' },
  { id: 'boost', label: 'Boost', icon: '🚀' },
  { id: 'tools', label: 'Tools', icon: '🔧' },
  { id: 'statistics', label: 'Statistics', icon: '📈' },
  { id: 'security', label: 'Security', icon: '🛡️' },
  { id: 'settings', label: 'Settings', icon: '⚙️' },
];

export const Sidebar: React.FC<SidebarProps> = ({ currentPage, onNavigate }) => {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h1 className="sidebar-logo">FORCH.iA WinOptimizer</h1>
      </div>
      <nav className="sidebar-nav" aria-label="Main navigation">
        {navItems.map((item) => (
          <button
            key={item.id}
            className={`nav-item ${currentPage === item.id ? 'active' : ''}`}
            onClick={() => onNavigate(item.id)}
            aria-current={currentPage === item.id ? 'page' : undefined}
          >
            <span className="nav-item-icon" aria-hidden="true">{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-footer">
        <a
          className="brand-badge"
          href="https://github.com/forchia-ecosystem"
          target="_blank"
          rel="noopener noreferrer"
        >
          Built with FORCH.i by Paulo Velasco
        </a>
      </div>
    </aside>
  );
};
