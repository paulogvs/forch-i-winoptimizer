export interface Source {
  id: string;
  name: string;
  url: string;
  type: string;
  description: string;
  priority: number;
  catalogs: string[];
  enabled: boolean;
}

export interface SourcesConfig {
  version: string;
  lastUpdated: string;
  sources: Source[];
}

export interface LastCheck {
  lastCheck: string | null;
  sources: Record<string, { lastCommit: string | null; lastCheck: string | null }>;
  pendingUpdates: PendingUpdate[];
}

export interface PendingUpdate {
  id: string;
  sourceId: string;
  sourceName: string;
  catalog: string;
  type: 'new' | 'modified' | 'removed';
  item: CatalogItem;
  detectedAt: string;
  status: 'pending' | 'imported' | 'rejected';
}

export interface CatalogItem {
  id: string;
  name: string;
  [key: string]: unknown;
}

export interface Catalog {
  version: string;
  lastUpdated: string;
  [key: string]: CatalogItem[] | string;
}

export interface UpdateReport {
  timestamp: string;
  sourcesChecked: number;
  newItems: PendingUpdate[];
  modifiedItems: PendingUpdate[];
  removedItems: PendingUpdate[];
  errors: string[];
}

export interface GitHubRepoInfo {
  id: number;
  full_name: string;
  default_branch: string;
  updated_at: string;
  pushed_at: string;
  stargazers_count: number;
}

export interface GitHubContent {
  name: string;
  path: string;
  sha: string;
  type: string;
  download_url: string | null;
}
