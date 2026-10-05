/**
 * Disk repair utilities (Fase 4.9, adopted from Kudu's "disk repair" idea).
 *
 * A curated, data-driven catalog of real Windows repair tools. The renderer
 * reads the catalog for labels, warnings and estimated durations; the main
 * process only ever runs a tool by its catalog id. Nothing here mutates the
 * system by itself.
 *
 * Honesty notes:
 *  - `sfc` / `DISM` do not emit a percentage; the UI must show an honest
 *    indeterminate indicator (percent `null`) unless a `%` token really appears
 *    in the live output.
 *  - `chkdsk C: /scan` and `Optimize-Volume -ReTrim` are read-only maintenance
 *    (no filesystem repair / no data change); the others DO modify state.
 */

export type DiskRepairToolId = 'dism-restore-health' | 'sfc-scannow' | 'chkdsk' | 'trim';

export interface DiskRepairTool {
  id: DiskRepairToolId;
  name: string;
  description: string;
  /** The equivalent command line shown to the user. */
  command: string;
  /** Human estimate; never a promise. */
  estimatedDuration: string;
  requiresAdmin: boolean;
  /** True when running it can modify system state. */
  modifiesSystem: boolean;
  /** True when interrupting it is safe. */
  cancellable: boolean;
  /** One-line explanation of what it does, shown before confirmation. */
  whatItDoes: string;
  icon: string;
}

export const DISK_REPAIR_TOOLS: readonly DiskRepairTool[] = [
  {
    id: 'dism-restore-health',
    name: 'DISM RestoreHealth',
    description: 'Repairs the Windows component store using Windows Update.',
    command: 'DISM /Online /Cleanup-Image /RestoreHealth',
    estimatedDuration: '10–30 min',
    requiresAdmin: true,
    modifiesSystem: true,
    cancellable: false,
    whatItDoes:
      'Scans the Windows image and repairs corrupted system files from Windows Update. It may finish a repair that SFC could not.',
    icon: '🛠️',
  },
  {
    id: 'sfc-scannow',
    name: 'System File Checker',
    description: 'Scans and repairs protected Windows system files.',
    command: 'sfc /scannow',
    estimatedDuration: '5–15 min',
    requiresAdmin: true,
    modifiesSystem: true,
    cancellable: false,
    whatItDoes:
      'Verifies every protected system file and replaces corrupt copies with the cached good version. Do not close the app while it runs.',
    icon: '🩺',
  },
  {
    id: 'chkdsk',
    name: 'Check Disk (online scan)',
    description: 'Read-only NTFS scan of the C: filesystem.',
    command: 'chkdsk C: /scan',
    estimatedDuration: '1–5 min',
    requiresAdmin: true,
    modifiesSystem: false,
    cancellable: true,
    whatItDoes:
      'Runs the online NTFS scan (`/scan`): it reports filesystem problems without repairing or modifying anything.',
    icon: '🗂️',
  },
  {
    id: 'trim',
    name: 'Optimize Volume (TRIM)',
    description: 'Re-trims an SSD so unused blocks are released.',
    command: 'Optimize-Volume -DriveLetter C -ReTrim -Verbose',
    estimatedDuration: 'seconds–1 min',
    requiresAdmin: true,
    modifiesSystem: false,
    cancellable: true,
    whatItDoes:
      'Sends TRIM to the SSD so it can reclaim unused blocks. It does not delete files or change your data.',
    icon: '⚡',
  },
];

export function getDiskRepairTool(id: string): DiskRepairTool | null {
  return DISK_REPAIR_TOOLS.find((tool) => tool.id === id) ?? null;
}

export function isDiskRepairToolId(id: string): id is DiskRepairToolId {
  return DISK_REPAIR_TOOLS.some((tool) => tool.id === id);
}

export type DiskRepairStatus = 'completed' | 'failed' | 'requires-admin' | 'cancelled';

export interface DiskRepairResult {
  toolId: DiskRepairToolId;
  toolName: string;
  /** True only when the tool ran AND reported success. */
  success: boolean;
  status: DiskRepairStatus;
  exitCode: number | null;
  /** Parsed human summary of what the tool really reported. */
  summary: string;
  /** Last meaningful output lines (progress bars stripped). */
  lines: string[];
  durationMs: number;
  requiresAdmin: boolean;
  /** Parsed verdict when determinable, else null (never a fake boolean). */
  repairNeeded: boolean | null;
}

export interface DiskRepairProgressEvent {
  toolId: DiskRepairToolId;
  line: string;
  stream: 'stdout' | 'stderr';
  /** Real percent parsed from the live output, or null (indeterminate). */
  percent: number | null;
}
