import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faMagnifyingGlass,
  faPlaneArrival,
  faPlaneDeparture,
  faRightLeft,
  faScrewdriverWrench,
  faSnowflake,
} from '@fortawesome/free-solid-svg-icons';
import type { RunwayStat, SimulationDetail } from '../types/metrics';
import type { OperatingMode, OperationalStatus } from '../types/runway';
import { OPERATIONAL_STATUS_STYLE } from '../functions/replayTheme';

const MODE_ICON: Record<OperatingMode, typeof faRightLeft> = {
  ArrivalsOnly: faPlaneArrival,
  DeparturesOnly: faPlaneDeparture,
  Mixed: faRightLeft,
};

/** A completely-closed runway (0% open) shows *why* it's down instead of its
 * operating mode. `Available` has no closure icon — a 0% runway is always one
 * of these closed reasons in practice. */
const CLOSURE_REASON_ICON: Partial<Record<OperationalStatus, typeof faRightLeft>> = {
  RunwayInspection: faMagnifyingGlass,
  SnowClearance: faSnowflake,
  EquipmentFailure: faScrewdriverWrench,
};

/** Per-runway open-time percentage: how much of the simulation's duration the
 * runway was open (not closed for inspection/snow/failure), shown as a quick
 * at-a-glance figure next to each runway. */
const openTimePercentFor = (row: RunwayStat, durationMinutes: number) =>
  durationMinutes > 0 ? Math.round((row.openMinutes / durationMinutes) * 100) : null;

/** Status-dot colour keyed off open time: fully closed (0%) = red, fully open
 * (100%) = green, anything in between = yellow. */
const dotColorFor = (openPercent: number | null): string => {
  if (openPercent == null) return 'bg-slate-300';
  if (openPercent <= 0) return 'bg-red-500';
  if (openPercent >= 100) return 'bg-green-500';
  return 'bg-yellow-400';
};

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
          const openPercent = openTimePercentFor(row, detail.durationMinutes);
          // A fully-closed runway (0% open) shows its closure reason; otherwise
          // it keeps the arrival/departure/mixed operating-mode icon.
          const reasonIcon = CLOSURE_REASON_ICON[row.operationalStatus];
          const closed = openPercent === 0 && reasonIcon !== undefined;
          const icon = closed ? reasonIcon : MODE_ICON[row.operatingMode];
          const iconTitle = closed
            ? OPERATIONAL_STATUS_STYLE[row.operationalStatus].label
            : row.operatingMode;
          return (
            <div key={row.runwayId} className="flex items-center gap-2 px-3 py-1">
              <span className="shrink-0 text-xs font-semibold text-slate-800">
                Runway {row.identifier}
              </span>
              <div className="ml-auto flex shrink-0 items-center gap-2">
                <span
                  className="w-9 shrink-0 text-right text-xs text-slate-600"
                  title="Open time (% of simulation duration)"
                >
                  {openPercent != null ? `${openPercent}%` : '—'}
                </span>
                <span
                  className={`h-2.5 w-2.5 shrink-0 rounded-full ${dotColorFor(openPercent)}`}
                  title={
                    openPercent == null
                      ? undefined
                      : openPercent <= 0
                        ? 'Closed for the whole simulation'
                        : openPercent >= 100
                          ? 'Open for the whole simulation'
                          : 'Open for part of the simulation'
                  }
                />
                <FontAwesomeIcon
                  icon={icon}
                  className="shrink-0 text-xs text-slate-600"
                  title={iconTitle}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
