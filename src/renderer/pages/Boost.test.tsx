import { describe, it, expect, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Boost } from './Boost';
import type { SystemService } from '@shared/electron-api';

const riskyService: SystemService = {
  id: 'DiagTrack',
  name: 'DiagTrack',
  displayName: 'Connected User Experiences',
  description: 'Telemetry service',
  status: 'running',
  startType: 'automatic',
  canOptimize: true,
  recommendedAction: 'disable',
  protection: 'caution',
  impact: 'medium',
  safety: 'caution',
  risk: 'medium',
  safetyWarning: 'Telemetry service. Disabling improves privacy but affects diagnostics.',
};

function installBridge() {
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    getSystemServices: () => Promise.resolve([riskyService]),
  };
}

describe('Boost safety warnings (Fase 4.8)', () => {
  afterEach(() => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  it('shows the safety warning and risk badge for a risky service', async () => {
    installBridge();
    render(<Boost />);

    expect(await screen.findByTestId('service-warning-DiagTrack')).toHaveTextContent(
      'Telemetry service.'
    );
    expect(screen.getByText('medium risk')).toBeInTheDocument();
  });
});
