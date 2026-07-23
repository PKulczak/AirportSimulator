import type { SimulationDetail } from '../types/metrics';
import MetricsStatCircle from './MetricsStatCircle';

const formatMinutes = (minutes: number | null) => (minutes != null ? minutes.toFixed(1) : '—');

/** Overall, non-movement-specific stats — sits above the switchable
 * arrival/departure panel so a viewer sees the simulation's headline numbers
 * before drilling into one direction of traffic. */
export default function MetricsGeneralStats({ detail }: { detail: SimulationDetail }) {
  const stats: { value: string; label: string }[] = [
    { value: `${detail.outcomeCounts.total}`, label: 'Total Aircraft Generated' },
    { value: `${Math.round(detail.successRate)}%`, label: 'Success Rate' },
    { value: `${detail.outcomeCounts.success}`, label: 'Successful Landings/Takeoffs' },
    { value: `${formatMinutes(detail.waitTimeStats.averageMinutes)}`, label: 'Avg Wait Time (mins)' },
    { value: `${formatMinutes(detail.waitTimeStats.maxMinutes)}`, label: 'Max Wait Time (mins)' },
    { value: `${detail.closureEventCount}`, label: 'Runway Closure Events' },
  ];

  return (
    <div className="rounded-lg overflow-hidden border border-slate-200">
      <h2 className="bg-brand-accent px-3 py-1.5 text-center text-sm font-bold uppercase tracking-wide text-black">
        General Stats
      </h2>
      <div className="grid grid-cols-3 place-items-center gap-3 bg-brand-bg p-3 lg:grid-cols-6">
        {stats.map((stat) => (
          <MetricsStatCircle key={stat.label} value={stat.value} label={stat.label} />
        ))}
      </div>
    </div>
  );
}
