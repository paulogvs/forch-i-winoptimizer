import React, { useState, useEffect } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Progress } from '../components/ui/Progress';
import type { CleaningSchedule, CleaningHistoryEntry } from '@shared/types';

export const Cleaning: React.FC = () => {
  const [schedules, setSchedules] = useState<CleaningSchedule[]>([]);
  const [history, setHistory] = useState<CleaningHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [activeTab, setActiveTab] = useState<'schedules' | 'history'>('schedules');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [schedulesResult, historyResult] = await Promise.all([
        window.winoptimizer.cleaning.getSchedules(),
        window.winoptimizer.cleaning.getHistory(),
      ]);
      setSchedules(schedulesResult);
      setHistory(historyResult);
    } catch (error) {
      console.error('Failed to load cleaning data:', error);
    } finally {
      setLoading(false);
    }
  };

  const runSchedule = async (id: string) => {
    setRunning(id);
    setProgress(0);

    const progressInterval = setInterval(() => {
      setProgress((prev) => Math.min(prev + 10, 90));
    }, 300);

    try {
      const result = await window.winoptimizer.cleaning.runNow(id);
      clearInterval(progressInterval);
      setProgress(100);
      alert(result.message);
      await loadData();
    } catch (error) {
      console.error('Failed to run schedule:', error);
    } finally {
      setRunning(null);
    }
  };

  const toggleSchedule = async (id: string, enabled: boolean) => {
    try {
      await window.winoptimizer.cleaning.updateSchedule(id, { enabled });
      await loadData();
    } catch (error) {
      console.error('Failed to update schedule:', error);
    }
  };

  const deleteSchedule = async (id: string) => {
    if (!confirm('Delete this schedule?')) return;
    try {
      await window.winoptimizer.cleaning.deleteSchedule(id);
      await loadData();
    } catch (error) {
      console.error('Failed to delete schedule:', error);
    }
  };

  if (loading) {
    return (
      <div className="page">
        <h2 className="page-title">Scheduled Cleaning</h2>
        <div className="flex items-center justify-center h-64">
          <div className="text-fg-tertiary">Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="flex justify-between items-center mb-6">
        <h2 className="page-title">Scheduled Cleaning</h2>
        <div className="flex gap-2">
          <Button
            variant={activeTab === 'schedules' ? 'primary' : 'secondary'}
            onClick={() => setActiveTab('schedules')}
          >
            Schedules
          </Button>
          <Button
            variant={activeTab === 'history' ? 'primary' : 'secondary'}
            onClick={() => setActiveTab('history')}
          >
            History
          </Button>
        </div>
      </div>

      {activeTab === 'schedules' && (
        <div className="flex flex-col gap-4">
          {schedules.length === 0 && (
            <Card>
              <div className="text-center text-fg-tertiary py-8">
                No cleaning schedules configured.
              </div>
            </Card>
          )}
          {schedules.map((schedule) => (
            <Card
              key={schedule.id}
              title={schedule.name}
              footer={
                <div className="flex items-center gap-2">
                  <Badge variant={schedule.enabled ? 'success' : 'neutral'}>
                    {schedule.enabled ? 'Enabled' : 'Disabled'}
                  </Badge>
                  <Badge variant="info">{schedule.frequency}</Badge>
                  <span className="text-xs text-fg-tertiary">
                    Next: {schedule.nextRun.toLocaleDateString()}
                  </span>
                </div>
              }
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex gap-1 mb-2">
                    {schedule.categories.map((cat) => (
                      <Badge key={cat} variant="neutral">
                        {cat}
                      </Badge>
                    ))}
                  </div>
                  {schedule.lastRun && (
                    <div className="text-xs text-fg-tertiary">
                      Last run: {schedule.lastRun.toLocaleString()}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {running === schedule.id ? (
                    <Progress value={progress} className="w-24" />
                  ) : (
                    <>
                      <Button variant="primary" size="sm" onClick={() => runSchedule(schedule.id)}>
                        Run Now
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => toggleSchedule(schedule.id, !schedule.enabled)}
                      >
                        {schedule.enabled ? 'Disable' : 'Enable'}
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => deleteSchedule(schedule.id)}
                      >
                        Delete
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {activeTab === 'history' && (
        <Card title="Cleaning History">
          {history.length === 0 ? (
            <div className="text-center text-fg-tertiary py-8">No cleaning history yet.</div>
          ) : (
            <div className="flex flex-col gap-2">
              {history.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between p-3 rounded-lg hover:bg-bg-hover"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-fg-primary">
                        {entry.scheduleName}
                      </span>
                      <Badge
                        variant={
                          entry.status === 'success'
                            ? 'success'
                            : entry.status === 'partial'
                              ? 'warning'
                              : 'error'
                        }
                      >
                        {entry.status}
                      </Badge>
                    </div>
                    <div className="text-xs text-fg-tertiary">
                      {entry.timestamp.toLocaleString()} • {entry.filesDeleted} files •{' '}
                      {Math.round(entry.spaceFreed / 1_000_000)} MB freed
                    </div>
                  </div>
                  <div className="text-sm text-fg-secondary">
                    {Math.round(entry.duration / 1000)}s
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
};
