import { ProgressBar } from 'primereact/progressbar';
import type { SimulationDetail } from '../types/metrics';

export default function MetricsGrid({ detail }: { detail: SimulationDetail }) {
  const { outcomeCounts, waitTimeStats, delayStats, successRate } = detail;
  const totalAircraft = outcomeCounts.total;

  const outcomeRows: { label: string; count: number; color: string }[] = [
    { label: 'Success', count: outcomeCounts.success, color: 'bg-emerald-500' },
    { label: 'Diverted', count: outcomeCounts.diverted, color: 'bg-amber-500' },
    { label: 'Cancelled', count: outcomeCounts.cancelled, color: 'bg-red-500' },
    { label: 'Pending', count: outcomeCounts.pending, color: 'bg-slate-400' },
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="rounded-lg border border-slate-200 bg-brand-bg p-4 text-left">
        <h2 className="text-lg font-semibold text-slate-800 mb-3">Success rate</h2>
        <ProgressBar value={Math.round(successRate)} />
        <p className="mt-2 text-sm text-slate-500">
          {totalAircraft} aircraft generated, {outcomeCounts.success} completed successfully.
        </p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-brand-bg p-4 text-left">
        <h2 className="text-lg font-semibold text-slate-800 mb-3">Outcomes</h2>
        <div className="flex flex-col gap-2">
          {outcomeRows.map((row) => (
            <div key={row.label} className="flex items-center gap-2">
              <span className="w-20 text-sm text-slate-600">{row.label}</span>
              <div className="flex-1 h-2 rounded bg-slate-100">
                <div
                  className={`h-2 rounded ${row.color}`}
                  style={{
                    width: totalAircraft > 0 ? `${(row.count / totalAircraft) * 100}%` : '0%',
                  }}
                />
              </div>
              <span className="w-8 text-right text-sm text-slate-600">{row.count}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-brand-bg p-4 text-left lg:col-span-2">
        <h2 className="text-lg font-semibold text-slate-800 mb-3">Wait times</h2>
        <div className="flex gap-8">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">Average</p>
            <p className="text-xl font-semibold text-slate-800">
              {waitTimeStats.averageMinutes != null ? waitTimeStats.averageMinutes.toFixed(1) : '—'} min
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">Max</p>
            <p className="text-xl font-semibold text-slate-800">
              {waitTimeStats.maxMinutes != null ? waitTimeStats.maxMinutes.toFixed(1) : '—'} min
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-brand-bg p-4 text-left lg:col-span-2">
        <h2 className="text-lg font-semibold text-slate-800 mb-3">
          Delay (queue join to landing/take-off)
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {(
            [
              { label: 'Arrival', stats: delayStats.arrival },
              { label: 'Departure', stats: delayStats.departure },
            ] as const
          ).map(({ label, stats }) => (
            <div key={label}>
              <p className="text-xs uppercase tracking-wide text-slate-400 mb-1">{label}</p>
              <div className="flex gap-8">
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-400">Average</p>
                  <p className="text-xl font-semibold text-slate-800">
                    {stats.averageMinutes != null ? stats.averageMinutes.toFixed(1) : '—'} min
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-400">Max</p>
                  <p className="text-xl font-semibold text-slate-800">
                    {stats.maxMinutes != null ? stats.maxMinutes.toFixed(1) : '—'} min
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
