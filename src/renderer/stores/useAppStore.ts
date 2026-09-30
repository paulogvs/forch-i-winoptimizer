import { create } from 'zustand';
import { PageId, Theme } from '@shared/types';

interface AppState {
  currentPage: PageId;
  theme: Theme;
  searchQuery: string;
  lastScan: Date | null;
  setPage: (page: PageId) => void;
  setTheme: (theme: Theme) => void;
  setSearchQuery: (query: string) => void;
  setLastScan: (date: Date) => void;
}

export const useAppStore = create<AppState>((set) => ({
  currentPage: 'dashboard',
  theme: 'dark',
  searchQuery: '',
  lastScan: null,
  setPage: (page) => set({ currentPage: page }),
  setTheme: (theme) => set({ theme }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setLastScan: (date) => set({ lastScan: date }),
}));
