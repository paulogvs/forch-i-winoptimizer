import React from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';

interface SecurityIssue {
  id: string;
  title: string;
  description: string;
  severity: 'critical' | 'warning' | 'info';
  autoFixable: boolean;
}

const issues: SecurityIssue[] = [
  { id: '1', title: 'Windows Defender Real-time Protection', description: 'Real-time protection is enabled', severity: 'info', autoFixable: false },
  { id: '2', title: 'Firewall Status', description: 'Windows Firewall is active', severity: 'info', autoFixable: false },
  { id: '3', title: 'Outdated Software', description: '3 applications have available updates', severity: 'warning', autoFixable: true },
  { id: '4', title: 'Weak Password Policy', description: 'Password policy could be stronger', severity: 'critical', autoFixable: false },
];

export const Security: React.FC = () => {
  return (
    <div className="page">
      <div className="flex justify-between items-center mb-6">
        <h2 className="page-title">Security</h2>
        <Button variant="primary">Run Security Scan</Button>
      </div>

      <div className="flex gap-2 mb-6">
        <Badge variant="success">2 Protected</Badge>
        <Badge variant="warning">1 Warning</Badge>
        <Badge variant="error">1 Critical</Badge>
      </div>

      <div className="flex flex-col gap-4">
        {issues.map(issue => (
          <Card key={issue.id}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-md font-semibold text-fg-primary">{issue.title}</h3>
                  <Badge variant={issue.severity === 'critical' ? 'error' : issue.severity === 'warning' ? 'warning' : 'info'}>
                    {issue.severity}
                  </Badge>
                </div>
                <p className="text-sm text-fg-secondary">{issue.description}</p>
              </div>
              {issue.autoFixable && (
                <Button variant="secondary" size="sm">Fix</Button>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
};
