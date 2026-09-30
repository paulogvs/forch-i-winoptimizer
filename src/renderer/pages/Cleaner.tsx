import React, { useState } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Progress } from '../components/ui/Progress';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { formatBytes } from '../utils/format';
import type { JunkScanResult } from '@shared/electron-api';

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

export const Cleaner: React.FC = () => {
  const [scanning, setScanning] = useState(false);
  const [files, setFiles] = useState<JunkFileWithSelection[]>([]);

  const handleScan = async () => {
    setScanning(true);
    try {
      const result: JunkScanResult = await window.electronAPI.scanForJunkFiles();
      const filesWithSelection = result.files.map((f) => ({
        ...f,
        selected: f.safeToDelete,
      }));
      setFiles(filesWithSelection);
    } catch (error) {
      console.error('Scan failed:', error);
    } finally {
      setScanning(false);
    }
  };

  const handleClean = async () => {
    const selectedFiles = files.filter((f) => f.selected);
    if (selectedFiles.length === 0) return;

    try {
      const result = await window.electronAPI.deleteFiles(
        selectedFiles.map((f) => f.path)
      );
      if (result.success) {
        setFiles((prev) => prev.filter((f) => !f.selected));
      }
    } catch (error) {
      console.error('Clean failed:', error);
    }
  };

  const toggleFile = (id: string) => {
    setFiles(files.map((f) => (f.id === id ? { ...f, selected: !f.selected } : f)));
  };

  const selectedSize = files.filter((f) => f.selected).reduce((sum, f) => sum + f.size, 0);

  return (
    <div className="page">
      <div className="flex justify-between items-center mb-6">
        <h2 className="page-title">Cleaner</h2>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={handleScan} loading={scanning}>
            {scanning ? 'Scanning...' : 'Scan'}
          </Button>
          <Button variant="primary" onClick={handleClean} disabled={files.length === 0}>
            Clean ({selectedSize > 0 ? `${formatBytes(selectedSize)}` : '0 B'})
          </Button>
        </div>
      </div>

      {scanning && <Progress value={60} label="Scanning..." className="mb-4" />}

      {files.length === 0 && !scanning && (
        <EmptyState
          title="No junk files found"
          description="Run a scan to find temporary files, caches, and other junk that can be safely removed."
          actionLabel="Scan Now"
          onAction={handleScan}
        />
      )}

      {files.length > 0 && (
        <Card>
          <div className="flex flex-col gap-2">
            {files.map((file) => (
              <div key={file.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-bg-hover">
                <input
                  type="checkbox"
                  checked={file.selected}
                  onChange={() => toggleFile(file.id)}
                  className="w-4 h-4"
                />
                <div className="flex-1">
                  <div className="text-sm font-medium text-fg-primary">{file.name}</div>
                  <div className="text-xs text-fg-tertiary font-mono">{file.path}</div>
                </div>
                <Badge variant="info">{file.category}</Badge>
                <span className="text-sm text-fg-secondary font-mono">
                  {formatBytes(file.size)}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
};
