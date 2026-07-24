import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
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
 *
 * A progress "fill" bar sits behind the plane in the same colour as the runway
 * but a brighter shade (`OPERATING_MODE_STYLE.fill`): it spans the full height
 * of the runway card (under the identifier badge), is pinned to the edge the
 * plane started from, and its leading edge tracks the tail of the icon, so it
 * covers exactly the ground already travelled. That edge has to line up with
 * the icon in pixels (the icon has a real width, sits inset within the card by
 * the card padding, and the callsign trails it), so the same rAF loop sizes the
 * fill from cached card/track/icon widths — re-measured on mount, on occupant
 * change, and on resize via a `ResizeObserver`.
 */
export default function Runway({
  identifier,
  operatingMode,
  closureReason,
  occupancy,
  getSmoothTime,
}: RunwayProps) {
  const closed = closureReason !== null;
  const cardRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const planeRef = useRef<HTMLDivElement | null>(null);
  const fillRef = useRef<HTMLDivElement | null>(null);
  const latestRef = useRef({ occupancy, getSmoothTime });
  latestRef.current = { occupancy, getSmoothTime };

  // Card, track and plane-icon widths (px) plus the track's left offset within
  // the card, cached so the per-frame paint loop can size the progress fill
  // without reading layout every frame (which would thrash). Re-measured when
  // the occupant changes (the icon mounts) and whenever the card resizes.
  const metricsRef = useRef({ cardWidth: 0, trackOffsetLeft: 0, trackWidth: 0, iconWidth: 0 });
  const measure = useCallback(() => {
    const track = trackRef.current;
    metricsRef.current = {
      cardWidth: cardRef.current?.clientWidth ?? 0,
      trackOffsetLeft: track?.offsetLeft ?? 0,
      trackWidth: track?.clientWidth ?? 0,
      iconWidth: planeRef.current?.offsetWidth ?? 0,
    };
  }, []);

  useLayoutEffect(() => {
    measure();
    const card = cardRef.current;
    if (!card || typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(() => measure());
    observer.observe(card);
    return () => observer.disconnect();
  }, [measure, occupancy?.callsign, occupancy?.movementType]);

  useEffect(() => {
    let frameId: number;

    const paint = () => {
      const plane = planeRef.current;
      const fill = fillRef.current;
      const { occupancy: current, getSmoothTime: getTime } = latestRef.current;
      // When unoccupied the plane/fill aren't rendered, so there's nothing to
      // move — the elements simply don't exist and this is a no-op.
      if (plane && current) {
        const t = getTime();
        const span = current.endTime - current.startTime;
        const fraction = span > 0 ? Math.min(1, Math.max(0, (t - current.startTime) / span)) : 1;
        // Departures travel right-to-left, so their progress runs in reverse.
        const progress = current.movementType === 'Departure' ? 1 - fraction : fraction;
        // Only the icon travels (the callsign is absolutely positioned, so it
        // doesn't count toward this element's width): translateX is a
        // percentage of the icon's OWN width, sliding it from flush against
        // the start edge (progress 0) to flush against the far edge
        // (progress 1) without ever overflowing the track.
        plane.style.left = `${progress * 100}%`;
        plane.style.transform = `translateY(-50%) translateX(${-progress * 100}%)`;

        if (fill) {
          // The fill spans the full runway card, pinned to the edge the plane
          // started from, and its leading edge reaches the tail of the icon.
          // The icon travels the inner track, which is inset from the card edge
          // by the card padding, so the fill width is that padding plus
          // `fraction` of the icon's travel distance (track width minus the
          // icon's own width). `fraction` runs 0→1 over the occupancy in both
          // directions, so this covers arrivals and departures.
          const { cardWidth, trackOffsetLeft, trackWidth, iconWidth } = metricsRef.current;
          const travel = Math.max(0, trackWidth - iconWidth);
          const startPad =
            current.movementType === 'Departure'
              ? Math.max(0, cardWidth - trackOffsetLeft - trackWidth)
              : trackOffsetLeft;
          fill.style.width = `${startPad + fraction * travel}px`;
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
      ref={cardRef}
      className={`relative flex flex-1 items-stretch gap-3 overflow-hidden rounded-xl p-3 min-h-[44px] max-h-[58px] ${
        closed ? 'border border-red-300 bg-red-50' : modeStyle.bg
      }`}
    >
      {!closed && occupancy && (
        // Progress fill: spans the whole runway card (full height, passing
        // under the identifier badge), pinned to the edge the plane came from;
        // its width — set each frame — reaches the tail of the icon.
        <div
          ref={fillRef}
          className={`absolute inset-y-0 ${modeStyle.fill}`}
          style={occupancy.movementType === 'Departure' ? { right: 0, width: 0 } : { left: 0, width: 0 }}
        />
      )}
      <div className="absolute right-2 top-1 z-10 text-sm font-bold text-black">{identifier}</div>

      <div ref={trackRef} className="relative min-w-0 flex-1 overflow-hidden">
        {closed ? (
          <span className="absolute inset-0 flex items-center truncate text-sm font-semibold text-red-600">
            {closureReason}
          </span>
        ) : occupancy ? (
          <>
            <div className="absolute left-0 right-0 top-1/2 border-t-2 border-dashed border-slate-500/40" />
            <div
              ref={planeRef}
              className="absolute top-1/2 flex items-center"
              style={
                occupancy.movementType === 'Departure'
                  ? { left: '100%', transform: 'translateY(-50%) translateX(-100%)' }
                  : { left: '0%', transform: 'translateY(-50%)' }
              }
            >
              <FontAwesomeIcon
                icon={faPlaneUp}
                className={`text-slate-800 ${
                  occupancy.movementType === 'Departure' ? '-rotate-90' : 'rotate-90'
                }`}
              />
              {/* Callsign trails just behind the icon (over the fill), on the
               * side the plane came from. Absolutely positioned so it doesn't
               * add to the icon element's width, which the travel maths relies
               * on being just the icon. */}
              <span
                className={`absolute top-1/2 -translate-y-1/2 whitespace-nowrap text-sm font-semibold text-slate-800 ${
                  occupancy.movementType === 'Departure' ? 'left-full ml-1.5' : 'right-full mr-1.5'
                }`}
              >
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
    </div>
  );
}
