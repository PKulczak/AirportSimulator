import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DataTable, type DataTablePageEvent } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { Tag } from 'primereact/tag';
import { Button } from 'primereact/button';
import { Checkbox } from 'primereact/checkbox';
import { InputText } from 'primereact/inputtext';
import { Dialog } from 'primereact/dialog';
import { Menu } from 'primereact/menu';
import { Message } from 'primereact/message';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faArrowsRotate,
  faBan,
  faChevronRight,
  faCodeCompare,
  faCopy,
  faEllipsisVertical,
  faFileImport,
  faLayerGroup,
  faPen,
  faPlaneArrival,
  faPlaneDeparture,
  faTrash,
} from '@fortawesome/free-solid-svg-icons';
import {
  apiClient,
  POLL_INTERVAL_MS,
  SAFETY_POLL_INTERVAL_MS,
  useDelete,
  useGet,
  usePatch,
  usePollWhile,
  usePost,
} from '../functions/axios';
import { useSimulationSocket } from '../functions/socket';
import { STATUS_SEVERITY } from '../functions/statusSeverity';
import {
  configToFormValues,
  SIMULATION_NAME_MAX,
  templateToFormValues,
  validateSimulationName,
  type SimulationFormValues,
} from '../schemas/simulationForm';
import type { Page } from '../types/common';
import type {
  Simulation,
  SimulationConfig,
  SimulationStatus,
  SweepVariable,
} from '../types/simulation';
import type { Template } from '../types/template';
import SimulationFormDialog from './SimulationFormDialog';
import SweepFormDialog from './SweepFormDialog';
import TemplatePickerDialog from './TemplatePickerDialog';
import backgroundImage from '../assets/Background.png';

const PAGE_SIZE = 10;
const SEARCH_DEBOUNCE_MS = 350;

const ACTIVE_STATUSES: SimulationStatus[] = ['Pending', 'Running'];

/** e.g. { date: "26/06/2026", time: "12:17" } — a fixed format so it doesn't
 * depend on the viewer's browser locale, split across two lines to match the
 * "Date Requested" column's stacked layout. */
