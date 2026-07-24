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
  operationalStatus: OperationalStatus;
  totalAssigned: number;
  successCount: number;
  closureCount: number;
}

export type TimelineEventType = 'Diverted' | 'Cancelled' | 'Closed';

/** A single point-in-time incident for the summary timeline: an aircraft
 * diversion/cancellation, or a runway closure starting. There's no
 * reopened/un-diverted counterpart — every marker represents one instant,
 * not a start/end pair. */
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
