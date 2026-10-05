import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Tweaks } from './Tweaks';
import type { TweakView } from '@shared/tweaks';

const riskyTweak: TweakView = {
  id: 'sysmain-toggle',
  name: 'SysMain (Superfetch)',
  description: 'Disables the SysMain service.',
  category: 'performance',
  safety: 'safe',
  reversible: true,
  impact: 'medium',
  requiresAdmin: true,
  risk: 'medium',
  safetyNote: 'On mechanical disks SysMain helps; disabling may slow app launch.',
  apply: [{ kind: 'service', serviceName: 'SysMain', startType: 'disabled', state: 'stopped' }],
  revert: [{ kind: 'service', serviceName: 'SysMain', startType: 'automatic', state: 'running' }],
  applied: false,
};

function installBridge() {
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    getOperationStatus: () =>
      Promise.resolve({ busy: false, current: null, queued: 0, startedAt: null }),
    onOperationStatus: () => () => {},
  };
  (window as unknown as { winoptimizer: unknown }).winoptimizer = {
    tweaks: {
      get: () => Promise.resolve([riskyTweak]),
      preview: vi.fn(),
      apply: vi.fn(),
      restore: vi.fn(),
      applyMany: vi.fn(),
      restoreMany: vi.fn(),
    },
  };
}

describe('Tweaks safety warnings (Fase 4.8)', () => {
  afterEach(() => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    delete (window as unknown as { winoptimizer?: unknown }).winoptimizer;
  });

  it('shows the safety warning for a risky tweak', async () => {
    installBridge();
    render(<Tweaks />);

    expect(await screen.findByTestId('tweak-warning-sysmain-toggle')).toHaveTextContent(
      'On mechanical disks SysMain helps'
    );
  });
});
