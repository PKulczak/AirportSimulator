import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DataTable, type DataTablePageEvent } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { Tag } from 'primereact/tag';
import { Button } from 'primereact/button';
import { InputText } from 'primereact/inputtext';
import { Dialog } from 'primereact/dialog';
import { Message } from 'primereact/message';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faArrowsRotate,
  faBan,
  faChevronRight,
  faCodeCompare,
  faCopy,
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
  useGet,
  usePollWhile,
} from '../functions/axios';
import { useSimulationSocket } from '../functions/socket';
import {
  configToFormValues,
  SIMULATION_NAME_MAX,
  validateSimulationName,
  type SimulationFormValues,
} from '../schemas/simulationForm';
import type { Page } from '../types/common';
import type { Simulation, SimulationConfig, SimulationStatus } from '../types/simulation';
import SimulationFormDialog from './SimulationFormDialog';
import SweepFormDialog from './SweepFormDialog';
import backgroundImage from '../assets/Background.png';

const PAGE_SIZE = 10;
const SEARCH_DEBOUNCE_MS = 350;

const STATUS_SEVERITY: Record<
  SimulationStatus,
  'info' | 'warning' | 'success' | 'danger' | 'secondary'
> = {
  Pending: 'info',
  Running: 'warning',
  Complete: 'success',
  Error: 'danger',
  Cancelled: 'secondary',
};

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

export default function SimulationHistory() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [dialogVisible, setDialogVisible] = useState(false);
  const [formInitialValues, setFormInitialValues] = useState<SimulationFormValues | undefined>();
  const [duplicatingId, setDuplicatingId] = useState<number | null>(null);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Simulation | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Simulation | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<Simulation | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [compareIds, setCompareIds] = useState<number[]>([]);
  const [sweepDialogVisible, setSweepDialogVisible] = useState(false);

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

  const confirmDelete = async () => {
    if (!deleteTarget) {
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    try {
      await apiClient.delete(`/api/simulations/${deleteTarget.id}/`);
      setDeleteTarget(null);
      // If that was the last row on a page past the first, step back a page
      // (which refetches via the url memo); otherwise refetch in place.
      const remaining = (data?.results?.length ?? 1) - 1;
      if (remaining <= 0 && page > 1) {
        setPage((p) => p - 1);
      } else {
        refetch();
      }
    } catch {
      setDeleteError('Failed to delete simulation. Please try again.');
    } finally {
      setDeleting(false);
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
    setRenaming(true);
    setRenameError(null);
    try {
      await apiClient.patch(`/api/simulations/${renameTarget.id}/`, {
        name: renameValue.trim(),
      });
      setRenameTarget(null);
      refetch();
    } catch {
      setRenameError('Failed to rename simulation. Please try again.');
    } finally {
      setRenaming(false);
    }
  };

  const openCreate = () => {
    setDuplicateError(null);
    setFormInitialValues(undefined);
    setDialogVisible(true);
  };

  const openDuplicate = async (simulation: Simulation) => {
    setDuplicateError(null);
    setDuplicatingId(simulation.id);
    try {
      const { data } = await apiClient.get<SimulationConfig>(
        `/api/simulations/${simulation.id}/config/`,
      );
      setFormInitialValues(configToFormValues(data));
      setDialogVisible(true);
    } catch {
      setDuplicateError('Failed to load that run’s configuration. Please try again.');
    } finally {
      setDuplicatingId(null);
    }
  };

  const confirmCancel = async () => {
    if (!cancelTarget) {
      return;
    }
    setCancelling(true);
    setCancelError(null);
    try {
      await apiClient.post(`/api/simulations/${cancelTarget.id}/cancel/`);
      setCancelTarget(null);
      refetch();
    } catch {
      setCancelError('Failed to cancel simulation. It may have already finished.');
    } finally {
      setCancelling(false);
    }
  };

  const toggleCompareMode = () => {
    setCompareMode((prev) => !prev);
    setCompareIds([]);
  };

  const toggleCompareSelection = (row: Simulation) => {
    if (row.status !== 'Complete') {
      return;
    }
    setCompareIds((ids) =>
      ids.includes(row.id) ? ids.filter((id) => id !== row.id) : [...ids, row.id],
    );
  };

  const startCompare = () => {
    navigate(`/compare?ids=${compareIds.join(',')}`);
  };

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
              } else {
                navigate(`/simulation/${row.id}/detail`);
              }
            }}
            rowClassName={(row: Simulation) => {
              if (!compareMode) {
                return '';
              }
              if (row.status !== 'Complete') {
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
              body={(row: Simulation) =>
                ACTIVE_STATUSES.includes(row.status) ? (
                  // While a run is in flight, this slot cancels it; once it's
                  // finished it becomes the delete action.
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
                ) : (
                  <Button
                    icon={<FontAwesomeIcon icon={faTrash} />}
                    text
                    aria-label={`Delete ${row.name}`}
                    tooltip="Delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteError(null);
                      setDeleteTarget(row);
                    }}
                    className="!border-transparent !bg-transparent !text-red-600 !text-lg"
                  />
                )
              }
            />
            <Column
              field="name"
              header="Name"
              alignHeader="center"
              align="center"
              bodyClassName="font-semibold"
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
              body={(row: Simulation) => (row.durationMinutes / 60).toFixed(1).replace(/\.0$/, '')}
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
              body={(row: Simulation) => (
                <span className="inline-flex items-center gap-3">
                  <span className="flex items-center gap-1.5">
                    {row.arrivalRatePerHour}
                    <FontAwesomeIcon icon={faPlaneArrival} className="text-slate-500" />
                  </span>
                  <span className="flex items-center gap-1.5">
                    {row.departureRatePerHour}
                    <FontAwesomeIcon icon={faPlaneDeparture} className="text-slate-500" />
                  </span>
                </span>
              )}
            />
            <Column
              header="Status"
              alignHeader="center"
              align="center"
              body={(row: Simulation) => (
                <Tag value={row.status} severity={STATUS_SEVERITY[row.status]} />
              )}
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
                <span className="inline-flex items-center">
                  <Button
                    icon={<FontAwesomeIcon icon={faCopy} />}
                    text
                    loading={duplicatingId === row.id}
                    aria-label={`Duplicate ${row.name}`}
                    tooltip="Duplicate"
                    onClick={(e) => {
                      e.stopPropagation();
                      openDuplicate(row);
                    }}
                    className="!border-transparent !bg-transparent !text-slate-500 !text-base"
                  />
                  <Button
                    icon={<FontAwesomeIcon icon={faPen} />}
                    text
                    aria-label={`Rename ${row.name}`}
                    tooltip="Rename"
                    onClick={(e) => {
                      e.stopPropagation();
                      openRename(row);
                    }}
                    className="!border-transparent !bg-transparent !text-slate-500 !text-base"
                  />
                  <Button
                    icon={<FontAwesomeIcon icon={faChevronRight} />}
                    text
                    aria-label="View details"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/simulation/${row.id}/detail`);
                    }}
                    className="!border-transparent !bg-transparent !text-brand-accent-active !text-lg"
                  />
                </span>
              )}
            />
          </DataTable>
        </div>
      </div>

      <SimulationFormDialog
        visible={dialogVisible}
        initialValues={formInitialValues}
        onHide={() => {
          setDialogVisible(false);
          setFormInitialValues(undefined);
        }}
        onCreated={() => refetch()}
      />

      <SweepFormDialog
        visible={sweepDialogVisible}
        onHide={() => setSweepDialogVisible(false)}
        onDone={() => refetch()}
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
    </div>
  );
}
