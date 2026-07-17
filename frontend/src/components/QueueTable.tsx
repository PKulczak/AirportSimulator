import { useMemo } from 'react';
import { DataTable } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { deriveQueue } from '../functions/visualisationHelpers';
import type { AircraftVisualisation, MovementType, SimulationEvent } from '../types/visualisation';

interface QueueTableProps {
  events: SimulationEvent[];
  currentTime: number;
  aircraft: AircraftVisualisation[];
  movementType: MovementType;
}

interface QueueRow {
  aircraftId: number;
  callsign: string;
  waitingMinutes: number;
}

/** Queue table for a single movement type (arrivals or departures) — the
 * replay shows these as two separate panels rather than one mixed queue. */
export default function QueueTable({ events, currentTime, aircraft, movementType }: QueueTableProps) {
  const aircraftById = useMemo(() => new Map(aircraft.map((a) => [a.id, a])), [aircraft]);

  const rows: QueueRow[] = deriveQueue(events, currentTime)
    .filter((entry) => aircraftById.get(entry.aircraftId)?.movementType === movementType)
    .map((entry) => ({
      aircraftId: entry.aircraftId,
      callsign: aircraftById.get(entry.aircraftId)?.callsign ?? `#${entry.aircraftId}`,
      waitingMinutes: entry.waitingMinutes,
    }));

  const label = movementType === 'Arrival' ? 'Arrivals queue' : 'Departures queue';

  return (
    <div className="h-full flex flex-col rounded-lg border border-slate-200 bg-brand-bg p-4 text-left">
      <h2 className="text-lg font-semibold text-slate-800 mb-3">
        {label} ({rows.length})
      </h2>
      <DataTable
        value={rows}
        emptyMessage={`No ${movementType.toLowerCase()}s currently queued`}
        scrollable
        scrollHeight="flex"
        className="flex-1"
      >
        <Column field="callsign" header="Callsign" />
        <Column
          field="waitingMinutes"
          header="Waiting (min)"
          body={(row: QueueRow) => row.waitingMinutes.toFixed(1)}
        />
      </DataTable>
    </div>
  );
}