function formatDateParts(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

// Matches the " (variable: value)" suffix SimulationSweepCreationDto appends
// to each generated run's name, so a batch row can show the sweep's base
// name instead of just its first (lowest-value) run's full name.
const SWEEP_NAME_SUFFIX =
  / \((arrivalRatePerHour|departureRatePerHour|durationMinutes|maxWaitMinutes|aircraftSpeedKnots): -?\d+\)$/;

function displayName(row: Simulation): string {
  return row.batchId != null ? row.name.replace(SWEEP_NAME_SUFFIX, '') : row.name;
}

/** The swept variable's raw min/max, for whichever column matches `field` —
 * null everywhere else (a standalone row, or a batch row swept on a
 * different field), so callers fall back to the row's own single value. */
function sweptRange(row: Simulation, field: SweepVariable): { min: number; max: number } | null {
  const summary = row.batchSummary;
  if (
    !summary ||
    summary.sweptVariable !== field ||
    summary.rangeMin == null ||
    summary.rangeMax == null
  ) {
    return null;
  }
  return { min: summary.rangeMin, max: summary.rangeMax };
}

function formatDurationHours(minutes: number): string {
  return (minutes / 60).toFixed(1).replace(/\.0$/, '');
}

/** Whether a batch row has any run still Pending/Running — mirrors
 * ACTIVE_STATUSES's use for standalone rows, just read off the aggregate
 * batchSummary instead of a single row's own status. */
function batchHasActiveRuns(row: Simulation): boolean {
  return ACTIVE_STATUSES.some((s) => (row.batchSummary?.statusCounts[s] ?? 0) > 0);
}

export default function SimulationHistory() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [dialogVisible, setDialogVisible] = useState(false);
  const [formInitialValues, setFormInitialValues] = useState<SimulationFormValues | undefined>();
  // Distinguishes *why* the create dialog has `formInitialValues` set, purely
  // to pick the right header text — Duplicate and "from template" both
  // pre-fill the same form but mean different things to the user.
  const [formSource, setFormSource] = useState<'create' | 'duplicate' | 'template'>('create');
  const [templatePickerVisible, setTemplatePickerVisible] = useState(false);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Simulation | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [cancelBatchTarget, setCancelBatchTarget] = useState<Simulation | null>(null);
  const [cancelBatchError, setCancelBatchError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Simulation | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteBatchTarget, setDeleteBatchTarget] = useState<Simulation | null>(null);
  const [deleteBatchError, setDeleteBatchError] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<Simulation | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [compareIds, setCompareIds] = useState<number[]>([]);
  const [sweepDialogVisible, setSweepDialogVisible] = useState(false);
  // The row-actions menu (Duplicate/Rename/Delete) is a single shared Menu
  // instance rather than one per row — a ref (not state) tracks which row it
  // was opened for, so the command callbacks below always read the row that
  // was current when clicked, not a stale value from before a re-render.
  const rowMenuRef = useRef<Menu>(null);
  const rowMenuTarget = useRef<Simulation | null>(null);

  useEffect(() => {
    const handle = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const url = useMemo(() => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    if (search) {
      params.set('search', search);
    }
    return `/api/simulations/?${params.toString()}`;
  }, [page, search]);

  const { data, loading, error, refetch } = useGet<Page<Simulation>>(url);

  // Poll only while the current page shows a run that could still change state.
  const hasActiveRuns = useMemo(
    () =>
      (data?.results ?? []).some(
        (s) => s.status === 'Pending' || s.status === 'Running',
      ),
    [data],
  );
  // Prefer websocket push (global feed) for status changes, refetching on
  // (re)connect to catch anything missed during the connect window. Keep
  // polling while a run could still change — fast when push is down, slow as a
  // safety net when it's up — so a missed/half-open push never leaves the list
  // stale until a manual refresh.
  const { connected } = useSimulationSocket(
    hasActiveRuns ? '/ws/simulations/' : null,
    refetch,
    refetch,
  );
  usePollWhile(hasActiveRuns, refetch, connected ? SAFETY_POLL_INTERVAL_MS : POLL_INTERVAL_MS);

  const onPage = (event: DataTablePageEvent) => {
    setPage(Math.floor((event.first ?? 0) / PAGE_SIZE) + 1);
  };

  // Same-shape mutations (loading/error/try-catch around a single apiClient
  // call) previously hand-rolled per action — useDelete/usePatch/usePost
  // centralize that shape; each site below keeps its own friendly error
  // copy and post-success side effect (page-back, refetch, closing a
  // dialog). `!== undefined` (not truthiness) is the correct success check
  // here since a 204 delete/cancel response's `data` is `''`, which is
  // falsy despite being a success.
  const { execute: deleteSimulation, loading: deleting } = useDelete(
    deleteTarget ? `/api/simulations/${deleteTarget.id}/` : '',
  );
  const { execute: deleteBatch, loading: deletingBatch } = useDelete(
    deleteBatchTarget?.batchId ? `/api/simulations/batch/?id=${deleteBatchTarget.batchId}` : '',
  );
  const { execute: renameSimulation, loading: renaming } = usePatch<Simulation, { name: string }>(
    renameTarget ? `/api/simulations/${renameTarget.id}/` : '',
  );
  const { execute: cancelSimulation, loading: cancelling } = usePost<Simulation, void>(
    cancelTarget ? `/api/simulations/${cancelTarget.id}/cancel/` : '',
  );
  const { execute: cancelBatch, loading: cancellingBatch } = usePost<
    { batchId: number; simulations: Simulation[] },
    void
  >(cancelBatchTarget?.batchId ? `/api/simulations/batch/cancel/?id=${cancelBatchTarget.batchId}` : '');

  const confirmDelete = async () => {
    if (!deleteTarget) {
      return;
    }
    setDeleteError(null);
    const result = await deleteSimulation();
    if (result === undefined) {
      setDeleteError('Failed to delete simulation. Please try again.');
      return;
    }
    setDeleteTarget(null);
    // If that was the last row on a page past the first, step back a page
    // (which refetches via the url memo); otherwise refetch in place.
    const remaining = (data?.results?.length ?? 1) - 1;
    if (remaining <= 0 && page > 1) {
      setPage((p) => p - 1);
    } else {
      refetch();
    }
  };

  const confirmDeleteBatch = async () => {
    if (!deleteBatchTarget?.batchId) {
      return;
    }
    setDeleteBatchError(null);
    const result = await deleteBatch();
    if (result === undefined) {
      setDeleteBatchError('Failed to delete sweep. Please try again.');
      return;
    }
    setDeleteBatchTarget(null);
    // A batch collapses to a single history row, so the same "step back a
    // page if that was the last row" logic from confirmDelete applies here.
    const remaining = (data?.results?.length ?? 1) - 1;
    if (remaining <= 0 && page > 1) {
      setPage((p) => p - 1);
    } else {
      refetch();
    }
  };

  const openRename = (simulation: Simulation) => {
    setRenameError(null);
    setRenameValue(simulation.name);
    setRenameTarget(simulation);
  };

  const renameValidationError = validateSimulationName(renameValue);
  const renameUnchanged = renameValue.trim() === renameTarget?.name;

  const confirmRename = async () => {
    if (!renameTarget || renameValidationError || renameUnchanged) {
      return;
    }
    setRenameError(null);
    const result = await renameSimulation({ name: renameValue.trim() });
    if (result === undefined) {
      setRenameError('Failed to rename simulation. Please try again.');
      return;
    }
    setRenameTarget(null);
    refetch();
  };

  const openCreate = () => {
    setDuplicateError(null);
    setFormSource('create');
    setFormInitialValues(undefined);
    setDialogVisible(true);
  };

  const openDuplicate = async (simulation: Simulation) => {
    setDuplicateError(null);
    try {
      const { data } = await apiClient.get<SimulationConfig>(
        `/api/simulations/${simulation.id}/config/`,
      );
      setFormSource('duplicate');
      setFormInitialValues(configToFormValues(data));
      setDialogVisible(true);
    } catch {
      setDuplicateError('Failed to load that run’s configuration. Please try again.');
    }
  };

  const openFromTemplate = (template: Template) => {
    setDuplicateError(null);
    setFormSource('template');
    setFormInitialValues(templateToFormValues(template));
    setTemplatePickerVisible(false);
    setDialogVisible(true);
  };

  const formDialogTitle =
    formSource === 'duplicate'
      ? 'Duplicate Simulation'
      : formSource === 'template'
        ? 'Create From Template'
        : undefined;

  const confirmCancel = async () => {
    if (!cancelTarget) {
      return;
    }
    setCancelError(null);
    const result = await cancelSimulation();
    if (result === undefined) {
      setCancelError('Failed to cancel simulation. It may have already finished.');
      return;
    }
    setCancelTarget(null);
    refetch();
  };

  const confirmCancelBatch = async () => {
    if (!cancelBatchTarget?.batchId) {
      return;
    }
    setCancelBatchError(null);
    const result = await cancelBatch();
    if (result === undefined) {
      setCancelBatchError('Failed to cancel sweep. It may have already finished.');
      return;
    }
    setCancelBatchTarget(null);
    refetch();
  };

  const toggleCompareMode = () => {
    setCompareMode((prev) => !prev);
    setCompareIds([]);
  };

  const toggleCompareSelection = (row: Simulation) => {
    // A batch row represents a whole group of runs, not one comparable
    // result — comparison needs individual completed runs.
    if (row.status !== 'Complete' || row.batchId != null) {
      return;
    }
    setCompareIds((ids) =>
      ids.includes(row.id) ? ids.filter((id) => id !== row.id) : [...ids, row.id],
    );
  };

  const startCompare = () => {
    navigate(`/compare?ids=${compareIds.join(',')}`);
  };

  // Shared by every standalone row's "..." menu — each command reads
  // rowMenuTarget.current at click time (see the ref's declaration above),
  // so one Menu instance can serve the whole table instead of one per row.
  const rowMenuItems = [
    {
      label: 'Duplicate',
      icon: <FontAwesomeIcon icon={faCopy} />,
      command: () => {
        const row = rowMenuTarget.current;
        if (row) {
          openDuplicate(row);
        }
      },
    },
    {
      label: 'Rename',
      icon: <FontAwesomeIcon icon={faPen} />,
      command: () => {
        const row = rowMenuTarget.current;
        if (row) {
          openRename(row);
        }
      },
    },
    {
      label: 'Delete',
      icon: <FontAwesomeIcon icon={faTrash} />,
      command: () => {
        const row = rowMenuTarget.current;
        if (row) {
          setDeleteError(null);
          setDeleteTarget(row);
        }
      },
    },
  ];

  return (
    <div className="-m-6 h-[calc(100%+3rem)] flex flex-col">
      <div
        className="relative flex-1 min-h-0 overflow-x-auto overflow-y-hidden p-4 sm:p-10 flex items-center justify-center"
        style={{
          backgroundImage: `url(${backgroundImage})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        }}
      >
        <div
          className="queue-scroll relative flex min-w-[800px] flex-col gap-4 overflow-y-auto rounded-lg border-2 border-black bg-white p-4 shadow-2xl sm:p-6"
          style={{ width: '100%', maxWidth: '1600px', maxHeight: '100%', aspectRatio: '1.5' }}
        >
          <h1 className="text-center text-2xl font-bold uppercase tracking-wide text-slate-900">
            Airport Simulation
          </h1>

          <div className="grid grid-cols-1 items-center gap-3 sm:grid-cols-[1fr_auto_1fr]">
            <Button
              icon={<FontAwesomeIcon icon={faCodeCompare} />}
              label={compareMode ? 'Exit compare' : 'Compare runs'}
              onClick={toggleCompareMode}
              className={
                compareMode
                  ? 'justify-self-start !border-brand-accent-active !bg-brand-accent-active font-bold !text-white'
                  : 'justify-self-start'
              }
            />
            <InputText
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search"
              className="w-full max-w-sm justify-self-center bg-brand-bg"
            />
            <div className="flex justify-self-end gap-2">
              <Button
                icon={<FontAwesomeIcon icon={faFileImport} />}
                label="Templates"
                onClick={() => setTemplatePickerVisible(true)}
              />
              <Button
                icon={<FontAwesomeIcon icon={faLayerGroup} />}
                label="Sweep"
                onClick={() => setSweepDialogVisible(true)}
              />
              <Button
                label="Create"
                onClick={openCreate}
                className="!border-brand-accent-active !bg-brand-accent-active font-bold !text-white"
              />
            </div>
          </div>

          {compareMode && (
            <div className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-brand-bg px-3 py-2">
              <span className="text-sm text-slate-700">
                {compareIds.length === 0
                  ? 'Select 2 or more completed runs to compare.'
                  : `${compareIds.length} selected`}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  label="Clear"
                  text
                  disabled={compareIds.length === 0}
                  onClick={() => setCompareIds([])}
                />
                <Button
                  label="Compare selected"
                  icon={<FontAwesomeIcon icon={faCodeCompare} />}
                  disabled={compareIds.length < 2}
                  onClick={startCompare}
                  className="!border-brand-accent-active !bg-brand-accent-active !text-white"
                />
              </div>
            </div>
          )}

          {error && <p className="text-red-600">Failed to load simulations: {error.message}</p>}
          {duplicateError && <Message severity="error" text={duplicateError} className="w-full" />}

          <DataTable
            value={data?.results ?? []}
            // Only show the overlay on the first load; background polls refetch
            // in place so the table shouldn't flash a spinner every few seconds.
            loading={loading && !data}
            lazy
            paginator
            first={(page - 1) * PAGE_SIZE}
            rows={PAGE_SIZE}
            totalRecords={data?.count ?? 0}
            onPage={onPage}
            onRowClick={(e) => {
              const row = e.data as Simulation;
              if (compareMode) {
                toggleCompareSelection(row);
              } else if (row.batchId != null) {
                navigate(`/batch/${row.batchId}`);
              } else {
                navigate(`/simulation/${row.id}/detail`);
              }
            }}
            rowClassName={(row: Simulation) => {
              if (!compareMode) {
                return '';
              }
              if (row.status !== 'Complete' || row.batchId != null) {
                return 'opacity-40';
              }
              return compareIds.includes(row.id) ? '!bg-brand-bg' : '';
            }}
            rowHover
            className="cursor-pointer"
            emptyMessage="No simulations yet"
          >
            <Column
              header=""
              alignHeader="center"
              align="center"
              headerStyle={{ width: '3rem' }}
              body={(row: Simulation) => {
                // Compare mode's only way to (de)select a row was clicking
                // the row itself (`onRowClick` below) — a `<tr>` isn't
                // natively focusable/keyboard-activatable, so a keyboard-only
                // user had no way to use the compare feature at all. This
                // checkbox is a real, focusable form control providing that
                // parity; `stopPropagation` keeps its own click from also
                // bubbling to the row's `onRowClick` and double-toggling,
                // same as every other button in this column already does.
                if (compareMode) {
                  const eligible = row.status === 'Complete' && row.batchId == null;
                  return (
                    <Checkbox
                      checked={compareIds.includes(row.id)}
                      disabled={!eligible}
                      onChange={(e) => {
                        e.stopPropagation();
                        toggleCompareSelection(row);
                      }}
                      aria-label={`Select ${row.name} for comparison`}
                    />
                  );
                }
                // A batch row stands in for a whole group of runs. While any
                // run in it is still Pending/Running this slot cancels all of
                // them (mirrors the standalone-row cancel-while-active
                // behaviour below); once every run is terminal it deletes the
                // whole sweep, same as before (see confirmDeleteBatch).
                if (row.batchId != null) {
                  if (batchHasActiveRuns(row)) {
                    return (
                      <Button
                        icon={<FontAwesomeIcon icon={faBan} />}
                        text
                        aria-label={`Cancel sweep ${row.name}`}
                        tooltip="Cancel sweep"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCancelBatchError(null);
                          setCancelBatchTarget(row);
                        }}
                        className="!border-transparent !bg-transparent !text-amber-600 !text-lg"
                      />
                    );
                  }
                  return (
                    <Button
                      icon={<FontAwesomeIcon icon={faTrash} />}
                      text
                      aria-label={`Delete sweep ${row.name}`}
                      tooltip="Delete sweep"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteBatchError(null);
                        setDeleteBatchTarget(row);
                      }}
                      className="!border-transparent !bg-transparent !text-red-600 !text-lg"
                    />
                  );
                }
                // While a run is in flight, this slot cancels it; once it's
                // finished it opens the Duplicate/Rename/Delete menu.
                if (ACTIVE_STATUSES.includes(row.status)) {
                  return (
                    <Button
                      icon={<FontAwesomeIcon icon={faBan} />}
                      text
                      aria-label={`Cancel ${row.name}`}
                      tooltip="Cancel run"
                      onClick={(e) => {
                        e.stopPropagation();
                        setCancelError(null);
                        setCancelTarget(row);
                      }}
                      className="!border-transparent !bg-transparent !text-amber-600 !text-lg"
                    />
                  );
                }
                return (
                  <Button
                    icon={<FontAwesomeIcon icon={faEllipsisVertical} />}
                    text
                    aria-label={`Actions for ${row.name}`}
                    tooltip="Actions"
                    onClick={(e) => {
                      e.stopPropagation();
                      rowMenuTarget.current = row;
                      rowMenuRef.current?.toggle(e);
                    }}
                    className="!border-transparent !bg-transparent !text-slate-600 !text-lg"
                  />
                );
              }}
            />
            <Column
              header="Name"
              alignHeader="center"
              align="center"
              bodyClassName="font-semibold"
              body={(row: Simulation) =>
                row.batchSummary ? (
                  <span className="inline-flex flex-nowrap items-center gap-2 whitespace-nowrap">
                    <FontAwesomeIcon icon={faLayerGroup} className="text-slate-500" />
                    <span className="whitespace-nowrap">{displayName(row)}</span>
                    <Tag
                      value={`${row.batchSummary.runCount} runs`}
                      severity="secondary"
                      className="whitespace-nowrap"
                    />
                  </span>
                ) : (
                  row.name
                )
              }
            />
            <Column
              header="Date Requested"
              alignHeader="center"
              align="center"
              body={(row: Simulation) => {
                const { date, time } = formatDateParts(row.createdAt);
                return (
                  <span className="inline-flex flex-col leading-tight">
                    <span>{date}</span>
                    <span>{time}</span>
                  </span>
                );
              }}
            />
            <Column
              header="Duration (Hrs)"
              alignHeader="center"
              align="center"
              body={(row: Simulation) => {
                const range = sweptRange(row, 'durationMinutes');
                return range
                  ? `${formatDurationHours(range.min)} → ${formatDurationHours(range.max)}`
                  : formatDurationHours(row.durationMinutes);
              }}
            />
            <Column
              field="runwayCount"
              header="Runways"
              alignHeader="center"
              align="center"
            />
            <Column
              header="Aircraft Flow"
              alignHeader="center"
              align="center"
              body={(row: Simulation) => {
                const arrivalRange = sweptRange(row, 'arrivalRatePerHour');
                const departureRange = sweptRange(row, 'departureRatePerHour');
                return (
                  <span className="inline-flex items-center gap-3">
                    <span className="flex items-center gap-1.5">
                      {arrivalRange ? `${arrivalRange.min} → ${arrivalRange.max}` : row.arrivalRatePerHour}
                      <FontAwesomeIcon icon={faPlaneArrival} className="text-slate-500" />
                    </span>
                    <span className="flex items-center gap-1.5">
                      {departureRange
                        ? `${departureRange.min} → ${departureRange.max}`
                        : row.departureRatePerHour}
                      <FontAwesomeIcon icon={faPlaneDeparture} className="text-slate-500" />
                    </span>
                  </span>
                );
              }}
            />
            <Column
              header="Status"
              alignHeader="center"
              align="center"
              body={(row: Simulation) => {
                if (!row.batchSummary) {
                  return <Tag value={row.status} severity={STATUS_SEVERITY[row.status]} />;
                }
                const entries = (
                  Object.entries(row.batchSummary.statusCounts) as [SimulationStatus, number][]
                ).filter(([, count]) => count > 0);
                return (
                  <span className="inline-flex flex-nowrap items-center justify-center gap-1 whitespace-nowrap">
                    {entries.map(([statusName, count]) => (
                      <Tag
                        key={statusName}
                        value={`${count} ${statusName}`}
                        severity={STATUS_SEVERITY[statusName]}
                        className="whitespace-nowrap"
                      />
                    ))}
                  </span>
                );
              }}
            />
            <Column
              header={() => (
                <Button
                  icon={<FontAwesomeIcon icon={faArrowsRotate} />}
                  text
                  onClick={() => refetch()}
                  aria-label="Refresh"
                  tooltip="Refresh"
                  className="!border-transparent !bg-transparent !text-brand-accent-active !text-lg"
                />
              )}
              alignHeader="center"
              align="center"
              body={(row: Simulation) => (
                <Button
                  icon={<FontAwesomeIcon icon={faChevronRight} />}
                  text
                  aria-label="View details"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (row.batchId != null) {
                      navigate(`/batch/${row.batchId}`);
                    } else {
                      navigate(`/simulation/${row.id}/detail`);
                    }
                  }}
                  className="!border-transparent !bg-transparent !text-brand-accent-active !text-lg"
                />
              )}
            />
          </DataTable>

          <Menu model={rowMenuItems} popup ref={rowMenuRef} />
        </div>
      </div>

      <SimulationFormDialog
        visible={dialogVisible}
        initialValues={formInitialValues}
        title={formDialogTitle}
        onHide={() => {
          setDialogVisible(false);
          setFormInitialValues(undefined);
          setFormSource('create');
        }}
        onCreated={() => refetch()}
      />

      <SweepFormDialog
        visible={sweepDialogVisible}
        onHide={() => setSweepDialogVisible(false)}
        onDone={() => refetch()}
      />

      <TemplatePickerDialog
        visible={templatePickerVisible}
        onHide={() => setTemplatePickerVisible(false)}
        onSelect={openFromTemplate}
      />

      <Dialog
        header="Delete simulation"
        visible={deleteTarget !== null}
        onHide={() => {
          if (!deleting) {
            setDeleteTarget(null);
          }
        }}
        draggable={false}
        dismissableMask={!deleting}
        style={{ width: '28rem', maxWidth: '90vw' }}
        footer={
          <div className="flex justify-end gap-2">
            <Button
              label="Cancel"
              text
              disabled={deleting}
              onClick={() => setDeleteTarget(null)}
            />
            <Button
              label="Delete"
              icon={<FontAwesomeIcon icon={faTrash} className="mr-2" />}
              loading={deleting}
              onClick={confirmDelete}
              className="!border-red-600 !bg-red-600 !text-white"
            />
          </div>
        }
      >
        <p className="text-slate-700">
          Delete <span className="font-semibold">{deleteTarget?.name}</span> and all of its
          results? This cannot be undone.
        </p>
        {deleteError && <Message severity="error" text={deleteError} className="mt-3 w-full" />}
      </Dialog>

      <Dialog
        header="Delete sweep"
        visible={deleteBatchTarget !== null}
        onHide={() => {
          if (!deletingBatch) {
            setDeleteBatchTarget(null);
          }
        }}
        draggable={false}
        dismissableMask={!deletingBatch}
        style={{ width: '28rem', maxWidth: '90vw' }}
        footer={
          <div className="flex justify-end gap-2">
            <Button
              label="Cancel"
              text
              disabled={deletingBatch}
              onClick={() => setDeleteBatchTarget(null)}
            />
            <Button
              label="Delete sweep"
              icon={<FontAwesomeIcon icon={faTrash} className="mr-2" />}
              loading={deletingBatch}
              onClick={confirmDeleteBatch}
              className="!border-red-600 !bg-red-600 !text-white"
            />
          </div>
        }
      >
        <p className="text-slate-700">
          Delete <span className="font-semibold">{deleteBatchTarget ? displayName(deleteBatchTarget) : ''}</span>{' '}
          and all {deleteBatchTarget?.batchSummary?.runCount ?? 'its'} runs in it? This cannot
          be undone.
        </p>
        {deleteBatchError && (
          <Message severity="error" text={deleteBatchError} className="mt-3 w-full" />
        )}
      </Dialog>

      <Dialog
        header="Rename simulation"
        visible={renameTarget !== null}
        onHide={() => {
          if (!renaming) {
            setRenameTarget(null);
          }
        }}
        draggable={false}
        dismissableMask={!renaming}
        style={{ width: '28rem', maxWidth: '90vw' }}
        footer={
          <div className="flex justify-end gap-2">
            <Button
              label="Cancel"
              text
              disabled={renaming}
              onClick={() => setRenameTarget(null)}
            />
            <Button
              label="Save"
              loading={renaming}
              disabled={!!renameValidationError || renameUnchanged}
              onClick={confirmRename}
              className="!border-brand-accent-active !bg-brand-accent-active !text-white"
            />
          </div>
        }
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="rename-input" className="text-sm font-bold text-slate-800">
            Name
          </label>
          <InputText
            id="rename-input"
            value={renameValue}
            maxLength={SIMULATION_NAME_MAX}
            autoFocus
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                confirmRename();
              }
            }}
            className={`bg-brand-bg ${renameValidationError && renameValue ? 'p-invalid' : ''}`}
          />
          {renameValue.length > 0 && renameValidationError && (
            <small className="text-red-600">{renameValidationError}</small>
          )}
          {renameError && <Message severity="error" text={renameError} className="mt-2 w-full" />}
        </div>
      </Dialog>

      <Dialog
        header="Cancel simulation"
        visible={cancelTarget !== null}
        onHide={() => {
          if (!cancelling) {
            setCancelTarget(null);
          }
        }}
        draggable={false}
        dismissableMask={!cancelling}
        style={{ width: '28rem', maxWidth: '90vw' }}
        footer={
          <div className="flex justify-end gap-2">
            <Button
              label="Keep running"
              text
              disabled={cancelling}
              onClick={() => setCancelTarget(null)}
            />
            <Button
              label="Cancel run"
              icon={<FontAwesomeIcon icon={faBan} className="mr-2" />}
              loading={cancelling}
              onClick={confirmCancel}
              className="!border-amber-600 !bg-amber-600 !text-white"
            />
          </div>
        }
      >
        <p className="text-slate-700">
          Stop <span className="font-semibold">{cancelTarget?.name}</span>? It will be marked
          Cancelled and won’t finish. Its config stays available to duplicate.
        </p>
        {cancelError && <Message severity="error" text={cancelError} className="mt-3 w-full" />}
      </Dialog>

      <Dialog
        header="Cancel sweep"
        visible={cancelBatchTarget !== null}
        onHide={() => {
          if (!cancellingBatch) {
            setCancelBatchTarget(null);
          }
        }}
        draggable={false}
        dismissableMask={!cancellingBatch}
        style={{ width: '28rem', maxWidth: '90vw' }}
        footer={
          <div className="flex justify-end gap-2">
            <Button
              label="Keep running"
              text
              disabled={cancellingBatch}
              onClick={() => setCancelBatchTarget(null)}
            />
            <Button
              label="Cancel sweep"
              icon={<FontAwesomeIcon icon={faBan} className="mr-2" />}
              loading={cancellingBatch}
              onClick={confirmCancelBatch}
              className="!border-amber-600 !bg-amber-600 !text-white"
            />
          </div>
        }
      >
        <p className="text-slate-700">
          Stop every Pending/Running run in{' '}
          <span className="font-semibold">
            {cancelBatchTarget ? displayName(cancelBatchTarget) : ''}
          </span>
          ? Those runs will be marked Cancelled and won’t finish. Runs already Complete or Error
          in this sweep are left untouched.
        </p>
        {cancelBatchError && (
          <Message severity="error" text={cancelBatchError} className="mt-3 w-full" />
        )}
      </Dialog>
    </div>
  );
}
