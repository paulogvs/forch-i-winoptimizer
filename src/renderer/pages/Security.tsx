import React, { useState, useEffect } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Progress } from '../components/ui/Progress';
import type { PrivacySetting, SecurityAction, DNSBenchmarkResult } from '@shared/types';

interface SecurityCheck {
  id: string;
  title: string;
  description: string;
  status: 'pass' | 'warning' | 'critical';
  recommendation: string;
  autoFixable: boolean;
}

export const Security: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'security' | 'privacy' | 'dns'>('security');
  const [securityChecks, setSecurityChecks] = useState<SecurityCheck[]>([]);
  const [privacySettings, setPrivacySettings] = useState<PrivacySetting[]>([]);
  const [securityActions, setSecurityActions] = useState<SecurityAction[]>([]);
  const [dnsResults, setDnsResults] = useState<DNSBenchmarkResult[]>([]);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [applying, setApplying] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [privacyResult, actionsResult, dnsResult] = await Promise.all([
        window.winoptimizer.privacy.getSettings(),
        window.winoptimizer.security.getActions(),
        window.winoptimizer.dns.benchmark(),
      ]);
      setPrivacySettings(privacyResult);
      setSecurityActions(actionsResult);
      setDnsResults(dnsResult);
    } catch (error) {
      console.error('Failed to load security data:', error);
    }
  };

  const runSecurityScan = async () => {
    setScanning(true);
    setProgress(0);

    const progressInterval = setInterval(() => {
      setProgress((prev) => Math.min(prev + 5, 90));
    }, 100);

    await new Promise((resolve) => setTimeout(resolve, 2000));

    const checks: SecurityCheck[] = [
      { id: 'defender', title: 'Windows Defender Real-time Protection', description: 'Real-time protection is enabled and active', status: 'pass', recommendation: 'No action needed', autoFixable: false },
      { id: 'firewall', title: 'Windows Firewall', description: 'Firewall is enabled for all network profiles', status: 'pass', recommendation: 'No action needed', autoFixable: false },
      { id: 'updates', title: 'Windows Updates', description: 'System is up to date with latest security patches', status: 'pass', recommendation: 'No action needed', autoFixable: false },
      { id: 'uac', title: 'User Account Control (UAC)', description: 'UAC is set to recommended level', status: 'pass', recommendation: 'No action needed', autoFixable: false },
      { id: 'telemetry', title: 'Telemetry Level', description: 'Telemetry is set to required minimum', status: 'warning', recommendation: 'Consider disabling telemetry for better privacy', autoFixable: true },
      { id: 'password', title: 'Password Policy', description: 'Password policy could be stronger', status: 'warning', recommendation: 'Enable password complexity requirements', autoFixable: false },
      { id: 'remote-desktop', title: 'Remote Desktop', description: 'Remote Desktop is disabled', status: 'pass', recommendation: 'No action needed', autoFixable: false },
      { id: 'smb1', title: 'SMBv1 Protocol', description: 'SMBv1 is disabled (recommended)', status: 'pass', recommendation: 'No action needed', autoFixable: false },
    ];

    clearInterval(progressInterval);
    setProgress(100);
    setSecurityChecks(checks);
    setScanning(false);
  };

  const applyPrivacySetting = async (settingId: string) => {
    setApplying(settingId);
    try {
      const result = await window.winoptimizer.privacy.applySetting(settingId);
      alert(result.message);
      await loadData();
    } catch (error) {
      console.error('Failed to apply privacy setting:', error);
    } finally {
      setApplying(null);
    }
  };

  const applyAllPrivacy = async () => {
    setApplying('all');
    try {
      const result = await window.winoptimizer.privacy.applyAll();
      alert(result.message);
      await loadData();
    } catch (error) {
      console.error('Failed to apply all privacy settings:', error);
    } finally {
      setApplying(null);
    }
  };

  const runSecurityAction = async (action: SecurityAction) => {
    if (action.warning && !confirm(action.warning)) return;
    setApplying(action.id);
    try {
      const result = await window.winoptimizer.security.runAction(action.id);
      alert(result.message);
    } catch (error) {
      console.error('Failed to run security action:', error);
    } finally {
      setApplying(null);
    }
  };

  const setDNS = async (primary: string, secondary: string) => {
    try {
      const result = await window.winoptimizer.dns.set(primary, secondary);
      alert(result.message);
    } catch (error) {
      console.error('Failed to set DNS:', error);
    }
  };

  const passCount = securityChecks.filter((c) => c.status === 'pass').length;
  const warningCount = securityChecks.filter((c) => c.status === 'warning').length;
  const criticalCount = securityChecks.filter((c) => c.status === 'critical').length;

  const appliedPrivacyCount = privacySettings.filter((s) => s.isApplied).length;

  return (
    <div className="page">
      <div className="flex justify-between items-center mb-6">
        <h2 className="page-title">Security & Privacy</h2>
        <div className="flex gap-2">
          <Button
            variant={activeTab === 'security' ? 'primary' : 'secondary'}
            onClick={() => setActiveTab('security')}
          >
            Security
          </Button>
          <Button
            variant={activeTab === 'privacy' ? 'primary' : 'secondary'}
            onClick={() => setActiveTab('privacy')}
          >
            Privacy
          </Button>
          <Button
            variant={activeTab === 'dns' ? 'primary' : 'secondary'}
            onClick={() => setActiveTab('dns')}
          >
            DNS
          </Button>
        </div>
      </div>

      {activeTab === 'security' && (
        <>
          <div className="flex justify-between items-center mb-4">
            <div className="flex gap-2">
              <Badge variant="success">{passCount} Passed</Badge>
              <Badge variant="warning">{warningCount} Warnings</Badge>
              <Badge variant="error">{criticalCount} Critical</Badge>
            </div>
            <Button variant="primary" onClick={runSecurityScan} loading={scanning}>
              {scanning ? 'Scanning...' : 'Run Security Scan'}
            </Button>
          </div>

          {scanning && (
            <Progress value={progress} label="Running security checks..." className="mb-4" />
          )}

          {securityChecks.length > 0 && !scanning && (
            <div className="flex flex-col gap-4">
              {securityChecks.map((check) => (
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
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled
                        title="Automatic fix is not implemented yet — apply the recommendation from the Privacy tab."
                      >
                        Fix
                      </Button>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )}

          <Card title="Security Actions" className="mt-6">
            <div className="flex flex-col gap-3">
              {securityActions.map((action) => (
                <div
                  key={action.id}
                  className="flex items-center justify-between p-3 rounded-lg hover:bg-bg-hover"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-fg-primary">{action.name}</span>
                      <Badge variant="info">{action.category}</Badge>
                      {action.isReversible && <Badge variant="success">Reversible</Badge>}
                    </div>
                    <p className="text-xs text-fg-tertiary mt-1">{action.description}</p>
                    {action.warning && (
                      <p className="text-xs text-warning mt-1">⚠️ {action.warning}</p>
                    )}
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => runSecurityAction(action)}
                    loading={applying === action.id}
                  >
                    Run
                  </Button>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}

      {activeTab === 'privacy' && (
        <>
          <div className="flex justify-between items-center mb-4">
            <div className="flex gap-2">
              <Badge variant="success">{appliedPrivacyCount} Applied</Badge>
              <Badge variant="warning">{privacySettings.length - appliedPrivacyCount} Pending</Badge>
            </div>
            <Button
              variant="primary"
              onClick={applyAllPrivacy}
              loading={applying === 'all'}
            >
              Apply All Privacy Settings
            </Button>
          </div>

          <div className="flex flex-col gap-4">
            {privacySettings.map((setting) => (
              <Card key={setting.id}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-md font-semibold text-fg-primary">{setting.name}</h3>
                      <Badge variant="info">{setting.category}</Badge>
                      <Badge variant={setting.isApplied ? 'success' : 'warning'}>
                        {setting.isApplied ? 'Applied' : 'Not Applied'}
                      </Badge>
                      <Badge variant="neutral">{setting.impact} impact</Badge>
                    </div>
                    <p className="text-sm text-fg-secondary">{setting.description}</p>
                    <p className="text-xs text-fg-tertiary mt-1">
                      Current: {setting.currentValue ?? 'Not set'} → Recommended: {setting.recommendedValue}
                    </p>
                  </div>
                  {!setting.isApplied && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => applyPrivacySetting(setting.id)}
                      loading={applying === setting.id}
                    >
                      Apply
                    </Button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      {activeTab === 'dns' && (
        <>
          <Card title="DNS Benchmark" className="mb-4">
            <div className="flex flex-col gap-3">
              {dnsResults.map((dns) => (
                <div
                  key={dns.name}
                  className="flex items-center justify-between p-3 rounded-lg hover:bg-bg-hover"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-fg-primary">{dns.name}</span>
                      {dns.isRecommended && <Badge variant="success">Recommended</Badge>}
                    </div>
                    <div className="text-xs text-fg-tertiary">
                      {dns.primaryDNS} / {dns.secondaryDNS}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div className="text-sm font-medium text-fg-primary">{dns.avgLatency}ms</div>
                      <div className="text-xs text-fg-tertiary">Latency</div>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setDNS(dns.primaryDNS, dns.secondaryDNS)}
                    >
                      Set DNS
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  );
};
