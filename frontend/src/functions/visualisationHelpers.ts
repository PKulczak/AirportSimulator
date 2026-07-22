import type {
  AircraftEventType,
  SimulationEvent,
  VisualisationResponse,
  VisualisationResponseWire,
} from '../types/visualisation';

/** Mirrors the backend's `PriorityTracker`/`constants.EVENT_PRIORITY_BOOSTS`
 * (simpy.PriorityResource treats *lower* numbers as higher priority) so the
 * holding-queue display can reconstruct each aircraft's current priority
 * score from its emergency-event history instead of just showing arrival
 * order. Every emergency, even a bare LowFuel (boost 10), always outranks a
 * normal aircraft (score 100) — the boosts are all well under 100. */
const BASE_PRIORITY = 100;
const EVENT_PRIORITY_BOOSTS: Partial<Record<AircraftEventType, number>> = {
  LowFuel: 10,
  FuelCritical: 40,
  MechanicalFailure: 25,
  PassengerHealth: 15,
};

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
  /** Reason text from the triggering `closureStart` event, or null when the
   * runway isn't currently closed. Carries the *specific* reason (e.g.
   * "Snow clearance") rather than a bare boolean so the UI can show why. */
  closureReason: string | null;
}

/**
 * Pure fold building every runway's current state in a single pass over an
 * already-sliced `visibleEvents` prefix (see `eventsUpTo`) — deliberately
 * stateless/derived (not an incremental accumulator) so jumping backwards in
 * time or resetting to t=0 is correct by construction, with no mutable
 * "current occupancy" to forget to clear.
 *
 * Computing every runway's state in one pass (rather than the caller looping
 * runways and re-scanning the whole prefix per runway) matters at high replay
 * speeds: with N runways this is the difference between one O(events) scan
 * and N of them every tick, and ticks fire up to 8 times a second at 8x speed.
 */
export function deriveRunwayStates(visibleEvents: SimulationEvent[]): Map<number, RunwayState> {
  const states = new Map<number, RunwayState>();

  const stateFor = (runwayId: number): RunwayState => {
    let state = states.get(runwayId);
    if (!state) {
      state = { occupiedByAircraftId: null, closureReason: null };
      states.set(runwayId, state);
    }
    return state;
  };

  for (const evt of visibleEvents) {
    if (evt.type === 'runwayOccupy') {
      stateFor(evt.runwayId).occupiedByAircraftId = evt.aircraftId;
    } else if (evt.type === 'runwayVacate') {
      stateFor(evt.runwayId).occupiedByAircraftId = null;
    } else if (evt.type === 'closureStart') {
      stateFor(evt.runwayId).closureReason = evt.reason ?? 'Closed';
    } else if (evt.type === 'closureEnd') {
      stateFor(evt.runwayId).closureReason = null;
    }
  }

  return states;
}

export interface QueuedAircraft {
  aircraftId: number;
  queueEntryTime: number;
  waitingMinutes: number;
  /** Current priority score (lower = higher priority), accumulated from every
   * emergency event recorded for this aircraft since it joined the queue —
   * mirrors the backend's `PriorityTracker.boost()`, which is cumulative
   * across repeated/escalating emergencies, not just the most recent one. */
  priorityScore: number;
}

/**
 * Pure fold: aircraft that have entered a queue by time `t` but have neither
 * been assigned a runway nor reached a terminal outcome yet, sorted by
 * current priority first (any emergency always outranks a normal aircraft,
 * matching the engine's actual selection order — see the brief's "Emergency,
 * then FIFO" rule), then longest-waiting-first among equal priority.
 *
 * Takes an already-sliced `visibleEvents` prefix (see `eventsUpTo`) rather
 * than slicing internally — the caller typically already has this prefix
 * computed once per tick for other purposes, and re-slicing per queue is
 * wasted work at high replay speeds where ticks fire several times a second.
 */
export function deriveQueue(visibleEvents: SimulationEvent[], t: number): QueuedAircraft[] {
  const queueEntryTimeByAircraft = new Map<number, number>();
  const priorityScoreByAircraft = new Map<number, number>();

  for (const evt of visibleEvents) {
    if (evt.type === 'queueEnter') {
      queueEntryTimeByAircraft.set(evt.aircraftId, evt.time);
      priorityScoreByAircraft.set(evt.aircraftId, BASE_PRIORITY);
    } else if (evt.type === 'runwayOccupy' || evt.type === 'outcome') {
      queueEntryTimeByAircraft.delete(evt.aircraftId);
      priorityScoreByAircraft.delete(evt.aircraftId);
    } else if (evt.type === 'emergency' && priorityScoreByAircraft.has(evt.aircraftId)) {
      const boost = EVENT_PRIORITY_BOOSTS[evt.eventType] ?? 0;
      const current = priorityScoreByAircraft.get(evt.aircraftId) ?? BASE_PRIORITY;
      priorityScoreByAircraft.set(evt.aircraftId, Math.max(0, current - boost));
    }
  }

  return Array.from(queueEntryTimeByAircraft.entries())
    .map(([aircraftId, queueEntryTime]) => ({
      aircraftId,
      queueEntryTime,
      waitingMinutes: t - queueEntryTime,
      priorityScore: priorityScoreByAircraft.get(aircraftId) ?? BASE_PRIORITY,
    }))
    .sort((a, b) => a.priorityScore - b.priorityScore || a.queueEntryTime - b.queueEntryTime);
}
