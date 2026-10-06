import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { SkeletonList } from '../components/ui/Skeleton';
import type { PresetMode, TweakCategory, TweakOperation, TweakView } from '@shared/tweaks';
import { safetyWarning } from '@shared/safety';
import { useOperationStatus } from '../hooks/useOperationStatus';

type ActionState = 'idle' | 'working' | 'done' | 'error';

const CATEGORY_LABELS: Record<TweakCategory, string> = {
  performance: 'Performance',
  privacy: 'Privacy',
  explorer: 'Explorer',
  accessibility: 'Accessibility',
  system: 'System',
};

const CATEGORY_ORDER: TweakCategory[] = [
  'performance',
  'privacy',
  'explorer',
  'accessibility',
  'system',
];

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

interface PresetControlsProps {
  preset: TweakView;
  children: TweakView[];
  busy: boolean;
  onResult: (results: { id: string; success: boolean; message: string }[]) => void;
  onBanner: (message: string) => void;
}

const PRESET_MODES: { value: PresetMode; label: string; hint: string }[] = [
  { value: 'deny', label: 'Deny all', hint: 'Applies every child tweak.' },
  { value: 'allow', label: 'Allow all', hint: 'Restores every child tweak.' },
  { value: 'custom', label: 'Custom', hint: 'Applies only the selected children.' },
];

/** Allow/Deny/Custom controls for a master preset (A1). */
const PresetControls: React.FC<PresetControlsProps> = ({
  preset,
  children,
  busy,
  onResult,
  onBanner,
}) => {
  const [mode, setMode] = useState<PresetMode>('deny');
  const [selection, setSelection] = useState<Set<string>>(
    () => new Set((preset.children ?? []).filter((id) => children.some((c) => c.id === id)))
  );
  const [working, setWorking] = useState(false);

  const toggleChild = useCallback((id: string) => {
    setSelection((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const run = useCallback(async () => {
    setWorking(true);
    try {
      const picked = mode === 'custom' ? Array.from(selection) : [];
      const results = await window.winoptimizer.tweaks.applyPreset(preset.id, mode, picked);
      onResult(results);
      const failed = results.filter((r) => !r.success).length;
      onBanner(
        failed === 0
          ? `Preset "${preset.name}" processed (${results.length} tweak(s)).`
          : `${failed} preset tweak(s) failed.`
      );
    } catch (error) {
      onBanner(`Preset action failed: ${String(error)}`);
    } finally {
      setWorking(false);
    }
  }, [mode, selection, preset.id, preset.name, onResult, onBanner]);

  return (
    <div className="tweak-preset" data-testid={`preset-controls-${preset.id}`}>
      <div className="tweak-preset-modes" role="radiogroup" aria-label={`${preset.name} mode`}>
        {PRESET_MODES.map((option) => (
          <label key={option.value} className="tweak-preset-mode" title={option.hint}>
            <input
              type="radio"
              name={`preset-mode-${preset.id}`}
              value={option.value}
              checked={mode === option.value}
              onChange={() => setMode(option.value)}
              aria-label={option.label}
            />
            {option.label}
          </label>
        ))}
      </div>
      {mode === 'custom' ? (
        <ul className="tweak-preset-children">
          {children.map((child) => (
            <li key={child.id}>
              <label>
                <input
                  type="checkbox"
                  checked={selection.has(child.id)}
                  onChange={() => toggleChild(child.id)}
                  aria-label={`Preset child ${child.name}`}
                />
                {child.name}
                <Badge variant={child.applied ? 'success' : 'neutral'}>
                  {child.applied ? 'Applied' : 'Not applied'}
                </Badge>
              </label>
            </li>
          ))}
        </ul>
      ) : (
        <p className="tweak-note">
          {children.length} child tweak(s): {children.map((c) => c.name).join(', ')}
        </p>
      )}
      <Button
        variant="primary"
        size="sm"
        loading={working}
        disabled={busy || (mode === 'custom' && children.length === 0)}
        onClick={run}
      >
        {mode === 'allow' ? 'Allow all' : mode === 'deny' ? 'Deny all' : 'Apply custom'}
      </Button>
    </div>
  );
};

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

  const handlePresetResult = useCallback(
    (results: { id: string; success: boolean; message: string }[]) => {
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
      loadTweaks();
    },
    [loadTweaks]
  );

  const previewOps = useMemo(() => {
    if (!preview) return null;
    // A preset previews as the union of its children's operations.
    if (preview.kind === 'preset' && preview.children) {
      const kids = preview.children
        .map((id) => tweaks.find((t) => t.id === id))
        .filter((t): t is TweakView => Boolean(t));
      return {
        apply: kids.flatMap((k) => k.apply),
        revert: kids.flatMap((k) => k.revert),
        names: kids.map((k) => k.name),
      };
    }
    return { apply: preview.apply, revert: preview.revert, names: [] as string[] };
  }, [preview, tweaks]);

  const renderTweak = (tweak: TweakView) => {
    const preset = tweak.kind === 'preset';
    const infoOnly = !preset && isInfoOnly(tweak);
    const state = actionState[tweak.id] ?? 'idle';
    const warning = tweak.risk
      ? safetyWarning({
          safety: tweak.safety,
          risk: tweak.risk,
          safetyNote: tweak.safetyNote ?? '',
        })
      : null;
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
              {preset && <Badge variant="info">Preset</Badge>}
            </div>
            <p className="tweak-description">{tweak.description}</p>
            {preset && (
              <PresetControls
                preset={tweak}
                children={(tweak.children ?? [])
                  .map((id) => tweaks.find((t) => t.id === id))
                  .filter((t): t is TweakView => Boolean(t))}
                busy={operation.busy}
                onResult={handlePresetResult}
                onBanner={setBanner}
              />
            )}
            {tweak.note && <p className="tweak-note">{tweak.note}</p>}
            {warning && (
              <p
                className="tweak-note tweak-warning"
                role="note"
                data-testid={`tweak-warning-${tweak.id}`}
              >
                ⚠ {warning}
              </p>
            )}
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
        {preview && previewOps && (
          <div className="tweak-preview">
            {previewOps.names.length > 0 && (
              <p className="tweak-preview-label">Preset children: {previewOps.names.join(', ')}</p>
            )}
            <p className="tweak-preview-label">This will apply:</p>
            <ul className="tweak-preview-list">
              {previewOps.apply.map((op, i) => (
                <li key={`a-${i}`}>{describeOperation(op)}</li>
              ))}
            </ul>
            <p className="tweak-preview-label">Restore will revert with:</p>
            <ul className="tweak-preview-list">
              {previewOps.revert.map((op, i) => (
                <li key={`r-${i}`}>{describeOperation(op)}</li>
              ))}
            </ul>
          </div>
        )}
      </Modal>
    </div>
  );
};
