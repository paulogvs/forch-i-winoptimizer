/**
 * Quick-fix action catalog (Fase 3.1). Kept in a component-free module so
 * `QuickFixBar.tsx` exports only its component (react-refresh rule).
 */

export type QuickFixId = 'free-ram' | 'clean-temp' | 'flush-dns' | 'restore-point' | 'scan-drivers';

export interface QuickFixAction {
  id: QuickFixId;
  icon: string;
  label: string;
  hint: string;
  /** When set, a `window.confirm` gates the action. */
  confirm?: string;
}

export const QUICK_FIX_ACTIONS: readonly QuickFixAction[] = [
  {
    id: 'free-ram',
    icon: '⚡',
    label: 'Free RAM',
    hint: 'Frees RAM used by this app only (its own working set). Windows manages system memory.',
  },
  {
    id: 'clean-temp',
    icon: '🧹',
    label: 'Clean Temp',
    hint: 'Deletes safe-to-delete junk only (temp, cache, logs, thumbnails, browser cache). Never Windows Update or the Recycle Bin.',
    confirm:
      'Delete safe temporary files now? Only categories flagged safe-to-delete are touched — never Windows Update downloads or the Recycle Bin.',
  },
  {
    id: 'flush-dns',
    icon: '🌐',
    label: 'Flush DNS',
    hint: 'Runs ipconfig /flushdns and verifies the resolver cache really shrank.',
  },
  {
    id: 'restore-point',
    icon: '🛡️',
    label: 'Create Restore Point',
    hint: 'Creates a verified System Restore checkpoint (Checkpoint-Computer).',
    confirm: 'Create a System Restore point now? This can take a moment to complete.',
  },
  {
    id: 'scan-drivers',
    icon: '🔍',
    label: 'Scan Drivers',
    hint: 'Scans devices and asks Windows Update for real driver updates.',
  },
];
