import type { OperatingMode, OperationalStatus } from '../types/runway';
import type { AircraftEventType } from '../types/visualisation';

/** Shared colour/label mapping so the legend, runway cards, and queue rows
 * all agree on what each operating mode / emergency type looks like. `fill` is
 * a brighter, more vivid version of `bg`, used for the runway progress bar that
 * tracks behind the plane as it moves along the runway. */
export const OPERATING_MODE_STYLE: Record<
  OperatingMode,
  { label: string; bg: string; fill: string }
> = {
  ArrivalsOnly: { label: 'Landing', bg: 'bg-mode-landing', fill: 'bg-mode-landing-fill' },
  DeparturesOnly: { label: 'Takeoff', bg: 'bg-mode-takeoff', fill: 'bg-mode-takeoff-fill' },
  Mixed: { label: 'Mixed', bg: 'bg-mode-mixed', fill: 'bg-mode-mixed-fill' },
};

export const MODE_LEGEND = (Object.keys(OPERATING_MODE_STYLE) as OperatingMode[]).map((mode) => ({
  mode,
  ...OPERATING_MODE_STYLE[mode],
}));

/** FuelCritical is an escalation of LowFuel, not a distinct legend category —
 * both map to the same "Low Fuel" swatch. `glowColor` is a raw CSS colour
 * (not a Tailwind class) since it's consumed via the `--glow-color` custom
 * property that drives the `.emergency-glow` flicker animation. */
export const EMERGENCY_TYPE_STYLE: Record<
  AircraftEventType,
  { label: string; dot: string; glowColor: string }
> = {
  LowFuel: { label: 'Low Fuel', dot: 'bg-alert-lowfuel', glowColor: 'var(--color-alert-lowfuel)' },
  FuelCritical: {
    label: 'Low Fuel',
    dot: 'bg-alert-lowfuel',
    glowColor: 'var(--color-alert-lowfuel)',
  },
  MechanicalFailure: {
    label: 'Mechanical Failure',
    dot: 'bg-alert-mechanical',
    glowColor: 'var(--color-alert-mechanical)',
  },
  PassengerHealth: {
    label: 'Passenger Health',
    dot: 'bg-alert-passenger',
    glowColor: 'var(--color-alert-passenger)',
  },
};

export const EMERGENCY_LEGEND = [
  { label: 'Low Fuel', dot: 'bg-alert-lowfuel' },
  { label: 'Mechanical Failure', dot: 'bg-alert-mechanical' },
  { label: 'Passenger Health', dot: 'bg-alert-passenger' },
];

/** Closed-reason colour/label mapping shared by the runway card, the runway
 * stats table, and the closure legend — `Available` has no swatch since it's
 * the "not closed" state and never rendered as a closure reason. */
export const OPERATIONAL_STATUS_STYLE: Record<
  OperationalStatus,
  { label: string; dot: string }
> = {
  Available: { label: 'Available', dot: 'bg-emerald-500' },
  RunwayInspection: { label: 'Runway Inspection', dot: 'bg-status-inspection' },
  SnowClearance: { label: 'Snow Clearance', dot: 'bg-status-snow' },
  EquipmentFailure: { label: 'Equipment Failure', dot: 'bg-status-equipment' },
};

export const CLOSURE_REASON_LEGEND = (
  Object.keys(OPERATIONAL_STATUS_STYLE) as OperationalStatus[]
)
  .filter((status) => status !== 'Available')
  .map((status) => ({ status, ...OPERATIONAL_STATUS_STYLE[status] }));
