import type { WeatherCondition } from './simulation';
import type { SimulationRunwayConfig } from './runway';

/** A saved, named simulation config (Slice 8.1), reusable to pre-fill the
 * create form. `name` identifies the saved preset itself — distinct from any
 * simulation's own `name`, which is chosen fresh each time a template is
 * applied. From GET /api/templates/ and the create response. */
export interface Template {
  id: number;
  name: string;
  arrivalRatePerHour: number;
  departureRatePerHour: number;
  durationMinutes: number;
  maxWaitMinutes: number;
  aircraftSpeedKnots: number;
  includeClosures: boolean;
  randomSeed: number | null;
  heavyPercentage: number | null;
  mediumPercentage: number | null;
  lightPercentage: number | null;
  weatherCondition: WeatherCondition;
  runways: SimulationRunwayConfig[];
  createdAt: string;
  /** Slice B.1 — true when `owner` is null, i.e. visible to every user, not
   * just its creator. Only staff can create one (see `CreateTemplateRequest`'s
   * `isGlobal`); a non-staff caller can see one but never rename/delete it. */
  isGlobal: boolean;
}

/** POST /api/templates/ request body. */
export interface CreateTemplateRequest {
  name: string;
  arrivalRatePerHour: number;
  departureRatePerHour: number;
  durationMinutes: number;
  maxWaitMinutes: number;
  includeClosures: boolean;
  randomSeed?: number;
  heavyPercentage?: number;
  mediumPercentage?: number;
  lightPercentage?: number;
  weatherCondition?: WeatherCondition;
  runways: SimulationRunwayConfig[];
  /** Slice B.1 — "make this template available to everyone." Only honoured
   * server-side when the caller is staff; ignored otherwise, so it's safe to
   * omit entirely for non-staff callers. */
  isGlobal?: boolean;
}
