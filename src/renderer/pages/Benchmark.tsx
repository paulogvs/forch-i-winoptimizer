import React, { useState } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Progress } from '../components/ui/Progress';
import { useToast } from '../components/ui/toast-context';
import type { BenchmarkReport } from '@shared/types';

export const Benchmark: React.FC = () => {
  const { notify } = useToast();
  const [report, setReport] = useState<BenchmarkReport | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);

  const runBenchmark = async () => {
    setRunning(true);
    setProgress(0);

    const progressInterval = setInterval(() => {
      setProgress((prev) => Math.min(prev + 2, 90));
    }, 150);

    try {
      const result = await window.winoptimizer.benchmark.run();
      clearInterval(progressInterval);
      setProgress(100);
      setReport(result);
    } catch (error) {
      console.error('Failed to run benchmark:', error);
    } finally {
      setRunning(false);
    }
  };

  const exportMarkdown = async () => {
    if (!report) return;
    try {
      const markdown = await window.winoptimizer.benchmark.exportMarkdown(report);
      // Copy to clipboard
      await navigator.clipboard.writeText(markdown);
      notify({
        variant: 'success',
        title: 'Copied',
        message: 'Markdown report copied to clipboard.',
      });
    } catch (error) {
      console.error('Failed to export markdown:', error);
      notify({
        variant: 'error',
        title: 'Export failed',
        message: error instanceof Error ? error.message : 'Could not copy the report.',
      });
    }
  };

  const categories = ['cpu', 'memory', 'disk', 'gpu', 'network'] as const;

  return (
    <div className="page">
      <div className="flex justify-between items-center mb-6">
        <h2 className="page-title">Benchmark</h2>
        <div className="flex gap-2">
          {report && (
            <Button variant="secondary" onClick={exportMarkdown}>
              Export Markdown
            </Button>
          )}
          <Button variant="primary" onClick={runBenchmark} loading={running}>
            {running ? 'Running...' : 'Run Benchmark'}
          </Button>
        </div>
      </div>

      {running && <Progress value={progress} label="Running benchmark tests..." className="mb-4" />}

      {report && !running && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <Card>
              <div className="text-center">
                <div className="text-3xl font-bold text-fg-primary">{report.totalScore}</div>
                <div className="text-sm text-fg-secondary">Total Score</div>
              </div>
            </Card>
            <Card>
              <div className="text-center">
                <div className="text-lg font-semibold text-fg-primary truncate">
                  {report.systemInfo.cpu}
                </div>
                <div className="text-sm text-fg-secondary">CPU</div>
              </div>
            </Card>
            <Card>
              <div className="text-center">
                <div className="text-lg font-semibold text-fg-primary">
                  {report.systemInfo.memory} GB
                </div>
                <div className="text-sm text-fg-secondary">Memory</div>
              </div>
            </Card>
            <Card>
              <div className="text-center">
                <div className="text-lg font-semibold text-fg-primary truncate">
                  {report.systemInfo.gpu}
                </div>
                <div className="text-sm text-fg-secondary">GPU</div>
              </div>
            </Card>
          </div>

          {categories.map((category) => {
            const categoryResults = report.results.filter((r) => r.category === category);
            if (categoryResults.length === 0) return null;

            return (
              <Card key={category} title={category.toUpperCase()} className="mb-4">
                <div className="flex flex-col gap-3">
                  {categoryResults.map((result) => (
                    <div
                      key={result.id}
                      className="flex items-center justify-between p-3 rounded-lg hover:bg-bg-hover"
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-fg-primary">{result.name}</span>
                          <Badge
                            variant={
                              result.score >= 80
                                ? 'success'
                                : result.score >= 50
                                  ? 'warning'
                                  : 'error'
                            }
                          >
                            {result.score}
                          </Badge>
                        </div>
                        <div className="text-xs text-fg-tertiary mt-1">{result.details}</div>
                      </div>
                      <div className="text-sm text-fg-secondary">{result.unit}</div>
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
