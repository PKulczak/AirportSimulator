import { describe, expect, it } from 'vitest';
import {
  configToFormValues,
  defaultSimulationFormValues,
  detailToRerunRequest,
  simulationFormSchema,
  sweepFormSchema,
  toCreateSimulationRequest,
  toCreateSweepRequest,
  validateSimulationName,
  type SimulationFormValues,
  type SweepFormValues,
} from './simulationForm';
import type { SimulationConfig } from '../types/simulation';
import type { SimulationDetail } from '../types/metrics';

function validFormValues(overrides: Partial<SimulationFormValues> = {}): SimulationFormValues {
  return {
    ...defaultSimulationFormValues,
    name: 'Morning Rush',
    arrivalRate: 20,
    departureRate: 10,
    durationMinutes: 60,
    maxWaitMinutes: 20,
    includeClosures: false,
    randomSeed: null,
    runwayIds: [1],
    runwayModes: { '1': 'Mixed' },
    runwayInitialStatus: { '1': 'Available' },
    ...overrides,
  };
}

function validSweepValues(overrides: Partial<SweepFormValues> = {}): SweepFormValues {
  return {
    ...validFormValues(),
    variable: 'arrivalRatePerHour',
    rangeEnd: 50,
    rangeStep: 10,
    ...overrides,
  };
}

describe('validateSimulationName', () => {
  it('rejects empty or whitespace-only names', () => {
    expect(validateSimulationName('')).toBe('Name is required');
    expect(validateSimulationName('   ')).toBe('Name is required');
  });

  it('rejects names over the max length', () => {
    expect(validateSimulationName('a'.repeat(121))).toBe('Name is too long');
  });

  it('rejects disallowed characters', () => {
    expect(validateSimulationName('Flight <script>')).toMatch(/can only contain/);
  });

  it('accepts a name with basic punctuation', () => {
    expect(validateSimulationName("Morning Rush (v2) - test_run #1")).toBeNull();
  });

  it('trims surrounding whitespace before validating', () => {
    expect(validateSimulationName('  Valid Name  ')).toBeNull();
  });
});

