import React, { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Progress } from '../components/ui/Progress';
import { SkeletonList } from '../components/ui/Skeleton';
import { ScanProgress } from '../components/ui/ScanProgress';
import { VirtualList } from '../components/ui/VirtualList';
import { useScanProgress } from '../hooks/useScanProgress';
import { useChunkedReveal } from '../hooks/useChunkedReveal';
import { formatBytes } from '../utils/format';
import type { DriverScanResult, DriverInfo } from '@shared/types';
import type { DriverInstallRequest, DriverProgressEvent } from '@shared/driver-update';

/** Lists larger than this are virtualized. */
const VIRTUALIZE_THRESHOLD = 50;

const STAGE_LABEL: Record<DriverProgressEvent['stage'], string> = {
  'restore-point': 'Creating restore point',
  download: 'Downloading',
  verify: 'Verifying',
  install: 'Installing',
  reverify: 'Verifying install',
  done: 'Done',
  error: 'Failed',
};

interface DriverRowProps {
  driver: DriverInfo;
  outdated: boolean;
  isInstalling: boolean;
  progress: DriverProgressEvent | null;
  onInstall: (driver: DriverInfo) => void;
  onRollback: (driver: DriverInfo) => void;
  onCancel: (driver: DriverInfo) => void;
}

const DriverRow = React.memo(function DriverRow({
  driver,
  outdated,
  isInstalling,
  progress,
  onInstall,
  onRollback,
  onCancel,
}: DriverRowProps) {
  const statusVariant =
    driver.status === 'update-available'
      ? 'warning'
      : driver.status === 'up-to-date'
        ? 'success'
        : 'info';
  const statusLabel =
    driver.status === 'update-available'
      ? 'update available'
      : driver.status === 'up-to-date'
        ? 'up to date'
        : 'status unknown';

  return (
    <div className="driver-row">
      <div className="driver-row-main">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-primary">{driver.name}</span>
          <Badge variant="info">{driver.manufacturer}</Badge>
          <Badge variant={statusVariant}>{statusLabel}</Badge>
        </div>
        <div className="text-xs text-tertiary mt-1">
          {driver.status === 'unknown'
            ? `Version: ${driver.currentVersion} (could not check for updates)`
            : outdated
              ? `Current: ${driver.currentVersion} → Latest: ${driver.latestVersion}`
              : `Version: ${driver.currentVersion}`}
        </div>
      </div>
      {outdated && (
        <div className="flex items-center gap-2">
          {isInstalling ? (
            <div className="flex items-center gap-2">
              <Progress
                value={progress?.percent ?? 0}
                showValue
                label={
                  progress
                    ? `${STAGE_LABEL[progress.stage]}${
                        progress.bytesTotal
                          ? ` ${formatBytes(progress.bytesReceived ?? 0)} / ${formatBytes(progress.bytesTotal)}`
                          : ''
                      }`
                    : 'Working...'
                }
                className="w-40"
              />
              <Button variant="secondary" size="sm" onClick={() => onCancel(driver)}>
                Cancel
              </Button>
            </div>
          ) : (
            <>
              <Button variant="primary" size="sm" onClick={() => onInstall(driver)}>
                Update
              </Button>
              <Button variant="secondary" size="sm" onClick={() => onRollback(driver)}>
                Rollback
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
});

export const Drivers: React.FC = () => {
  const [scanResult, setScanResult] = useState<DriverScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);
  const [progress, setProgress] = useState<DriverProgressEvent | null>(null);
  const [restorePoint, setRestorePoint] = useState<string | null>(null);
  const [rebootRequired, setRebootRequired] = useState(false);
  const [query, setQuery] = useState('');
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  const deferredQuery = useDeferredValue(query);
  const scanProgress = useScanProgress('drivers');

  // Real byte/step progress streamed from main (Fase 2.6).
  useEffect(() => {
    const unsubscribe = window.winoptimizer.drivers.onProgress((event) => {
      setProgress(event);
    });
    return unsubscribe;
  }, []);

  const scanDrivers = useCallback(async (force = false) => {
    setScanning(true);
    try {
      const result = await window.winoptimizer.drivers.scan(force ? { force: true } : undefined);
      setScanResult(result);
    } catch (error) {
      console.error('Failed to scan drivers:', error);
    } finally {
      setScanning(false);
    }
  }, []);

  useEffect(() => {
    void scanDrivers();
  }, [scanDrivers]);

  const createRestorePoint = useCallback(async () => {
    try {
      const result = await window.winoptimizer.drivers.createRestorePoint('Before driver update');
      setRestorePoint(
        result.success ? 'Restore point created and verified' : `Failed: ${result.message}`
      );
    } catch (error) {
      console.error('Failed to create restore point:', error);
      setRestorePoint('Failed to create restore point');
    }
  }, []);

  const buildRequest = useCallback(
    (driver: DriverInfo): DriverInstallRequest => ({
      driverId: driver.id,
      name: driver.name,
      manufacturer: driver.manufacturer,
      currentVersion: driver.currentVersion,
      expectedVersion: driver.latestVersion,
      source: driver.source,
      updateTitle: driver.updateTitle,
      downloadUrl: driver.downloadUrl || undefined,
      size: driver.size || undefined,
    }),
    []
  );

  const installDriver = useCallback(
    async (driver: DriverInfo) => {
      setInstalling(driver.id);
      setProgress(null);
      setRebootRequired(false);
      setFeedback(null);
      try {
        const result = await window.winoptimizer.drivers.install(buildRequest(driver));
        setFeedback({ ok: result.success, message: result.message });
        if (result.rebootRequired) setRebootRequired(true);
        if (result.restorePointCreated) setRestorePoint('Restore point created and verified');
        await scanDrivers(true);
      } catch (error) {
        console.error('Failed to install driver:', error);
        setFeedback({ ok: false, message: `Driver update failed: ${String(error)}` });
      } finally {
        setInstalling(null);
        setProgress(null);
      }
    },
    [buildRequest, scanDrivers]
  );

  const cancelDriver = useCallback(async (driver: DriverInfo) => {
    try {
      const result = await window.winoptimizer.drivers.cancel(driver.id);
      setFeedback({ ok: result.success, message: result.message });
    } catch (error) {
      console.error('Failed to cancel driver operation:', error);
    }
  }, []);

  const rollbackDriver = useCallback(
    async (driver: DriverInfo) => {
      if (
        !confirm(
          `Roll back ${driver.name} to the previous driver version? ` +
            'This only works for drivers this app installed (it needs a captured receipt).'
        )
      )
        return;
      setFeedback(null);
      try {
        const result = await window.winoptimizer.drivers.rollback(driver.id);
        setFeedback({ ok: result.success, message: result.message });
        await scanDrivers(true);
      } catch (error) {
        console.error('Failed to roll back driver:', error);
        setFeedback({ ok: false, message: `Rollback failed: ${String(error)}` });
      }
    },
    [scanDrivers]
  );

  const filteredDrivers = useMemo(() => {
    const list = scanResult?.drivers ?? [];
    const q = deferredQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (driver) =>
        driver.name.toLowerCase().includes(q) || driver.manufacturer.toLowerCase().includes(q)
    );
  }, [scanResult, deferredQuery]);

  const outdatedDrivers = useMemo(
    () => filteredDrivers.filter((driver) => driver.status === 'update-available'),
    [filteredDrivers]
  );
  const upToDateDrivers = useMemo(
    () => filteredDrivers.filter((driver) => driver.status !== 'update-available'),
    [filteredDrivers]
  );

  // Chunked reveal: paint the first rows instantly, grow the rest (P0.4).
  const outdatedRevealed = useChunkedReveal(outdatedDrivers.length);
  const upToDateRevealed = useChunkedReveal(upToDateDrivers.length);
  const visibleOutdated = useMemo(
    () => outdatedDrivers.slice(0, outdatedRevealed),
    [outdatedDrivers, outdatedRevealed]
  );
  const visibleUpToDate = useMemo(
    () => upToDateDrivers.slice(0, upToDateRevealed),
    [upToDateDrivers, upToDateRevealed]
  );

  const renderList = (items: DriverInfo[], outdated: boolean, testId: string) => {
    const renderItem = (driver: DriverInfo) => (
      <DriverRow
        driver={driver}
        outdated={outdated}
        isInstalling={installing === driver.id}
        progress={progress?.driverId === driver.id ? progress : null}
        onInstall={installDriver}
        onRollback={rollbackDriver}
        onCancel={cancelDriver}
      />
    );

    if (items.length > VIRTUALIZE_THRESHOLD) {
      return (
        <VirtualList
          items={items}
          estimateSize={outdated ? 74 : 62}
          getKey={(driver) => driver.id}
          renderItem={renderItem}
          testId={testId}
        />
      );
    }

    return (
      <div className="flex flex-col gap-2" data-testid={testId}>
        {items.map((driver) => (
          <div key={driver.id}>{renderItem(driver)}</div>
        ))}
      </div>
    );
  };

  return (
    <div className="page">
      <div className="flex justify-between items-center mb-6">
        <h2 className="page-title">Driver Updater</h2>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={createRestorePoint}>
            Create Restore Point
          </Button>
          <Button variant="primary" onClick={() => scanDrivers(true)} loading={scanning}>
            {scanning ? 'Scanning...' : 'Scan Drivers'}
          </Button>
        </div>
      </div>

      {scanResult && scanResult.wuStatus !== 'ok' && (
        <div className="mb-4 p-3 rounded-lg bg-secondary text-sm text-warning" role="status">
          {scanResult.wuMessage}
        </div>
      )}

      {restorePoint && (
        <div className="mb-4 p-3 rounded-lg bg-secondary text-sm text-success" role="status">
          {restorePoint}
        </div>
      )}

      {rebootRequired && (
        <div className="mb-4 p-3 rounded-lg bg-secondary text-sm text-warning" role="alert">
          A reboot is required to finish the driver update. Restart when convenient.
        </div>
      )}

      {feedback && (
        <div
          className={`mb-4 p-3 rounded-lg text-sm ${feedback.ok ? 'text-success' : 'text-warning'}`}
          role="status"
          aria-live="polite"
        >
          {feedback.message}
        </div>
      )}

      {scanning && <ScanProgress event={scanProgress} className="mb-4" />}

      {scanning && !scanResult && <SkeletonList rows={8} />}

      {scanResult && !scanning && (
        <>
          <div className="flex gap-2 mb-4 items-center">
            <Badge variant="info">{scanResult.totalDevices} devices</Badge>
            <Badge variant="warning">{scanResult.outdatedCount} outdated</Badge>
            <Badge variant="success">{scanResult.upToDateCount} up to date</Badge>
            {scanResult.unknownCount > 0 && (
              <Badge variant="info">{scanResult.unknownCount} unknown</Badge>
            )}
            <div className="ml-auto" style={{ maxWidth: 260, width: '100%' }}>
              <input
                type="search"
                className="input"
                placeholder="Filter drivers..."
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-label="Filter drivers"
              />
            </div>
          </div>

          {outdatedDrivers.length > 0 && (
            <Card title={`Outdated Drivers (${outdatedDrivers.length})`} className="mb-4">
              {renderList(visibleOutdated, true, 'outdated-drivers')}
            </Card>
          )}

          {upToDateDrivers.length > 0 && (
            <Card title={`Drivers (${upToDateDrivers.length})`}>
              {renderList(visibleUpToDate, false, 'uptodate-drivers')}
            </Card>
          )}

          {filteredDrivers.length === 0 && (
            <Card>
              <div className="text-sm text-tertiary">No drivers match “{query}”.</div>
            </Card>
          )}
        </>
      )}
    </div>
  );
};
