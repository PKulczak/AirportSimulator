import { useEffect, useRef } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlaneUp } from '@fortawesome/free-solid-svg-icons';
import type { OperatingMode } from '../types/runway';
import type { AircraftEventType } from '../types/visualisation';
import { EMERGENCY_TYPE_STYLE, OPERATING_MODE_STYLE } from '../functions/replayTheme';

export interface RunwayOccupancy {
  callsign: string;
  startTime: number;
  endTime: number;
}

interface RunwayProps {
  identifier: string;
  operatingMode: OperatingMode;
  closed: boolean;
  occupancy: RunwayOccupancy | null;
  /** Active emergency (if any) for the aircraft currently occupying this runway. */
  activeEmergency: AircraftEventType | null;
  /** Returns the current replay time (minutes), interpolated continuously
   * between ticks — call fresh on every animation frame, don't cache. */
  getSmoothTime: () => number;
}

/** Clamp how far along the track the plane icon travels so it never slides
 * out past the runway card's edge. */
const MAX_TRAVEL_FRACTION = 0.9;

/**
 * Renders one runway as a coloured card (colour keyed to its operating mode,
 * matching the on-screen legend): an identifier badge, a dashed "runway"
 * track with a plane icon that slides along it while occupied, and an
 * emergency dot when the current occupant has an active emergency.
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
  closed,
  occupancy,
  activeEmergency,
  getSmoothTime,
}: RunwayProps) {
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
          plane.style.left = `${Math.min(fraction, MAX_TRAVEL_FRACTION) * 100}%`;
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
      className={`flex items-center gap-3 rounded-xl p-3 ${
        closed ? 'border border-red-300 bg-red-50' : modeStyle.bg
      }`}
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-sm font-bold text-white">
        {identifier}
      </div>

      <div className="relative h-8 min-w-0 flex-1 overflow-hidden">
        {closed ? (
          <span className="absolute inset-0 flex items-center text-sm font-semibold text-red-600">
            Closed
          </span>
        ) : occupancy ? (
          <>
            <div className="absolute left-0 right-0 top-1/2 border-t-2 border-dashed border-slate-500/40" />
            <div
              ref={planeRef}
              className="absolute top-1/2 flex -translate-y-1/2 items-center gap-1.5"
              style={{ left: '0%' }}
            >
              <FontAwesomeIcon icon={faPlaneUp} className="rotate-90 text-slate-800" />
              <span className="whitespace-nowrap text-sm font-semibold text-slate-800">
                {occupancy.callsign}
              </span>
            </div>
          </>
        ) : (
          <span className="absolute inset-0 flex items-center text-sm font-medium text-slate-500">
            Free
          </span>
        )}
      </div>

      {activeEmergency && (
        <span
          className={`h-3 w-3 shrink-0 rounded-full ${EMERGENCY_TYPE_STYLE[activeEmergency].dot}`}
          title={EMERGENCY_TYPE_STYLE[activeEmergency].label}
        />
      )}
    </div>
  );
}