describe('simulationFormSchema', () => {
  it('accepts a valid configuration', () => {
    expect(simulationFormSchema.safeParse(validFormValues()).success).toBe(true);
  });

  it('rejects max wait time over 90% of duration', () => {
    const result = simulationFormSchema.safeParse(
      validFormValues({ durationMinutes: 60, maxWaitMinutes: 55 }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['maxWaitMinutes']);
    }
  });

  it('accepts max wait time at exactly 90% of duration (integer-comparison boundary)', () => {
    const result = simulationFormSchema.safeParse(
      validFormValues({ durationMinutes: 60, maxWaitMinutes: 54 }),
    );
    expect(result.success).toBe(true);
  });

  it('rejects zero arrival and departure rates together', () => {
    const result = simulationFormSchema.safeParse(
      validFormValues({ arrivalRate: 0, departureRate: 0 }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path[0]);
      expect(paths).toContain('arrivalRate');
      expect(paths).toContain('departureRate');
    }
  });

  it('rejects a selected runway with no assigned operating mode', () => {
    const result = simulationFormSchema.safeParse(
      validFormValues({ runwayIds: [1, 2], runwayModes: { '1': 'Mixed' } }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects when no selected runway accepts arrivals', () => {
    const result = simulationFormSchema.safeParse(
      validFormValues({
        arrivalRate: 10,
        departureRate: 0,
        runwayIds: [1],
        runwayModes: { '1': 'DeparturesOnly' },
      }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects when the only arrivals-accepting runway does not start Available', () => {
    const result = simulationFormSchema.safeParse(
      validFormValues({
        arrivalRate: 10,
        departureRate: 0,
        runwayIds: [1],
        runwayModes: { '1': 'Mixed' },
        runwayInitialStatus: { '1': 'SnowClearance' },
      }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects enabling closures with fewer than 2 runways', () => {
    const result = simulationFormSchema.safeParse(
      validFormValues({ includeClosures: true, runwayIds: [1], runwayModes: { '1': 'Mixed' } }),
    );
    expect(result.success).toBe(false);
  });

  it('accepts closures enabled with 2 runways', () => {
    const result = simulationFormSchema.safeParse(
      validFormValues({
        includeClosures: true,
        runwayIds: [1, 2],
        runwayModes: { '1': 'Mixed', '2': 'Mixed' },
        runwayInitialStatus: { '1': 'Available', '2': 'Available' },
      }),
    );
    expect(result.success).toBe(true);
  });
});

describe('sweepFormSchema', () => {
  it('accepts a valid sweep configuration', () => {
    expect(sweepFormSchema.safeParse(validSweepValues()).success).toBe(true);
  });

  it('deliberately omits the runway-acceptance rules the create schema enforces', () => {
    // Data where the only runway can't accept the configured arrivals — fails
    // simulationFormSchema...
    const data = validSweepValues({
      arrivalRate: 10,
      departureRate: 0,
      runwayIds: [1],
      runwayModes: { '1': 'DeparturesOnly' },
    });
    expect(simulationFormSchema.safeParse(data).success).toBe(false);
    // ...but a sweep only knows the *starting* value client-side (a later
    // step could differ), so sweepFormSchema deliberately doesn't check it —
    // see the doc comment above sweepFormSchema.
    expect(sweepFormSchema.safeParse(data).success).toBe(true);
  });

  it('still rejects a selected runway with no operating mode', () => {
    const result = sweepFormSchema.safeParse(
      validSweepValues({ runwayIds: [1, 2], runwayModes: { '1': 'Mixed' } }),
    );
    expect(result.success).toBe(false);
  });

  it('still rejects closures enabled with fewer than 2 runways', () => {
    const result = sweepFormSchema.safeParse(
      validSweepValues({ includeClosures: true, runwayIds: [1], runwayModes: { '1': 'Mixed' } }),
    );
    expect(result.success).toBe(false);
  });
});

describe('toCreateSimulationRequest', () => {
  it('omits randomSeed entirely when null', () => {
    const request = toCreateSimulationRequest(validFormValues({ randomSeed: null }));
    expect(request).not.toHaveProperty('randomSeed');
  });

  it('includes randomSeed when set', () => {
    const request = toCreateSimulationRequest(validFormValues({ randomSeed: 42 }));
    expect(request.randomSeed).toBe(42);
  });

  it('trims the name', () => {
    const request = toCreateSimulationRequest(validFormValues({ name: '  Padded Name  ' }));
    expect(request.name).toBe('Padded Name');
  });

  it('defaults a runway with no recorded initial status to Available', () => {
    const request = toCreateSimulationRequest(
      validFormValues({ runwayIds: [1], runwayModes: { '1': 'Mixed' }, runwayInitialStatus: {} }),
    );
    expect(request.runways).toEqual([
      { runwayId: 1, operatingMode: 'Mixed', operationalStatus: 'Available' },
    ]);
  });
});

describe('toCreateSweepRequest', () => {
  it('carries the base config plus the sweep-specific fields', () => {
    const request = toCreateSweepRequest(
      validSweepValues({ variable: 'durationMinutes', rangeEnd: 240, rangeStep: 30 }),
    );
    expect(request.variable).toBe('durationMinutes');
    expect(request.rangeEnd).toBe(240);
    expect(request.rangeStep).toBe(30);
    expect(request.arrivalRatePerHour).toBe(20);
    expect(request.runways).toEqual([
      { runwayId: 1, operatingMode: 'Mixed', operationalStatus: 'Available' },
    ]);
  });
});

describe('configToFormValues', () => {
  const sampleConfig: SimulationConfig = {
    id: 1,
    name: 'Sample Run',
    arrivalRatePerHour: 20,
    departureRatePerHour: 10,
    durationMinutes: 60,
    maxWaitMinutes: 20,
    aircraftSpeedKnots: 140,
    includeClosures: false,
    randomSeed: 42,
    runways: [
      { runwayId: 1, operatingMode: 'Mixed', operationalStatus: 'Available' },
      { runwayId: 2, operatingMode: 'ArrivalsOnly' },
    ],
  };

  it('maps each runway into id-keyed mode/status records, defaulting a missing status to Available', () => {
    const values = configToFormValues(sampleConfig);
    expect(values.runwayIds).toEqual([1, 2]);
    expect(values.runwayModes).toEqual({ '1': 'Mixed', '2': 'ArrivalsOnly' });
    expect(values.runwayInitialStatus).toEqual({ '1': 'Available', '2': 'Available' });
  });

  it('carries the seed through so a duplicate pre-fills it', () => {
    expect(configToFormValues(sampleConfig).randomSeed).toBe(42);
  });
});

describe('detailToRerunRequest', () => {
  const sampleDetail: SimulationDetail = {
    id: 5,
    name: 'A'.repeat(130),
    status: 'Complete',
    arrivalRatePerHour: 20,
    departureRatePerHour: 10,
    durationMinutes: 60,
    maxWaitMinutes: 20,
    aircraftSpeedKnots: 140,
    includeClosures: false,
    randomSeed: null,
    createdAt: '2026-01-01T00:00:00Z',
    startedAt: '2026-01-01T00:00:05Z',
    completedAt: '2026-01-01T00:10:00Z',
    batchId: null,
    successRate: 95,
    outcomeCounts: { success: 19, diverted: 1, cancelled: 0, pending: 0, total: 20 },
    waitTimeStats: { averageMinutes: 2.5, maxMinutes: 8 },
    delayStats: {
      arrival: { averageMinutes: 3, maxMinutes: 9 },
      departure: { averageMinutes: 2, maxMinutes: 6 },
    },
    queueDepthStats: { arrival: 3, departure: 2 },
    runwayStats: [
      {
        runwayId: 1,
        identifier: '09',
        operatingMode: 'Mixed',
        // End-of-run status differs from the initial one on purpose, to
        // prove the rerun uses the initial value, not this one.
        operationalStatus: 'SnowClearance',
        initialOperationalStatus: 'Available',
        totalAssigned: 10,
        successCount: 9,
        closureCount: 1,
        openMinutes: 55,
      },
    ],
    closureEventCount: 1,
    timelineEvents: [],
  };

  it('suffixes the name with " (re-run)" and keeps the total within the 120-char cap', () => {
    const request = detailToRerunRequest(sampleDetail);
    expect(request.name.endsWith(' (re-run)')).toBe(true);
    expect(request.name.length).toBeLessThanOrEqual(120);
  });

  it("uses each runway's initial status, not its end-of-run one", () => {
    const request = detailToRerunRequest(sampleDetail);
    expect(request.runways).toEqual([
      { runwayId: 1, operatingMode: 'Mixed', operationalStatus: 'Available' },
    ]);
  });

  it('omits randomSeed when the original run had none', () => {
    expect(detailToRerunRequest(sampleDetail)).not.toHaveProperty('randomSeed');
  });

  it('includes randomSeed when the original run had one', () => {
    const request = detailToRerunRequest({ ...sampleDetail, randomSeed: 777 });
    expect(request.randomSeed).toBe(777);
  });
});
