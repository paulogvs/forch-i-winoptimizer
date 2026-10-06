import React, { useState, useEffect, useCallback } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Input } from '../components/ui/Input';
import { Progress } from '../components/ui/Progress';
import { Tooltip } from '../components/ui/Tooltip';
import { Modal } from '../components/ui/Modal';
import { useToast } from '../components/ui/toast-context';
import { useAppStore } from '../stores/useAppStore';
import { useOperationStatus } from '../hooks/useOperationStatus';
import type { PrivacySetting, SecurityAction, DNSBenchmarkResult } from '@shared/types';
import type { SecurityFixOutcome, SecurityFixPreview } from '@shared/security-fix';
import type { MalwareFileResult, MalwareScanReport, MalwareScanScope } from '@shared/malware-scan';
import {
  SECURITY_CHECK_BY_ID,
  SECURITY_SCORE_FORMULA,
  type SecurityCheckResult,
  type SecurityCheckStatus,
  type SecurityScanReport,
} from '@shared/security-scan';

const STATUS_LABEL: Record<SecurityCheckStatus, string> = {
  pass: 'Pass',
  warn: 'Warning',
  fail: 'Fail',
  unknown: 'Unknown',
  'not-applicable': 'Not applicable',
  'requires-admin': 'Requires admin',
};

const STATUS_BADGE: Record<
  SecurityCheckStatus,
  'success' | 'warning' | 'error' | 'info' | 'neutral'
> = {
  pass: 'success',
  warn: 'warning',
  fail: 'error',
  unknown: 'neutral',
  'not-applicable': 'info',
  'requires-admin': 'info',
};

const STATUS_ICON: Record<SecurityCheckStatus, string> = {
  pass: '✓',
  warn: '!',
  fail: '✕',
  unknown: '?',
  'not-applicable': '–',
  'requires-admin': '↑',
};

const SEVERITY_BADGE: Record<string, 'error' | 'warning' | 'info' | 'neutral'> = {
  critical: 'error',
  high: 'warning',
  medium: 'neutral',
  low: 'neutral',
};

const MALWARE_BADGE: Record<MalwareFileResult['status'], 'success' | 'error' | 'neutral'> = {
  clean: 'success',
  infected: 'error',
  unknown: 'neutral',
};

const MALWARE_LABEL: Record<MalwareFileResult['status'], string> = {
  clean: 'Clean',
  infected: 'Match',
  unknown: 'Unknown',
};

/** Files shown per report before truncating the list (the report keeps them all). */
const MALWARE_VISIBLE_FILES = 100;

