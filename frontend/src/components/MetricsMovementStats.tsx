import { InputSwitch } from 'primereact/inputswitch';
import type { SimulationDetail } from '../types/metrics';
import type { MovementType } from '../types/visualisation';
import MetricsStatCircle from './MetricsStatCircle';

const formatMinutes = (minutes: number | null) => (minutes != null ? minutes.toFixed(1) : '—');

interface MetricsMovementStatsProps {
  detail: SimulationDetail;
  movementType: MovementType;
  onMovementTypeChange: (movementType: MovementType) => void;
}

/** Switchable arrival/departure stats panel — only one direction of traffic
 * is shown at a time, toggled by the switch in the header, since arrivals
 * and departures use unrelated queues (holding pattern vs. take-off queue)
 * with no meaningful combined view. */
export default function MetricsMovementStats({
  detail,
  movementType,
  onMovementTypeChange,
}: MetricsMovementStatsProps) {
  const isArrival = movementType === 'Arrival';
  const removedCount = isArrival ? detail.outcomeCounts.diverted : detail.outcomeCounts.cancelled;
  const hours = detail.durationMinutes / 60;

  const stats: { value: string; label: string }[] = [
    {
      value: `${isArrival ? detail.queueDepthStats.arrival : detail.queueDepthStats.departure}`,
      label: isArrival ? 'Max No. Of Planes In Holding Pattern' : 'Max No. Of Planes In Takeoff Queue',
    },
    {
      value: formatMinutes(
        (isArrival ? detail.delayStats.arrival : detail.delayStats.departure).averageMinutes,
      ),
      label: 'Avg Delay (mins)',
    },
    {
      value: formatMinutes(
        (isArrival ? detail.delayStats.arrival : detail.delayStats.departure).maxMinutes,
      ),
      label: 'Max Delay (mins)',
    },
    {
      value: `${removedCount}`,
      label: isArrival ? 'No. Of Diverted Planes' : 'No. Of Cancelled Planes',
    },
    {
      value: hours > 0 ? (removedCount / hours).toFixed(1) : '0.0',
      label: isArrival ? 'Diversions Per Hour' : 'Cancellations Per Hour',
    },
    {
      value: `${isArrival ? detail.arrivalRatePerHour : detail.departureRatePerHour}/hr`,
      label: isArrival ? 'Configured Arrival Rate' : 'Configured Departure Rate',
    },
  ];

  return (
    <div className="rounded-lg overflow-hidden border border-slate-200">
      <div className="flex items-center justify-between gap-3 bg-brand-accent px-3 py-1.5">
        <span className="text-sm font-bold uppercase tracking-wide text-black">
          {isArrival ? 'Arrival Metrics' : 'Departure Metrics'}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-black">Arrival</span>
          <InputSwitch
            checked={!isArrival}
            onChange={(e) => onMovementTypeChange(e.value ? 'Departure' : 'Arrival')}
          />
          <span className="text-xs font-semibold text-black">Departure</span>
        </div>
      </div>
      <div className="grid grid-cols-3 items-start justify-items-center gap-3 bg-brand-bg p-3 lg:grid-cols-6">
        {stats.map((stat) => (
          <MetricsStatCircle key={stat.label} value={stat.value} label={stat.label} />
        ))}
      </div>
    </div>
  );
}
