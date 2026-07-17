import { useEffect, useRef, useState } from 'react';
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

/** Reverse-chronological log of events up to the current replay time. Auto-scrolls
 * to the newest entry unless the user has manually scrolled away. */
export default function SimulationEventLog({
  events,
  aircraft,
  runwayIdentifier,
}: SimulationEventLogProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [userScrolledAway, setUserScrolledAway] = useState(false);

  const aircraftById = new Map(aircraft.map((a) => [a.id, a]));
  const reversed = [...events].reverse();

  useEffect(() => {
    const el = containerRef.current;
    if (el && !userScrolledAway) {
      el.scrollTop = 0;
    }
  }, [events, userScrolledAway]);

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
