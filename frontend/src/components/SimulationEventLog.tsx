import { useEffect, useMemo, useRef, useState } from 'react';
import type { AircraftVisualisation, SimulationEvent } from '../types/visualisation';

interface SimulationEventLogProps {
  events: SimulationEvent[];
  aircraft: AircraftVisualisation[];
  runwayIdentifier: (runwayId: number) => string;
}

function eventKey(event: SimulationEvent): string {
  const subject = 'aircraftId' in event ? `a${event.aircraftId}` : `r${event.runwayId}`;
  return `${event.type}-${event.time}-${subject}`;
}

function describeEvent(
  event: SimulationEvent,
  aircraftById: Map<number, AircraftVisualisation>,
  runwayIdentifier: (runwayId: number) => string,
): string {
  const callsign = (id: number) => aircraftById.get(id)?.callsign ?? `#${id}`;

  switch (event.type) {
    case 'arrival':
      return `${callsign(event.aircraftId)} scheduled to arrive`;
    case 'departure':
      return `${callsign(event.aircraftId)} scheduled to depart`;
    case 'queueEnter':
      return `${callsign(event.aircraftId)} entered the runway queue`;
    case 'runwayOccupy':
      return `${callsign(event.aircraftId)} took runway ${runwayIdentifier(event.runwayId)}`;
    case 'runwayVacate':
      return `${callsign(event.aircraftId)} vacated runway ${runwayIdentifier(event.runwayId)}`;
    case 'emergency':
      return `${callsign(event.aircraftId)} declared ${event.eventType}${
        event.detail ? `: ${event.detail}` : ''
      }`;
    case 'outcome':
      return `${callsign(event.aircraftId)} outcome: ${event.outcome}`;
    case 'closureStart':
      return `Runway ${runwayIdentifier(event.runwayId)} closed${
        event.reason ? ` (${event.reason})` : ''
      }`;
    case 'closureEnd':
      return `Runway ${runwayIdentifier(event.runwayId)} reopened`;
    default:
      return 'Unknown event';
  }
}

// Bounds the reverse-chronological log to the most recent N entries — while
// the sidebar is open during playback, `events` (the replay's growing
// visible-events prefix) can reach into the thousands on a large/long
// simulation, and copying+reversing the *entire* list every tick would scale
// with that, not with what's actually rendered.
const MAX_VISIBLE_LOG_ENTRIES = 300;

/** Reverse-chronological log of events up to the current replay time. Auto-scrolls
 * to the newest entry unless the user has manually scrolled away. */
export default function SimulationEventLog({
  events,
  aircraft,
  runwayIdentifier,
}: SimulationEventLogProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [userScrolledAway, setUserScrolledAway] = useState(false);

  // `aircraft` is a stable reference for the whole replay (only changes on a
  // fresh fetch) — memoize the O(n) lookup map instead of rebuilding it from
  // scratch on every tick.
  const aircraftById = useMemo(
    () => new Map(aircraft.map((a) => [a.id, a])),
    [aircraft],
  );
  const truncatedCount = Math.max(0, events.length - MAX_VISIBLE_LOG_ENTRIES);
  // Slicing just the tail before reversing (rather than `[...events].reverse()`)
  // keeps the per-tick copy bounded to what's actually rendered instead of
  // scaling with the full, ever-growing event list.
  const reversed = events.slice(-MAX_VISIBLE_LOG_ENTRIES).reverse();

  useEffect(() => {
    const el = containerRef.current;
    if (el && !userScrolledAway) {
      el.scrollTop = 0;
    }
  }, [events, userScrolledAway]);

  // A replay reset drops `events` back to empty (currentTime resets to 0) —
  // treat that as "start of a fresh replay" and clear any scrolled-away
  // state left over from the previous run, rather than leaving the log
  // stuck scrolled away with nothing new arriving to prompt the user back.
  useEffect(() => {
    if (events.length === 0) {
      setUserScrolledAway(false);
    }
  }, [events.length]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    setUserScrolledAway(el.scrollTop > 8);
  };

  return (
    <div className="h-full text-left flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-800">Event log</h2>
        {userScrolledAway && (
          <button
            type="button"
            className="text-xs text-black underline decoration-brand-accent decoration-2 hover:decoration-brand-accent-hover"
            onClick={() => setUserScrolledAway(false)}
          >
            Jump to latest
          </button>
        )}
      </div>
      {truncatedCount > 0 && (
        <p className="text-xs text-slate-400">
          Showing the most recent {MAX_VISIBLE_LOG_ENTRIES} events ({truncatedCount} earlier
          {truncatedCount === 1 ? ' event' : ' events'} hidden).
        </p>
      )}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1 text-sm"
      >
        {reversed.length === 0 && <p className="text-slate-400">No events yet</p>}
        {reversed.map((event) => (
          <div
            key={eventKey(event)}
            className="flex gap-2 border-b border-slate-100 pb-1 last:border-none"
          >
            <span className="text-slate-400 tabular-nums">{event.time.toFixed(1)}</span>
            <span className="text-slate-700">
              {describeEvent(event, aircraftById, runwayIdentifier)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
