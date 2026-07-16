export type OperatingMode = 'ArrivalsOnly' | 'DeparturesOnly' | 'Mixed';

export type OperationalStatus = 'Open' | 'Closed';

/** Master runway record, from GET /api/runways/. */
export interface Runway {
  id: number;
  identifier: string;
  headingDegrees: number;
  lengthMetres: number;
  isActive: boolean;
}

/** A runway's configuration for a single simulation run (creation payload). */
export interface SimulationRunwayConfig {
  runwayId: number;
  operatingMode: OperatingMode;
}
