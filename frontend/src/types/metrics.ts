import type { SimulationStatus, SweepVariable, WeatherCondition } from './simulation';
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
  /** Optional Heavy/Medium/Light traffic-mix override (percent, sums to 100);
   * all three null means the engine's default mix was used. */
  heavyPercentage: number | null;
  mediumPercentage: number | null;
  lightPercentage: number | null;
  weatherCondition: WeatherCondition;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  /** The sweep/batch this run belongs to, or null for a standalone run —
   * lets the detail page's back button return to the sweep results instead
   * of the history home page. */
  batchId: number | null;
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
  batchId: number | null;
}

export type SimulationDetailResponse = SimulationDetail | SimulationNotComplete;

export function isDetailComplete(
  detail: SimulationDetailResponse,
): detail is SimulationDetail {
  return detail.status === 'Complete';
}

/** One run inside GET /api/simulations/batch/?id=<batchId>. Unlike the
 * single-run /detail/ endpoint (modeled narrowly by SimulationDetailResponse
 * above), the backend's SimulationDetailDto always includes the full config
 * and metric fields regardless of status — a Pending/Running run just has
 * not-yet-meaningful metric values (0s/nulls), rather than omitting them. */
export type BatchRun = Omit<SimulationDetail, 'status'> & {
  status: SimulationStatus;
  errorMessage?: string | null;
};

/** GET /api/simulations/batch/?id=<batchId> — every run in a batch (e.g. a
 * sweep), in creation/step order. `sweptVariable` is null for a batch that
 * isn't a sweep. */
export interface BatchResults {
  batchId: number;
  sweptVariable: SweepVariable | null;
  simulations: BatchRun[];
}
