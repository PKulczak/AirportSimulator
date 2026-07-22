import { useRef } from 'react';
import { OverlayPanel } from 'primereact/overlaypanel';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faGasPump, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
import { deriveQueue } from '../functions/visualisationHelpers';
import { EMERGENCY_TYPE_STYLE } from '../functions/replayTheme';
import type {
  AircraftEventType,
  AircraftVisualisation,
  MovementType,
  SimulationEvent,
} from '../types/visualisation';

interface QueueTableProps {
  events: SimulationEvent[];
  currentTime: number;
  aircraft: AircraftVisualisation[];
  movementType: MovementType;
  activeEmergencyByAircraft: Map<number, AircraftEventType>;
}

interface QueueRow {
  aircraftId: number;
  callsign: string;
  operator: string;
  originDestination: string;
  /** Holding-pattern altitude (arrivals only): the highest-priority aircraft
   * (an active emergency always outranks a normal aircraft; longest-waiting
   * breaks ties) holds at 1000ft, each aircraft behind it stacked 1000ft
   * higher. Departures are grounded awaiting a runway slot, so altitude
   * doesn't apply to them. */
  altitudeFeet?: number;
  /** Fuel burnt off while holding (arrivals only) — departures are grounded
   * with engines idling, not burning through holding fuel, so this doesn't
   * apply/deplete for them. */
  fuelRemaining?: number;
}

const HOLDING_ALTITUDE_STEP_FEET = 1000;

/** Queue panel styled like an airport terminal's flight-information board
 * (dark title bar, column headings, monospace flight codes) for a single
 * movement type — arrivals hold to land, departures hold to take off. */
export default function QueueTable({
  events,
  currentTime,
  aircraft,
  movementType,
  activeEmergencyByAircraft,
}: QueueTableProps) {
  const aircraftById = new Map(aircraft.map((a) => [a.id, a]));
  const isArrival = movementType === 'Arrival';
  const removedListRef = useRef<OverlayPanel>(null);

  const removedAircraft = aircraft
    .filter(
      (ac) =>
        ac.movementType === movementType &&
        (ac.outcome === 'Diverted' || ac.outcome === 'Cancelled') &&
        ac.completionTime !== null &&
        ac.completionTime <= currentTime,
    )
    .sort((a, b) => (b.completionTime as number) - (a.completionTime as number));

  const rows: QueueRow[] = deriveQueue(events, currentTime)
    .filter((entry) => aircraftById.get(entry.aircraftId)?.movementType === movementType)
    .map((entry, index) => {
      const ac = aircraftById.get(entry.aircraftId);
      return {
        aircraftId: entry.aircraftId,
        callsign: ac?.callsign ?? `#${entry.aircraftId}`,
        operator: ac?.operator ?? '',
        originDestination: ac?.originDestination ?? '',
        ...(isArrival
          ? {
              altitudeFeet: (index + 1) * HOLDING_ALTITUDE_STEP_FEET,
              fuelRemaining: Math.max(0, (ac?.initialFuelMinutes ?? 0) - entry.waitingMinutes),
            }
          : {}),
      };
    });

  const label = isArrival ? 'Holding Queue' : 'Takeoff Queue';
  const originLabel = isArrival ? 'From' : 'To';

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-slate-200 shadow-sm">
      <div className="flex items-center gap-3 border-b-4 border-brand-accent bg-slate-900 px-4 py-3">
        <button
          type="button"
          onClick={(e) => removedListRef.current?.toggle(e)}
          aria-label={`${isArrival ? 'Diverted' : 'Cancelled'} aircraft`}
          className="relative flex h-6 w-6 shrink-0 items-center justify-center"
        >
          <FontAwesomeIcon icon={faTriangleExclamation} className="text-brand-accent" />
          <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {removedAircraft.length}
          </span>
        </button>
        <h2 className="text-sm font-bold uppercase tracking-wide text-white">{label}</h2>
      </div>

      <OverlayPanel ref={removedListRef}>
        <div className="flex max-h-72 w-64 flex-col gap-2 overflow-y-auto">
          <h3 className="text-sm font-bold text-slate-800">
            {isArrival ? 'Diverted' : 'Cancelled'} aircraft ({removedAircraft.length})
          </h3>
          {removedAircraft.length === 0 ? (
            <p className="text-sm text-slate-500">None so far.</p>
          ) : (
            removedAircraft.map((ac) => (
              <div key={ac.id} className="border-b border-slate-100 pb-1 last:border-b-0">
                <p className="font-mono text-xs font-semibold text-slate-800">{ac.callsign}</p>
                <p className="text-xs text-slate-500">
                  {ac.operator} &middot; {originLabel} {ac.originDestination} &middot; {ac.outcome}
                </p>
              </div>
            ))
          )}
        </div>
      </OverlayPanel>

      <div className="flex items-center gap-3 border-b border-slate-700 bg-black px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        <span className="flex-1">Flight</span>
        {isArrival && <span className="w-14 shrink-0 text-right">Alt</span>}
        {isArrival && <span className="w-12 shrink-0 text-right">Fuel</span>}
        <span className="w-10 shrink-0 text-right">{originLabel}</span>
      </div>

      <div className="queue-scroll flex-1 min-h-0 divide-y divide-slate-800 overflow-y-auto bg-black">
        {rows.length === 0 && (
          <p className="p-4 text-sm text-slate-500">No {movementType.toLowerCase()}s currently queued</p>
        )}
        {rows.map((row) => {
          const emergency = activeEmergencyByAircraft.get(row.aircraftId);
          return (
            <div
              key={row.aircraftId}
              className="flex items-center gap-3 px-4 py-2 even:bg-white/5"
            >
              {emergency && (
                <span
                  className={`h-2.5 w-2.5 shrink-0 rounded-full ${EMERGENCY_TYPE_STYLE[emergency].dot}`}
                  title={EMERGENCY_TYPE_STYLE[emergency].label}
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-xs font-semibold text-brand-accent">
                  {row.callsign}
                </p>
                <p className="truncate text-sm font-semibold text-white">{row.operator}</p>
              </div>
              {isArrival && (
                <span className="w-14 shrink-0 text-right font-mono text-xs font-medium text-slate-400">
                  {row.altitudeFeet}ft
                </span>
              )}
              {isArrival && (
                <span className="flex w-12 shrink-0 items-center justify-end gap-1 font-mono text-xs font-medium text-slate-400">
                  <FontAwesomeIcon icon={faGasPump} />
                  {row.fuelRemaining?.toFixed(1)}
                </span>
              )}
              <span className="w-10 shrink-0 text-right font-mono text-xs font-medium text-slate-500">
                {row.originDestination}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
