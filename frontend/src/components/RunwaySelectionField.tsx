import { Dropdown } from 'primereact/dropdown';
import { DataTable, type DataTableSelectionMultipleChangeEvent } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { useRunways } from '../context/RunwayContext';
import { MAX_RUNWAYS } from '../schemas/simulationForm';
import type { OperatingMode, OperationalStatus, Runway } from '../types/runway';

const OPERATING_MODE_OPTIONS: { label: string; value: OperatingMode }[] = [
  { label: 'Arrivals only', value: 'ArrivalsOnly' },
  { label: 'Departures only', value: 'DeparturesOnly' },
  { label: 'Mixed', value: 'Mixed' },
];

const OPERATIONAL_STATUS_OPTIONS: { label: string; value: OperationalStatus }[] = [
  { label: 'Available', value: 'Available' },
  { label: 'Runway Inspection', value: 'RunwayInspection' },
  { label: 'Snow Clearance', value: 'SnowClearance' },
  { label: 'Equipment Failure', value: 'EquipmentFailure' },
];

interface RunwaySelectionFieldProps {
  runwayIds: number[];
  runwayModes: Record<string, OperatingMode>;
  runwayInitialStatus: Record<string, OperationalStatus>;
  onRunwayIdsChange: (ids: number[]) => void;
  onRunwayModesChange: (modes: Record<string, OperatingMode>) => void;
  onRunwayInitialStatusChange: (status: Record<string, OperationalStatus>) => void;
  error?: string;
}

/** Shared by RequestForm and SweepForm: the runway picker + per-runway
 * operating mode / initial status table. Whole-object setters (rather than
 * per-runway callbacks) so the bulk "select all" path can merge one complete
 * object per field in a single call — building it up via repeated
 * single-runway callbacks would race against each other's stale closures
 * before a re-render lands. */
export default function RunwaySelectionField({
  runwayIds,
  runwayModes,
  runwayInitialStatus,
  onRunwayIdsChange,
  onRunwayModesChange,
  onRunwayInitialStatusChange,
  error,
}: RunwaySelectionFieldProps) {
  const { runways, loading: runwaysLoading } = useRunways();
  const selectedRunways = runways.filter((r) => runwayIds.includes(r.id));

  const setRunwayMode = (runwayId: number, mode: OperatingMode) => {
    onRunwayModesChange({ ...runwayModes, [String(runwayId)]: mode });
  };

  const setRunwayInitialStatus = (runwayId: number, initialStatus: OperationalStatus) => {
    onRunwayInitialStatusChange({ ...runwayInitialStatus, [String(runwayId)]: initialStatus });
  };

  // The master runway list (12) deliberately exceeds MAX_RUNWAYS (10), so
  // "select all" has to actually cap rather than just select everything.
  // `isDataSelectable` disables individual checkboxes once the cap is hit;
  // this clip is the backstop that also covers the header select-all
  // checkbox, which can otherwise add many rows in one event.
  const onRunwaySelectionChange = (e: DataTableSelectionMultipleChangeEvent<Runway[]>) => {
    const newIds = e.value.map((r) => r.id).slice(0, MAX_RUNWAYS);
    onRunwayIdsChange(newIds);
    const newModes = { ...runwayModes };
    const newInitialStatus = { ...runwayInitialStatus };
    for (const id of newIds) {
      if (!newModes[String(id)]) {
        newModes[String(id)] = 'Mixed';
      }
      if (!newInitialStatus[String(id)]) {
        newInitialStatus[String(id)] = 'Available';
      }
    }
    onRunwayModesChange(newModes);
    onRunwayInitialStatusChange(newInitialStatus);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-slate-800">
          Select runways to include in simulation <span className="text-red-600">*</span>
        </p>
        <p className="text-xs text-slate-500">
          {runwayIds.length} / {MAX_RUNWAYS} selected
        </p>
      </div>
      {runwaysLoading && <p className="text-sm text-slate-500">Loading runways...</p>}
      <DataTable
        value={runways}
        dataKey="id"
        // "checkbox" (not "multiple") so selection is driven only by the
        // checkbox column below — "multiple" also enables click-anywhere-
        // in-the-row selection, which swallowed clicks on the mode/status
        // Dropdowns (PrimeReact's row-click handler doesn't recognise
        // Dropdown's DOM as "already interactive"), toggling the row
        // instead of opening the dropdown.
        selectionMode="checkbox"
        selection={selectedRunways}
        onSelectionChange={onRunwaySelectionChange}
        isDataSelectable={(e) =>
          runwayIds.includes((e.data as Runway).id) || runwayIds.length < MAX_RUNWAYS
        }
        // PrimeReact memoizes body cells by default, re-rendering only when
        // a fixed set of keys change (rowData, field, index, ...) — none of
        // which are affected by `runwayIds`/`runwayModes` changing. The
        // Mode/Status columns' bodies close over those, so without this
        // they'd render once with nothing selected and then never update —
        // the Dropdowns would look stuck disabled even after checking a
        // row. The table is small (≤12 rows), so unmemoized cells are fine.
        cellMemo={false}
        scrollable
        scrollHeight="240px"
        className="rounded border border-slate-200"
      >
        <Column selectionMode="multiple" headerStyle={{ width: '3rem' }} />
        <Column field="identifier" header="Runway Number" />
        <Column field="lengthMetres" header="Length (m)" />
        <Column field="headingDegrees" header="Bearing" />
        <Column
          header="Operational Mode"
          body={(row: Runway) => (
            // Stops the click from bubbling to the row: PrimeReact's row
            // click handler runs regardless of whether selection itself
            // changes, and unconditionally steals focus back to the row —
            // which otherwise fights with the Dropdown opening from the
            // same click.
            <div onClick={(e) => e.stopPropagation()}>
              <Dropdown
                value={runwayModes[String(row.id)] ?? null}
                options={OPERATING_MODE_OPTIONS}
                onChange={(e) => setRunwayMode(row.id, e.value as OperatingMode)}
                disabled={!runwayIds.includes(row.id)}
                placeholder="Please..."
                className="w-full"
              />
            </div>
          )}
        />
        <Column
          header="Operational Status"
          body={(row: Runway) => (
            <div onClick={(e) => e.stopPropagation()}>
              <Dropdown
                value={runwayInitialStatus[String(row.id)] ?? null}
                options={OPERATIONAL_STATUS_OPTIONS}
                onChange={(e) => setRunwayInitialStatus(row.id, e.value as OperationalStatus)}
                disabled={!runwayIds.includes(row.id)}
                placeholder="Please..."
                className="w-full"
              />
            </div>
          )}
        />
      </DataTable>
      {error && <small className="text-red-600">{error}</small>}
    </div>
  );
}
