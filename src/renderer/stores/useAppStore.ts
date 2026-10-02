import { create } from 'zustand';
import type { PageId, Theme } from '@shared/types';

export type SecurityTab = 'security' | 'privacy' | 'dns';

interface AppState {
  currentPage: PageId;
  theme: Theme;
  searchQuery: string;
  lastScan: Date | null;
  /** Tab the Security page should open on (set by cross-page "Fix" actions). */
  securityTab: SecurityTab;
  setPage: (page: PageId) => void;
  setTheme: (theme: Theme) => void;
  setSearchQuery: (query: string) => void;
  setLastScan: (date: Date) => void;
  setSecurityTab: (tab: SecurityTab) => void;
}

export const useAppStore = create<AppState>((set) => ({
  currentPage: 'dashboard',
  theme: 'dark',
  searchQuery: '',
  lastScan: null,
  securityTab: 'security',
  setPage: (page) => set({ currentPage: page }),
  setTheme: (theme) => set({ theme }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setLastScan: (date) => set({ lastScan: date }),
  setSecurityTab: (tab) => set({ securityTab: tab }),
}));
