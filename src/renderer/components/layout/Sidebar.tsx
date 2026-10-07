import React, { useMemo } from 'react';
import type { PageId } from '@shared/types';
import { NAV_SECTIONS, matchNavItems } from './nav';
import { Icon } from '../ui/Icon';

interface SidebarProps {
  currentPage: PageId;
  onNavigate: (page: PageId) => void;
  /** Live filter from the header search (Fase B: search is real now). */
  searchQuery: string;
}

export const Sidebar: React.FC<SidebarProps> = ({ currentPage, onNavigate, searchQuery }) => {
  const matches = useMemo(() => new Set(matchNavItems(searchQuery)), [searchQuery]);
  const filtering = searchQuery.trim().length > 0;

  const sections = useMemo(
    () =>
      NAV_SECTIONS.map((section) => ({
        ...section,
        items: section.items.filter((item) => matches.has(item.id)),
      })).filter((section) => section.items.length > 0),
    [matches]
  );

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <img
          className="sidebar-brand brand-logo--dark"
          src="brand/lockup-dark.png"
          alt="FORCH.iA WinOptimizer"
        />
        <img
          className="sidebar-brand brand-logo--light"
          src="brand/lockup-light.png"
          alt="FORCH.iA WinOptimizer"
        />
      </div>
      <nav className="sidebar-nav" aria-label="Main navigation">
        {sections.map((section) => (
          <div key={section.title} className="nav-section" role="group" aria-label={section.title}>
            <span className="nav-section-title" aria-hidden="true">
              {section.title}
            </span>
            {section.items.map((item) => (
              <button
                key={item.id}
                className={`nav-item ${currentPage === item.id ? 'active' : ''}`}
                onClick={() => onNavigate(item.id)}
                aria-current={currentPage === item.id ? 'page' : undefined}
              >
                <span className="nav-item-icon" aria-hidden="true">
                  <Icon name={item.icon} size={18} />
                </span>
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        ))}
        {filtering && sections.length === 0 && (
          <p className="nav-empty" role="status">
            No pages match “{searchQuery.trim()}”. Press Esc to clear.
          </p>
        )}
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
