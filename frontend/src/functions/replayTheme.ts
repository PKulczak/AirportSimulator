import type { OperatingMode } from '../types/runway';
import type { AircraftEventType } from '../types/visualisation';

/** Shared colour/label mapping so the legend, runway cards, and queue rows
 * all agree on what each operating mode / emergency type looks like. */
export const OPERATING_MODE_STYLE: Record<OperatingMode, { label: string; bg: string }> = {
  ArrivalsOnly: { label: 'Landing', bg: 'bg-mode-landing' },
  DeparturesOnly: { label: 'Takeoff', bg: 'bg-mode-takeoff' },
  Mixed: { label: 'Mixed', bg: 'bg-mode-mixed' },
};

export const MODE_LEGEND = (Object.keys(OPERATING_MODE_STYLE) as OperatingMode[]).map((mode) => ({
  mode,
  ...OPERATING_MODE_STYLE[mode],
}));

/** FuelCritical is an escalation of LowFuel, not a distinct legend category —
 * both map to the same "Low Fuel" swatch. */
export const EMERGENCY_TYPE_STYLE: Record<AircraftEventType, { label: string; dot: string }> = {
  LowFuel: { label: 'Low Fuel', dot: 'bg-alert-lowfuel' },
  FuelCritical: { label: 'Low Fuel', dot: 'bg-alert-lowfuel' },
  MechanicalFailure: { label: 'Mechanical Failure', dot: 'bg-alert-mechanical' },
  PassengerHealth: { label: 'Passenger Health', dot: 'bg-alert-passenger' },
};

export const EMERGENCY_LEGEND = [
  { label: 'Low Fuel', dot: 'bg-alert-lowfuel' },
  { label: 'Mechanical Failure', dot: 'bg-alert-mechanical' },
  { label: 'Passenger Health', dot: 'bg-alert-passenger' },
];
