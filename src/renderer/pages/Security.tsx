import React, { useState, useEffect } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Progress } from '../components/ui/Progress';

interface SecurityCheck {
  id: string;
  title: string;
  description: string;
  status: 'pass' | 'warning' | 'critical';
  recommendation: string;
  autoFixable: boolean;
}

export const Security: React.FC = () => {
  const [checks, setChecks] = useState<SecurityCheck[]>([]);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState(0);

  const runSecurityScan = async () => {
    setScanning(true);
    setProgress(0);

    const progressInterval = setInterval(() => {
      setProgress((prev) => Math.min(prev + 5, 90));
    }, 100);

    // Simulate security checks
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const securityChecks: SecurityCheck[] = [
      {
        id: 'defender',
        title: 'Windows Defender Real-time Protection',
        description: 'Real-time protection is enabled and active',
        status: 'pass',
        recommendation: 'No action needed',
        autoFixable: false,
      },
      {
        id: 'firewall',
        title: 'Windows Firewall',
        description: 'Firewall is enabled for all network profiles',
        status: 'pass',
        recommendation: 'No action needed',
        autoFixable: false,
      },
      {
        id: 'updates',
        title: 'Windows Updates',
        description: 'System is up to date with latest security patches',
        status: 'pass',
        recommendation: 'No action needed',
        autoFixable: false,
      },
      {
        id: 'uac',
        title: 'User Account Control (UAC)',
        description: 'UAC is set to recommended level',
        status: 'pass',
        recommendation: 'No action needed',
        autoFixable: false,
      },
      {
        id: 'telemetry',
        title: 'Telemetry Level',
        description: 'Telemetry is set to required minimum',
        status: 'warning',
        recommendation: 'Consider disabling telemetry for better privacy',
        autoFixable: true,
      },
      {
        id: 'password',
        title: 'Password Policy',
        description: 'Password policy could be stronger',
        status: 'warning',
        recommendation: 'Enable password complexity requirements',
        autoFixable: false,
      },
      {
        id: 'remote-desktop',
        title: 'Remote Desktop',
        description: 'Remote Desktop is disabled',
        status: 'pass',
        recommendation: 'No action needed',
        autoFixable: false,
      },
      {
        id: 'smb1',
        title: 'SMBv1 Protocol',
        description: 'SMBv1 is disabled (recommended)',
        status: 'pass',
        recommendation: 'No action needed',
        autoFixable: false,
      },
    ];

    clearInterval(progressInterval);
    setProgress(100);
    setChecks(securityChecks);
    setScanning(false);
  };

  useEffect(() => {
    runSecurityScan();
  }, []);

  const passCount = checks.filter((c) => c.status === 'pass').length;
  const warningCount = checks.filter((c) => c.status === 'warning').length;
  const criticalCount = checks.filter((c) => c.status === 'critical').length;

  return (
    <div className="page">
      <div className="flex justify-between items-center mb-6">
        <h2 className="page-title">Security</h2>
        <Button variant="primary" onClick={runSecurityScan} loading={scanning}>
          {scanning ? 'Scanning...' : 'Run Security Scan'}
        </Button>
      </div>

      {scanning && (
        <Progress value={progress} label="Running security checks..." className="mb-4" />
      )}

      {checks.length > 0 && !scanning && (
        <>
          <div className="flex gap-2 mb-6">
            <Badge variant="success">{passCount} Passed</Badge>
            <Badge variant="warning">{warningCount} Warnings</Badge>
            <Badge variant="error">{criticalCount} Critical</Badge>
          </div>

          <div className="flex flex-col gap-4">
            {checks.map((check) => (
              <Card key={check.id}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-md font-semibold text-fg-primary">{check.title}</h3>
                      <Badge
                        variant={
                          check.status === 'critical'
                            ? 'error'
                            : check.status === 'warning'
                              ? 'warning'
                              : 'success'
                        }
                      >
                        {check.status}
                      </Badge>
                    </div>
                    <p className="text-sm text-fg-secondary">{check.description}</p>
                    {check.status !== 'pass' && (
                      <p className="text-xs text-fg-tertiary mt-1">
                        <strong>Recommendation:</strong> {check.recommendation}
                      </p>
                    )}
                  </div>
                  {check.autoFixable && check.status !== 'pass' && (
                    <Button variant="secondary" size="sm">Fix</Button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
};
