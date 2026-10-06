import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
      previewPreset: vi.fn(),
      applyPreset: vi.fn(),
    },
  };
}

const childTweak: TweakView = {
  id: 'ads-start-suggestions',
  name: 'Start menu suggestions',
  description: 'Turns off suggested apps in Start.',
  category: 'privacy',
  safety: 'safe',
  reversible: true,
  impact: 'low',
  requiresAdmin: false,
  apply: [
    {
      kind: 'registry',
      hive: 'HKCU',
      path: 'Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager',
      name: 'SystemPaneSuggestionsEnabled',
      type: 'DWORD',
      value: 0,
    },
  ],
  revert: [
    {
      kind: 'registry',
      hive: 'HKCU',
      path: 'Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager',
      name: 'SystemPaneSuggestionsEnabled',
      type: 'DWORD',
      value: 1,
    },
  ],
  applied: false,
};

const presetTweak: TweakView = {
  id: 'ads-suggestions-preset',
  name: 'Ads & Suggestions (master)',
  description: 'Master switch for ad tweaks.',
  category: 'privacy',
  safety: 'safe',
  reversible: true,
  impact: 'low',
  requiresAdmin: false,
  kind: 'preset',
  children: ['ads-start-suggestions'],
  apply: [{ kind: 'info', detail: 'Master switch.' }],
  revert: [{ kind: 'info', detail: 'Master switch.' }],
  applied: false,
};

function installPresetBridge() {
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    getOperationStatus: () =>
      Promise.resolve({ busy: false, current: null, queued: 0, startedAt: null }),
    onOperationStatus: () => () => {},
  };
  (window as unknown as { winoptimizer: unknown }).winoptimizer = {
    tweaks: {
      get: () => Promise.resolve([presetTweak, childTweak]),
      preview: vi.fn(),
      apply: vi.fn(),
      restore: vi.fn(),
      applyMany: vi.fn(),
      restoreMany: vi.fn(),
      previewPreset: vi.fn(),
      applyPreset: vi.fn(async () => []),
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

describe('Tweaks preset controls (A1)', () => {
  afterEach(() => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    delete (window as unknown as { winoptimizer?: unknown }).winoptimizer;
  });

  it('renders Allow/Deny/Custom modes for a preset', async () => {
    installPresetBridge();
    render(<Tweaks />);

    expect(await screen.findByTestId('preset-controls-ads-suggestions-preset')).toBeDefined();
    expect(screen.getByLabelText('Deny all')).toBeDefined();
    expect(screen.getByLabelText('Allow all')).toBeDefined();
    expect(screen.getByLabelText('Custom')).toBeDefined();
  });

  it('shows per-child checkboxes in Custom mode and calls applyPreset with the selection', async () => {
    installPresetBridge();
    render(<Tweaks />);
    await screen.findByTestId('preset-controls-ads-suggestions-preset');

    fireEvent.click(screen.getByLabelText('Custom'));
    const child = await screen.findByLabelText('Preset child Start menu suggestions');
    expect(child).toBeDefined();

    fireEvent.click(screen.getByText('Apply custom'));
    const bridge = (
      window as unknown as { winoptimizer: { tweaks: { applyPreset: ReturnType<typeof vi.fn> } } }
    ).winoptimizer.tweaks;
    expect(bridge.applyPreset).toHaveBeenCalledWith('ads-suggestions-preset', 'custom', [
      'ads-start-suggestions',
    ]);
  });
});
