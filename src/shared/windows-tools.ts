/**
 * Real Windows utilities launched from Tools → Utilities.
 *
 * `file` is resolved by the main process against `%SystemRoot%\System32` (bare
 * names) before launching, so the binary's existence is validated instead of
 * shelling out blind. Nothing here mutates system state by itself; the user
 * drives the opened tool.
 */

export interface WindowsTool {
  id: string;
  name: string;
  description: string;
  /** Icon glyph shown in the UI (the app ships no per-tool bitmaps). */
  icon: string;
  /** Executable or `.msc` file inside System32. */
  file: string;
  /** Optional arguments. */
  args?: string[];
}

export const WINDOWS_TOOLS: readonly WindowsTool[] = [
  {
    id: 'task-manager',
    name: 'Task Manager',
    description: 'Running processes, CPU and memory usage.',
    icon: '📊',
    file: 'taskmgr.exe',
  },
  {
    id: 'disk-cleanup',
    name: 'Disk Cleanup',
    description: 'Windows built-in disk cleanup utility.',
    icon: '🧹',
    file: 'cleanmgr.exe',
  },
  {
    id: 'device-manager',
    name: 'Device Manager',
    description: 'Hardware devices and drivers.',
    icon: '💽',
    file: 'devmgmt.msc',
  },
  {
    id: 'services',
    name: 'Services',
    description: 'Windows services and startup types.',
    icon: '⚙️',
    file: 'services.msc',
  },
  {
    id: 'system-info',
    name: 'System Information',
    description: 'Detailed hardware and software report.',
    icon: 'ℹ️',
    file: 'msinfo32.exe',
  },
  {
    id: 'control-panel',
    name: 'Control Panel',
    description: 'Classic Windows Control Panel.',
    icon: '🎛️',
    file: 'control.exe',
  },
  {
    id: 'resource-monitor',
    name: 'Resource Monitor',
    description: 'Real-time CPU, disk, network and memory.',
    icon: '📈',
    file: 'resmon.exe',
  },
  {
    id: 'programs-features',
    name: 'Programs & Features',
    description: 'Installed programs and uninstall entries.',
    icon: '📦',
    file: 'appwiz.cpl',
  },
  {
    id: 'network-connections',
    name: 'Network Connections',
    description: 'Network adapters and connections.',
    icon: '🌐',
    file: 'ncpa.cpl',
  },
  {
    id: 'disk-management',
    name: 'Disk Management',
    description: 'Partitions, volumes and drives.',
    icon: '🗄️',
    file: 'diskmgmt.msc',
  },
  {
    id: 'event-viewer',
    name: 'Event Viewer',
    description: 'System and application event logs.',
    icon: '📋',
    file: 'eventvwr.msc',
  },
  {
    id: 'performance-monitor',
    name: 'Performance Monitor',
    description: 'Performance counters and data logs.',
    icon: '⏱️',
    file: 'perfmon.msc',
  },
];

export function getWindowsTool(id: string): WindowsTool | null {
  return WINDOWS_TOOLS.find((tool) => tool.id === id) ?? null;
}
