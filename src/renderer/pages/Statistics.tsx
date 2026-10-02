import React from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';

export const Statistics: React.FC = () => {
  return (
    <div className="page">
      <div className="flex justify-between items-center mb-6">
        <h2 className="page-title">Statistics</h2>
        <Button variant="secondary" disabled title="CSV export is not implemented yet">
          Export CSV
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card title="CPU Usage (Last 24h)">
          <div className="h-48 flex items-center justify-center text-fg-tertiary">
            Chart placeholder — integrate Chart.js or Recharts
          </div>
        </Card>
        <Card title="Memory Usage (Last 24h)">
          <div className="h-48 flex items-center justify-center text-fg-tertiary">
            Chart placeholder — integrate Chart.js or Recharts
          </div>
        </Card>
        <Card title="Disk Activity">
          <div className="h-48 flex items-center justify-center text-fg-tertiary">
            Chart placeholder — integrate Chart.js or Recharts
          </div>
        </Card>
        <Card title="Network Traffic">
          <div className="h-48 flex items-center justify-center text-fg-tertiary">
            Chart placeholder — integrate Chart.js or Recharts
          </div>
        </Card>
      </div>
    </div>
  );
};
