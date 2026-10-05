import React, { useCallback, useMemo, useState } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { SkeletonList } from '../components/ui/Skeleton';
import { ScanProgress } from '../components/ui/ScanProgress';
import { VirtualList } from '../components/ui/VirtualList';
import { useScanProgress } from '../hooks/useScanProgress';
import { formatBytes } from '../utils/format';
import type { JunkScanResult } from '@shared/electron-api';
import type { DeleteReceipt } from '@shared/cleanup';

interface JunkFileWithSelection {
  id: string;
  name: string;
  path: string;
  size: number;
  category: string;
  lastModified: Date;
  safeToDelete: boolean;
  selected: boolean;
}

/** Lists larger than this are virtualized (same rule as Tools/Drivers). */
const VIRTUALIZE_THRESHOLD = 50;

interface FileRowProps {
  file: JunkFileWithSelection;
  onToggle: (id: string) => void;
}

const FileRow = React.memo(function FileRow({ file, onToggle }: FileRowProps) {
  return (
    <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-hover">
      <input
        type="checkbox"
        checked={file.selected}
        onChange={() => onToggle(file.id)}
        className="w-4 h-4"
        aria-label={`Select ${file.name}`}
      />
      <div className="flex-1">
        <div className="text-sm font-medium text-primary">{file.name}</div>
        <div className="text-xs text-tertiary font-mono">{file.path}</div>
      </div>
      <Badge variant="info">{file.category}</Badge>
      <span className="text-sm text-secondary font-mono">{formatBytes(file.size)}</span>
    </div>
  );
});

export const Cleaner: React.FC = () => {
  const [scanning, setScanning] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [files, setFiles] = useState<JunkFileWithSelection[]>([]);
  const [scanned, setScanned] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedReceipts, setFailedReceipts] = useState<DeleteReceipt[]>([]);
  const progress = useScanProgress('junk');

  const handleScan = useCallback(async () => {
    setScanning(true);
    setError(null);
    try {
      const result: JunkScanResult = await window.electronAPI.scanForJunkFiles({ force: true });
      const filesWithSelection = result.files.map((f) => ({ ...f, selected: f.safeToDelete }));
      setFiles(filesWithSelection);
      setScanned(true);
    } catch (scanError) {
      console.error('Scan failed:', scanError);
      setError('The scan could not be completed. Please try again.');
    } finally {
      setScanning(false);
    }
  }, []);

  const handleClean = useCallback(async () => {
    setCleaning(true);
    setError(null);
    try {
      const selectedFiles = files.filter((f) => f.selected);
      if (selectedFiles.length === 0) return;
      const result = await window.electronAPI.deleteFiles(selectedFiles.map((f) => f.path));
      // Fase 4.6: keep the per-file receipts so the UI can explain WHY a
      // delete failed (in-use, permissions, ...) instead of an opaque count.
      setFailedReceipts((result.receipts ?? []).filter((r) => !r.deleted));
      if (result.success) {
        setFiles((prev) => prev.filter((f) => !f.selected));
      } else {
        // Fase 0.3: on failure the files STAY visible so the user can see
        // what was not removed and retry. Hiding them would lie about the
        // real (unverified) effect.
        setError(
          `Some files could not be removed (${result.failed} failed). The files are still listed below — fix the cause and retry.`
        );
      }
    } catch (cleanError) {
      console.error('Clean failed:', cleanError);
      setError('Cleaning failed. The files are still listed below — please try again.');
    } finally {
      setCleaning(false);
    }
  }, [files]);

  const handleRetryFailed = useCallback(async () => {
    setCleaning(true);
    setError(null);
    try {
      const result = await window.electronAPI.retryFailedFiles();
      const stillFailed = result.receipts.filter((r) => !r.deleted);
      setFailedReceipts(stillFailed);
      const removedPaths = new Set(result.receipts.filter((r) => r.deleted).map((r) => r.path));
      if (removedPaths.size > 0) {
        setFiles((prev) => prev.filter((f) => !removedPaths.has(f.path)));
      }
      if (stillFailed.length > 0) {
        setError(`Still ${stillFailed.length} file(s) could not be removed.`);
      }
    } catch (retryError) {
      console.error('Retry failed:', retryError);
      setError('Retry failed. The files are still listed below — please try again.');
    } finally {
      setCleaning(false);
    }
  }, []);

  const toggleFile = useCallback((id: string) => {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, selected: !f.selected } : f)));
  }, []);

  const selectedSize = useMemo(
    () => files.filter((f) => f.selected).reduce((sum, f) => sum + f.size, 0),
    [files]
  );

  return (
    <div className="page">
      <div className="flex justify-between items-center mb-6">
        <h2 className="page-title">Cleaner</h2>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={handleScan} loading={scanning}>
            {scanning ? 'Scanning...' : 'Scan'}
          </Button>
          <Button
            variant="primary"
            onClick={handleClean}
            loading={cleaning}
            disabled={files.length === 0}
          >
            Clean ({selectedSize > 0 ? formatBytes(selectedSize) : '0 B'})
          </Button>
        </div>
      </div>

      {scanning && <ScanProgress event={progress} className="mb-4" />}
      {scanning && files.length === 0 && <SkeletonList rows={8} />}

      {error && (
        <div className="mb-4 p-3 rounded-lg text-sm text-error" role="alert">
          <span>{error}</span>
          {failedReceipts.length > 0 && (
            <ul className="mt-2 text-xs" data-testid="cleaner-failures">
              {failedReceipts.map((receipt) => (
                <li key={receipt.path} className="truncate">
                  {receipt.path} — <strong>{receipt.reason ?? 'unknown'}</strong>
                  {receipt.message ? `: ${receipt.message}` : ''}
                </li>
              ))}
            </ul>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={failedReceipts.length > 0 ? handleRetryFailed : handleClean}
            loading={cleaning}
            disabled={files.length === 0}
          >
            {failedReceipts.length > 0 ? 'Retry failed files' : 'Retry cleaning'}
          </Button>
        </div>
      )}

      {!scanning && files.length === 0 && (
        <EmptyState
          title={scanned ? 'No junk files found' : 'Ready to scan'}
          description={
            scanned
              ? 'Your system is already clean. Run a scan again after using your PC for a while.'
              : 'Run a scan to find temporary files, caches, and other junk that can be safely removed.'
          }
          actionLabel={scanned ? 'Scan Again' : 'Scan Now'}
          onAction={handleScan}
        />
      )}

      {files.length > 0 && (
        <Card>
          {/* Fase 1.5: scans can return thousands of files (MAX_FILES_PER_TARGET
              is 5000 per target). Past the shared threshold the same VirtualList
              as Tools/Drivers bounds the DOM instead of rendering N rows. */}
          {files.length > VIRTUALIZE_THRESHOLD ? (
            <VirtualList
              items={files}
              estimateSize={56}
              getKey={(file) => file.id}
              renderItem={(file) => <FileRow file={file} onToggle={toggleFile} />}
              maxHeight={480}
              testId="cleaner-files"
            />
          ) : (
            <div className="flex flex-col gap-2">
              {files.map((file) => (
                <FileRow key={file.id} file={file} onToggle={toggleFile} />
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
};
