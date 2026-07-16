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

export interface RunwayStat {
  runwayId: number;
  identifier: string;
  operatingMode: OperatingMode;
  operationalStatus: OperationalStatus;
  totalAssigned: number;
  successCount: number;
  closureCount: number;
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
  runwayStats: RunwayStat[];
  closureEventCount: number;
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
