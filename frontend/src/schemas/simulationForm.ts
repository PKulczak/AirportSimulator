import { z } from 'zod';
import type {
  CreateSimulationRequest,
  CreateSweepRequest,
  SimulationConfig,
  SweepVariable,
} from '../types/simulation';
import type { SimulationDetail } from '../types/metrics';
import type { OperatingMode, OperationalStatus } from '../types/runway';

export const operatingModeSchema = z.enum(['ArrivalsOnly', 'DeparturesOnly', 'Mixed']);

export const operationalStatusSchema = z.enum([
  'Available',
  'RunwayInspection',
  'SnowClearance',
  'EquipmentFailure',
]);

/** Mirrors the backend's `SimulationCreationDto.MAX_RUNWAYS` cap. */
export const MAX_RUNWAYS = 10;

/** Allowed simulation-name characters — mirrors the backend `NAME_PATTERN`
 * (letters/numbers/whitespace + basic punctuation). Shared by the create form
 * and the rename dialog so both accept exactly the same names. */
export const SIMULATION_NAME_REGEX = /^[\p{L}\p{N}\s.,'()_#:/&-]+$/u;
export const SIMULATION_NAME_MAX = 120;
export const SIMULATION_NAME_INVALID_MESSAGE =
  'Name can only contain letters, numbers, spaces, and basic punctuation';

/** Client-side name check shared by the create form and rename dialog; returns
 * an error message or null. */
export function validateSimulationName(raw: string): string | null {
  const name = raw.trim();
  if (!name) {
    return 'Name is required';
  }
  if (name.length > SIMULATION_NAME_MAX) {
    return 'Name is too long';
  }
  if (!SIMULATION_NAME_REGEX.test(name)) {
    return SIMULATION_NAME_INVALID_MESSAGE;
  }
  return null;
}

/** The raw field shape shared by the create form and the sweep form — kept
 * separate from `simulationFormSchema`'s `.refine()` chain below so the sweep
 * schema can `.extend()` it (Zod effects/refinements can't be extended). */
const simulationFormBaseSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Name is required')
      .max(SIMULATION_NAME_MAX, 'Name is too long')
      .regex(SIMULATION_NAME_REGEX, SIMULATION_NAME_INVALID_MESSAGE),
    arrivalRate: z.number().min(0, 'Must be zero or greater').max(100, 'Must be 100 or fewer per hour'),
    departureRate: z.number().min(0, 'Must be zero or greater').max(100, 'Must be 100 or fewer per hour'),
    durationMinutes: z
      .number()
      .int()
      .min(10, 'Must run for at least 10 minutes')
      .max(1440, 'Must be 24 hours or less'),
    maxWaitMinutes: z.number().int().min(1, 'Must be at least 1 minute'),
    includeClosures: z.boolean(),
    // Optional reproducibility seed; null (blank field) = a fresh random run.
    // Bounds mirror the backend DTO (non-negative signed-32-bit int).
    randomSeed: z
      .number()
      .int('Seed must be a whole number')
      .min(0, 'Seed must be zero or greater')
      .max(2147483647, 'Seed is too large')
      .nullable(),
    runwayIds: z
      .array(z.number())
      .min(1, 'Select at least one runway')
      .max(MAX_RUNWAYS, `At most ${MAX_RUNWAYS} runways may be selected`),
    runwayModes: z.record(z.string(), operatingModeSchema),
    runwayInitialStatus: z.record(z.string(), operationalStatusSchema),
  });

