import React, { useState, useEffect, useCallback } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Progress } from '../components/ui/Progress';
import { useAppStore } from '../stores/useAppStore';
import type { AuditCheck, AuditCategory, PageId } from '@shared/types';

interface AuditProps {
  onNavigate?: (page: PageId) => void;
}

/**
 * Fase 5.3: the audit is loaded one category at a time. On mount only the
 * default (first) tab is scanned; the other categories run when the user opens
 * their tab — never before. The "Run Audit" button still scans everything and
 * can be used to force-refresh the full report.
 */
const CATEGORIES: readonly AuditCategory[] = [
  'privacy',
  'performance',
  'memory',
  'storage',
  'startup',
  'network',
];

const CATEGORY_LABEL: Record<AuditCategory, string> = {
  privacy: 'Privacy',
  performance: 'Performance',
  memory: 'Memory',
  storage: 'Storage',
  startup: 'Startup',
  network: 'Network',
};

/**
 * Where each audit category is actually resolved. The audit itself never
 * mutates the machine: "Fix" opens the page that owns the reversible flow
 * (Tweaks preview/restore, Privacy apply, Cleaner selection, ...).
 */
const FIX_TARGETS: Record<AuditCategory, { page: PageId; label: string }> = {
  privacy: { page: 'security', label: 'Security → Privacy' },
  performance: { page: 'tweaks', label: 'Tweaks' },
  memory: { page: 'boost', label: 'Boost' },
  storage: { page: 'cleaner', label: 'Cleaner' },
  startup: { page: 'tools', label: 'Tools → Startup Manager' },
  network: { page: 'network', label: 'Network' },
};

/** Five-minute in-page cache so switching tabs back is instant. */
const CATEGORY_CACHE_TTL_MS = 5 * 60 * 1000;

export const Audit: React.FC<AuditProps> = ({ onNavigate }) => {
  const [activeCategory, setActiveCategory] = useState<AuditCategory>('privacy');
  const [checksByCategory, setChecksByCategory] = useState<
    Partial<Record<AuditCategory, AuditCheck[]>>
  >({});
  const [loadedAt, setLoadedAt] = useState<Partial<Record<AuditCategory, number>>>({});
  const [loadingCategory, setLoadingCategory] = useState<AuditCategory | null>(null);
  const [runningAll, setRunningAll] = useState(false);
  const [progress, setProgress] = useState(0);

  const loadCategory = useCallback(
    async (category: AuditCategory, force = false) => {
      // Paint from the in-page cache when fresh; only force re-reads the machine.
      const at = loadedAt[category];
      if (!force && at !== undefined && Date.now() - at < CATEGORY_CACHE_TTL_MS) {
        return;
      }
      setLoadingCategory(category);
      try {
        const result = await window.winoptimizer.audit.run({
          categories: [category],
          ...(force ? { force: true } : {}),
        });
        setChecksByCategory((prev) => ({
          ...prev,
          [category]: result.checks.filter((c) => c.category === category),
        }));
        setLoadedAt((prev) => ({ ...prev, [category]: Date.now() }));
      } catch (error) {
        console.error(`Failed to run ${category} audit:`, error);
      } finally {
        setLoadingCategory((current) => (current === category ? null : current));
      }
    },
    [loadedAt]
  );

  // Opening a tab (the landing tab included) scans it only if it was never
  // loaded. Other categories are never touched until the user opens them.
  useEffect(() => {
    if (checksByCategory[activeCategory] === undefined) {
      void loadCategory(activeCategory);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCategory]);

  const runFullAudit = async () => {
    setRunningAll(true);
    setProgress(0);
    const tick = setInterval(() => setProgress((prev) => Math.min(prev + 4, 90)), 150);
    try {
      // Explicit user action: bypass the TTL and re-read the machine.
      const result = await window.winoptimizer.audit.run({ force: true });
      const grouped: Partial<Record<AuditCategory, AuditCheck[]>> = {};
      const now = Date.now();
      for (const category of CATEGORIES) {
        grouped[category] = result.checks.filter((c) => c.category === category);
      }
      setChecksByCategory(grouped);
      setLoadedAt(
        Object.fromEntries(CATEGORIES.map((c) => [c, now])) as Partial<
          Record<AuditCategory, number>
        >
      );
      setProgress(100);
    } catch (error) {
      console.error('Failed to run audit:', error);
    } finally {
      clearInterval(tick);
      setRunningAll(false);
    }
  };

  const mergedChecks = CATEGORIES.flatMap((category) => checksByCategory[category] ?? []);
  const passedCount = mergedChecks.filter((c) => c.status === 'pass').length;
  const warningCount = mergedChecks.filter((c) => c.status === 'warning').length;
  const criticalCount = mergedChecks.filter((c) => c.status === 'critical').length;
  const loadedCount = CATEGORIES.filter((c) => checksByCategory[c] !== undefined).length;
  const score = Math.max(0, 100 - warningCount * 5 - criticalCount * 15);
  const categoryChecks = checksByCategory[activeCategory] ?? [];
  const loading = loadingCategory === activeCategory;

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
        <Button variant="primary" onClick={runFullAudit} loading={runningAll}>
          {runningAll ? 'Auditing...' : 'Run Audit'}
        </Button>
      </div>

      {runningAll && (
        <Progress value={progress} label="Running full system audit..." className="mb-4" />
      )}

      {(mergedChecks.length > 0 || runningAll) && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <Card>
            <div className="text-center">
              <div className="text-3xl font-bold text-fg-primary">{score}</div>
              <div className="text-sm text-fg-secondary">
                Overall Score ({loadedCount}/{CATEGORIES.length} categories)
              </div>
            </div>
          </Card>
          <Card>
            <div className="text-center">
              <div className="text-3xl font-bold text-success">{passedCount}</div>
              <div className="text-sm text-fg-secondary">Passed</div>
            </div>
          </Card>
          <Card>
            <div className="text-center">
              <div className="text-3xl font-bold text-warning">{warningCount}</div>
              <div className="text-sm text-fg-secondary">Warnings</div>
            </div>
          </Card>
          <Card>
            <div className="text-center">
              <div className="text-3xl font-bold text-error">{criticalCount}</div>
              <div className="text-sm text-fg-secondary">Critical</div>
            </div>
          </Card>
        </div>
      )}

      <div className="flex gap-2 flex-wrap mb-4">
        {CATEGORIES.map((category) => (
          <Button
            key={category}
            variant={activeCategory === category ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setActiveCategory(category)}
            data-testid={`audit-tab-${category}`}
          >
            {CATEGORY_LABEL[category]}
          </Button>
        ))}
      </div>

      <Card title={CATEGORY_LABEL[activeCategory]} className="mb-4">
        {loading && (
          <p className="text-sm text-fg-secondary" data-testid="audit-category-loading">
            Scanning {CATEGORY_LABEL[activeCategory]}... only this category is being read.
          </p>
        )}
        {!loading && categoryChecks.length === 0 && (
          <p className="text-sm text-fg-secondary">
            No results yet for {CATEGORY_LABEL[activeCategory]}. Open a tab to scan it, or run the
            full audit.
          </p>
        )}
        {!loading && categoryChecks.length > 0 && (
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
        )}
      </Card>
    </div>
  );
};
