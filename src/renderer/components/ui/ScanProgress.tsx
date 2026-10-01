import React from 'react';
import type { ScanProgressEvent, ScanStage } from '@shared/scan-progress';

const STAGES: { id: ScanStage; label: string }[] = [
  { id: 'discover', label: 'Discover' },
  { id: 'query', label: 'Query' },
  { id: 'parse', label: 'Parse' },
  { id: 'normalize', label: 'Normalize' },
  { id: 'done', label: 'Done' },
];

const STAGE_LABELS: Record<string, string> = {
  discover: 'Discovering',
  query: 'Querying',
  parse: 'Parsing',
  normalize: 'Normalizing',
  done: 'Done',
  error: 'Error',
};

type StepState = 'done' | 'active' | 'pending' | 'error';

interface ScanProgressProps {
  event: ScanProgressEvent | null;
  className?: string;
}

/**
 * Stage stepper + percent bar for long scans (P0.3).
 * Renders nothing until the first progress event arrives.
 */
export const ScanProgress: React.FC<ScanProgressProps> = ({ event, className }) => {
  if (!event) return null;

  const percent = Math.max(0, Math.min(100, event.percent));
  const currentIndex = STAGES.findIndex((stage) => stage.id === event.stage);
  const isError = event.stage === 'error';

  const stepState = (index: number): StepState => {
    if (isError) return 'error';
    if (index < currentIndex) return 'done';
    if (index === currentIndex) return 'active';
    return 'pending';
  };

  return (
    <div
      className={`scan-progress ${className ?? ''}`}
      role="status"
      aria-live="polite"
      data-stage={event.stage}
      data-testid="scan-progress"
    >
      <div className="scan-progress-head">
        <span className="scan-progress-stage">
          {STAGE_LABELS[event.stage] ?? event.stage}
          {event.message ? ` · ${event.message}` : ''}
        </span>
        <span className="scan-progress-percent">{percent}%</span>
      </div>

      <div className="progress">
        <div
          className={`progress-bar ${isError ? 'progress-bar-error' : 'progress-bar-primary'}`}
          style={{ width: `${percent}%` }}
        />
      </div>

      {!isError && (
        <ol className="scan-steps">
          {STAGES.map((stage, index) => (
            <li key={stage.id} className={`scan-step scan-step--${stepState(index)}`}>
              {stage.label}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
};
