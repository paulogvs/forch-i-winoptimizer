import React, { useCallback, useState } from 'react';
import { Button } from './ui/Button';
import { useToast } from './ui/toast-context';
import { useOperationStatus } from '../hooks/useOperationStatus';
import { QUICK_FIX_ACTIONS, type QuickFixAction, type QuickFixId } from './quickFixActions';
import type { PageId } from '@shared/types';

/**
 * Quick fixes bar (Fase 3.1/3.2). Five 1-click actions that run for real and
 * always report the verified outcome:
 *
 *  - ⚡ Free RAM            -> trims THIS app's own working set (never system RAM)
 *  - 🧹 Clean Temp          -> deletes only safeToDelete junk (never WU/Recycle Bin)
 *  - 🌐 Flush DNS           -> `ipconfig /flushdns`, verified against the cache
 *  - 🛡️ Create Restore Point -> verified Checkpoint-Computer
 *  - 🔍 Scan Drivers        -> fresh device + Windows Update driver scan
 *
 * Uniform behaviour (3.3): 1 click -> global operation-lock FIFO -> real toast
 * with a "View in Statistics" link -> `disabled` while any operation runs.
 * Free RAM, Flush DNS and Scan Drivers are pure 1-click (no dialog); Clean Temp
 * and Create Restore Point ask for confirmation because of their risk (3.5).
 */

interface QuickFixBarProps {
  onNavigate?: ((page: PageId) => void) | undefined;
}

interface LastResult {
  ok: boolean;
  message: string;
}

export const QuickFixBar: React.FC<QuickFixBarProps> = ({ onNavigate }) => {
  const operation = useOperationStatus();
  const { notify } = useToast();
  const [runningId, setRunningId] = useState<QuickFixId | null>(null);
  const [last, setLast] = useState<LastResult | null>(null);

  const busy = operation.busy || runningId !== null;

  const report = useCallback(
    (ok: boolean, title: string, message: string) => {
      setLast({ ok, message });
      notify({
        variant: ok ? 'success' : 'error',
        title,
        message,
        ...(onNavigate
          ? { action: { label: 'View in Statistics', onClick: () => onNavigate('statistics') } }
          : {}),
      });
    },
    [notify, onNavigate]
  );

  const run = useCallback(
    async (action: QuickFixAction) => {
      if (busy) return;
      if (action.confirm && !window.confirm(action.confirm)) return;

      const api = window.electronAPI.quickFixes;
      setRunningId(action.id);
      setLast(null);
      try {
        switch (action.id) {
          case 'free-ram': {
            const result = await api.freeRam();
            if (result.success) {
              report(
                true,
                'RAM freed',
                `Freed ${result.freedMb} MB (this app: ${result.rssBeforeMb} → ${result.rssAfterMb} MB). This is this app's own working set, not system RAM.`
              );
            } else {
              report(false, 'Free RAM failed', result.error ?? 'The working set was not trimmed.');
            }
            break;
          }
          case 'clean-temp': {
            const result = await api.cleanTemp();
            if (result.success) {
              report(true, 'Clean Temp done', result.message);
            } else {
              const detail = result.errors[0] ? ` ${result.errors[0]}` : '';
              report(false, 'Clean Temp had failures', `${result.message}${detail}`);
            }
            break;
          }
          case 'flush-dns': {
            const result = await api.flushDns();
            report(
              result.success,
              result.success ? 'DNS flushed' : 'Flush DNS failed',
              result.message
            );
            break;
          }
          case 'restore-point': {
            const result = await api.createRestorePoint('FORCH.iA WinOptimizer quick fix');
            report(
              result.success,
              result.success ? 'Restore point created' : 'Restore point failed',
              result.message
            );
            break;
          }
          case 'scan-drivers': {
            const result = await api.scanDrivers();
            if (result.wuStatus === 'unavailable') {
              report(
                false,
                'Driver scan incomplete',
                result.wuMessage || 'Windows Update did not answer.'
              );
            } else {
              report(
                true,
                'Driver scan complete',
                `Scanned ${result.totalDevices} device(s): ${result.outdatedCount} update(s) available, ${result.upToDateCount} up to date.`
              );
            }
            break;
          }
        }
      } catch (error) {
        report(false, 'Quick fix failed', `Unexpected error: ${String(error)}`);
      } finally {
        setRunningId(null);
      }
    },
    [busy, report]
  );

  return (
    <div>
      <div className="quick-fix-bar" role="group" aria-label="Quick fixes">
        {QUICK_FIX_ACTIONS.map((action) => (
          <Button
            key={action.id}
            variant={action.id === 'free-ram' ? 'primary' : 'secondary'}
            onClick={() => void run(action)}
            disabled={busy}
            loading={runningId === action.id}
            title={action.hint}
            aria-label={`${action.label}. ${action.hint}`}
            data-testid={`quickfix-${action.id}`}
          >
            <span aria-hidden="true">{action.icon}</span> {action.label}
          </Button>
        ))}
      </div>
      {last && (
        <p
          className={`quick-fix-status ${last.ok ? 'text-success' : 'text-error'}`}
          role="status"
          aria-live="polite"
          data-testid="quickfix-status"
        >
          {last.message}
        </p>
      )}
    </div>
  );
};
