import React, { useState } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Toggle } from '../components/ui/Toggle';
import { Badge } from '../components/ui/Badge';

interface BoostOption {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
  impact: 'low' | 'medium' | 'high';
}

export const Boost: React.FC = () => {
  const [options, setOptions] = useState<BoostOption[]>([
    { id: '1', label: 'Disable startup apps', description: 'Prevent unnecessary apps from starting with Windows', enabled: false, impact: 'high' },
    { id: '2', label: 'Optimize system services', description: 'Disable non-essential Windows services', enabled: false, impact: 'medium' },
    { id: '3', label: 'Clear memory', description: 'Free up RAM by clearing unused memory', enabled: false, impact: 'low' },
    { id: '4', label: 'Disable visual effects', description: 'Reduce animations for better performance', enabled: false, impact: 'medium' },
  ]);

  const toggleOption = (id: string) => {
    setOptions(options.map(o => o.id === id ? { ...o, enabled: !o.enabled } : o));
  };

  const enabledCount = options.filter(o => o.enabled).length;

  return (
    <div className="page">
      <div className="flex justify-between items-center mb-6">
        <h2 className="page-title">Boost</h2>
        <div className="flex gap-2 items-center">
          <Badge variant={enabledCount > 0 ? 'success' : 'neutral'}>
            {enabledCount} optimizations ready
          </Badge>
          <Button variant="primary" disabled={enabledCount === 0}>
            Apply All
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {options.map(option => (
          <Card key={option.id}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-md font-semibold text-fg-primary mb-1">{option.label}</h3>
                <p className="text-sm text-fg-secondary">{option.description}</p>
              </div>
              <Toggle
                checked={option.enabled}
                onChange={() => toggleOption(option.id)}
                label={option.label}
              />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
};
