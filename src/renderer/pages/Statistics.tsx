import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { BarChart, type BarDatum } from '../components/ui/BarChart';
import { LineChart } from '../components/ui/LineChart';
import { formatBytes } from '../utils/format';
import type { StatsEvent } from '@shared/stats';

/** Compact time label: `HH:MM` for today, `MM/DD` otherwise. */
function shortLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function toSeries(events: StatsEvent[], pick: (event: StatsEvent) => number): BarDatum[] {
  // Cap to the most recent 30 observations so the chart stays legible.
  return events.slice(-30).map((event) => ({
    label: shortLabel(event.timestamp),
    value: pick(event),
  }));
}

export const Statistics: React.FC = () => {
  const [events, setEvents] = useState<StatsEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await window.electronAPI.getStats();
      setEvents(Array.isArray(result) ? result : []);
    } catch (error) {
      console.error('Failed to load statistics:', error);
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const scans = useMemo(() => events.filter((e) => e.type === 'scan'), [events]);
  const cleans = useMemo(() => events.filter((e) => e.type === 'clean'), [events]);
  const audits = useMemo(() => events.filter((e) => e.type === 'audit'), [events]);
  const boosts = useMemo(() => events.filter((e) => e.type === 'boost'), [events]);
  const maintenance = useMemo(() => events.filter((e) => e.type === 'maintenance'), [events]);

  const totalFreed = useMemo(() => cleans.reduce((sum, e) => sum + e.bytes, 0), [cleans]);
  const totalFilesCleaned = useMemo(() => cleans.reduce((sum, e) => sum + e.files, 0), [cleans]);
  const totalScanned = useMemo(() => scans.reduce((sum, e) => sum + e.bytes, 0), [scans]);
  const lastScore = audits.length > 0 ? (audits[audits.length - 1]?.score ?? null) : null;

  const exportCsv = async () => {
    setFeedback(null);
    try {
      const result = await window.electronAPI.exportStats();
      setFeedback(result.message);
    } catch (error) {
      setFeedback(`Export failed: ${String(error)}`);
    }
  };

  return (
    <div className="page">
      <div className="flex justify-between items-center mb-6">
        <h2 className="page-title">Statistics</h2>
        <div className="flex items-center gap-3">
          {feedback && (
            <span role="status" className="text-xs text-fg-tertiary">
              {feedback}
            </span>
          )}
          <Button variant="secondary" onClick={exportCsv} data-testid="export-csv">
            Export CSV
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64 text-fg-tertiary">
          Loading statistics...
        </div>
      ) : events.length === 0 ? (
        <Card>
          <EmptyState
            icon={<span className="text-3xl">📊</span>}
            title="No activity recorded yet"
            description="Run a cleaner scan, an audit, or Free RAM and the real measurements will appear here."
          />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <Card>
              <div className="text-center">
                <div className="text-2xl font-bold text-fg-primary">
                  {formatBytes(totalScanned)}
                </div>
                <div className="text-sm text-fg-secondary">Junk scanned</div>
              </div>
            </Card>
            <Card>
              <div className="text-center">
                <div className="text-2xl font-bold text-success">{formatBytes(totalFreed)}</div>
                <div className="text-sm text-fg-secondary">Space freed</div>
              </div>
            </Card>
            <Card>
              <div className="text-center">
                <div className="text-2xl font-bold text-info">{totalFilesCleaned}</div>
                <div className="text-sm text-fg-secondary">Files cleaned</div>
              </div>
            </Card>
            <Card>
              <div className="text-center">
                <div className="text-2xl font-bold text-fg-primary">
                  {lastScore === null ? '—' : lastScore}
                </div>
                <div className="text-sm text-fg-secondary">Last audit score</div>
              </div>
            </Card>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card title="Junk found per scan">
              <BarChart
                testId="chart-scan"
                data={toSeries(scans, (e) => e.bytes)}
                ariaLabel="Junk bytes found per cleaner scan"
                formatValue={formatBytes}
                emptyMessage="No cleaner scans recorded yet."
              />
            </Card>
            <Card title="Files cleaned">
              <BarChart
                testId="chart-clean"
                data={toSeries(cleans, (e) => e.files)}
                ariaLabel="Files deleted per cleanup"
                formatValue={(v) => `${v} file(s)`}
                emptyMessage="No cleanup recorded yet."
                color="var(--color-chart-quaternary)"
              />
            </Card>
            <Card title="Audit score history">
              <LineChart
                testId="chart-audit"
                data={toSeries(audits, (e) => e.score ?? 0)}
                ariaLabel="System audit score over time (0 to 100)"
                formatValue={(v) => `${v}/100`}
                emptyMessage="No audit runs recorded yet."
                max={100}
              />
            </Card>
            <Card title="RAM boosted">
              <BarChart
                testId="chart-boost"
                data={toSeries(boosts, (e) => e.bytes)}
                ariaLabel="Bytes of working set trimmed by Free RAM"
                formatValue={formatBytes}
                emptyMessage="No Free RAM boosts recorded yet."
                color="var(--color-chart-tertiary)"
              />
            </Card>
            <Card title="Maintenance actions">
              <BarChart
                testId="chart-maintenance"
                data={toSeries(maintenance, () => 1)}
                ariaLabel="One-click maintenance actions (Flush DNS, restore point, driver scan)"
                formatValue={(v) => `${v} action(s)`}
                emptyMessage="No maintenance actions recorded yet."
                color="var(--color-chart-secondary)"
              />
            </Card>
          </div>
        </>
      )}
    </div>
  );
};
