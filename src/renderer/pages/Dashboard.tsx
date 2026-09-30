import React, { useState, useEffect } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Progress } from '../components/ui/Progress';
import { formatBytes, formatUptime } from '../utils/format';
import type { SystemInfo } from '@shared/electron-api';

export const Dashboard: React.FC = () => {
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSystemInfo();
  }, []);

  const loadSystemInfo = async () => {
    try {
      const info = await window.electronAPI.getSystemInfo();
      setSystemInfo(info);
    } catch (error) {
      console.error('Failed to load system info:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="page">
        <h2 className="page-title">Dashboard</h2>
        <div className="flex items-center justify-center h-64">
          <div className="text-fg-tertiary">Loading system information...</div>
        </div>
      </div>
    );
  }

  if (!systemInfo) {
    return (
      <div className="page">
        <h2 className="page-title">Dashboard</h2>
        <div className="flex items-center justify-center h-64">
          <div className="text-fg-tertiary">Failed to load system information</div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="flex justify-between items-center mb-6">
        <h2 className="page-title">Dashboard</h2>
        <Button variant="secondary" onClick={loadSystemInfo}>
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 mb-6">
        <Card>
          <div className="kpi-card">
            <span className="kpi-label">CPU Usage</span>
            <span className="kpi-value">{systemInfo.cpu.usage}<span className="kpi-unit">%</span></span>
            <Progress value={systemInfo.cpu.usage} variant="primary" />
            <span className="text-xs text-fg-tertiary">{systemInfo.cpu.model}</span>
          </div>
        </Card>
        <Card>
          <div className="kpi-card">
            <span className="kpi-label">Memory</span>
            <span className="kpi-value">{(systemInfo.memory.used / 1024 / 1024 / 1024).toFixed(1)}<span className="kpi-unit">GB</span></span>
            <Progress value={systemInfo.memory.usagePercent} variant="warning" />
            <span className="text-xs text-fg-tertiary">
              {formatBytes(systemInfo.memory.used)} / {formatBytes(systemInfo.memory.total)}
            </span>
          </div>
        </Card>
        <Card>
          <div className="kpi-card">
            <span className="kpi-label">Disk (C:)</span>
            <span className="kpi-value">{(systemInfo.disk.used / 1024 / 1024 / 1024).toFixed(0)}<span className="kpi-unit">GB</span></span>
            <Progress value={systemInfo.disk.usagePercent} variant="success" />
            <span className="text-xs text-fg-tertiary">
              {formatBytes(systemInfo.disk.used)} / {formatBytes(systemInfo.disk.total)}
            </span>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card title="System Information">
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between">
              <span className="text-fg-tertiary">OS:</span>
              <span className="text-fg-primary">{systemInfo.windowsVersion}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-fg-tertiary">Build:</span>
              <span className="text-fg-primary">{systemInfo.windowsBuild}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-fg-tertiary">Hostname:</span>
              <span className="text-fg-primary">{systemInfo.hostname}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-fg-tertiary">Username:</span>
              <span className="text-fg-primary">{systemInfo.username}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-fg-tertiary">Uptime:</span>
              <span className="text-fg-primary">{formatUptime(systemInfo.uptime)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-fg-tertiary">CPU Cores:</span>
              <span className="text-fg-primary">{systemInfo.cpu.cores}</span>
            </div>
          </div>
        </Card>

        <Card title="GPU Information">
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between">
              <span className="text-fg-tertiary">GPU:</span>
              <span className="text-fg-primary">{systemInfo.gpu.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-fg-tertiary">VRAM:</span>
              <span className="text-fg-primary">{formatBytes(systemInfo.gpu.vram)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-fg-tertiary">Driver:</span>
              <span className="text-fg-primary">{systemInfo.gpu.driverVersion}</span>
            </div>
          </div>
        </Card>
      </div>

      <div className="mt-6">
        <Card title="Quick Actions">
          <div className="flex gap-3 flex-wrap">
            <Button variant="primary">Scan Now</Button>
            <Button variant="secondary">Clean Junk</Button>
            <Button variant="secondary">Optimize</Button>
          </div>
        </Card>
      </div>
    </div>
  );
};
