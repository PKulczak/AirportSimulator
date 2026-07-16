import type {
  SimulationEvent,
  VisualisationResponse,
  VisualisationResponseWire,
} from '../types/visualisation';

/**
 * Converts the wire response (absolute ISO-8601 timestamps, relative to
 * `startedAt`) into the minute-offset domain model the rest of the replay
 * engine operates on. `startedAt` is only present once the simulation has
 * actually started running; callers must not invoke this before that.
 */
export function normalizeVisualisation(
  raw: VisualisationResponseWire,
): VisualisationResponse {
  if (!raw.startedAt) {
    throw new Error('Cannot normalize visualisation data before the simulation has started.');
  }
  const startedAtMs = Date.parse(raw.startedAt);

  const toMinutes = (iso: string | null): number | null =>
    iso === null ? null : (Date.parse(iso) - startedAtMs) / 60000;

  return {
    id: raw.id,
    name: raw.name,
    durationMinutes: raw.durationMinutes,
    aircraft: raw.aircraft.map((ac) => ({
      id: ac.id,
      callsign: ac.callsign,
      operator: ac.operator,
      originDestination: ac.originDestination,
      movementType: ac.movementType,
      initialFuelMinutes: ac.initialFuelMinutes,
      scheduledTime: toMinutes(ac.scheduledTime) as number,
      queueEntryTime: toMinutes(ac.queueEntryTime),
      runwayAssignedTime: toMinutes(ac.runwayAssignedTime),
      completionTime: toMinutes(ac.completionTime),
      waitMinutes: ac.waitMinutes,
      outcome: ac.outcome,
      runwayId: ac.runwayId,
      finalPriorityScore: ac.finalPriorityScore,
      events: ac.events.map((evt) => ({
        id: evt.id,
        eventType: evt.eventType,
        occurredAt: toMinutes(evt.occurredAt) as number,
        priorityBoost: evt.priorityBoost,
        detail: evt.detail,
      })),
    })),
    runways: raw.runways.map((rw) => ({
      id: rw.id,
      runwayId: rw.runwayId,
      identifier: rw.identifier,
      operatingMode: rw.operatingMode,
      closureEvents: rw.closureEvents.map((evt) => ({
        id: evt.id,
        eventType: evt.eventType,
        occurredAt: toMinutes(evt.occurredAt) as number,
        reason: evt.reason,
      })),
    })),
  };
}

/**
 * Tie-break ordering applied when two events share the same timestamp. Lower
 * numbers sort first. Runways are freed (vacate/closureEnd) before anything
 * else so a same-tick vacate-then-occupy on the same runway never looks like
 * two aircraft holding it at once; outcomes are recorded once the runway is
 * free; new occupancy/queue/schedule events come after; emergencies are pure
 * annotations and sort last.
 */
const EVENT_ORDER: Record<SimulationEvent['type'], number> = {
  runwayVacate: 0,
  closureEnd: 1,
  outcome: 2,
  closureStart: 3,
  runwayOccupy: 4,
  queueEnter: 5,
  arrival: 6,
  departure: 6,
  emergency: 7,
};

/**
 * Flattens every aircraft's lifecycle (schedule -> queue -> runway occupy ->
 * runway vacate/outcome, plus any emergency events) and every runway's
 * closure events into one timeline, sorted by time with a stable tie-break.
 */
