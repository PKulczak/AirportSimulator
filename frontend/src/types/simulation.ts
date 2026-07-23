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

/** POST /api/simulations/ request body. */
export interface CreateSimulationRequest {
  name: string;
  arrivalRatePerHour: number;
  departureRatePerHour: number;
  durationMinutes: number;
  maxWaitMinutes: number;
  aircraftSpeedKnots?: number;
  includeClosures: boolean;
  runways: SimulationRunwayConfig[];
}
