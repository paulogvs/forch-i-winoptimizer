import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkForUpdates, downloadUpdate } from './updater';

// Mock electron
vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn().mockReturnValue('0.1.0'),
    getPath: vi.fn().mockReturnValue('C:\\Users\\Test\\AppData\\Local\\forch-i-winoptimizer'),
  },
}));

// Mock fs
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  mkdirSync: vi.fn(),
  createWriteStream: vi.fn(() => ({
    write: vi.fn(),
    end: vi.fn(),
  })),
}));

describe('updater', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  describe('checkForUpdates', () => {
    it('should return no update when versions match', async () => {
      const mockRelease = {
        tag_name: 'v0.1.0',
        name: 'v0.1.0',
        body: 'Release notes',
        published_at: '2024-01-15T10:30:00Z',
        assets: [{ name: 'setup.exe', browser_download_url: 'https://example.com/setup.exe', size: 1024 }],
      };

      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockRelease),
      } as any);

      const result = await checkForUpdates();

      expect(result.currentVersion).toBe('0.1.0');
      expect(result.latestVersion).toBe('0.1.0');
      expect(result.updateAvailable).toBe(false);
    });

    it('should detect available update', async () => {
      const mockRelease = {
        tag_name: 'v0.2.0',
        name: 'v0.2.0',
        body: 'New features',
        published_at: '2024-01-15T10:30:00Z',
        assets: [{ name: 'setup.exe', browser_download_url: 'https://example.com/setup.exe', size: 2048 }],
      };

      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockRelease),
      } as any);

      const result = await checkForUpdates();

      expect(result.updateAvailable).toBe(true);
      expect(result.latestVersion).toBe('0.2.0');
      expect(result.downloadUrl).toBe('https://example.com/setup.exe');
    });

    it('should handle network errors', async () => {
      vi.mocked(global.fetch).mockRejectedValue(new Error('Network error'));

      const result = await checkForUpdates();

      expect(result.updateAvailable).toBe(false);
      expect(result.currentVersion).toBe('0.1.0');
    });

    it('should handle HTTP errors', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: false,
        status: 404,
      } as any);

      const result = await checkForUpdates();

      expect(result.updateAvailable).toBe(false);
    });

    it('should handle version comparison correctly', async () => {
      const mockRelease = {
        tag_name: 'v0.0.9',
        name: 'v0.0.9',
        body: '',
        published_at: '2024-01-15T10:30:00Z',
        assets: [],
      };

      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockRelease),
      } as any);

      const result = await checkForUpdates();

      expect(result.updateAvailable).toBe(false);
    });

    it('should handle missing assets', async () => {
      const mockRelease = {
        tag_name: 'v0.2.0',
        name: 'v0.2.0',
        body: '',
        published_at: '2024-01-15T10:30:00Z',
        assets: [],
      };

      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockRelease),
      } as any);

      const result = await checkForUpdates();

      expect(result.updateAvailable).toBe(true);
      expect(result.downloadUrl).toBe('');
      expect(result.size).toBe(0);
    });
  });

  describe('downloadUpdate', () => {
    it('should throw error on HTTP failure', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: false,
        statusText: 'Not Found',
      } as any);

      await expect(downloadUpdate('https://example.com/update.exe')).rejects.toThrow('Download failed');
    });

    it('should throw error when response body is null', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        body: null,
        headers: new Headers(),
      } as any);

      await expect(downloadUpdate('https://example.com/update.exe')).rejects.toThrow('Failed to read response body');
    });
  });
});
