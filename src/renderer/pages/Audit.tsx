import React, { useState, useEffect } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Progress } from '../components/ui/Progress';
import type { AuditReport } from '@shared/types';

export const Audit: React.FC = () => {
  const [report, setReport] = useState<AuditReport | null>(null);
  const [auditing, setAuditing] = useState(false);
  const [progress, setProgress] = useState(0);

  const runAudit = async () => {
    setAuditing(true);
    setProgress(0);

    const progressInterval = setInterval(() => {
      setProgress((prev) => Math.min(prev + 2, 90));
    }, 100);

    try {
      const result = await window.winoptimizer.audit.run();
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
    runAudit();
  }, []);

  const categories = ['privacy', 'performance', 'memory', 'storage', 'startup', 'network'] as const;

  return (
    <div className="page">
      <div className="flex justify-between items-center mb-6">
        <h2 className="page-title">System Audit</h2>
        <Button variant="primary" onClick={runAudit} loading={auditing}>
          {auditing ? 'Auditing...' : 'Run Audit'}
        </Button>
      </div>

      {auditing && (
        <Progress value={progress} label="Running system audit..." className="mb-4" />
      )}

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
              <Card key={category} title={category.charAt(0).toUpperCase() + category.slice(1)} className="mb-4">
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
                        <Button variant="secondary" size="sm">
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
