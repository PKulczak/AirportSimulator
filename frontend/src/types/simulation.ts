import type { SimulationRunwayConfig } from './runway';

export type SimulationStatus = 'Pending' | 'Running' | 'Complete' | 'Error' | 'Cancelled';

/** Aggregate info for a batch/sweep, carried on its representative row in the
 * history list (GET /api/simulations/ collapses a batch's N runs down to
 * one). `rangeMin`/`rangeMax` are the swept variable's bounds across every
 * run in the batch — null if the batch has no recorded swept variable. */
export interface BatchSummary {
  sweptVariable: SweepVariable | null;
  runCount: number;
  statusCounts: Record<SimulationStatus, number>;
  rangeMin: number | null;
  rangeMax: number | null;
}

/** List-shape DTO, from GET /api/simulations/ and the create response. A row
 * with `batchId` set represents an entire sweep, collapsed to one item —
 * `batchSummary` carries the aggregate the individual runs no longer show
 * here (see BatchSummary). */
export interface Simulation {
  id: number;
  name: string;
  status: SimulationStatus;
  arrivalRatePerHour: number;
  departureRatePerHour: number;
  durationMinutes: number;
  maxWaitMinutes: number;
  aircraftSpeedKnots: number;
  includeClosures: boolean;
  createdAt: string;
  completedAt: string | null;
  runwayCount: number;
  /** The sweep/batch this run belongs to, or null for a standalone run. */
  batchId: number | null;
  batchSummary: BatchSummary | null;
}

/** GET /api/simulations/{id}/config/ — a run's full creation config, shaped to
 * round-trip straight back into a CreateSimulationRequest (the Duplicate flow). */
export interface SimulationConfig {
  id: number;
  name: string;
  arrivalRatePerHour: number;
  departureRatePerHour: number;
  durationMinutes: number;
  maxWaitMinutes: number;
  aircraftSpeedKnots: number;
  includeClosures: boolean;
  randomSeed: number | null;
  runways: SimulationRunwayConfig[];
}

/** POST /api/simulations/ request body. */
export interface CreateSimulationRequest {
  name: string;
  arrivalRatePerHour: number;
  departureRatePerHour: number;
  durationMinutes: number;
  maxWaitMinutes: number;
  aircraftSpeedKnots?: number;
  includeClosures: boolean;
  /** Optional reproducibility seed; omit for a fresh random run. */
  randomSeed?: number;
  runways: SimulationRunwayConfig[];
}

/** The base-config field a sweep steps — matches the backend's
 * `SWEEPABLE_VARIABLES` wire-level keys exactly. */
export type SweepVariable =
  | 'arrivalRatePerHour'
  | 'departureRatePerHour'
  | 'durationMinutes'
  | 'maxWaitMinutes';

/** POST /api/simulations/sweep/ request body — a CreateSimulationRequest base
 * config plus which field to step and its range. The base config's own value
 * for `variable` is the sweep's starting point. */
export interface CreateSweepRequest extends CreateSimulationRequest {
  variable: SweepVariable;
  rangeEnd: number;
  rangeStep: number;
}

/** POST /api/simulations/sweep/ response. */
export interface SweepResponse {
  batchId: number;
  simulations: Simulation[];
}
