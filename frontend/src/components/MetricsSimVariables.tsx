import type { SimulationDetail } from '../types/metrics';

export default function MetricsSimVariables({ detail }: { detail: SimulationDetail }) {
  const items: { label: string; value: string }[] = [
    { label: 'Arrival rate', value: `${detail.arrivalRatePerHour}/hr` },
    { label: 'Departure rate', value: `${detail.departureRatePerHour}/hr` },
    { label: 'Duration', value: `${detail.durationMinutes} min` },
    { label: 'Max wait', value: `${detail.maxWaitMinutes} min` },
    { label: 'Aircraft speed', value: `${detail.aircraftSpeedKnots} kts` },
    { label: 'Closures', value: detail.includeClosures ? 'Enabled' : 'Disabled' },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
      {items.map((item) => (
        <div
          key={item.label}
          className="rounded-lg border border-slate-200 bg-white p-3 text-left"
        >
          <p className="text-xs uppercase tracking-wide text-slate-400">{item.label}</p>
          <p className="text-lg font-semibold text-slate-800">{item.value}</p>
        </div>
      ))}
    </div>
  );
}
