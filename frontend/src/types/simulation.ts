import type { SimulationRunwayConfig } from './runway';

export type SimulationStatus = 'Pending' | 'Running' | 'Complete' | 'Error';

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
