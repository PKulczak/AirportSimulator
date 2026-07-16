import type { OperatingMode } from './runway';

export type MovementType = 'Arrival' | 'Departure';
export type AircraftOutcome = 'Pending' | 'Success' | 'Diverted' | 'Cancelled';
export type AircraftEventType =
  | 'LowFuel'
  | 'FuelCritical'
  | 'MechanicalFailure'
  | 'PassengerHealth';
export type RunwayEventType = 'Closed' | 'Reopened';

/** Wire-format per-aircraft emergency/priority event: `occurredAt` is an absolute
 * ISO-8601 timestamp, per GET /api/simulations/{id}/visualisation/. */
export interface AircraftEventWire {
  id: number;
  eventType: AircraftEventType;
  occurredAt: string;
  priorityBoost: number;
  detail: string | null;
}

/** Wire-format per-aircraft record. All `*Time`/`occurredAt` fields are absolute
 * ISO-8601 timestamps (relative to the response's `startedAt`), not minute-offsets —
 * see `normalizeVisualisation()` for the conversion into the minute-offset domain
 * model the replay engine operates on. */
export interface AircraftVisualisationWire {
  id: number;
  callsign: string;
  operator: string;
  originDestination: string;
  movementType: MovementType;
  initialFuelMinutes: number;
  scheduledTime: string;
  queueEntryTime: string | null;
  runwayAssignedTime: string | null;
  completionTime: string | null;
  waitMinutes: number | null;
  outcome: AircraftOutcome;
  runwayId: number | null;
  finalPriorityScore: number;
  events: AircraftEventWire[];
}

/** Wire-format runway closure event, nested under a runway's `closureEvents[]`. */
export interface RunwayEventWire {
  id: number;
  eventType: RunwayEventType;
  occurredAt: string;
  reason: string | null;
}

export interface RunwayVisualisationWire {
  id: number;
  runwayId: number;
  identifier: string;
  operatingMode: OperatingMode;
  operationalStatus: string;
  closureEvents: RunwayEventWire[];
}

/** Raw response shape from GET /api/simulations/{id}/visualisation/. */
export interface VisualisationResponseWire {
  id: number;
  name: string;
  status: 'Pending' | 'Running' | 'Complete' | 'Error';
  startedAt: string | null;
  durationMinutes: number;
  maxWaitMinutes: number;
  aircraftSpeedKnots: number;
  aircraft: AircraftVisualisationWire[];
  runways: RunwayVisualisationWire[];
}

/** Raw per-aircraft emergency/priority event, nested under an aircraft's `events[]`. */
export interface AircraftEventRaw {
  id: number;
  eventType: AircraftEventType;
  occurredAt: number;
  priorityBoost: number;
  detail: string | null;
}

/** Normalized per-aircraft record used by the replay engine. All times are
 * minute-offsets from simulation start (`startedAt` in the wire response). */
export interface AircraftVisualisation {
  id: number;
  callsign: string;
  operator: string;
  originDestination: string;
  movementType: MovementType;
  initialFuelMinutes: number;
  scheduledTime: number;
  queueEntryTime: number | null;
  runwayAssignedTime: number | null;
  completionTime: number | null;
  waitMinutes: number | null;
  outcome: AircraftOutcome;
  runwayId: number | null;
  finalPriorityScore: number;
  events: AircraftEventRaw[];
}

/** Normalized runway closure event, nested under a runway's `closureEvents[]`. */
export interface RunwayEventRaw {
  id: number;
  eventType: RunwayEventType;
  occurredAt: number;
  reason: string | null;
}

export interface RunwayVisualisation {
  id: number;
  runwayId: number;
  identifier: string;
  operatingMode: OperatingMode;
  closureEvents: RunwayEventRaw[];
}

/** Normalized visualisation payload (minute-offset times) the replay engine
 * operates on, produced from `VisualisationResponseWire` by `normalizeVisualisation()`. */
export interface VisualisationResponse {
  id: number;
  name: string;
  durationMinutes: number;
  aircraft: AircraftVisualisation[];
  runways: RunwayVisualisation[];
}

// ---------------------------------------------------------------------------
// Derived replay-engine timeline, built by functions/visualisationHelpers.ts.
// Every variant carries a `time` (minute-offset) so the whole array can be
// sorted once and then folded up to any point in time.
// ---------------------------------------------------------------------------

interface SimulationEventBase {
  time: number;
}

export interface ArrivalEvent extends SimulationEventBase {
  type: 'arrival';
  aircraftId: number;
}

export interface DepartureEvent extends SimulationEventBase {
  type: 'departure';
  aircraftId: number;
}

export interface QueueEnterEvent extends SimulationEventBase {
  type: 'queueEnter';
  aircraftId: number;
}

export interface RunwayOccupyEvent extends SimulationEventBase {
  type: 'runwayOccupy';
  aircraftId: number;
  runwayId: number;
}

export interface RunwayVacateEvent extends SimulationEventBase {
  type: 'runwayVacate';
  aircraftId: number;
  runwayId: number;
}

export interface EmergencyEvent extends SimulationEventBase {
  type: 'emergency';
  aircraftId: number;
  eventType: AircraftEventType;
  detail: string | null;
}

export interface OutcomeEvent extends SimulationEventBase {
  type: 'outcome';
  aircraftId: number;
  outcome: AircraftOutcome;
}

export interface ClosureStartEvent extends SimulationEventBase {
  type: 'closureStart';
  runwayId: number;
  reason: string | null;
}

export interface ClosureEndEvent extends SimulationEventBase {
  type: 'closureEnd';
  runwayId: number;
}

export type SimulationEvent =
  | ArrivalEvent
  | DepartureEvent
  | QueueEnterEvent
  | RunwayOccupyEvent
  | RunwayVacateEvent
  | EmergencyEvent
  | OutcomeEvent
  | ClosureStartEvent
  | ClosureEndEvent;
