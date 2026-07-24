import { z } from 'zod';
import type { CreateSimulationRequest } from '../types/simulation';
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

export const simulationFormSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Name is required')
      .max(120, 'Name is too long')
      .regex(
        /^[\p{L}\p{N}\s.,'()_#:/&-]+$/u,
        'Name can only contain letters, numbers, spaces, and basic punctuation',
      ),
    arrivalRate: z.number().min(0, 'Must be zero or greater').max(100, 'Must be 100 or fewer per hour'),
    departureRate: z.number().min(0, 'Must be zero or greater').max(100, 'Must be 100 or fewer per hour'),
    durationMinutes: z
      .number()
      .int()
      .min(10, 'Must run for at least 10 minutes')
      .max(1440, 'Must be 24 hours or less'),
    maxWaitMinutes: z.number().int().min(1, 'Must be at least 1 minute'),
    includeClosures: z.boolean(),
    runwayIds: z
      .array(z.number())
      .min(1, 'Select at least one runway')
      .max(MAX_RUNWAYS, `At most ${MAX_RUNWAYS} runways may be selected`),
    runwayModes: z.record(z.string(), operatingModeSchema),
    runwayInitialStatus: z.record(z.string(), operationalStatusSchema),
  })
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
  runwayIds: [],
  runwayModes: {},
  runwayInitialStatus: {},
};

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
    runways: values.runwayIds.map((runwayId) => ({
      runwayId,
      operatingMode: values.runwayModes[String(runwayId)] as OperatingMode,
      operationalStatus:
        (values.runwayInitialStatus[String(runwayId)] as OperationalStatus) ?? 'Available',
    })),
  };
}