export const simulationFormSchema = simulationFormBaseSchema
  .refine(
    // Integer-only comparison (maxWait * 10 <= duration * 9) instead of
    // `maxWaitMinutes <= durationMinutes * 0.9` — avoids floating-point
    // rounding at the threshold (e.g. 60 * 0.9 not landing exactly on 54).
    (data) => data.maxWaitMinutes * 10 <= data.durationMinutes * 9,
    {
      message: 'Max wait time must be at most 90% of the simulation duration',
      path: ['maxWaitMinutes'],
    },
  )
  .superRefine((data, ctx) => {
    if (data.arrivalRate <= 0 && data.departureRate <= 0) {
      const message = 'At least one of arrival or departure rate must be greater than zero';
      ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: ['arrivalRate'] });
      ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: ['departureRate'] });
    }
  })
  .refine(
    (data) => data.runwayIds.every((id) => data.runwayModes[String(id)] !== undefined),
    {
      message: 'Every selected runway needs an operating mode',
      path: ['runwayModes'],
    },
  )
  .refine(
    (data) =>
      data.arrivalRate <= 0 ||
      data.runwayIds.some((id) => {
        const mode = data.runwayModes[String(id)];
        return mode === 'ArrivalsOnly' || mode === 'Mixed';
      }),
    {
      message: 'At least one selected runway must accept arrivals',
      path: ['runwayModes'],
    },
  )
  .refine(
    (data) =>
      data.departureRate <= 0 ||
      data.runwayIds.some((id) => {
        const mode = data.runwayModes[String(id)];
        return mode === 'DeparturesOnly' || mode === 'Mixed';
      }),
    {
      message: 'At least one selected runway must accept departures',
      path: ['runwayModes'],
    },
  )
  .refine(
    (data) =>
      data.arrivalRate <= 0 ||
      data.runwayIds.some((id) => {
        const mode = data.runwayModes[String(id)];
        const status = data.runwayInitialStatus[String(id)] ?? 'Available';
        return (mode === 'ArrivalsOnly' || mode === 'Mixed') && status === 'Available';
      }),
    {
      message: 'At least one runway accepting arrivals must start out Available',
      path: ['runwayModes'],
    },
  )
  .refine(
    (data) =>
      data.departureRate <= 0 ||
      data.runwayIds.some((id) => {
        const mode = data.runwayModes[String(id)];
        const status = data.runwayInitialStatus[String(id)] ?? 'Available';
        return (mode === 'DeparturesOnly' || mode === 'Mixed') && status === 'Available';
      }),
    {
      message: 'At least one runway accepting departures must start out Available',
      path: ['runwayModes'],
    },
  )
  .refine((data) => !data.includeClosures || data.runwayIds.length >= 2, {
    message: 'Select at least 2 runways when random runway closures are enabled',
    path: ['runwayIds'],
  });

export type SimulationFormValues = z.infer<typeof simulationFormSchema>;

export const defaultSimulationFormValues: SimulationFormValues = {
  name: '',
  arrivalRate: 10,
  departureRate: 10,
  durationMinutes: 120,
  maxWaitMinutes: 20,
  includeClosures: false,
  randomSeed: null,
  runwayIds: [],
  runwayModes: {},
  runwayInitialStatus: {},
};

export const SWEEP_VARIABLE_OPTIONS: { label: string; value: SweepVariable }[] = [
  { label: 'Arrivals Per Hour', value: 'arrivalRatePerHour' },
  { label: 'Departures Per Hour', value: 'departureRatePerHour' },
  { label: 'Duration (Minutes)', value: 'durationMinutes' },
  { label: 'Max Wait Time (Minutes)', value: 'maxWaitMinutes' },
];

/** Max sweep runs — mirrors the backend's `SimulationSweepCreationDto.MAX_SWEEP_RUNS`. */
export const MAX_SWEEP_RUNS = 50;

function sweepStartValue(
  data: { arrivalRate: number; departureRate: number; durationMinutes: number; maxWaitMinutes: number },
  variable: SweepVariable,
): number {
  switch (variable) {
    case 'arrivalRatePerHour':
      return data.arrivalRate;
    case 'departureRatePerHour':
      return data.departureRate;
    case 'durationMinutes':
      return data.durationMinutes;
    case 'maxWaitMinutes':
      return data.maxWaitMinutes;
  }
}

/** The sweep form reuses the base config fields and a subset of the create
 * form's cross-field checks. Deliberately does NOT re-check the
 * runway-acceptance rules (e.g. "an arrivals-accepting runway must be
 * Available") here: those depend on the exact swept value, so a check against
 * only the *starting* value would give false confidence — a later step in the
 * range could still violate it. The backend re-validates every generated run
 * independently and reports which stepped value failed; that's the source of
 * truth for this class of error. */
export const sweepFormSchema = simulationFormBaseSchema
  .extend({
    variable: z.enum(['arrivalRatePerHour', 'departureRatePerHour', 'durationMinutes', 'maxWaitMinutes']),
    rangeEnd: z.number(),
    rangeStep: z.number().int().min(1, 'Step must be at least 1'),
  })
  .refine((data) => data.maxWaitMinutes * 10 <= data.durationMinutes * 9, {
    message: 'Max wait time must be at most 90% of the simulation duration',
    path: ['maxWaitMinutes'],
  })
  .superRefine((data, ctx) => {
    if (data.arrivalRate <= 0 && data.departureRate <= 0) {
      const message = 'At least one of arrival or departure rate must be greater than zero';
      ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: ['arrivalRate'] });
      ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: ['departureRate'] });
    }
  })
  .refine((data) => data.runwayIds.every((id) => data.runwayModes[String(id)] !== undefined), {
    message: 'Every selected runway needs an operating mode',
    path: ['runwayModes'],
  })
  .refine((data) => !data.includeClosures || data.runwayIds.length >= 2, {
    message: 'Select at least 2 runways when random runway closures are enabled',
    path: ['runwayIds'],
  })
  .refine((data) => data.rangeEnd >= sweepStartValue(data, data.variable), {
    message: "Must be greater than or equal to the swept variable's base value",
    path: ['rangeEnd'],
  })
  .superRefine((data, ctx) => {
    const start = sweepStartValue(data, data.variable);
    const stepCount = Math.floor((data.rangeEnd - start) / data.rangeStep) + 1;
    if (data.rangeEnd >= start && stepCount < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'The range and step must produce at least 2 runs to form a sweep',
        path: ['rangeStep'],
      });
    }
    if (data.rangeEnd >= start && stepCount > MAX_SWEEP_RUNS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `A sweep can create at most ${MAX_SWEEP_RUNS} runs (this range/step would create ${stepCount})`,
        path: ['rangeStep'],
      });
    }
  });

