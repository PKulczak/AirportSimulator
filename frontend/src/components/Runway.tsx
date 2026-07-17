import { useEffect, useRef } from 'react';
import type { OperatingMode } from '../types/runway';
import type { AircraftEventType } from '../types/visualisation';
import AlertButton from './AlertButton';

export interface RunwayOccupancy {
  callsign: string;
  startTime: number;
  endTime: number;
}

export interface RunwayEmergency {
  callsign: string;
  eventType: AircraftEventType;
  time: number;
}

interface RunwayProps {
  identifier: string;
  operatingMode: OperatingMode;
  closed: boolean;
  occupancy: RunwayOccupancy | null;
  /** Emergencies attributed to aircraft assigned to this runway, up to the
   * current replay time, most recent first. */
  emergencies: RunwayEmergency[];
  /** True when the most recent of `emergencies` is within the trailing alert window. */
  emergencyActive: boolean;
  /** Returns the current replay time (minutes), interpolated continuously
   * between ticks — call fresh on every animation frame, don't cache. */
  getSmoothTime: () => number;
}

/**
 * Renders one runway's live state. `closed`/`occupancy` are computed fresh
 * every parent render straight from `deriveRunwayState(events, currentTime, ...)`
 * — there is no locally-mutated accumulator here, so a reset to t=0 (or a
 * scrub backwards) clears the occupancy bar automatically instead of leaving
 * stale state behind.
 *
 * The occupancy bar's width is written directly to a ref via
 * requestAnimationFrame rather than driven by a CSS transition, per the
 * animation design in the plan. The replay's `currentTime` state only ticks a
 * few times a second (it drives data derivation, not animation), so painting
 * straight off it would look stepped; `getSmoothTime()` extrapolates the sim
 * clock continuously between ticks off wall-clock time, so this rAF loop
 * repaints a genuinely different value every frame instead of the same value
 * several times in a row.
 */
export default function Runway({
  identifier,
  operatingMode,
  closed,
  occupancy,
  emergencies,
  emergencyActive,
  getSmoothTime,
}: RunwayProps) {
  const barRef = useRef<HTMLDivElement | null>(null);
  const latestRef = useRef({ occupancy, getSmoothTime });
  latestRef.current = { occupancy, getSmoothTime };

  useEffect(() => {
    let frameId: number;

    const paint = () => {
      const bar = barRef.current;
      const { occupancy: current, getSmoothTime: getTime } = latestRef.current;
      if (bar) {
        if (!current) {
          bar.style.width = '0%';
        } else {
          const t = getTime();
          const span = current.endTime - current.startTime;
          const fraction = span > 0 ? Math.min(1, Math.max(0, (t - current.startTime) / span)) : 1;
          bar.style.width = `${fraction * 100}%`;
        }
      }
      frameId = requestAnimationFrame(paint);
    };

    frameId = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(frameId);
  }, []);

  return (
    <div
      className={`rounded-lg border p-4 flex flex-col gap-2 ${
        closed ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-brand-bg'
      }`}
    >
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-slate-800">{identifier}</h3>
        <span className="text-xs uppercase tracking-wide text-slate-400">{operatingMode}</span>
      </div>

      {emergencies.length > 0 && (
        <div className="flex flex-col gap-1">
          <AlertButton active={emergencyActive} compact />
          <ul className="flex flex-col gap-0.5 text-xs text-slate-500">
            {emergencies.slice(0, 3).map((e) => (
              <li key={`${e.callsign}-${e.eventType}-${e.time}`}>
                {e.callsign}: {e.eventType}
              </li>
            ))}
          </ul>
        </div>
      )}

      {closed ? (
        <p className="text-sm font-medium text-red-600">Closed</p>
      ) : (
        <>
          <p className="text-sm text-slate-600 h-5">
            {occupancy ? `Occupied by ${occupancy.callsign}` : 'Free'}
          </p>
          <div className="h-3 rounded bg-slate-100 overflow-hidden">
            <div
              ref={barRef}
              className={`h-3 rounded ${occupancy ? 'bg-brand-accent' : 'bg-transparent'}`}
              style={{ width: '0%' }}
            />
          </div>
        </>
      )}
    </div>
  );
}
