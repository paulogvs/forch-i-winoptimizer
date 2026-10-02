import React from 'react';

export interface BarDatum {
  label: string;
  value: number;
}

export interface BarChartProps {
  data: BarDatum[];
  /** Screen-reader description of the whole series. */
  ariaLabel: string;
  /** Formats a value for the tooltip / accessible list. */
  formatValue?: (value: number) => string;
  height?: number;
  emptyMessage?: string;
  testId?: string;
  /** Chart token, defaults to the accent colour. */
  color?: string;
}

const VIEW_W = 600;
const PAD_LEFT = 8;
const PAD_RIGHT = 8;
const PAD_TOP = 12;
const PAD_BOTTOM = 28;

/**
 * Hand-rolled SVG bar chart (the app deliberately ships no chart library).
 * Colour is never the only channel: every bar carries a value label and the
 * series is mirrored as an accessible list for screen readers.
 */
export const BarChart: React.FC<BarChartProps> = ({
  data,
  ariaLabel,
  formatValue = (value) => String(value),
  height = 200,
  emptyMessage = 'No data recorded yet.',
  testId,
  color = 'var(--color-chart-primary)',
}) => {
  if (data.length === 0) {
    return (
      <div
        data-testid={testId}
        className="h-48 flex items-center justify-center text-fg-tertiary text-sm"
      >
        {emptyMessage}
      </div>
    );
  }

  const viewH = 200;
  const plotW = VIEW_W - PAD_LEFT - PAD_RIGHT;
  const plotH = viewH - PAD_TOP - PAD_BOTTOM;
  const max = Math.max(...data.map((d) => d.value), 1);
  const slot = plotW / data.length;
  const barW = Math.max(2, Math.min(48, slot * 0.6));

  // Keep at most ~7 x labels so narrow charts stay readable.
  const labelStep = Math.max(1, Math.ceil(data.length / 7));

  return (
    <div data-testid={testId} role="img" aria-label={ariaLabel}>
      <svg
        viewBox={`0 0 ${VIEW_W} ${viewH}`}
        className="w-full"
        style={{ height }}
        preserveAspectRatio="none"
        focusable="false"
        aria-hidden="true"
      >
        {[0, 0.5, 1].map((ratio) => {
          const y = PAD_TOP + plotH * ratio;
          return (
            <line
              key={ratio}
              x1={PAD_LEFT}
              x2={VIEW_W - PAD_RIGHT}
              y1={y}
              y2={y}
              stroke="var(--color-chart-grid)"
              strokeWidth={1}
            />
          );
        })}

        {data.map((datum, index) => {
          const barH = (datum.value / max) * plotH;
          const x = PAD_LEFT + index * slot + (slot - barW) / 2;
          const y = PAD_TOP + plotH - barH;
          return (
            <g key={`${datum.label}-${index}`}>
              <rect x={x} y={y} width={barW} height={barH} rx={2} fill={color}>
                <title>{`${datum.label}: ${formatValue(datum.value)}`}</title>
              </rect>
              {index % labelStep === 0 && (
                <text
                  x={PAD_LEFT + index * slot + slot / 2}
                  y={viewH - 8}
                  textAnchor="middle"
                  fontSize={11}
                  fill="var(--color-chart-text)"
                >
                  {datum.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <ul className="sr-only">
        {data.map((datum, index) => (
          <li key={`${datum.label}-sr-${index}`}>
            {`${datum.label}: ${formatValue(datum.value)}`}
          </li>
        ))}
      </ul>
    </div>
  );
};
