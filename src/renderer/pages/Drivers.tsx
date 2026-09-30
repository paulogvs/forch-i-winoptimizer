import React, { useState, useEffect } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Progress } from '../components/ui/Progress';
import type { DriverScanResult, DriverInfo } from '@shared/types';

export const Drivers: React.FC = () => {
  const [scanResult, setScanResult] = useState<DriverScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [installing, setInstalling] = useState<string | null>(null);
  const [restorePoint, setRestorePoint] = useState<string | null>(null);

  const scanDrivers = async () => {
    setScanning(true);
    setProgress(0);

    const progressInterval = setInterval(() => {
      setProgress((prev) => Math.min(prev + 5, 90));
    }, 100);

    try {
      const result = await window.winoptimizer.drivers.scan();
      clearInterval(progressInterval);
      setProgress(100);
      setScanResult(result);
    } catch (error) {
      console.error('Failed to scan drivers:', error);
    } finally {
      setScanning(false);
    }
  };

  const createRestorePoint = async () => {
    try {
      const result = await window.winoptimizer.drivers.createRestorePoint('Before driver update');
      if (result.success) {
        setRestorePoint('Restore point created successfully');
      } else {
        setRestorePoint(`Failed: ${result.message}`);
      }
    } catch (error) {
      setRestorePoint('Failed to create restore point');
    }
  };

  const installDriver = async (driver: DriverInfo) => {
    setInstalling(driver.id);
    try {
      const result = await window.winoptimizer.drivers.install(driver.id, driver.downloadUrl);
      if (result.success) {
        alert(result.message);
      }
    } catch (error) {
      console.error('Failed to install driver:', error);
    } finally {
      setInstalling(null);
    }
  };

  const rollbackDriver = async (driver: DriverInfo) => {
    if (!confirm(`Rollback driver for ${driver.name}?`)) return;
    try {
      const result = await window.winoptimizer.drivers.rollback(driver.id);
      alert(result.message);
    } catch (error) {
      console.error('Failed to rollback driver:', error);
    }
  };

  useEffect(() => {
    scanDrivers();
  }, []);

  const outdatedDrivers = scanResult?.drivers.filter((d) => !d.isUpToDate) ?? [];
  const upToDateDrivers = scanResult?.drivers.filter((d) => d.isUpToDate) ?? [];

  return (
    <div className="page">
      <div className="flex justify-between items-center mb-6">
        <h2 className="page-title">Driver Updater</h2>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={createRestorePoint}>
            Create Restore Point
          </Button>
          <Button variant="primary" onClick={scanDrivers} loading={scanning}>
            {scanning ? 'Scanning...' : 'Scan Drivers'}
          </Button>
        </div>
      </div>

      {restorePoint && (
        <div className="mb-4 p-3 rounded-lg bg-bg-secondary text-sm">
          {restorePoint}
        </div>
      )}

      {scanning && (
        <Progress value={progress} label="Scanning hardware..." className="mb-4" />
      )}

      {scanResult && !scanning && (
        <>
          <div className="flex gap-2 mb-6">
            <Badge variant="info">{scanResult.totalDevices} devices</Badge>
            <Badge variant="warning">{scanResult.outdatedCount} outdated</Badge>
            <Badge variant="success">{scanResult.upToDateCount} up to date</Badge>
          </div>

          {outdatedDrivers.length > 0 && (
            <Card title="Outdated Drivers" className="mb-4">
              <div className="flex flex-col gap-3">
                {outdatedDrivers.map((driver) => (
                  <div
                    key={driver.id}
                    className="flex items-center justify-between p-3 rounded-lg hover:bg-bg-hover"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-fg-primary">{driver.name}</span>
                        <Badge variant="info">{driver.manufacturer}</Badge>
                        <Badge variant="warning">outdated</Badge>
                      </div>
                      <div className="text-xs text-fg-tertiary mt-1">
                        Current: {driver.currentVersion} → Latest: {driver.latestVersion}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {installing === driver.id ? (
                        <Progress value={50} className="w-24" />
                      ) : (
                        <>
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => installDriver(driver)}
                          >
                            Update
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => rollbackDriver(driver)}
                          >
                            Rollback
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {upToDateDrivers.length > 0 && (
            <Card title="Up to Date Drivers">
              <div className="flex flex-col gap-2">
                {upToDateDrivers.map((driver) => (
                  <div
                    key={driver.id}
                    className="flex items-center justify-between p-2 rounded-lg hover:bg-bg-hover"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-fg-primary">{driver.name}</span>
                        <Badge variant="info">{driver.manufacturer}</Badge>
                        <Badge variant="success">up to date</Badge>
                      </div>
                      <div className="text-xs text-fg-tertiary">
                        Version: {driver.currentVersion}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
};
