import React, { useState, useEffect } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Toggle } from '../components/ui/Toggle';
import { Badge } from '../components/ui/Badge';
import { Progress } from '../components/ui/Progress';
import type { SystemService } from '@shared/electron-api';

export const Boost: React.FC = () => {
  const [services, setServices] = useState<SystemService[]>([]);
  const [loading, setLoading] = useState(true);
  const [optimizing, setOptimizing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [selectedServices, setSelectedServices] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadServices();
  }, []);

  const loadServices = async () => {
    try {
      const result = await window.electronAPI.getSystemServices();
      setServices(result);
    } catch (error) {
      console.error('Failed to load services:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleServiceSelection = (serviceId: string) => {
    setSelectedServices((prev) => {
      const next = new Set(prev);
      if (next.has(serviceId)) {
        next.delete(serviceId);
      } else {
        next.add(serviceId);
      }
      return next;
    });
  };

  const applyOptimizations = async () => {
    if (selectedServices.size === 0) return;

    setOptimizing(true);
    setProgress(0);

    const selected = services.filter((s) => selectedServices.has(s.id));
    const total = selected.length;
    let completed = 0;

    for (const service of selected) {
      try {
        if (service.recommendedAction === 'disable') {
          await window.electronAPI.setServiceStartType(service.id, 'disabled');
          await window.electronAPI.toggleService(service.id, false);
        } else if (service.recommendedAction === 'manual') {
          await window.electronAPI.setServiceStartType(service.id, 'manual');
        }
      } catch (error) {
        console.error(`Failed to optimize service ${service.name}:`, error);
      }

      completed++;
      setProgress(Math.round((completed / total) * 100));
    }

    await loadServices();
    setSelectedServices(new Set());
    setOptimizing(false);
  };

  const optimizableServices = services.filter((s) => s.canOptimize);
  const selectedCount = selectedServices.size;

  if (loading) {
    return (
      <div className="page">
        <h2 className="page-title">Boost</h2>
        <div className="flex items-center justify-center h-64">
          <div className="text-fg-tertiary">Loading services...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="flex justify-between items-center mb-6">
        <h2 className="page-title">Boost</h2>
        <div className="flex gap-2 items-center">
          <Badge variant={selectedCount > 0 ? 'success' : 'neutral'}>
            {selectedCount} services selected
          </Badge>
          <Button
            variant="primary"
            onClick={applyOptimizations}
            disabled={selectedCount === 0}
            loading={optimizing}
          >
            {optimizing ? 'Optimizing...' : 'Apply Selected'}
          </Button>
        </div>
      </div>

      {optimizing && (
        <Progress value={progress} label="Applying optimizations..." className="mb-4" />
      )}

      <Card
        title="Optimizable Services"
        footer={
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSelectedServices(new Set(optimizableServices.map((s) => s.id)))}>
              Select All
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelectedServices(new Set())}>
              Deselect All
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          {optimizableServices.map((service) => (
            <div
              key={service.id}
              className="flex items-center justify-between p-3 rounded-lg hover:bg-bg-hover"
            >
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-fg-primary">{service.displayName}</span>
                  <Badge variant={service.protection === 'protected' ? 'error' : service.protection === 'caution' ? 'warning' : 'success'}>
                    {service.protection}
                  </Badge>
                  <Badge variant="neutral">{service.impact} impact</Badge>
                </div>
                <p className="text-xs text-fg-tertiary mt-1">{service.description}</p>
              </div>
              <div className="flex items-center gap-3">
                <Badge variant={service.status === 'running' ? 'success' : 'neutral'}>
                  {service.status}
                </Badge>
                <Toggle
                  checked={selectedServices.has(service.id)}
                  onChange={() => toggleServiceSelection(service.id)}
                  label={service.displayName}
                />
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div className="mt-6">
        <Card title="All Services">
          <div className="flex flex-col gap-2 max-h-64 overflow-y-auto">
            {services.map((service) => (
              <div
                key={service.id}
                className="flex items-center justify-between p-2 rounded-lg hover:bg-bg-hover"
              >
                <div className="flex-1">
                  <span className="text-sm text-fg-primary">{service.displayName}</span>
                  <span className="text-xs text-fg-tertiary ml-2">({service.name})</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={service.status === 'running' ? 'success' : 'neutral'}>
                    {service.status}
                  </Badge>
                  <Badge variant="neutral">{service.startType}</Badge>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
};
