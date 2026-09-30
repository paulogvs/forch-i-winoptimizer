import React from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Progress } from '../components/ui/Progress';
import { Badge } from '../components/ui/Badge';

export const Dashboard: React.FC = () => {
  return (
    <div className="page">
      <h2 className="page-title">Dashboard</h2>

      <div className="grid grid-cols-1 md:grid-cols-3 mb-6">
        <Card>
          <div className="kpi-card">
            <span className="kpi-label">CPU Usage</span>
            <span className="kpi-value">45<span className="kpi-unit">%</span></span>
            <Progress value={45} variant="primary" />
          </div>
        </Card>
        <Card>
          <div className="kpi-card">
            <span className="kpi-label">Memory</span>
            <span className="kpi-value">8.2<span className="kpi-unit">GB</span></span>
            <Progress value={68} variant="warning" />
          </div>
        </Card>
        <Card>
          <div className="kpi-card">
            <span className="kpi-label">Disk</span>
            <span className="kpi-value">256<span className="kpi-unit">GB</span></span>
            <Progress value={52} variant="success" />
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card title="Quick Actions">
          <div className="flex gap-3 flex-wrap">
            <Button variant="primary">Scan Now</Button>
            <Button variant="secondary">Clean Junk</Button>
            <Button variant="secondary">Optimize</Button>
          </div>
        </Card>
        <Card title="System Status">
          <div className="flex gap-2 flex-wrap">
            <Badge variant="success">Protected</Badge>
            <Badge variant="info">Up to date</Badge>
            <Badge variant="warning">3 issues</Badge>
          </div>
        </Card>
      </div>
    </div>
  );
};
