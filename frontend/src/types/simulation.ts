import type { SimulationRunwayConfig } from './runway';

export type SimulationStatus = 'Pending' | 'Running' | 'Complete' | 'Error' | 'Cancelled';

/** Scales runway-operation time, wake-separation minima, and (when closures
 * are enabled) closure frequency/reason mix — see the backend's
 * `constants.WEATHER_OPERATION_MULTIPLIER` et al. `Clear` is the neutral
 * baseline. */
export type WeatherCondition = 'Clear' | 'Windy' | 'Snow' | 'LowVisibility';

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
  /** Optional Heavy/Medium/Light traffic-mix override (percent, sums to 100);
   * all three null means the engine's default mix was used. */
  heavyPercentage: number | null;
  mediumPercentage: number | null;
  lightPercentage: number | null;
  weatherCondition: WeatherCondition;
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
  /** Optional Heavy/Medium/Light traffic-mix override (percent, sums to 100);
   * omit all three to use the engine's default mix. */
  heavyPercentage?: number;
  mediumPercentage?: number;
  lightPercentage?: number;
  /** Omit to use the server's default (Clear). */
  weatherCondition?: WeatherCondition;
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

/** POST /api/simulations/{id}/share/ response (Slice 10.1) — a shareable,
 * unguessable token granting read-only access to this one run's detail +
 * visualisation, with no login required. Idempotent: repeated calls for the
 * same run return the same token rather than minting a new one. */
export interface ShareLink {
  token: string;
  createdAt: string;
}
