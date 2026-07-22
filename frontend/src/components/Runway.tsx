import { useEffect, useRef } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlaneUp } from '@fortawesome/free-solid-svg-icons';
import type { OperatingMode } from '../types/runway';
import { OPERATING_MODE_STYLE } from '../functions/replayTheme';

export interface RunwayOccupancy {
  callsign: string;
  startTime: number;
  endTime: number;
  /** Drives animation direction: arrivals land left-to-right, departures
   * take off right-to-left. */
  movementType: 'Arrival' | 'Departure';
}

interface RunwayProps {
  identifier: string;
  operatingMode: OperatingMode;
  /** Reason text (e.g. "Snow clearance") when closed, null when available. */
  closureReason: string | null;
  occupancy: RunwayOccupancy | null;
  /** Returns the current replay time (minutes), interpolated continuously
   * between ticks — call fresh on every animation frame, don't cache. */
  getSmoothTime: () => number;
}

/** Clamp how far along the track the plane icon travels so it never slides
 * out past the runway card's edge. */
const MAX_TRAVEL_FRACTION = 0.9;

/**
 * Renders one runway as a coloured card (colour keyed to its operating mode,
 * matching the on-screen legend): an identifier badge and a dashed "runway"
 * track with a plane icon that slides along it while occupied — left-to-right
 * for an arrival landing, right-to-left for a departure taking off, matching
 * `occupancy.movementType`. Emergency status is deliberately not shown here —
 * it's only relevant while an aircraft is queued (see `QueueTable`), not once
 * it's already on the runway.
 *
 * `closed`/`occupancy` are computed fresh every parent render straight from
 * `deriveRunwayState(events, currentTime, ...)` — there is no locally-mutated
 * accumulator here, so a reset to t=0 (or a scrub backwards) clears the
 * occupancy indicator automatically instead of leaving stale state behind.
 *
 * The plane's position is written directly to a ref via requestAnimationFrame
 * rather than driven by a CSS transition. The replay's `currentTime` state
 * only ticks a few times a second (it drives data derivation, not
 * animation), so painting straight off it would look stepped;
 * `getSmoothTime()` extrapolates the sim clock continuously between ticks
 * off wall-clock time, so this rAF loop repaints a genuinely different value
 * every frame instead of the same value several times in a row.
 */
export default function Runway({
  identifier,
  operatingMode,
  closureReason,
  occupancy,
  getSmoothTime,
}: RunwayProps) {
  const closed = closureReason !== null;
  const planeRef = useRef<HTMLDivElement | null>(null);
  const latestRef = useRef({ occupancy, getSmoothTime });
  latestRef.current = { occupancy, getSmoothTime };

  useEffect(() => {
    let frameId: number;

    const paint = () => {
      const plane = planeRef.current;
      const { occupancy: current, getSmoothTime: getTime } = latestRef.current;
      if (plane) {
        if (!current) {
          plane.style.left = '0%';
        } else {
          const t = getTime();
          const span = current.endTime - current.startTime;
          const fraction = span > 0 ? Math.min(1, Math.max(0, (t - current.startTime) / span)) : 1;
          const travel = Math.min(fraction, MAX_TRAVEL_FRACTION) * 100;
          plane.style.left =
            current.movementType === 'Departure'
              ? `${MAX_TRAVEL_FRACTION * 100 - travel}%`
              : `${travel}%`;
        }
      }
      frameId = requestAnimationFrame(paint);
    };

    frameId = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(frameId);
  }, []);

  const modeStyle = OPERATING_MODE_STYLE[operatingMode];

  return (
    <div
      className={`relative flex items-center gap-3 rounded-xl p-3 ${
        closed ? 'border border-red-300 bg-red-50' : modeStyle.bg
      }`}
    >
      <div className="absolute right-2 top-1 z-10 text-sm font-bold text-black">{identifier}</div>

      <div className="relative h-8 min-w-0 flex-1 overflow-hidden">
        {closed ? (
          <span className="absolute inset-0 flex items-center truncate text-sm font-semibold text-red-600">
            {closureReason}
          </span>
        ) : occupancy ? (
          <>
            <div className="absolute left-0 right-0 top-1/2 border-t-2 border-dashed border-slate-500/40" />
            <div
              ref={planeRef}
              className="absolute top-1/2 flex -translate-y-1/2 items-center gap-1.5"
              style={{ left: occupancy.movementType === 'Departure' ? `${MAX_TRAVEL_FRACTION * 100}%` : '0%' }}
            >
              {occupancy.movementType === 'Arrival' && (
                <span className="whitespace-nowrap text-sm font-semibold text-slate-800">
                  {occupancy.callsign}
                </span>
              )}
              <FontAwesomeIcon
                icon={faPlaneUp}
                className={`text-slate-800 ${
                  occupancy.movementType === 'Departure' ? '-rotate-90' : 'rotate-90'
                }`}
              />
              {occupancy.movementType === 'Departure' && (
                <span className="whitespace-nowrap text-sm font-semibold text-slate-800">
                  {occupancy.callsign}
                </span>
              )}
            </div>
          </>
        ) : (
          <span className="absolute inset-0 flex items-center text-sm font-medium text-slate-500">
            Free
          </span>
        )}
      </div>
    </div>
  );
}