export type SweepFormValues = z.infer<typeof sweepFormSchema>;

export const defaultSweepFormValues: SweepFormValues = {
  ...defaultSimulationFormValues,
  variable: 'arrivalRatePerHour',
  rangeEnd: 50,
  rangeStep: 10,
};

export function toCreateSweepRequest(values: SweepFormValues): CreateSweepRequest {
  return {
    ...toCreateSimulationRequest(values),
    variable: values.variable,
    rangeEnd: values.rangeEnd,
    rangeStep: values.rangeStep,
  };
}

/** Maps a fetched run config into create-form values, for the Duplicate flow.
 * Pre-fills identically (name, seed, and each runway's initial mode/status) so
 * the user can tweak and re-submit. `aircraftSpeedKnots` isn't a form field
 * (the form defers to the server default), so it's intentionally dropped. */
export function configToFormValues(config: SimulationConfig): SimulationFormValues {
  const runwayModes: Record<string, OperatingMode> = {};
  const runwayInitialStatus: Record<string, OperationalStatus> = {};
  for (const runway of config.runways) {
    runwayModes[String(runway.runwayId)] = runway.operatingMode;
    runwayInitialStatus[String(runway.runwayId)] = runway.operationalStatus ?? 'Available';
  }
  return {
    name: config.name,
    arrivalRate: config.arrivalRatePerHour,
    departureRate: config.departureRatePerHour,
    durationMinutes: config.durationMinutes,
    maxWaitMinutes: config.maxWaitMinutes,
    includeClosures: config.includeClosures,
    randomSeed: config.randomSeed,
    runwayIds: config.runways.map((runway) => runway.runwayId),
    runwayModes,
    runwayInitialStatus,
  };
}

export function toCreateSimulationRequest(
  values: SimulationFormValues,
): CreateSimulationRequest {
  return {
    name: values.name.trim(),
    arrivalRatePerHour: values.arrivalRate,
    departureRatePerHour: values.departureRate,
    durationMinutes: values.durationMinutes,
    maxWaitMinutes: values.maxWaitMinutes,
    includeClosures: values.includeClosures,
    // Omit entirely when blank so the backend treats it as "no seed" (random).
    ...(values.randomSeed != null ? { randomSeed: values.randomSeed } : {}),
    runways: values.runwayIds.map((runwayId) => ({
      runwayId,
      operatingMode: values.runwayModes[String(runwayId)] as OperatingMode,
      operationalStatus:
        (values.runwayInitialStatus[String(runwayId)] as OperationalStatus) ?? 'Available',
    })),
  };
}

/** Backend name max is 255; the create form caps at 120. Keep re-run names
 * within that so a re-run's name would itself pass the create form's rules. */
function rerunName(base: string): string {
  const suffix = ' (re-run)';
  const room = 120 - suffix.length;
  const trimmed = base.length > room ? base.slice(0, room) : base;
  return `${trimmed}${suffix}`;
}

/** Builds a create request that reproduces a completed run: identical config
 * and, crucially, its fixed `randomSeed` and each runway's *initial* status
 * (not the possibly-closure-mutated end-of-run status). */
export function detailToRerunRequest(detail: SimulationDetail): CreateSimulationRequest {
  return {
    name: rerunName(detail.name),
    arrivalRatePerHour: detail.arrivalRatePerHour,
    departureRatePerHour: detail.departureRatePerHour,
    durationMinutes: detail.durationMinutes,
    maxWaitMinutes: detail.maxWaitMinutes,
    aircraftSpeedKnots: detail.aircraftSpeedKnots,
    includeClosures: detail.includeClosures,
    ...(detail.randomSeed != null ? { randomSeed: detail.randomSeed } : {}),
    runways: detail.runwayStats.map((runway) => ({
      runwayId: runway.runwayId,
      operatingMode: runway.operatingMode,
      operationalStatus: runway.initialOperationalStatus,
    })),
  };
}
