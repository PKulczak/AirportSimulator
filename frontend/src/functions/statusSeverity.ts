import type { SimulationStatus } from '../types/simulation';

/** PrimeReact Tag severity for each simulation status — shared by the history
 * table and the sweep results page's per-run table. */
export const STATUS_SEVERITY: Record<
  SimulationStatus,
  'info' | 'warning' | 'success' | 'danger' | 'secondary'
> = {
  Pending: 'info',
  Running: 'warning',
  Complete: 'success',
  Error: 'danger',
  Cancelled: 'secondary',
};
