import type { PageId } from '@shared/types';
import type { IconName } from '../ui/Icon';

export interface NavItem {
  id: PageId;
  label: string;
  icon: IconName;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

/**
 * Navigation IA (Fase B): 14 flat items grouped into 4 sections so the
 * sidebar scans instead of overwhelming. Single source of truth for the
 * sidebar, the header search matcher and tests.
 */
export const NAV_SECTIONS: NavSection[] = [
  {
    title: 'System health',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: 'grid' },
      { id: 'boost', label: 'Boost', icon: 'rocket' },
      { id: 'cleaner', label: 'Cleaner', icon: 'trash' },
      { id: 'cleaning', label: 'Cleaning', icon: 'calendar' },
    ],
  },
  {
    title: 'System',
    items: [
      { id: 'tweaks', label: 'Tweaks', icon: 'sliders' },
      { id: 'tools', label: 'Tools', icon: 'wrench' },
      { id: 'drivers', label: 'Drivers', icon: 'cpu' },
      { id: 'network', label: 'Network', icon: 'globe' },
      { id: 'security', label: 'Security', icon: 'shield' },
    ],
  },
  {
    title: 'Analysis',
    items: [
      { id: 'audit', label: 'Audit', icon: 'search' },
      { id: 'benchmark', label: 'Benchmark', icon: 'chart' },
      { id: 'statistics', label: 'Statistics', icon: 'trending-up' },
      { id: 'bundles', label: 'Bundles', icon: 'package' },
    ],
  },
  {
    title: 'App',
    items: [{ id: 'settings', label: 'Settings', icon: 'settings' }],
  },
];

/** Case-insensitive label match, in navigation order. Empty query matches all. */
export function matchNavItems(query: string): PageId[] {
  const q = query.trim().toLowerCase();
  const all = NAV_SECTIONS.flatMap((section) => section.items);
  if (!q) return all.map((item) => item.id);
  return all.filter((item) => item.label.toLowerCase().includes(q)).map((item) => item.id);
}
