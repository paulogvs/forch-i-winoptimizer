import React from 'react';
import type { BarDatum } from './BarChart';

export interface LineChartProps {
  data: BarDatum[];
  ariaLabel: string;
  formatValue?: (value: number) => string;
  height?: number;
  emptyMessage?: string;
  testId?: string;
  color?: string;
  /** Fixed upper bound (e.g. 100 for a percentage/score). */
  max?: number;
}

const VIEW_W = 600;
const PAD_LEFT = 8;
const PAD_RIGHT = 8;
const PAD_TOP = 12;
const PAD_BOTTOM = 28;

/**
 * Hand-rolled SVG line chart. Points are labelled and the data is also exposed
 * as an accessible list, so the series never relies on colour alone.
 */
export const LineChart: React.FC<LineChartProps> = ({
  data,
  ariaLabel,
  formatValue = (value) => String(value),
  height = 200,
  emptyMessage = 'No data recorded yet.',
  testId,
  color = 'var(--color-chart-secondary)',
  max: fixedMax,
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
  const max = fixedMax ?? Math.max(...data.map((d) => d.value), 1);
  const stepX = data.length > 1 ? plotW / (data.length - 1) : 0;

  const points = data.map((datum, index) => {
    const x = data.length > 1 ? PAD_LEFT + index * stepX : PAD_LEFT + plotW / 2;
    const y = PAD_TOP + plotH - (datum.value / max) * plotH;
    return { x, y, datum };
  });

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

        <polyline
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          points={points.map((p) => `${p.x},${p.y}`).join(' ')}
        />

        {points.map((point, index) => (
          <g key={`${point.datum.label}-${index}`}>
            <circle cx={point.x} cy={point.y} r={3} fill={color}>
              <title>{`${point.datum.label}: ${formatValue(point.datum.value)}`}</title>
            </circle>
            {index % labelStep === 0 && (
              <text
                x={point.x}
                y={viewH - 8}
                textAnchor="middle"
                fontSize={11}
                fill="var(--color-chart-text)"
              >
                {point.datum.label}
              </text>
            )}
          </g>
        ))}
      </svg>

      <ul className="sr-only">
        {data.map((datum, index) => (
          <li
            key={`${datum.label}-sr-${index}`}
          >{`${datum.label}: ${formatValue(datum.value)}`}</li>
        ))}
      </ul>
    </div>
  );
};
