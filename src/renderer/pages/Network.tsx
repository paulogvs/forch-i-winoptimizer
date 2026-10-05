import React, { useState } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Progress } from '../components/ui/Progress';
import type { NetworkFixReport } from '@shared/types';

export const Network: React.FC = () => {
  const [report, setReport] = useState<NetworkFixReport | null>(null);
  const [fixing, setFixing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  const runNetworkFix = async () => {
    setFixing(true);
    setFeedback(null);

    try {
      // Fase 0.5: no cosmetic progress — indeterminate until the backend
      // resolves with its verified per-fix report.
      const result = await window.winoptimizer.network.fix();
      setReport(result);
    } catch (error) {
      console.error('Failed to run network fix:', error);
      setFeedback({ ok: false, message: `Network fix failed: ${String(error)}` });
    } finally {
      setFixing(false);
    }
  };

  const testConnectivity = async () => {
    setTesting(true);
    setFeedback(null);
    try {
      const result = await window.winoptimizer.network.test();
      setFeedback({
        ok: result.success,
        message: result.success
          ? `Connectivity test passed. Latency: ${result.latency}ms`
          : 'Connectivity test failed. Check your network connection.',
      });
    } catch (error) {
      console.error('Failed to test connectivity:', error);
      setFeedback({ ok: false, message: `Connectivity test failed: ${String(error)}` });
    } finally {
      setTesting(false);
    }
  };

  const fixError0x00000709 = async () => {
    setFeedback(null);
    try {
      const result = await window.winoptimizer.network.fixError0x00000709();
      setFeedback({ ok: result.success, message: result.message });
    } catch (error) {
      console.error('Failed to fix error 0x00000709:', error);
      setFeedback({ ok: false, message: `Fix failed: ${String(error)}` });
    }
  };

  return (
    <div className="page">
      <div className="flex justify-between items-center mb-6">
        <h2 className="page-title">Network Fixer</h2>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={testConnectivity} loading={testing}>
            Test Connectivity
          </Button>
          <Button variant="primary" onClick={runNetworkFix} loading={fixing}>
            {fixing ? 'Fixing...' : 'Run Network Fix'}
          </Button>
        </div>
      </div>

      {fixing && <Progress indeterminate label="Running network fixes..." className="mb-4" />}

      {feedback && (
        <div
          role="status"
          aria-live="polite"
          className={`mb-4 p-3 rounded-lg text-sm ${feedback.ok ? 'text-success' : 'text-error'}`}
        >
          {feedback.message}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        <Card hoverable>
          <div className="flex flex-col items-center text-center gap-3 p-4">
            <span className="text-3xl">🌐</span>
            <h3 className="text-md font-semibold text-fg-primary">Reset TCP/IP</h3>
            <p className="text-sm text-fg-secondary">Reset TCP/IP stack and Winsock</p>
            <Button variant="secondary" size="sm" onClick={runNetworkFix}>
              Run Fix
            </Button>
          </div>
        </Card>
        <Card hoverable>
          <div className="flex flex-col items-center text-center gap-3 p-4">
            <span className="text-3xl">🖨️</span>
            <h3 className="text-md font-semibold text-fg-primary">Fix Error 0x00000709</h3>
            <p className="text-sm text-fg-secondary">Fix printer sharing error</p>
            <Button variant="secondary" size="sm" onClick={fixError0x00000709}>
              Fix Error
            </Button>
          </div>
        </Card>
        <Card hoverable>
          <div className="flex flex-col items-center text-center gap-3 p-4">
            <span className="text-3xl">📡</span>
            <h3 className="text-md font-semibold text-fg-primary">Test Connectivity</h3>
            <p className="text-sm text-fg-secondary">Test network connectivity</p>
            <Button variant="secondary" size="sm" onClick={testConnectivity} loading={testing}>
              Test
            </Button>
          </div>
        </Card>
      </div>

      {report && !fixing && (
        <Card title="Network Fix Report">
          <div className="flex flex-col gap-3">
            <div className="flex gap-2 mb-2">
              <Badge variant={report.connectivityTest.success ? 'success' : 'error'}>
                Connectivity: {report.connectivityTest.success ? 'OK' : 'Failed'}
              </Badge>
              <Badge variant="info">Latency: {report.connectivityTest.latency}ms</Badge>
            </div>
            {report.fixes.map((fix) => (
              <div
                key={fix.id}
                className="flex items-center justify-between p-3 rounded-lg hover:bg-bg-hover"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-fg-primary">{fix.name}</span>
                    <Badge variant={fix.status === 'success' ? 'success' : 'error'}>
                      {fix.status}
                    </Badge>
                  </div>
                  <div className="text-xs text-fg-tertiary mt-1">
                    {fix.description} • {fix.duration}ms
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
};
