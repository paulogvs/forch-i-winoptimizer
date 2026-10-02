import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { SkeletonList } from '../components/ui/Skeleton';
import type { TweakCategory, TweakOperation, TweakView } from '@shared/tweaks';
import { useOperationStatus } from '../hooks/useOperationStatus';

type ActionState = 'idle' | 'working' | 'done' | 'error';

const CATEGORY_LABELS: Record<TweakCategory, string> = {
  performance: 'Performance',
  privacy: 'Privacy',
  explorer: 'Explorer',
  accessibility: 'Accessibility',
};

const CATEGORY_ORDER: TweakCategory[] = ['performance', 'privacy', 'explorer', 'accessibility'];

function describeOperation(op: TweakOperation): string {
  switch (op.kind) {
    case 'registry': {
      const target = `${op.hive}\\${op.path}\\${op.name}`;
      return op.removeOnRevert
        ? `Delete  ${target}`
        : `Set  ${target} = ${String(op.value)} (${op.type})`;
    }
    case 'service':
      return `Service  ${op.serviceName}: ${[op.startType, op.state].filter(Boolean).join(' / ') || 'no change'}`;
    case 'scheduled-task':
      return `${op.disable ? 'Disable' : 'Enable'} task  ${op.taskPath}${op.taskName}`;
    case 'info':
      return op.detail;
    default:
      return 'Unknown operation';
  }
}

