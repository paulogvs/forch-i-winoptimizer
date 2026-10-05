import React, { useState, useEffect } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Progress } from '../components/ui/Progress';
import { useAppStore } from '../stores/useAppStore';
import type { AuditCheck, AuditReport, PageId } from '@shared/types';

interface AuditProps {
  onNavigate?: (page: PageId) => void;
}

/**
 * Where each audit category is actually resolved. The audit itself never
 * mutates the machine: "Fix" opens the page that owns the reversible flow
 * (Tweaks preview/restore, Privacy apply, Cleaner selection, ...).
 */
const FIX_TARGETS: Record<AuditCheck['category'], { page: PageId; label: string }> = {
  privacy: { page: 'security', label: 'Security → Privacy' },
  performance: { page: 'tweaks', label: 'Tweaks' },
  memory: { page: 'boost', label: 'Boost' },
  storage: { page: 'cleaner', label: 'Cleaner' },
  startup: { page: 'tools', label: 'Tools → Startup Manager' },
  network: { page: 'network', label: 'Network' },
};

export const Audit: React.FC<AuditProps> = ({ onNavigate }) => {
  const [report, setReport] = useState<AuditReport | null>(null);
  const [auditing, setAuditing] = useState(false);
  const [progress, setProgress] = useState(0);

  const runAudit = async (force = false) => {
    setAuditing(true);
    setProgress(0);

    const progressInterval = setInterval(() => {
      setProgress((prev) => Math.min(prev + 2, 90));
    }, 100);

    try {
      // An explicit re-run bypasses the TTL; the first paint serves the cache.
      const result = await window.winoptimizer.audit.run(force ? { force: true } : undefined);
      clearInterval(progressInterval);
      setProgress(100);
      setReport(result);
    } catch (error) {
      console.error('Failed to run audit:', error);
    } finally {
      setAuditing(false);
    }
  };

  useEffect(() => {
    // Fase 1.2 (SWR): paint from cache first (~instant when warm), then
    // revalidate silently in the background. The spinner only covers the
    // first paint; the revalidation never flashes loading state.
    let cancelled = false;
    void (async () => {
      await runAudit(false);
      if (cancelled) return;
      try {
        const fresh = await window.winoptimizer.audit.run({ force: true });
        if (!cancelled) setReport(fresh);
      } catch (error) {
        console.error('Background audit revalidation failed:', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const categories = ['privacy', 'performance', 'memory', 'storage', 'startup', 'network'] as const;

  const handleFix = (check: AuditCheck) => {
    const target = FIX_TARGETS[check.category];
    if (!target) return;
    // Privacy fixes live behind the Security page's Privacy tab.
    if (check.category === 'privacy') useAppStore.getState().setSecurityTab('privacy');
    onNavigate?.(target.page);
  };

  return (
    <div className="page">
      <div className="flex justify-between items-center mb-6">
        <h2 className="page-title">System Audit</h2>
        <Button variant="primary" onClick={() => runAudit(true)} loading={auditing}>
          {auditing ? 'Auditing...' : 'Run Audit'}
        </Button>
      </div>

      {auditing && <Progress value={progress} label="Running system audit..." className="mb-4" />}

      {report && !auditing && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <Card>
              <div className="text-center">
                <div className="text-3xl font-bold text-fg-primary">{report.score}</div>
                <div className="text-sm text-fg-secondary">Overall Score</div>
              </div>
            </Card>
            <Card>
              <div className="text-center">
                <div className="text-3xl font-bold text-success">{report.passedCount}</div>
                <div className="text-sm text-fg-secondary">Passed</div>
              </div>
            </Card>
            <Card>
              <div className="text-center">
                <div className="text-3xl font-bold text-warning">{report.warningCount}</div>
                <div className="text-sm text-fg-secondary">Warnings</div>
              </div>
            </Card>
            <Card>
              <div className="text-center">
                <div className="text-3xl font-bold text-error">{report.criticalCount}</div>
                <div className="text-sm text-fg-secondary">Critical</div>
              </div>
            </Card>
          </div>

          {categories.map((category) => {
            const categoryChecks = report.checks.filter((c) => c.category === category);
            if (categoryChecks.length === 0) return null;

            return (
              <Card
                key={category}
                title={category.charAt(0).toUpperCase() + category.slice(1)}
                className="mb-4"
              >
                <div className="flex flex-col gap-3">
                  {categoryChecks.map((check) => (
                    <div
                      key={check.id}
                      className="flex items-start justify-between p-3 rounded-lg hover:bg-bg-hover"
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-fg-primary">{check.name}</span>
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
                          <Badge variant="neutral">{check.impact} impact</Badge>
                        </div>
                        <p className="text-xs text-fg-tertiary mt-1">{check.description}</p>
                        {check.status !== 'pass' && (
                          <p className="text-xs text-fg-secondary mt-1">
                            <strong>Recommendation:</strong> {check.recommendation}
                          </p>
                        )}
                      </div>
                      {check.autoFixable && check.status !== 'pass' && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleFix(check)}
                          title={`Open ${FIX_TARGETS[check.category].label} to apply this safely.`}
                          data-testid={`audit-fix-${check.id}`}
                        >
                          Fix
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            );
          })}
        </>
      )}
    </div>
  );
};
