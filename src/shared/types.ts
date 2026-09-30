// Shared types between main and renderer processes

export type Theme = 'dark' | 'light';

export type PageId =
  | 'dashboard'
  | 'cleaner'
  | 'boost'
  | 'tools'
  | 'statistics'
  | 'security'
  | 'settings';

export interface NavItem {
  id: PageId;
  label: string;
  icon: string;
}

export interface KpiData {
  label: string;
  value: number;
  unit: string;
  trend?: 'up' | 'down';
  trendValue?: number;
}

export interface ToolItem {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: 'system' | 'privacy' | 'performance' | 'utilities';
  action: () => void;
}

export interface SecurityIssue {
  id: string;
  title: string;
  description: string;
  severity: 'critical' | 'warning' | 'info';
  recommendation: string;
  autoFixable: boolean;
}

export interface StatDataPoint {
  date: string;
  value: number;
}

export interface StatSeries {
  name: string;
  data: StatDataPoint[];
  color: string;
}
