import React, { useState } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Progress } from '../components/ui/Progress';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';

interface JunkFile {
  id: string;
  name: string;
  path: string;
  size: number;
  category: string;
  selected: boolean;
}

export const Cleaner: React.FC = () => {
  const [scanning, setScanning] = useState(false);
  const [files, setFiles] = useState<JunkFile[]>([]);

  const handleScan = () => {
    setScanning(true);
    // TODO: Call IPC to scan for junk files
    setTimeout(() => {
      setFiles([
        { id: '1', name: 'temp1234.tmp', path: 'C:\\Users\\User\\AppData\\Local\\Temp', size: 2048000, category: 'temp', selected: true },
        { id: '2', name: 'update.cab', path: 'C:\\Windows\\SoftwareDistribution', size: 157286400, category: 'windows-update', selected: true },
      ]);
      setScanning(false);
    }, 1500);
  };

  const handleClean = () => {
    // TODO: Call IPC to delete selected files
    setFiles([]);
  };

  const toggleFile = (id: string) => {
    setFiles(files.map(f => f.id === id ? { ...f, selected: !f.selected } : f));
  };

  const selectedSize = files.filter(f => f.selected).reduce((sum, f) => sum + f.size, 0);

  return (
    <div className="page">
      <div className="flex justify-between items-center mb-6">
        <h2 className="page-title">Cleaner</h2>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={handleScan} loading={scanning}>
            {scanning ? 'Scanning...' : 'Scan'}
          </Button>
          <Button variant="primary" onClick={handleClean} disabled={files.length === 0}>
            Clean ({selectedSize > 0 ? `${(selectedSize / 1024 / 1024).toFixed(1)} MB` : '0 MB'})
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
            {files.map(file => (
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
                  {(file.size / 1024 / 1024).toFixed(1)} MB
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
};
