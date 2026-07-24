import type { SimulationDetail } from '../types/metrics';
import MetricsStatCircle from './MetricsStatCircle';

const formatMinutes = (minutes: number | null) => (minutes != null ? minutes.toFixed(1) : '—');

/** Overall, non-movement-specific stats — sits above the switchable
 * arrival/departure panel so a viewer sees the simulation's headline numbers
 * before drilling into one direction of traffic. */
export default function MetricsGeneralStats({
  detail,
  className,
}: {
  detail: SimulationDetail;
  /** Lets the parent stretch this panel (e.g. `flex-1`) to fill its share of
   * the column height; the stat row then centres within the grown panel. */
  className?: string;
}) {
  const stats: { value: string; label: string }[] = [
    { value: `${detail.outcomeCounts.total}`, label: 'Total Aircraft Generated' },
    { value: `${Math.round(detail.successRate)}%`, label: 'Success Rate' },
    { value: `${detail.outcomeCounts.success}`, label: 'Successful Landings/Takeoffs' },
    { value: `${formatMinutes(detail.waitTimeStats.averageMinutes)}`, label: 'Avg Wait Time (mins)' },
    { value: `${formatMinutes(detail.waitTimeStats.maxMinutes)}`, label: 'Max Wait Time (mins)' },
    { value: `${detail.closureEventCount}`, label: 'Runway Closure Events' },
  ];

  return (
    <div className={`flex flex-col overflow-hidden rounded-lg border border-slate-200 ${className ?? ''}`}>
      <h2 className="bg-brand-accent px-3 py-1.5 text-sm font-bold uppercase tracking-wide text-black">
        General Stats
      </h2>
      <div className="grid flex-1 grid-cols-3 items-start content-around justify-items-center gap-3 bg-brand-bg px-3 py-2 lg:grid-cols-6 [@media(min-height:950px)]:py-3">
        {stats.map((stat) => (
          <MetricsStatCircle key={stat.label} value={stat.value} label={stat.label} />
        ))}
      </div>
    </div>
  );
}
