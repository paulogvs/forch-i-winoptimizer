import { describe, it, expect } from 'vitest';
import { withOperationLock, getOperationStatus, resetOperationLock } from './operation-lock';

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('operation lock (P0.3)', () => {
  it('reports idle status when nothing is running', () => {
    const status = getOperationStatus();
    expect(status.busy).toBe(false);
    expect(status.current).toBeNull();
    expect(status.queued).toBe(0);
  });

  it('reports the running operation while a task holds the lock', async () => {
    const gate = deferred();
    const running = withOperationLock('tweaks:apply', () => gate.promise);

    const status = getOperationStatus();
    expect(status.busy).toBe(true);
    expect(status.current).toBe('tweaks:apply');
    expect(status.startedAt).not.toBeNull();

    gate.resolve();
    await running;

    expect(getOperationStatus().busy).toBe(false);
    expect(getOperationStatus().current).toBeNull();
  });

  it('never runs two operations concurrently', async () => {
    const order: string[] = [];
    let inside = 0;
    let maxInside = 0;

    const task = (label: string) =>
      withOperationLock(label, async () => {
        inside++;
        maxInside = Math.max(maxInside, inside);
        order.push(`${label}:start`);
        await new Promise((r) => setTimeout(r, 10));
        order.push(`${label}:end`);
        inside--;
      });

    await Promise.all([task('a'), task('b'), task('c')]);

    expect(maxInside).toBe(1);
    expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end', 'c:start', 'c:end']);
  });

  it('keeps FIFO order for queued operations', async () => {
    const order: string[] = [];
    const first = deferred();

    const slow = withOperationLock('first', () => {
      order.push('first');
      return first.promise;
    });
    const second = withOperationLock('second', async () => {
      order.push('second');
    });
    const third = withOperationLock('third', async () => {
      order.push('third');
    });

    // 'first' is inside; the other two must be queued behind it.
    expect(getOperationStatus().current).toBe('first');
    expect(getOperationStatus().queued).toBe(2);

    first.resolve();
    await Promise.all([slow, second, third]);

    expect(order).toEqual(['first', 'second', 'third']);
    expect(getOperationStatus().busy).toBe(false);
    expect(getOperationStatus().queued).toBe(0);
  });

  it('releases the lock when the operation throws', async () => {
    await expect(
      withOperationLock('failing', async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    expect(getOperationStatus().busy).toBe(false);

    // A later operation must still be able to run.
    const ran = await withOperationLock('next', async () => 'ok');
    expect(ran).toBe('ok');
  });

  it('propagates a failure to the caller without blocking the queue', async () => {
    const failing = withOperationLock('bad', async () => {
      throw new Error('nope');
    });
    const queued = withOperationLock('good', async () => 'done');

    await expect(failing).rejects.toThrow('nope');
    expect(await queued).toBe('done');
  });

  it('resets cleanly between test cases', async () => {
    resetOperationLock();
    expect(getOperationStatus()).toEqual({
      busy: false,
      current: null,
      queued: 0,
      startedAt: null,
    });
  });
});