export function processEvents(raw: VisualisationResponse): SimulationEvent[] {
  const events: SimulationEvent[] = [];

  for (const ac of raw.aircraft) {
    events.push({
      type: ac.movementType === 'Arrival' ? 'arrival' : 'departure',
      time: ac.scheduledTime,
      aircraftId: ac.id,
    });

    if (ac.queueEntryTime !== null) {
      events.push({
        type: 'queueEnter',
        time: ac.queueEntryTime,
        aircraftId: ac.id,
      });
    }

    const hadRunway = ac.runwayAssignedTime !== null && ac.runwayId !== null;

    if (hadRunway) {
      events.push({
        type: 'runwayOccupy',
        time: ac.runwayAssignedTime as number,
        aircraftId: ac.id,
        runwayId: ac.runwayId as number,
      });
    }

    for (const evt of ac.events) {
      events.push({
        type: 'emergency',
        time: evt.occurredAt,
        aircraftId: ac.id,
        eventType: evt.eventType,
        detail: evt.detail,
      });
    }

    if (ac.completionTime !== null) {
      if (hadRunway) {
        events.push({
          type: 'runwayVacate',
          time: ac.completionTime,
          aircraftId: ac.id,
          runwayId: ac.runwayId as number,
        });
      }
      events.push({
        type: 'outcome',
        time: ac.completionTime,
        aircraftId: ac.id,
        outcome: ac.outcome,
      });
    }
  }

  for (const rw of raw.runways) {
    for (const evt of rw.closureEvents) {
      events.push(
        evt.eventType === 'Closed'
          ? {
              type: 'closureStart',
              time: evt.occurredAt,
              runwayId: rw.runwayId,
              reason: evt.reason,
            }
          : {
              type: 'closureEnd',
              time: evt.occurredAt,
              runwayId: rw.runwayId,
            },
      );
    }
  }

  return events.sort((a, b) => {
    if (a.time !== b.time) {
      return a.time - b.time;
    }
    return EVENT_ORDER[a.type] - EVENT_ORDER[b.type];
  });
}

/**
 * Returns the prefix of a (time-sorted) event array whose time is <= t.
 * Binary search since the replay loop calls this on every tick.
 */
export function eventsUpTo(events: SimulationEvent[], t: number): SimulationEvent[] {
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (events[mid].time <= t) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return events.slice(0, lo);
}

export interface RunwayState {
  occupiedByAircraftId: number | null;
  closed: boolean;
}

/**
 * Pure fold over events up to time `t` for a single runway. Deliberately
 * stateless/derived (not an incremental accumulator) so jumping backwards in
 * time or resetting to t=0 is correct by construction — there is no mutable
 * "current occupancy" to forget to clear.
 */
export function deriveRunwayState(
  events: SimulationEvent[],
  t: number,
  runwayId: number,
): RunwayState {
  let occupiedByAircraftId: number | null = null;
  let closed = false;

  for (const evt of eventsUpTo(events, t)) {
    if (evt.type === 'runwayOccupy' && evt.runwayId === runwayId) {
      occupiedByAircraftId = evt.aircraftId;
    } else if (evt.type === 'runwayVacate' && evt.runwayId === runwayId) {
      occupiedByAircraftId = null;
    } else if (evt.type === 'closureStart' && evt.runwayId === runwayId) {
      closed = true;
    } else if (evt.type === 'closureEnd' && evt.runwayId === runwayId) {
      closed = false;
    }
  }

  return { occupiedByAircraftId, closed };
}

export interface QueuedAircraft {
  aircraftId: number;
  queueEntryTime: number;
  waitingMinutes: number;
}

/**
 * Pure fold: aircraft that have entered a queue by time `t` but have neither
 * been assigned a runway nor reached a terminal outcome yet, sorted
 * longest-waiting-first.
 */
export function deriveQueue(events: SimulationEvent[], t: number): QueuedAircraft[] {
  const queueEntryTimeByAircraft = new Map<number, number>();

  for (const evt of eventsUpTo(events, t)) {
    if (evt.type === 'queueEnter') {
      queueEntryTimeByAircraft.set(evt.aircraftId, evt.time);
    } else if (evt.type === 'runwayOccupy' || evt.type === 'outcome') {
      queueEntryTimeByAircraft.delete(evt.aircraftId);
    }
  }

  return Array.from(queueEntryTimeByAircraft.entries())
    .map(([aircraftId, queueEntryTime]) => ({
      aircraftId,
      queueEntryTime,
      waitingMinutes: t - queueEntryTime,
    }))
    .sort((a, b) => a.queueEntryTime - b.queueEntryTime);
}
