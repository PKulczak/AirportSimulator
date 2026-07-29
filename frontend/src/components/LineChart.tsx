import { useMemo } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

export interface LineChartPoint {
  x: number;
  /** null leaves a gap in the line rather than a misleading straight line
   * across a step that has no value for this metric (e.g. no successful
   * aircraft to average a delay from). */
  y: number | null;
}

interface LineChartProps {
  title: string;
  color: string;
  points: LineChartPoint[];
  xTickFormat: (value: number) => string;
  yTickFormat: (value: number) => string;
  valueFormat: (value: number) => string;
  hoveredIndex: number | null;
  onHoverIndex: (index: number | null) => void;
}

const WIDTH = 480;
const HEIGHT = 220;
const MARGIN = { top: 16, right: 16, bottom: 28, left: 44 };
const PLOT_WIDTH = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_HEIGHT = HEIGHT - MARGIN.top - MARGIN.bottom;
const GRID_STEPS = 4;

// Chart chrome — muted/recessive ink and gridlines, per the dataviz skill.
const GRIDLINE_COLOR = '#e1e0d9';
const BASELINE_COLOR = '#c3c2b7';
const MUTED_TEXT = '#898781';
const PRIMARY_TEXT = '#0b0b0b';
const SURFACE = '#fcfcfb';

/** A single-series line chart (small multiple): one metric vs. one swept
 * variable. `hoveredIndex`/`onHoverIndex` are lifted to the parent so several
 * of these sharing the same x-axis can show a linked crosshair. */
export default function LineChart({
  title,
  color,
  points,
  xTickFormat,
  yTickFormat,
  valueFormat,
  hoveredIndex,
  onHoverIndex,
}: LineChartProps) {
  const xValues = points.map((point) => point.x);
  const yValues = points
    .map((point) => point.y)
    .filter((y): y is number => y != null);

  const xMin = Math.min(...xValues);
  const xMax = Math.max(...xValues);
  const yMax = yValues.length > 0 ? Math.max(...yValues) : 0;
  // Always a zero baseline (never a truncated axis) — every metric here
  // (percent, minutes, count) is non-negative, so 0 is a meaningful floor.
  const yDomainMax = yMax > 0 ? yMax * 1.15 : 1;

  const scaleX = (x: number) =>
    xMax === xMin
      ? MARGIN.left + PLOT_WIDTH / 2
      : MARGIN.left + ((x - xMin) / (xMax - xMin)) * PLOT_WIDTH;
  const scaleY = (y: number) => MARGIN.top + PLOT_HEIGHT - (y / yDomainMax) * PLOT_HEIGHT;

  // Split into contiguous non-null runs so a missing value leaves a visible
  // gap instead of a misleading connecting line.
  const segments = useMemo(() => {
    const runs: { x: number; y: number }[][] = [];
    let current: { x: number; y: number }[] = [];
    for (const point of points) {
      if (point.y == null) {
        if (current.length > 0) {
          runs.push(current);
        }
        current = [];
        continue;
      }
      current.push({ x: point.x, y: point.y });
    }
    if (current.length > 0) {
      runs.push(current);
    }
    return runs;
  }, [points]);

  const pathFor = (segment: { x: number; y: number }[]) =>
    segment
      .map((point, i) => `${i === 0 ? 'M' : 'L'} ${scaleX(point.x)} ${scaleY(point.y)}`)
      .join(' ');

  const lastPoint = [...points].reverse().find((point) => point.y != null);
  const hovered = hoveredIndex != null ? points[hoveredIndex] : undefined;

  const gridLines = Array.from({ length: GRID_STEPS + 1 }, (_, i) => {
    const value = (yDomainMax / GRID_STEPS) * i;
    return { value, y: scaleY(value) };
  });

  const handlePointerMove = (event: ReactPointerEvent<SVGRectElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const relativeX = ((event.clientX - rect.left) / rect.width) * WIDTH;
    let closestIndex = 0;
    let closestDistance = Infinity;
    points.forEach((point, index) => {
      const distance = Math.abs(scaleX(point.x) - relativeX);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    });
    onHoverIndex(closestIndex);
  };

  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm font-bold text-slate-800">{title}</p>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full"
        role="img"
        aria-label={`${title}, from ${xTickFormat(xMin)} to ${xTickFormat(xMax)}`}
        onPointerLeave={() => onHoverIndex(null)}
      >
        {gridLines.map(({ value, y }) => (
          <g key={value}>
            <line
              x1={MARGIN.left}
              x2={WIDTH - MARGIN.right}
              y1={y}
              y2={y}
              stroke={GRIDLINE_COLOR}
              strokeWidth={1}
            />
            <text
              x={MARGIN.left - 8}
              y={y}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize={10}
              fill={MUTED_TEXT}
            >
              {yTickFormat(value)}
            </text>
          </g>
        ))}

        <line
          x1={MARGIN.left}
          x2={WIDTH - MARGIN.right}
          y1={MARGIN.top + PLOT_HEIGHT}
          y2={MARGIN.top + PLOT_HEIGHT}
          stroke={BASELINE_COLOR}
          strokeWidth={1}
        />
        <text x={scaleX(xMin)} y={HEIGHT - 8} textAnchor="start" fontSize={10} fill={MUTED_TEXT}>
          {xTickFormat(xMin)}
        </text>
        <text x={scaleX(xMax)} y={HEIGHT - 8} textAnchor="end" fontSize={10} fill={MUTED_TEXT}>
          {xTickFormat(xMax)}
        </text>

        {hovered && (
          <line
            x1={scaleX(hovered.x)}
            x2={scaleX(hovered.x)}
            y1={MARGIN.top}
            y2={MARGIN.top + PLOT_HEIGHT}
            stroke={BASELINE_COLOR}
            strokeWidth={1}
          />
        )}

        {segments.map((segment, i) => (
          <path
            key={i}
            d={pathFor(segment)}
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}

        {points.map((point, index) =>
          point.y != null ? (
            <circle
              key={index}
              cx={scaleX(point.x)}
              cy={scaleY(point.y)}
              r={index === hoveredIndex ? 6 : 4}
              fill={color}
              stroke={SURFACE}
              strokeWidth={2}
            />
          ) : null,
        )}

        {lastPoint?.y != null && (
          <text
            x={scaleX(lastPoint.x) - 4}
            y={scaleY(lastPoint.y) - 10}
            textAnchor="end"
            fontSize={11}
            fontWeight={600}
            fill={PRIMARY_TEXT}
          >
            {valueFormat(lastPoint.y)}
          </text>
        )}

        <rect
          x={MARGIN.left}
          y={MARGIN.top}
          width={PLOT_WIDTH}
          height={PLOT_HEIGHT}
          fill="transparent"
          onPointerMove={handlePointerMove}
          onPointerLeave={() => onHoverIndex(null)}
        />
      </svg>
      {hovered?.y != null && (
        <div className="flex items-center gap-2 text-xs text-slate-600">
          <span className="inline-block h-0.5 w-3" style={{ backgroundColor: color }} />
          <span className="font-semibold text-slate-900">{valueFormat(hovered.y)}</span>
          <span>at {xTickFormat(hovered.x)}</span>
        </div>
      )}
    </div>
  );
}
