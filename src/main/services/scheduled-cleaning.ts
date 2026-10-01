import { runPowerShell } from './powershell';
import type { CleaningSchedule, CleaningHistoryEntry } from '@shared/types';

// In-memory storage (in production, use electron-store or similar)
let schedules: CleaningSchedule[] = [];
let history: CleaningHistoryEntry[] = [];

export async function getSchedules(): Promise<CleaningSchedule[]> {
  const result = await runPowerShell(
    '$path = "$env:APPDATA\\FORCH.iA WinOptimizer\\schedules.json"; ' +
    'if (Test-Path $path) { Get-Content $path -Raw } else { Write-Output "[]" }'
  );

  if (result.success && result.stdout) {
    try {
      schedules = JSON.parse(result.stdout);
    } catch { /* ignore */ }
  }

  return schedules;
}

export async function saveSchedules(newSchedules: CleaningSchedule[]): Promise<void> {
  schedules = newSchedules;
  const json = JSON.stringify(schedules);

  await runPowerShell(
    '$dir = "$env:APPDATA\\FORCH.iA WinOptimizer"; ' +
    'if (!(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null; } ' +
    '$path = "$dir\\schedules.json"; ' +
    'Set-Content -Path $path -Value \'' + json.replace(/'/g, "''") + '\' -Encoding UTF8'
  );
}

export async function createSchedule(schedule: Omit<CleaningSchedule, 'id'>): Promise<CleaningSchedule> {
  const newSchedule: CleaningSchedule = {
    ...schedule,
    id: 'schedule-' + Date.now(),
  };

  schedules.push(newSchedule);
  await saveSchedules(schedules);
  await createWindowsTask(newSchedule);

  return newSchedule;
}

export async function updateSchedule(id: string, updates: Partial<CleaningSchedule>): Promise<CleaningSchedule | null> {
  const index = schedules.findIndex((s) => s.id === id);
  if (index === -1) return null;

  const updated: CleaningSchedule = { ...schedules[index], ...updates } as CleaningSchedule;
  schedules[index] = updated;
  await saveSchedules(schedules);
  await updateWindowsTask(updated);

  return updated;
}

export async function deleteSchedule(id: string): Promise<boolean> {
  const index = schedules.findIndex((s) => s.id === id);
  if (index === -1) return false;

  const schedule = schedules[index];
  if (!schedule) return false;
  schedules.splice(index, 1);
  await saveSchedules(schedules);
  await deleteWindowsTask(schedule);

  return true;
}

export async function runScheduleNow(id: string): Promise<{
  success: boolean;
  message: string;
  filesDeleted: number;
  spaceFreed: number;
}> {
  const schedule = schedules.find((s) => s.id === id);
  if (!schedule) {
    return { success: false, message: 'Schedule not found', filesDeleted: 0, spaceFreed: 0 };
  }

  const startTime = Date.now();
  let filesDeleted = 0;
  let spaceFreed = 0;

  for (const category of schedule.categories) {
    const result = await cleanCategory(String(category));
    filesDeleted += result.filesDeleted;
    spaceFreed += result.spaceFreed;
  }

  const duration = Date.now() - startTime;

  const entry: CleaningHistoryEntry = {
    id: 'history-' + Date.now(),
    scheduleId: schedule.id,
    scheduleName: schedule.name,
    timestamp: new Date(),
    filesDeleted,
    spaceFreed,
    duration,
    status: filesDeleted > 0 ? 'success' : 'partial',
  };

  history.push(entry);
  await saveHistory();

  return {
    success: true,
    message: 'Cleaned ' + filesDeleted + ' files, freed ' + Math.round(spaceFreed / 1_000_000) + ' MB',
    filesDeleted,
    spaceFreed,
  };
}

async function cleanCategory(category: string): Promise<{ filesDeleted: number; spaceFreed: number }> {
  const psScript = [
    '$filesDeleted = 0;',
    '$spaceFreed = 0;',
    'switch ("' + category + '") {',
    '  "temp" {',
    '    $paths = @($env:TEMP, "C:\\Windows\\Temp");',
    '    foreach ($path in $paths) {',
    '      $files = Get-ChildItem -Path $path -Recurse -ErrorAction SilentlyContinue -Force;',
    '      foreach ($file in $files) {',
    '        try {',
    '          $size = $file.Length;',
    '          Remove-Item -Path $file.FullName -Force -ErrorAction Stop;',
    '          $filesDeleted++;',
    '          $spaceFreed += $size;',
    '        } catch {}',
    '      }',
    '    }',
    '  }',
    '  "cache" {',
    '    $paths = @(',
    '      "$env:LOCALAPPDATA\\Google\\Chrome\\User Data\\Default\\Cache",',
    '      "$env:LOCALAPPDATA\\Microsoft\\Edge\\User Data\\Default\\Cache"',
    '    );',
    '    foreach ($path in $paths) {',
    '      if (Test-Path $path) {',
    '        $files = Get-ChildItem -Path $path -Recurse -ErrorAction SilentlyContinue -Force;',
    '        foreach ($file in $files) {',
    '          try {',
    '            $size = $file.Length;',
    '            Remove-Item -Path $file.FullName -Force -ErrorAction Stop;',
    '            $filesDeleted++;',
    '            $spaceFreed += $size;',
    '          } catch {}',
    '        }',
    '      }',
    '    }',
    '  }',
    '  "logs" {',
    '    $paths = @("C:\\Windows\\Logs", "C:\\Windows\\Panther");',
    '    foreach ($path in $paths) {',
    '      if (Test-Path $path) {',
    '        $files = Get-ChildItem -Path $path -Recurse -ErrorAction SilentlyContinue -Force;',
    '        foreach ($file in $files) {',
    '          try {',
    '            $size = $file.Length;',
    '            Remove-Item -Path $file.FullName -Force -ErrorAction Stop;',
    '            $filesDeleted++;',
    '            $spaceFreed += $size;',
    '          } catch {}',
    '        }',
    '      }',
    '    }',
    '  }',
    '  "recycle-bin" {',
    '    $files = Get-ChildItem -LiteralPath \'C:\\$Recycle.Bin\' -Recurse -ErrorAction SilentlyContinue -Force;',
    '    foreach ($file in $files) {',
    '      try {',
    '        $size = $file.Length;',
    '        Remove-Item -Path $file.FullName -Force -ErrorAction Stop;',
    '        $filesDeleted++;',
    '        $spaceFreed += $size;',
    '      } catch {}',
    '    }',
    '  }',
    '  "windows-update" {',
    '    $path = "C:\\Windows\\SoftwareDistribution\\Download";',
    '    if (Test-Path $path) {',
    '      $files = Get-ChildItem -Path $path -Recurse -ErrorAction SilentlyContinue -Force;',
    '      foreach ($file in $files) {',
    '        try {',
    '          $size = $file.Length;',
    '          Remove-Item -Path $file.FullName -Force -ErrorAction Stop;',
    '          $filesDeleted++;',
    '          $spaceFreed += $size;',
    '        } catch {}',
    '      }',
    '    }',
    '  }',
    '}',
    'Write-Output "$filesDeleted,$spaceFreed"',
  ].join('\n');

  const result = await runPowerShell(psScript);

  if (result.success && result.stdout) {
    const parts = result.stdout.trim().split(',');
    return {
      filesDeleted: parseInt(parts[0] ?? '0', 10) || 0,
      spaceFreed: parseInt(parts[1] ?? '0', 10) || 0,
    };
  }

  return { filesDeleted: 0, spaceFreed: 0 };
}

export async function getHistory(): Promise<CleaningHistoryEntry[]> {
  const result = await runPowerShell(
    '$path = "$env:APPDATA\\FORCH.iA WinOptimizer\\history.json"; ' +
    'if (Test-Path $path) { Get-Content $path -Raw } else { Write-Output "[]" }'
  );

  if (result.success && result.stdout) {
    try {
      history = JSON.parse(result.stdout);
    } catch { /* ignore */ }
  }

  return history;
}

async function saveHistory(): Promise<void> {
  const json = JSON.stringify(history);

  await runPowerShell(
    '$dir = "$env:APPDATA\\FORCH.iA WinOptimizer"; ' +
    'if (!(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null; } ' +
    '$path = "$dir\\history.json"; ' +
    'Set-Content -Path $path -Value \'' + json.replace(/'/g, "''") + '\' -Encoding UTF8'
  );
}

async function createWindowsTask(schedule: CleaningSchedule): Promise<void> {
  const frequencyMap: Record<string, string> = {
    daily: 'DAILY',
    weekly: 'WEEKLY',
    monthly: 'MONTHLY',
  };

  const freq = frequencyMap[schedule.frequency] || 'DAILY';
  const taskName = 'FORCH.iA-Cleaning-' + schedule.id;

  const psScript = 'try { $trigger = New-ScheduledTaskTrigger -' + freq + ' -At "09:00"; $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries; Register-ScheduledTask -TaskName "' + taskName + '" -Action (New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c echo FORCH.iA WinOptimizer: Time to clean your system!") -Trigger $trigger -Settings $settings -Force | Out-Null; Write-Output "SUCCESS" } catch { Write-Output "FAILED: $_" }';

  await runPowerShell(psScript);
}

async function updateWindowsTask(schedule: CleaningSchedule): Promise<void> {
  await deleteWindowsTask(schedule);
  if (schedule.enabled) {
    await createWindowsTask(schedule);
  }
}

async function deleteWindowsTask(schedule: CleaningSchedule): Promise<void> {
  await runPowerShell(
    'try { Unregister-ScheduledTask -TaskName "FORCH.iA-Cleaning-' + schedule.id + '" -Confirm:$false -ErrorAction SilentlyContinue; Write-Output "SUCCESS" } catch { Write-Output "FAILED: $_" }'
  );
}

export function getDefaultSchedules(): CleaningSchedule[] {
  return [
    {
      id: 'default-daily',
      name: 'Daily Quick Clean',
      frequency: 'daily',
      categories: ['temp', 'cache'],
      enabled: true,
      lastRun: null,
      nextRun: getNextRunDate('daily'),
      notifyBefore: true,
    },
    {
      id: 'default-weekly',
      name: 'Weekly Deep Clean',
      frequency: 'weekly',
      categories: ['temp', 'cache', 'logs', 'recycle-bin'],
      enabled: true,
      lastRun: null,
      nextRun: getNextRunDate('weekly'),
      notifyBefore: true,
    },
    {
      id: 'default-monthly',
      name: 'Monthly Full Clean',
      frequency: 'monthly',
      categories: ['temp', 'cache', 'logs', 'recycle-bin', 'windows-update'],
      enabled: true,
      lastRun: null,
      nextRun: getNextRunDate('monthly'),
      notifyBefore: true,
    },
  ];
}

function getNextRunDate(frequency: 'daily' | 'weekly' | 'monthly'): Date {
  const now = new Date();
  switch (frequency) {
    case 'daily':
      return new Date(now.getTime() + 24 * 60 * 60 * 1000);
    case 'weekly':
      return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    case 'monthly':
      return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  }
}
