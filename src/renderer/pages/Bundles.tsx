import React, { useState, useEffect } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Progress } from '../components/ui/Progress';
import type { AppBundle } from '@shared/types';
import { useOperationStatus } from '../hooks/useOperationStatus';

export const Bundles: React.FC = () => {
  const operation = useOperationStatus();
  const [bundles, setBundles] = useState<AppBundle[]>([]);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState<string | null>(null);
  const [selectedApps, setSelectedApps] = useState<Set<string>>(new Set());
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    loadBundles();
  }, []);

  const loadBundles = async () => {
    setLoading(true);
    try {
      const result = await window.winoptimizer.bundles.get();
      setBundles(result);

      // Check which apps are installed
      const installed = await window.winoptimizer.bundles.checkInstalled();
      // Update bundles with installation status
      setBundles((prev) =>
        prev.map((bundle) => ({
          ...bundle,
          apps: bundle.apps.map((app) => ({
            ...app,
            isInstalled: installed.get(app.id) ?? false,
          })),
        }))
      );
    } catch (error) {
      console.error('Failed to load bundles:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleAppSelection = (appId: string) => {
    setSelectedApps((prev) => {
      const next = new Set(prev);
      if (next.has(appId)) {
        next.delete(appId);
      } else {
        next.add(appId);
      }
      return next;
    });
  };

  const installSelected = async () => {
    if (selectedApps.size === 0) return;

    const wingetIds = bundles
      .flatMap((b) => b.apps)
      .filter((a) => selectedApps.has(a.id))
      .map((a) => a.wingetId);

    setInstalling('selected');
    setFeedback(null);

    try {
      // Fase 0.5: no cosmetic progress — indeterminate until the backend
      // resolves with its verified per-package result.
      const result = await window.winoptimizer.bundles.installMultiple(wingetIds);
      setFeedback({ ok: result.success, message: result.message });
      await loadBundles();
      setSelectedApps(new Set());
    } catch (error) {
      console.error('Failed to install apps:', error);
      setFeedback({ ok: false, message: `Install failed: ${String(error)}` });
    } finally {
      setInstalling(null);
    }
  };

  const installApp = async (wingetId: string, appId: string) => {
    setInstalling(appId);
    setFeedback(null);
    try {
      const result = await window.winoptimizer.bundles.install(wingetId);
      setFeedback({ ok: result.success, message: result.message });
      await loadBundles();
    } catch (error) {
      console.error('Failed to install app:', error);
      setFeedback({ ok: false, message: `Install failed: ${String(error)}` });
    } finally {
      setInstalling(null);
    }
  };

  if (loading) {
    return (
      <div className="page">
        <h2 className="page-title">App Bundles</h2>
        <div className="flex items-center justify-center h-64">
          <div className="text-fg-tertiary">Loading bundles...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="flex justify-between items-center mb-6">
        <h2 className="page-title">App Bundles</h2>
        <div className="flex gap-2 items-center">
          <Badge variant="info">{selectedApps.size} selected</Badge>
          <Button
            variant="primary"
            onClick={installSelected}
            disabled={selectedApps.size === 0 || operation.busy}
            loading={installing === 'selected'}
          >
            Install Selected
          </Button>
        </div>
      </div>

      {installing === 'selected' && (
        <Progress indeterminate label="Installing apps..." className="mb-4" />
      )}

      {feedback && (
        <div
          role="status"
          aria-live="polite"
          className={`mb-4 p-3 rounded-lg text-sm ${feedback.ok ? 'text-success' : 'text-error'}`}
        >
          {feedback.message}
        </div>
      )}

      <div className="flex flex-col gap-6">
        {bundles.map((bundle) => (
          <Card
            key={bundle.id}
            title={`${bundle.icon} ${bundle.name}`}
            footer={<div className="text-sm text-fg-secondary">{bundle.description}</div>}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {bundle.apps.map((app) => (
                <div
                  key={app.id}
                  className={`p-3 rounded-lg border-2 transition-colors cursor-pointer ${
                    selectedApps.has(app.id)
                      ? 'border-info bg-info-muted'
                      : 'border-transparent hover:bg-bg-hover'
                  }`}
                  onClick={() => toggleAppSelection(app.id)}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-fg-primary">{app.name}</span>
                    {app.isInstalled && <Badge variant="success">Installed</Badge>}
                  </div>
                  <p className="text-xs text-fg-tertiary mb-2">{app.description}</p>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-fg-secondary">{app.wingetId}</span>
                    {!app.isInstalled && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          installApp(app.wingetId, app.id);
                        }}
                        loading={installing === app.id}
                        disabled={operation.busy}
                      >
                        Install
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
};
