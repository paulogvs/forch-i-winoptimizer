import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getSchedules,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  runScheduleNow,
  getHistory,
  getDefaultSchedules,
} from './scheduled-cleaning';

vi.mock('./powershell', () => ({
  runPowerShell: vi.fn(),
  parsePowerShellJson: vi.fn((data: string) => {
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }),
}));

import { runPowerShell } from './powershell';

describe('Scheduled Cleaning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getSchedules', () => {
    it('should return empty array when no schedules exist', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: '[]',
        stderr: '',
        exitCode: 0,
      });

      const result = await getSchedules();
      expect(result).toEqual([]);
    });

    it('should return schedules from storage', async () => {
      const mockSchedules = [
        {
          id: 'schedule-1',
          name: 'Daily Clean',
          frequency: 'daily',
          categories: ['temp'],
          enabled: true,
          lastRun: null,
          nextRun: '2025-01-02',
          notifyBefore: true,
        },
      ];

      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: JSON.stringify(mockSchedules),
        stderr: '',
        exitCode: 0,
      });

      const result = await getSchedules();
      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe('Daily Clean');
    });
  });

  describe('createSchedule', () => {
    it('should create schedule successfully', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: '[]',
        stderr: '',
        exitCode: 0,
      });

      const result = await createSchedule({
        name: 'Weekly Clean',
        frequency: 'weekly',
        categories: ['temp', 'cache'],
        enabled: true,
        lastRun: null,
        nextRun: new Date(),
        notifyBefore: true,
      });

      expect(result.id).toBeDefined();
      expect(result.name).toBe('Weekly Clean');
      expect(result.frequency).toBe('weekly');
    });
  });

  describe('updateSchedule', () => {
    it('should update schedule successfully', async () => {
      const existingSchedule = {
        id: 'schedule-1',
        name: 'Daily Clean',
        frequency: 'daily',
        categories: ['temp'],
        enabled: true,
        lastRun: null,
        nextRun: '2025-01-02',
        notifyBefore: true,
      };

      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: JSON.stringify([existingSchedule]),
        stderr: '',
        exitCode: 0,
      });

      const result = await updateSchedule('schedule-1', { enabled: false });
      expect(result).not.toBeNull();
      expect(result?.enabled).toBe(false);
    });

    it('should return null for unknown schedule', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: '[]',
        stderr: '',
        exitCode: 0,
      });

      const result = await updateSchedule('unknown-id', { enabled: false });
      expect(result).toBeNull();
    });
  });

  describe('deleteSchedule', () => {
    it('should delete schedule successfully', async () => {
      const existingSchedule = {
        id: 'schedule-1',
        name: 'Daily Clean',
        frequency: 'daily',
        categories: ['temp'],
        enabled: true,
        lastRun: null,
        nextRun: '2025-01-02',
        notifyBefore: true,
      };

      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: JSON.stringify([existingSchedule]),
        stderr: '',
        exitCode: 0,
      });

      const result = await deleteSchedule('schedule-1');
      expect(result).toBe(true);
    });

    it('should return false for unknown schedule', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: '[]',
        stderr: '',
        exitCode: 0,
      });

      const result = await deleteSchedule('unknown-id');
      expect(result).toBe(false);
    });
  });

  describe('runScheduleNow', () => {
    it('should run schedule and return results', async () => {
      const existingSchedule = {
        id: 'schedule-1',
        name: 'Daily Clean',
        frequency: 'daily',
        categories: ['temp'],
        enabled: true,
        lastRun: null,
        nextRun: '2025-01-02',
        notifyBefore: true,
      };

      // Seed the in-memory schedule store deterministically (independent of
      // execution order from previous tests) so the schedule can be found.
      vi.mocked(runPowerShell).mockResolvedValueOnce({
        success: true,
        stdout: JSON.stringify([existingSchedule]),
        stderr: '',
        exitCode: 0,
      });
      await getSchedules();

      vi.mocked(runPowerShell).mockImplementation((command: string) => {
        if (command.includes('filesDeleted')) {
          return Promise.resolve({
            success: true,
            stdout: '10,1048576',
            stderr: '',
            exitCode: 0,
          });
        }
        return Promise.resolve({
          success: true,
          stdout: '',
          stderr: '',
          exitCode: 0,
        });
      });

      const result = await runScheduleNow('schedule-1');
      expect(result.success).toBe(true);
      expect(result.filesDeleted).toBeGreaterThanOrEqual(0);
    });

    it('should handle unknown schedule', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: '[]',
        stderr: '',
        exitCode: 0,
      });

      const result = await runScheduleNow('unknown-id');
      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
    });
  });

  describe('getHistory', () => {
    it('should return empty array when no history exists', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: '[]',
        stderr: '',
        exitCode: 0,
      });

      const result = await getHistory();
      expect(result).toEqual([]);
    });

    it('should return history entries', async () => {
      const mockHistory = [
        {
          id: 'history-1',
          scheduleId: 'schedule-1',
          scheduleName: 'Daily Clean',
          timestamp: '2025-01-01',
          filesDeleted: 10,
          spaceFreed: 1048576,
          duration: 5000,
          status: 'success',
        },
      ];

      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: JSON.stringify(mockHistory),
        stderr: '',
        exitCode: 0,
      });

      const result = await getHistory();
      expect(result).toHaveLength(1);
      expect(result[0]?.scheduleName).toBe('Daily Clean');
    });
  });

  describe('getDefaultSchedules', () => {
    it('should return default schedules', () => {
      const defaults = getDefaultSchedules();
      expect(defaults.length).toBe(3);
      expect(defaults[0]?.frequency).toBe('daily');
      expect(defaults[1]?.frequency).toBe('weekly');
      expect(defaults[2]?.frequency).toBe('monthly');
    });
  });
});
