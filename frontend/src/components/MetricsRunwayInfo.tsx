import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlaneArrival, faPlaneDeparture, faRightLeft } from '@fortawesome/free-solid-svg-icons';
import type { RunwayStat, SimulationDetail } from '../types/metrics';
import type { OperatingMode } from '../types/runway';
import { OPERATIONAL_STATUS_STYLE } from '../functions/replayTheme';

const MODE_ICON: Record<OperatingMode, typeof faRightLeft> = {
  ArrivalsOnly: faPlaneArrival,
  DeparturesOnly: faPlaneDeparture,
  Mixed: faRightLeft,
};

/** Per-runway success rate (successful landings/takeoffs out of everything
 * assigned to it) — the closest existing signal to "how well this runway
 * performed", shown as a quick at-a-glance percentage next to each runway. */
const successRateFor = (row: RunwayStat) =>
  row.totalAssigned > 0 ? Math.round((row.successCount / row.totalAssigned) * 100) : null;

interface MetricsRunwayInfoProps {
  detail: SimulationDetail;
  /** Lets the parent stretch this panel (e.g. `flex-1`) to fill leftover
   * column height next to the fixed-height sim variables panel below it. */
  className?: string;
}

export default function MetricsRunwayInfo({ detail, className }: MetricsRunwayInfoProps) {
  return (
    <div className={`flex flex-col overflow-hidden rounded-lg border border-slate-200 ${className ?? ''}`}>
      <h2 className="bg-brand-accent px-3 py-1 text-xs font-bold uppercase tracking-wide text-black">
        Runway Info
      </h2>
      <div className="queue-scroll flex min-h-0 flex-1 flex-col divide-y divide-slate-200 overflow-y-auto bg-brand-bg">
        {detail.runwayStats.length === 0 && (
          <p className="p-2 text-xs text-slate-500">No runways in this simulation.</p>
        )}
        {detail.runwayStats.map((row) => {
          const rate = successRateFor(row);
          return (
            <div key={row.runwayId} className="flex items-center gap-2 px-3 py-1">
              <span className="w-16 shrink-0 text-xs font-semibold text-slate-800">
                Runway {row.identifier}
              </span>
              <span className="w-9 shrink-0 text-xs text-slate-600">
                {rate != null ? `${rate}%` : '—'}
              </span>
              <span
                className={`h-2.5 w-2.5 shrink-0 rounded-full ${OPERATIONAL_STATUS_STYLE[row.operationalStatus].dot}`}
                title={OPERATIONAL_STATUS_STYLE[row.operationalStatus].label}
              />
              <FontAwesomeIcon
                icon={MODE_ICON[row.operatingMode]}
                className="ml-auto shrink-0 text-xs text-slate-600"
                title={row.operatingMode}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
