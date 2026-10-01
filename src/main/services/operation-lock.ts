/**
 * Global operation lock (P0.3).
 *
 * All mutating IPC operations (tweaks, installs/uninstalls, service changes,
 * cleaners, debloat…) funnel through a single FIFO queue so the machine never
 * runs two conflicting PowerShell/winget operations at the same time. The
 * renderer subscribes to status changes to disable actions while busy.
 *
 * The lock is acquired synchronously when idle (so status readers see the
 * running operation immediately) and handed over waiter-by-waiter on release.
 */

import type { OperationStatus } from '@shared/electron-api';

export type { OperationStatus };

type Notifier = (status: OperationStatus) => void;

const queue: string[] = [];
const waiters: Array<() => void> = [];
let active = false;
let current: string | null = null;
let startedAt: number | null = null;
let notifier: Notifier | null = null;

function status(): OperationStatus {
  return {
    busy: active || current !== null || queue.length > 0,
    current,
    queued: queue.length,
    startedAt,
  };
}

function notify(): void {
  notifier?.(status());
}

/** Register a renderer-facing status listener (main process only). */
export function setOperationNotifier(cb: Notifier | null): void {
  notifier = cb;
}

export function getOperationStatus(): OperationStatus {
  return status();
}

export function isOperationBusy(): boolean {
  return active || queue.length > 0;
}

/**
 * Run `fn` exclusively. Callers are served in FIFO order; the lock is always
 * released (even when `fn` throws) so a failed operation can never wedge the
 * queue.
 */
export async function withOperationLock<T>(label: string, fn: () => Promise<T>): Promise<T> {
  queue.push(label);
  notify();

  if (active) {
    await new Promise<void>((resolve) => waiters.push(resolve));
  }

  active = true;
  current = label;
  startedAt = Date.now();
  queue.shift();
  notify();

  try {
    return await fn();
  } finally {
    current = null;
    startedAt = null;
    const next = waiters.shift();
    if (next) {
      // Hand the still-held lock to the next waiter (keeps `active` true).
      next();
    } else {
      active = false;
    }
    notify();
  }
}

/** Test-only helper: clear queue, waiters and active operation between cases. */
export function resetOperationLock(): void {
  active = false;
  queue.length = 0;
  waiters.length = 0;
  current = null;
  startedAt = null;
}
