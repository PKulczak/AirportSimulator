import type { SimulationDetail } from '../types/metrics';

interface MetricsSimVariablesProps {
  detail: SimulationDetail;
  /** Lets the parent stretch this panel (e.g. `flex-1`) to fill leftover
   * column height next to the fixed-height runway info panel above it. */
  className?: string;
}

export default function MetricsSimVariables({ detail, className }: MetricsSimVariablesProps) {
  const items: { label: string; value: string }[] = [
    { label: 'Departure Plane Flow', value: `${detail.departureRatePerHour} /hour` },
    { label: 'Arrival Plane Flow', value: `${detail.arrivalRatePerHour} /hour` },
    { label: 'Duration', value: `${detail.durationMinutes} mins` },
    { label: 'Maximum Wait Time', value: `${detail.maxWaitMinutes} mins` },
    { label: 'Aircraft Speed', value: `${detail.aircraftSpeedKnots} kts` },
    { label: 'Closures Included?', value: detail.includeClosures ? 'Yes' : 'No' },
  ];

  return (
    <div className={`flex flex-col overflow-hidden rounded-lg border border-slate-200 ${className ?? ''}`}>
      <h2 className="bg-brand-accent px-3 py-1 text-xs font-bold uppercase tracking-wide text-black">
        Sim Variables
      </h2>
      <div className="grid flex-1 grid-cols-1 content-around gap-y-1.5 bg-brand-bg px-3 py-2 [@media(min-height:950px)]:gap-y-3 [@media(min-height:950px)]:py-3">
        {items.map((item) => (
          <div key={item.label} className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-bold text-slate-800">{item.label}:</span>
            <span className="text-sm text-slate-700">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