export const Security: React.FC = () => {
  // Tab is shared through the store so cross-page "Fix" actions (e.g. Audit)
  // can land directly on Privacy.
  const activeTab = useAppStore((state) => state.securityTab);
  const setActiveTab = useAppStore((state) => state.setSecurityTab);
  const { notify } = useToast();
  const [report, setReport] = useState<SecurityScanReport | null>(null);
  const [privacySettings, setPrivacySettings] = useState<PrivacySetting[]>([]);
  const [securityActions, setSecurityActions] = useState<SecurityAction[]>([]);
  const [dnsResults, setDnsResults] = useState<DNSBenchmarkResult[]>([]);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [scanError, setScanError] = useState<string | null>(null);
  const [applying, setApplying] = useState<string | null>(null);
  // Reversible auto-fix (v0.7.0): mandatory preview -> confirm -> apply/revert.
  const [fixCheckId, setFixCheckId] = useState<string | null>(null);
  const [fixPreview, setFixPreview] = useState<SecurityFixPreview | null>(null);
  const [fixBusy, setFixBusy] = useState(false);
  const [fixMessage, setFixMessage] = useState<string | null>(null);

  const [dnsLoading, setDnsLoading] = useState(false);

  // YARA malware scan (v0.17.0): real rule matching in a worker_thread.
  const operation = useOperationStatus();
  const [malwareScopes, setMalwareScopes] = useState<MalwareScanScope[]>([]);
  const [malwarePath, setMalwarePath] = useState('');
  const [malwareReport, setMalwareReport] = useState<MalwareScanReport | null>(null);
  const [malwareScanning, setMalwareScanning] = useState(false);
  const [malwareError, setMalwareError] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      // Fase 1.1: the DNS benchmark (~12s cold) is NOT part of the initial
      // load. It runs only when the user opens the DNS tab (see below), so
      // visiting Security no longer waits for it. The 90s TTL in main reuses
      // a warm result across visits.
      const [privacyResult, actionsResult] = await Promise.all([
        window.winoptimizer.privacy.getSettings(),
        window.winoptimizer.security.getActions(),
      ]);
      setPrivacySettings(privacyResult);
      setSecurityActions(actionsResult);
      try {
        setMalwareScopes(await window.winoptimizer.malware.scopes());
      } catch {
        setMalwareScopes([]);
      }
    } catch (error) {
      console.error('Failed to load security data:', error);
    }
  };

  const loadDns = useCallback(async () => {
    setDnsLoading(true);
    try {
      const dnsResult = await window.winoptimizer.dns.benchmark();
      setDnsResults(dnsResult);
    } catch (error) {
      console.error('Failed to benchmark DNS:', error);
    } finally {
      setDnsLoading(false);
    }
  }, []);

  // Load the DNS benchmark on demand: first time the DNS tab opens.
  useEffect(() => {
    if (activeTab === 'dns' && dnsResults.length === 0 && !dnsLoading) {
      void loadDns();
    }
  }, [activeTab, dnsResults.length, dnsLoading, loadDns]);

  const runSecurityScan = useCallback(async () => {
    setScanning(true);
    setProgress(10);
    setScanError(null);
    const tick = setInterval(() => setProgress((prev) => Math.min(prev + 4, 90)), 150);
    try {
      // force=true: an explicit user action must re-read the machine, not a
      // warm TTL entry.
      const result = await window.winoptimizer.security.scan({ force: true });
      setReport(result);
      setProgress(100);
    } catch (error) {
      console.error('Security scan failed:', error);
      setScanError(error instanceof Error ? error.message : 'The security scan failed.');
    } finally {
      clearInterval(tick);
      setScanning(false);
    }
  }, []);

  const applyPrivacySetting = async (settingId: string) => {
    setApplying(settingId);
    try {
      const result = await window.winoptimizer.privacy.applySetting(settingId);
      notify({
        variant: result.success ? 'success' : 'error',
        title: result.success ? 'Privacy setting applied' : 'Privacy setting failed',
        message: result.message,
      });
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
      notify({
        variant: result.success ? 'success' : 'error',
        title: result.success ? 'Privacy settings applied' : 'Privacy settings failed',
        message: result.message,
      });
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
      notify({
        variant: result.success ? 'success' : 'error',
        title: result.success ? 'Security action completed' : 'Security action failed',
        message: result.message,
      });
    } catch (error) {
      console.error('Failed to run security action:', error);
    } finally {
      setApplying(null);
    }
  };

  const setDNS = async (primary: string, secondary: string) => {
    try {
      const result = await window.winoptimizer.dns.set(primary, secondary);
      notify({
        variant: result.success ? 'success' : 'error',
        title: result.success ? 'DNS updated' : 'DNS update failed',
        message: result.message,
      });
    } catch (error) {
      console.error('Failed to set DNS:', error);
    }
  };

  // ===== Reversible auto-fix (v0.7.0) =====
  const openFixPreview = async (checkId: string) => {
    setFixCheckId(checkId);
    setFixPreview(null);
    setFixMessage(null);
    setFixBusy(true);
    try {
      const preview = await window.winoptimizer.security.previewFix(checkId);
      setFixPreview(preview);
      if (!preview) setFixMessage('This check does not support auto-fix.');
    } catch (error) {
      setFixMessage(error instanceof Error ? error.message : 'Could not load the fix preview.');
    } finally {
      setFixBusy(false);
    }
  };

  const closeFix = () => {
    setFixCheckId(null);
    setFixPreview(null);
    setFixMessage(null);
    setFixBusy(false);
  };

  const runFix = async (action: 'apply' | 'revert') => {
    if (!fixCheckId) return;
    setFixBusy(true);
    setFixMessage(null);
    try {
      const outcome: SecurityFixOutcome =
        action === 'apply'
          ? await window.winoptimizer.security.applyFix(fixCheckId)
          : await window.winoptimizer.security.revertFix(fixCheckId);
      setFixMessage(outcome.message);
      // Re-read the machine so the report reflects reality, and refresh the
      // preview so the buttons match the new state.
      const [refreshedReport, refreshedPreview] = await Promise.all([
        window.winoptimizer.security.scan({ force: true }),
        window.winoptimizer.security.previewFix(fixCheckId),
      ]);
      setReport(refreshedReport);
      setFixPreview(refreshedPreview);
    } catch (error) {
      setFixMessage(error instanceof Error ? error.message : 'The action failed.');
    } finally {
      setFixBusy(false);
    }
  };

  const relaunchElevated = async () => {
    setFixBusy(true);
    try {
      const result = await window.winoptimizer.security.relaunchElevated();
      setFixMessage(result.message);
    } catch (error) {
      setFixMessage(error instanceof Error ? error.message : 'Could not relaunch elevated.');
    } finally {
      setFixBusy(false);
    }
  };

  // ===== YARA malware scan (v0.17.0, read-only) =====
  const runMalwareScan = useCallback(
    async (paths: string[]) => {
      const targets = paths.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
      if (targets.length === 0) {
        setMalwareError('Type or pick a file or folder to scan.');
        return;
      }
      setMalwareScanning(true);
      setMalwareError(null);
      try {
        const result = await window.winoptimizer.malware.scan({ paths: targets });
        setMalwareReport(result);
        const { infected, unknown, total } = result.summary;
        notify({
          variant: infected > 0 ? 'error' : 'success',
          title:
            infected > 0
              ? `Malware scan: ${infected} match(es) need review`
              : `Malware scan: ${total} file(s) checked`,
          message:
            infected > 0
              ? `${infected} of ${total} file(s) matched bundled YARA rules${unknown > 0 ? `, ${unknown} could not be read` : ''}.`
              : `${total} file(s) scanned, no rule matched${unknown > 0 ? `, ${unknown} could not be read` : ''}.`,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'The malware scan failed.';
        setMalwareError(/cancel/i.test(message) ? 'Scan cancelled.' : message);
      } finally {
        setMalwareScanning(false);
      }
    },
    [notify]
  );

  const cancelMalwareScan = useCallback(async () => {
    try {
      await window.winoptimizer.malware.cancel();
    } catch {
      /* the engine already settled: the scan handler reports the outcome */
    }
  }, []);

  const summary = report?.summary ?? {
    pass: 0,
    warn: 0,
    fail: 0,
    unknown: 0,
    'not-applicable': 0,
    'requires-admin': 0,
  };
  const measuredCount = summary.unknown + summary['not-applicable'] + summary['requires-admin'];

  const appliedPrivacyCount = privacySettings.filter((s) => s.isApplied).length;

  return (
    <div className="page">
      <div className="flex justify-between items-center mb-6">
        <h2 className="page-title">Security &amp; Privacy</h2>
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
          <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
            <div className="flex gap-2 flex-wrap">
              <Badge variant="success">{summary.pass} Passed</Badge>
              <Badge variant="warning">{summary.warn} Warnings</Badge>
              <Badge variant="error">{summary.fail} Failed</Badge>
              {summary.unknown > 0 && <Badge variant="neutral">{summary.unknown} Unknown</Badge>}
              {summary['not-applicable'] > 0 && (
                <Badge variant="info">{summary['not-applicable']} Not applicable</Badge>
              )}
              {summary['requires-admin'] > 0 && (
                <Badge variant="info">{summary['requires-admin']} Requires admin</Badge>
              )}
            </div>
            <Button
              variant="primary"
              onClick={runSecurityScan}
              loading={scanning}
              data-testid="security-scan-button"
            >
              {scanning ? 'Scanning...' : 'Run Security Scan'}
            </Button>
          </div>

          {scanning && (
            <Progress value={progress} label="Running live security checks..." className="mb-4" />
          )}

          {scanError && (
            <Card className="mb-4">
              <p className="text-sm text-fg-secondary">The scan could not complete: {scanError}</p>
            </Card>
          )}

          {report && !scanning && (
            <div data-testid="security-report">
              <Card className="mb-4">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-4">
                    <Tooltip content={SECURITY_SCORE_FORMULA}>
                      <div
                        className="text-2xl font-semibold"
                        style={{ color: 'var(--color-chart-primary)' }}
                        data-testid="security-score"
                        aria-label={
                          report.score === null
                            ? 'Security score: not scored'
                            : `Security score: ${report.score} of 100`
                        }
                      >
                        {report.score === null ? '—' : report.score}
                        <span className="text-sm text-fg-tertiary font-normal">
                          {report.score === null ? ' not scored' : ' / 100'}
                        </span>
                      </div>
                    </Tooltip>
                    <div className="text-xs text-fg-tertiary max-w-xl">
                      <div>
                        {report.scoredChecks} of {report.totalChecks} checks scored
                        {report.excludedChecks > 0
                          ? ` · ${report.excludedChecks} excluded (not measured / not applicable)`
                          : ''}
                        .
                      </div>
                      <div className="mt-1">{SECURITY_SCORE_FORMULA}</div>
                    </div>
                  </div>
                  <div className="text-xs text-fg-tertiary text-right">
                    <div>{report.machine.osCaption || 'Operating system: unknown'}</div>
                    <div>
                      Build {report.machine.osBuild || '?'}
                      {report.machine.displayVersion
                        ? ` (${report.machine.displayVersion})`
                        : ''} · {report.machine.edition || 'edition unknown'}
                    </div>
                    <div>
                      {report.machine.isAdmin
                        ? 'Running as administrator'
                        : 'Running without admin'}
                      {measuredCount > 0 ? ` · ${measuredCount} check(s) not measured` : ''}
                    </div>
                  </div>
                </div>
              </Card>

              <div className="flex flex-col gap-4">
                {report.checks.map((check: SecurityCheckResult) => {
                  const meta = SECURITY_CHECK_BY_ID.get(check.id);
                  const status = check.status;
                  return (
                    <Card key={check.id}>
                      <div
                        data-testid={`security-check-${check.id}`}
                        className="flex items-start justify-between gap-4"
                      >
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <h3 className="text-md font-semibold text-fg-primary">
                              {meta?.title ?? check.id}
                            </h3>
                            {meta && (
                              <Badge variant={SEVERITY_BADGE[meta.severity] ?? 'neutral'}>
                                {meta.severity} severity
                              </Badge>
                            )}
                            <Badge variant={STATUS_BADGE[status]}>
                              <span aria-hidden="true">{STATUS_ICON[status]} </span>
                              {STATUS_LABEL[status]}
                            </Badge>
                          </div>
                          <p className="text-sm text-fg-secondary">{check.reason}</p>
                          <p className="text-xs text-fg-tertiary mt-1 font-mono break-words">
                            <strong>Observed:</strong> {check.evidence}
                          </p>
                          {status !== 'pass' && meta && (
                            <p className="text-xs text-fg-tertiary mt-1">
                              <strong>How to fix:</strong> {meta.guidance}
                            </p>
                          )}
                        </div>
                        {check.id === 'antivirus' && (status === 'fail' || status === 'warn') && (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setActiveTab('privacy')}
                            title="Open the built-in Windows-protection actions."
                            data-testid="security-fix-antivirus"
                          >
                            Actions
                          </Button>
                        )}
                        {meta?.autoFixable && (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => openFixPreview(check.id)}
                            title="Preview a reversible, admin-only fix for this check."
                            data-testid={`security-fix-${check.id}`}
                          >
                            Auto-fix
                          </Button>
                        )}
                      </div>
                    </Card>
                  );
                })}
              </div>

              <p className="text-xs text-fg-tertiary mt-4">
                This scan only reads the machine. It never changes system state; any repair is a
                separate, explicit action.
              </p>
            </div>
          )}

          <Card title="Malware scan (YARA)" className="mt-6">
            <p className="text-xs text-fg-tertiary mb-3">
              Read-only file matching with bundled YARA rules (
              {malwareReport
                ? `rules v${malwareReport.rulesVersion}, ${malwareReport.engine}`
                : 'rules load on first scan'}
              ) running in a background worker — the app stays responsive. A match is a{' '}
              <strong>report</strong> (rule + file), not an antivirus verdict: heuristic hits need
              manual review. This does not replace real-time antivirus protection.
            </p>
            <div className="flex gap-2 flex-wrap mb-3">
              {malwareScopes.map((scope) => (
                <Button
                  key={scope.id}
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setMalwarePath(scope.path);
                    void runMalwareScan([scope.path]);
                  }}
                  disabled={malwareScanning || operation.busy}
                  title={`Scan ${scope.path}`}
                  data-testid={`malware-scan-scope-${scope.id}`}
                >
                  Scan {scope.label}
                </Button>
              ))}
            </div>
            <div className="flex gap-2 items-end flex-wrap">
              <div className="flex-1 min-w-52">
                <Input
                  label="File or folder to scan"
                  placeholder="C:\Users\you\Downloads"
                  value={malwarePath}
                  onChange={(event) => setMalwarePath(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void runMalwareScan([malwarePath]);
                  }}
                  disabled={malwareScanning}
                  data-testid="malware-path-input"
                />
              </div>
              <Button
                variant="primary"
                size="sm"
                onClick={() => void runMalwareScan([malwarePath])}
                loading={malwareScanning}
                disabled={operation.busy && !malwareScanning}
                title={
                  operation.busy && !malwareScanning
                    ? `Queued behind ${operation.current ?? 'another operation'}`
                    : 'Scan with bundled YARA rules'
                }
                data-testid="malware-scan-button"
              >
                {malwareScanning ? 'Scanning...' : 'Scan'}
              </Button>
              {malwareScanning && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void cancelMalwareScan()}
                  data-testid="malware-cancel-button"
                >
                  Cancel
                </Button>
              )}
            </div>
            {operation.busy && !malwareScanning && (
              <p className="text-xs text-fg-tertiary mt-2">
                Another operation ({operation.current ?? 'unknown'}) is running
                {operation.queued > 0 ? `, ${operation.queued} queued` : ''} — the scan will queue
                behind it.
              </p>
            )}

            {malwareError && (
              <p className="text-sm text-fg-secondary mt-3" data-testid="malware-error">
                {malwareError}
              </p>
            )}

            {malwareReport && !malwareScanning && (
              <div className="mt-4" data-testid="malware-report">
                <div className="flex gap-2 flex-wrap mb-3">
                  <Badge variant="success">{malwareReport.summary.clean} Clean</Badge>
                  <Badge variant="error">{malwareReport.summary.infected} Matches</Badge>
                  {malwareReport.summary.unknown > 0 && (
                    <Badge variant="neutral">{malwareReport.summary.unknown} Unknown</Badge>
                  )}
                  <span className="text-xs text-fg-tertiary">
                    {malwareReport.summary.total} file(s) in{' '}
                    {(malwareReport.durationMs / 1000).toFixed(1)}s · rules v
                    {malwareReport.rulesVersion} · {malwareReport.engine}
                  </span>
                </div>
                {malwareReport.note && (
                  <p className="text-xs text-fg-tertiary mb-2">{malwareReport.note}</p>
                )}
                <div className="flex flex-col gap-2">
                  {malwareReport.files.slice(0, MALWARE_VISIBLE_FILES).map((file) => (
                    <div
                      key={file.path}
                      data-testid={`malware-file-${file.status}`}
                      className="flex items-start justify-between gap-4 p-3 rounded-lg hover:bg-bg-hover"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="text-sm font-medium text-fg-primary break-all">
                            {file.path}
                          </span>
                          <Badge variant={MALWARE_BADGE[file.status]}>
                            {MALWARE_LABEL[file.status]}
                          </Badge>
                        </div>
                        <p className="text-xs text-fg-tertiary break-words">{file.reason}</p>
                        {file.matches.length > 0 && (
                          <p className="text-xs text-fg-secondary mt-1 font-mono break-words">
                            {file.matches
                              .map(
                                (match) =>
                                  `${match.rule}${match.description ? ` — ${match.description}` : ''}`
                              )
                              .join(' · ')}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                {malwareReport.files.length > MALWARE_VISIBLE_FILES && (
                  <p className="text-xs text-fg-tertiary mt-2">
                    Showing {MALWARE_VISIBLE_FILES} of {malwareReport.files.length} files.
                  </p>
                )}
              </div>
            )}
          </Card>

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
              <Badge variant="warning">
                {privacySettings.length - appliedPrivacyCount} Pending
              </Badge>
            </div>
            <Button variant="primary" onClick={applyAllPrivacy} loading={applying === 'all'}>
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
                      Current: {setting.currentValue ?? 'Not set'} → Recommended:{' '}
                      {setting.recommendedValue}
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
          <Card
            title="DNS Benchmark"
            className="mb-4"
            footer={
              <Button
                variant="secondary"
                size="sm"
                onClick={async () => {
                  setDnsLoading(true);
                  try {
                    setDnsResults(await window.winoptimizer.dns.benchmark({ force: true }));
                  } catch (error) {
                    console.error('Failed to benchmark DNS:', error);
                  } finally {
                    setDnsLoading(false);
                  }
                }}
                loading={dnsLoading}
              >
                Re-run benchmark
              </Button>
            }
          >
            {dnsLoading && dnsResults.length === 0 && (
              <p className="text-sm text-fg-secondary">Benchmarking DNS servers…</p>
            )}
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

      {/* Reversible auto-fix (v0.7.0): mandatory preview, then explicit
          confirmation, then apply; a revert restores the captured value. */}
      <Modal
        open={fixCheckId !== null}
        onClose={closeFix}
        title={fixPreview?.title ?? 'Security auto-fix'}
        footer={
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" size="sm" onClick={closeFix} disabled={fixBusy}>
              Close
            </Button>
            {fixPreview?.blockedReason === 'requires-admin' && (
              <Button
                variant="secondary"
                size="sm"
                onClick={relaunchElevated}
                loading={fixBusy}
                data-testid="security-fix-relaunch"
              >
                Restart as administrator
              </Button>
            )}
            {fixPreview?.canRevert && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => runFix('revert')}
                loading={fixBusy}
                data-testid="security-fix-revert"
              >
                Revert
              </Button>
            )}
            {fixPreview?.canApply && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => runFix('apply')}
                loading={fixBusy}
                data-testid="security-fix-apply"
              >
                Apply
              </Button>
            )}
          </div>
        }
      >
        {fixBusy && !fixPreview && (
          <p className="text-sm text-fg-secondary">Reading the current value…</p>
        )}
        {fixPreview && (
          <div className="flex flex-col gap-2 text-sm">
            <p className="text-fg-secondary">{fixPreview.description}</p>
            <p className="text-fg-primary">
              <strong>Current:</strong>{' '}
              <span data-testid="security-fix-current">{fixPreview.current}</span>
            </p>
            <p className="text-fg-primary">
              <strong>Change to:</strong>{' '}
              <span data-testid="security-fix-target">{fixPreview.target}</span>
            </p>
            {fixPreview.original && (
              <p className="text-fg-tertiary">
                <strong>Revert would restore:</strong> {fixPreview.original}
              </p>
            )}
            {fixPreview.blockedMessage && (
              <p className="text-warning" data-testid="security-fix-blocked">
                {fixPreview.blockedMessage}
              </p>
            )}
            {!fixPreview.canApply && !fixPreview.canRevert && !fixPreview.blockedMessage && (
              <p className="text-fg-tertiary">No change is available for this check right now.</p>
            )}
          </div>
        )}
        {fixMessage && (
          <p className="text-sm text-fg-secondary mt-3" data-testid="security-fix-message">
            {fixMessage}
          </p>
        )}
      </Modal>
    </div>
  );
};
