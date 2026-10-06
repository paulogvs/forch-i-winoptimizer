import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Security } from './Security';

/**
 * Lote 2 (A4): the UAC check offers its 5 level fixes as explicit buttons
 * (preview -> confirm -> apply/revert each), with Never notify flagged.
 */

function reportWithUac() {
  return {
    checks: [
      {
        id: 'uac',
        status: 'warn' as const,
        evidence: 'EnableLUA=1, ConsentPromptBehaviorAdmin=0, PromptOnSecureDesktop=0',
        reason: 'UAC is enabled but the admin prompt is set below the recommended level.',
      },
    ],
    summary: {
      pass: 0,
      warn: 1,
      fail: 0,
      unknown: 0,
      'not-applicable': 0,
      'requires-admin': 0,
    },
    score: 50,
    scoredChecks: 1,
    excludedChecks: 0,
    totalChecks: 1,
    machine: {
      osCaption: 'test-os',
      osVersion: '10.0.22631',
      osBuild: '22631',
      edition: 'Professional',
      displayVersion: '23H2',
      isAdmin: true,
      collectedAt: new Date(0).toISOString(),
    },
    timestamp: new Date(0).toISOString(),
  };
}

describe('Security UAC level fixes (A4)', () => {
  let scan: ReturnType<typeof vi.fn>;
  let previewFix: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    scan = vi.fn().mockResolvedValue(reportWithUac());
    previewFix = vi.fn().mockResolvedValue(null);
    (window as unknown as { winoptimizer: unknown }).winoptimizer = {
      privacy: { getSettings: () => Promise.resolve([]), applySetting: vi.fn(), applyAll: vi.fn() },
      security: {
        getActions: () => Promise.resolve([]),
        runAction: vi.fn(),
        scan,
        previewFix,
        applyFix: vi.fn(),
        revertFix: vi.fn(),
        relaunchElevated: vi.fn(),
      },
      dns: { benchmark: vi.fn().mockResolvedValue([]), set: vi.fn() },
      malware: { scopes: () => Promise.resolve([]), scan: vi.fn(), cancel: vi.fn() },
    };
  });

  it('renders one button per UAC level after a scan', async () => {
    render(<Security />);
    fireEvent.click(screen.getByTestId('security-scan-button'));

    await waitFor(() => expect(screen.getByTestId('security-check-uac')).toBeInTheDocument());

    for (const fixId of [
      'uac-always',
      'uac-credentials',
      'uac-default',
      'uac-nodim',
      'uac-never',
    ]) {
      expect(screen.getByTestId(`security-uac-${fixId}`)).toBeInTheDocument();
    }
  });

  it('flags Never notify and opens its preview on click', async () => {
    render(<Security />);
    fireEvent.click(screen.getByTestId('security-scan-button'));

    const never = await screen.findByTestId('security-uac-uac-never');
    expect(never.textContent).toMatch(/never notify/i);
    expect(never.getAttribute('title')).toMatch(/least secure/i);

    fireEvent.click(screen.getByTestId('security-uac-uac-default'));
    await waitFor(() => expect(previewFix).toHaveBeenCalledWith('uac-default'));
  });
});
