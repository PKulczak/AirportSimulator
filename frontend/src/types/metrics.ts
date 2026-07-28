import type { SimulationStatus } from './simulation';
import type { OperatingMode, OperationalStatus } from './runway';

export interface OutcomeCounts {
  success: number;
  diverted: number;
  cancelled: number;
  pending: number;
  total: number;
}

export interface WaitTimeStats {
  averageMinutes: number | null;
  maxMinutes: number | null;
}

export interface DelayStats {
  averageMinutes: number | null;
  maxMinutes: number | null;
}

export interface MovementDelayStats {
  arrival: DelayStats;
  departure: DelayStats;
}

export interface QueueDepthStats {
  arrival: number;
  departure: number;
}

export interface RunwayStat {
  runwayId: number;
  identifier: string;
  operatingMode: OperatingMode;
  /** End-of-run status (mutated by random closures during the run). */
  operationalStatus: OperationalStatus;
  /** Status as configured at creation — use this to reproduce/clone the run. */
  initialOperationalStatus: OperationalStatus;
  totalAssigned: number;
  successCount: number;
  closureCount: number;
  /** Minutes the runway was open (not closed) within the simulation duration. */
  openMinutes: number;
}

export type TimelineEventType = 'Diverted' | 'Cancelled' | 'Closed' | 'Reopened';

/** A single point-in-time incident for the summary timeline: an aircraft
 * diversion/cancellation, or a runway closure starting/ending. There's no
 * "un-diverted" counterpart for aircraft — every marker represents one
 * instant, not a start/end pair (closures and reopenings are two separate
 * instants, not one interval). */
export interface TimelineEvent {
  timeMinutes: number;
  type: TimelineEventType;
  runwayIdentifier: string | null;
  detail: string | null;
}

/** GET /api/simulations/{id}/detail/ when the simulation has finished running. */
export interface SimulationDetail {
  id: number;
  name: string;
  status: 'Complete';
  arrivalRatePerHour: number;
  departureRatePerHour: number;
  durationMinutes: number;
  maxWaitMinutes: number;
  aircraftSpeedKnots: number;
  includeClosures: boolean;
  /** Reproducibility seed, or null if the run used a fresh random seed. */
  randomSeed: number | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  successRate: number;
  outcomeCounts: OutcomeCounts;
  waitTimeStats: WaitTimeStats;
  delayStats: MovementDelayStats;
  queueDepthStats: QueueDepthStats;
  runwayStats: RunwayStat[];
  closureEventCount: number;
  timelineEvents: TimelineEvent[];
}

/** GET /api/simulations/{id}/detail/ while the simulation hasn't finished (or errored). */
export interface SimulationNotComplete {
  id: number;
  name: string;
  status: Exclude<SimulationStatus, 'Complete'>;
  errorMessage?: string | null;
}

export type SimulationDetailResponse = SimulationDetail | SimulationNotComplete;

export function isDetailComplete(
  detail: SimulationDetailResponse,
): detail is SimulationDetail {
  return detail.status === 'Complete';
}
