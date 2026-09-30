export interface JunkFile {
  id: string;
  path: string;
  name: string;
  size: number;
  category: JunkCategory;
  lastModified: Date;
  safeToDelete: boolean;
}

export type JunkCategory =
  | 'temp'
  | 'cache'
  | 'logs'
  | 'thumbnails'
  | 'recycle-bin'
  | 'browser-cache'
  | 'windows-update';

export interface JunkScanResult {
  files: JunkFile[];
  totalSize: number;
  totalCount: number;
  categories: Record<JunkCategory, { count: number; size: number }>;
}

export async function scanForJunkFiles(): Promise<JunkScanResult> {
  // TODO: Implement actual file system scanning
  // This is a placeholder that returns mock data for development
  const mockFiles: JunkFile[] = [
    {
      id: '1',
      path: 'C:\\Users\\User\\AppData\\Local\\Temp\\tmp1234.tmp',
      name: 'tmp1234.tmp',
      size: 1024 * 1024 * 2,
      category: 'temp',
      lastModified: new Date(),
      safeToDelete: true,
    },
    {
      id: '2',
      path: 'C:\\Windows\\SoftwareDistribution\\Download\\update.cab',
      name: 'update.cab',
      size: 1024 * 1024 * 150,
      category: 'windows-update',
      lastModified: new Date(),
      safeToDelete: true,
    },
  ];

  const totalSize = mockFiles.reduce((sum, f) => sum + f.size, 0);

  return {
    files: mockFiles,
    totalSize,
    totalCount: mockFiles.length,
    categories: {
      temp: { count: 1, size: 1024 * 1024 * 2 },
      cache: { count: 0, size: 0 },
      logs: { count: 0, size: 0 },
      thumbnails: { count: 0, size: 0 },
      'recycle-bin': { count: 0, size: 0 },
      'browser-cache': { count: 0, size: 0 },
      'windows-update': { count: 1, size: 1024 * 1024 * 150 },
    },
  };
}
