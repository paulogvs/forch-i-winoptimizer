import React, { useCallback, useEffect, useState } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Progress } from '../components/ui/Progress';
import { SkeletonCards } from '../components/ui/Skeleton';
import { ScanProgress } from '../components/ui/ScanProgress';
import { QuickFixBar } from '../components/QuickFixBar';
import { useScanProgress } from '../hooks/useScanProgress';
import { formatBytes, formatUptime } from '../utils/format';
import type { SystemInfo } from '@shared/electron-api';
import type { PageId } from '@shared/types';

interface DashboardProps {
  onNavigate?: (page: PageId) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ onNavigate }) => {
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const progress = useScanProgress('system');

  const loadSystemInfo = useCallback(async (force = false) => {
    setLoading(true);
    try {
      if (force) {
        // A manual refresh must bypass the 60s System Info cache (P1.2).
        await window.electronAPI.clearCache();
      }
      const info = await window.electronAPI.getSystemInfo(force ? { force: true } : undefined);
      setSystemInfo(info);
    } catch (error) {
      console.error('Failed to load system info:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Fase 1.2 (SWR): paint from cache first (~instant when warm), then
    // revalidate silently. The skeleton only covers the first paint.
    let cancelled = false;
    void (async () => {
      await loadSystemInfo();
      if (cancelled) return;
      try {
        const fresh = await window.electronAPI.getSystemInfo({ force: true });
        if (!cancelled) setSystemInfo(fresh);
      } catch (error) {
        console.error('Background system-info revalidation failed:', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadSystemInfo]);

  if (loading && !systemInfo) {
    return (
      <div className="page">
        <h2 className="page-title">Dashboard</h2>
        <ScanProgress event={progress} className="mb-4" />
        <SkeletonCards count={3} />
      </div>
    );
  }

  if (!systemInfo) {
    return (
      <div className="page">
        <h2 className="page-title">Dashboard</h2>
        <div className="flex items-center justify-center h-64">
          <div className="text-tertiary">Failed to load system information</div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="flex justify-between items-center mb-6">
        <h2 className="page-title">Dashboard</h2>
        <Button variant="secondary" onClick={() => loadSystemInfo(true)} loading={loading}>
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 mb-6">
        <Card>
          <div className="kpi-card">
            <span className="kpi-label">CPU Usage</span>
            <span className="kpi-value">
              {systemInfo.cpu.usage}
              <span className="kpi-unit">%</span>
            </span>
            <Progress value={systemInfo.cpu.usage} variant="primary" />
            <span className="text-xs text-tertiary">{systemInfo.cpu.model}</span>
          </div>
        </Card>
        <Card>
          <div className="kpi-card">
            <span className="kpi-label">Memory</span>
            <span className="kpi-value">
              {(systemInfo.memory.used / 1024 / 1024 / 1024).toFixed(1)}
              <span className="kpi-unit">GB</span>
            </span>
            <Progress value={systemInfo.memory.usagePercent} variant="warning" />
            <span className="text-xs text-tertiary">
              {formatBytes(systemInfo.memory.used)} / {formatBytes(systemInfo.memory.total)}
            </span>
          </div>
        </Card>
        <Card>
          <div className="kpi-card">
            <span className="kpi-label">Disk (C:)</span>
            <span className="kpi-value">
              {(systemInfo.disk.used / 1024 / 1024 / 1024).toFixed(0)}
              <span className="kpi-unit">GB</span>
            </span>
            <Progress value={systemInfo.disk.usagePercent} variant="success" />
            <span className="text-xs text-tertiary">
              {formatBytes(systemInfo.disk.used)} / {formatBytes(systemInfo.disk.total)}
            </span>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card title="System Information">
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between">
              <span className="text-tertiary">OS:</span>
              <span className="text-primary">{systemInfo.windowsVersion}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-tertiary">Build:</span>
              <span className="text-primary">{systemInfo.windowsBuild}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-tertiary">Hostname:</span>
              <span className="text-primary">{systemInfo.hostname}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-tertiary">Username:</span>
              <span className="text-primary">{systemInfo.username}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-tertiary">Uptime:</span>
              <span className="text-primary">{formatUptime(systemInfo.uptime)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-tertiary">CPU Cores:</span>
              <span className="text-primary">{systemInfo.cpu.cores}</span>
            </div>
          </div>
        </Card>

        <Card title="GPU Information">
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between">
              <span className="text-tertiary">GPU:</span>
              <span className="text-primary">{systemInfo.gpu.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-tertiary">VRAM:</span>
              <span className="text-primary">{formatBytes(systemInfo.gpu.vram)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-tertiary">Driver:</span>
              <span className="text-primary">{systemInfo.gpu.driverVersion}</span>
            </div>
          </div>
        </Card>
      </div>

      <div className="mt-6">
        <Card title="Quick Actions">
          <div className="flex gap-3 flex-wrap mb-6">
            <Button variant="primary" onClick={() => loadSystemInfo(true)}>
              Scan Now
            </Button>
            <Button variant="secondary" onClick={() => onNavigate?.('cleaner')}>
              Clean Junk
            </Button>
            <Button variant="secondary" onClick={() => onNavigate?.('boost')}>
              Optimize
            </Button>
          </div>
          <h3 className="text-sm font-semibold text-fg-secondary mb-3">Quick fixes</h3>
          <QuickFixBar onNavigate={onNavigate} />
        </Card>
      </div>
    </div>
  );
};
