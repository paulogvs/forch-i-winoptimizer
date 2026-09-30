import React from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';

interface Tool {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
}

const tools: Tool[] = [
  { id: '1', name: 'Registry Cleaner', description: 'Scan and fix registry errors', icon: '🔍', category: 'system' },
  { id: '2', name: 'Disk Defragmenter', description: 'Optimize disk performance', icon: '💽', category: 'system' },
  { id: '3', name: 'Privacy Eraser', description: 'Remove browsing history and traces', icon: '🔒', category: 'privacy' },
  { id: '4', name: 'Startup Manager', description: 'Manage startup programs', icon: '🚀', category: 'performance' },
  { id: '5', name: 'Uninstaller', description: 'Remove programs completely', icon: '🗑️', category: 'utilities' },
  { id: '6', name: 'File Shredder', description: 'Permanently delete sensitive files', icon: '🔥', category: 'privacy' },
  { id: '7', name: 'Network Optimizer', description: 'Optimize network settings', icon: '🌐', category: 'performance' },
  { id: '8', name: 'System Info', description: 'View detailed system information', icon: 'ℹ️', category: 'utilities' },
];

export const Tools: React.FC = () => {
  return (
    <div className="page">
      <h2 className="page-title mb-6">Tools</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {tools.map(tool => (
          <Card key={tool.id} hoverable>
            <div className="flex flex-col items-center text-center gap-3 p-4">
              <span className="text-3xl">{tool.icon}</span>
              <h3 className="text-md font-semibold text-fg-primary">{tool.name}</h3>
              <p className="text-sm text-fg-secondary">{tool.description}</p>
              <Button variant="secondary" size="sm">Open</Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
};
