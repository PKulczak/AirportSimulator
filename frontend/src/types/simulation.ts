import type { SimulationRunwayConfig } from './runway';

export type SimulationStatus = 'Pending' | 'Running' | 'Complete' | 'Error' | 'Cancelled';

/** List-shape DTO, from GET /api/simulations/ and the create response. */
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
