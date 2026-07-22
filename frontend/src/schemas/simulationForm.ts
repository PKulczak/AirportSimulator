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

export const simulationFormSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(120, 'Name is too long'),
    arrivalRate: z.number().min(0, 'Must be zero or greater').max(500),
    departureRate: z.number().min(0, 'Must be zero or greater').max(500),
    durationMinutes: z
      .number()
      .int()
      .min(10, 'Must run for at least 10 minutes')
      .max(1440, 'Must be 24 hours or less'),
    maxWaitMinutes: z.number().int().min(1, 'Must be at least 1 minute'),
    aircraftSpeedKnots: z.number().min(50).max(700).optional(),
    includeClosures: z.boolean(),
    runwayIds: z.array(z.number()).min(1, 'Select at least one runway'),
    runwayModes: z.record(z.string(), operatingModeSchema),
    runwayInitialStatus: z.record(z.string(), operationalStatusSchema),
  })
  .refine((data) => data.maxWaitMinutes < data.durationMinutes, {
    message: 'Max wait time must be less than the simulation duration',
    path: ['maxWaitMinutes'],
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
  );

export type SimulationFormValues = z.infer<typeof simulationFormSchema>;

export const defaultSimulationFormValues: SimulationFormValues = {
  name: '',
  arrivalRate: 10,
  departureRate: 10,
  durationMinutes: 120,
  maxWaitMinutes: 20,
  aircraftSpeedKnots: undefined,
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
    aircraftSpeedKnots: values.aircraftSpeedKnots,
    includeClosures: values.includeClosures,
    runways: values.runwayIds.map((runwayId) => ({
      runwayId,
      operatingMode: values.runwayModes[String(runwayId)] as OperatingMode,
      operationalStatus:
        (values.runwayInitialStatus[String(runwayId)] as OperationalStatus) ?? 'Available',
    })),
  };
}