export const Tweaks: React.FC = () => {
  const operation = useOperationStatus();
  const [tweaks, setTweaks] = useState<TweakView[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [actionState, setActionState] = useState<Record<string, ActionState>>({});
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<TweakView | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const loadTweaks = useCallback(async () => {
    setLoading(true);
    try {
      const list = await window.winoptimizer.tweaks.get();
      setTweaks(list);
    } catch (error) {
      console.error('Failed to load tweaks:', error);
      setBanner('Failed to load tweaks.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTweaks();
  }, [loadTweaks]);

  const grouped = useMemo(() => {
    const map = new Map<TweakCategory, TweakView[]>();
    for (const category of CATEGORY_ORDER) map.set(category, []);
    for (const tweak of tweaks) {
      const bucket = map.get(tweak.category);
      if (bucket) bucket.push(tweak);
      else map.set(tweak.category, [tweak]);
    }
    return map;
  }, [tweaks]);

  const isInfoOnly = useCallback(
    (tweak: TweakView) => tweak.apply.every((op) => op.kind === 'info'),
    []
  );

  const toggleSelected = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const runSingle = useCallback(
    async (tweak: TweakView, action: 'apply' | 'restore') => {
      setActionState((prev) => ({ ...prev, [tweak.id]: 'working' }));
      setMessages((prev) => ({ ...prev, [tweak.id]: '' }));
      try {
        const result =
          action === 'apply'
            ? await window.winoptimizer.tweaks.apply(tweak.id)
            : await window.winoptimizer.tweaks.restore(tweak.id);
        setActionState((prev) => ({ ...prev, [tweak.id]: result.success ? 'done' : 'error' }));
        setMessages((prev) => ({ ...prev, [tweak.id]: result.message }));
        await loadTweaks();
      } catch (error) {
        setActionState((prev) => ({ ...prev, [tweak.id]: 'error' }));
        setMessages((prev) => ({ ...prev, [tweak.id]: String(error) }));
      }
    },
    [loadTweaks]
  );

  const runSelected = useCallback(
    async (action: 'apply' | 'restore') => {
      const ids = Array.from(selected).filter((id) => {
        const tweak = tweaks.find((t) => t.id === id);
        if (!tweak) return false;
        if (isInfoOnly(tweak)) return false;
        return action === 'apply' ? !tweak.applied : tweak.applied;
      });
      if (ids.length === 0) {
        setBanner('Select at least one tweak that can be applied/restored.');
        return;
      }
      setActionState((prev) => {
        const next = { ...prev };
        for (const id of ids) next[id] = 'working';
        return next;
      });
      try {
        const results =
          action === 'apply'
            ? await window.winoptimizer.tweaks.applyMany(ids)
            : await window.winoptimizer.tweaks.restoreMany(ids);
        setActionState((prev) => {
          const next = { ...prev };
          for (const r of results) next[r.id] = r.success ? 'done' : 'error';
          return next;
        });
        setMessages((prev) => {
          const next = { ...prev };
          for (const r of results) next[r.id] = r.message;
          return next;
        });
        const failed = results.filter((r) => !r.success).length;
        setBanner(
          failed === 0 ? `${results.length} tweak(s) processed.` : `${failed} tweak(s) failed.`
        );
        setSelected(new Set());
        await loadTweaks();
      } catch (error) {
        console.error('Batch tweak action failed:', error);
        setBanner(`Batch action failed: ${String(error)}`);
      }
    },
    [selected, tweaks, isInfoOnly, loadTweaks]
  );

  const renderTweak = (tweak: TweakView) => {
    const infoOnly = isInfoOnly(tweak);
    const state = actionState[tweak.id] ?? 'idle';
    return (
      <Card key={tweak.id} className="tweak-card">
        <div className="tweak-row">
          {!infoOnly && (
            <input
              type="checkbox"
              className="tweak-check"
              checked={selected.has(tweak.id)}
              onChange={() => toggleSelected(tweak.id)}
              aria-label={`Select ${tweak.name}`}
            />
          )}
          <div className="tweak-body">
            <div className="tweak-title-row">
              <span className="tweak-name">{tweak.name}</span>
              <Badge variant={tweak.safety === 'safe' ? 'success' : 'warning'}>
                {tweak.safety === 'safe' ? 'Safe' : 'Advanced'}
              </Badge>
              <Badge variant={tweak.applied ? 'success' : 'neutral'}>
                {tweak.applied ? 'Applied' : 'Not applied'}
              </Badge>
              <Badge variant="info">Reversible: Yes</Badge>
              <Badge variant="neutral">{tweak.impact} impact</Badge>
              {infoOnly && <Badge variant="info">Informational</Badge>}
            </div>
            <p className="tweak-description">{tweak.description}</p>
            {tweak.note && <p className="tweak-note">{tweak.note}</p>}
            {messages[tweak.id] && (
              <p className={`tweak-message tweak-message--${state}`}>{messages[tweak.id]}</p>
            )}
          </div>
          <div className="tweak-actions">
            <Button variant="ghost" size="sm" onClick={() => setPreview(tweak)}>
              Preview
            </Button>
            {!infoOnly && !tweak.applied && (
              <Button
                variant="primary"
                size="sm"
                loading={state === 'working'}
                disabled={operation.busy}
                onClick={() => runSingle(tweak, 'apply')}
              >
                Apply
              </Button>
            )}
            {!infoOnly && tweak.applied && (
              <Button
                variant="secondary"
                size="sm"
                loading={state === 'working'}
                disabled={operation.busy}
                onClick={() => runSingle(tweak, 'restore')}
              >
                Restore
              </Button>
            )}
          </div>
        </div>
      </Card>
    );
  };

  const selectedCount = selected.size;

  return (
    <div className="page">
      <div className="flex justify-between items-center mb-4">
        <h2 className="page-title">Tweaks</h2>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={loadTweaks} loading={loading}>
            Refresh
          </Button>
          <Button
            variant="primary"
            onClick={() => runSelected('apply')}
            disabled={selectedCount === 0 || operation.busy}
          >
            Apply selected ({selectedCount})
          </Button>
          <Button
            variant="secondary"
            onClick={() => runSelected('restore')}
            disabled={selectedCount === 0 || operation.busy}
          >
            Restore selected
          </Button>
        </div>
      </div>

      <p className="tweak-intro">
        A curated set of <strong>safe, reversible</strong> tweaks. Nothing is applied automatically
        and every change can be restored to its previous state.
      </p>

      {banner && <div className="tweak-banner mb-4">{banner}</div>}

      {loading && tweaks.length === 0 ? (
        <SkeletonList rows={6} />
      ) : (
        CATEGORY_ORDER.map((category) => {
          const items = grouped.get(category) ?? [];
          if (items.length === 0) return null;
          return (
            <section key={category} className="tweak-section">
              <h3 className="tweak-section-title">{CATEGORY_LABELS[category]}</h3>
              <div className="flex flex-col gap-3">{items.map(renderTweak)}</div>
            </section>
          );
        })
      )}

      <Modal
        open={preview !== null}
        onClose={() => setPreview(null)}
        title={`Preview — ${preview?.name ?? ''}`}
      >
        {preview && (
          <div className="tweak-preview">
            <p className="tweak-preview-label">This will apply:</p>
            <ul className="tweak-preview-list">
              {preview.apply.map((op, i) => (
                <li key={`a-${i}`}>{describeOperation(op)}</li>
              ))}
            </ul>
            <p className="tweak-preview-label">Restore will revert with:</p>
            <ul className="tweak-preview-list">
              {preview.revert.map((op, i) => (
                <li key={`r-${i}`}>{describeOperation(op)}</li>
              ))}
            </ul>
          </div>
        )}
      </Modal>
    </div>
  );
};
