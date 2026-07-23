import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DataTable, type DataTablePageEvent } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { Tag } from 'primereact/tag';
import { Button } from 'primereact/button';
import { InputText } from 'primereact/inputtext';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faArrowsRotate,
  faChevronRight,
  faPlaneArrival,
  faPlaneDeparture,
} from '@fortawesome/free-solid-svg-icons';
import { useGet } from '../functions/axios';
import type { Page } from '../types/common';
import type { Simulation, SimulationStatus } from '../types/simulation';
import SimulationFormDialog from './SimulationFormDialog';
import backgroundImage from '../assets/Background.png';

const PAGE_SIZE = 10;
const SEARCH_DEBOUNCE_MS = 350;

const STATUS_SEVERITY: Record<SimulationStatus, 'info' | 'warning' | 'success' | 'danger'> = {
  Pending: 'info',
  Running: 'warning',
  Complete: 'success',
  Error: 'danger',
};

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

  const onPage = (event: DataTablePageEvent) => {
    setPage(Math.floor((event.first ?? 0) / PAGE_SIZE) + 1);
  };

  return (
    <div className="-m-6 h-[calc(100%+3rem)] flex flex-col">
      <div
        className="relative flex-1 min-h-0 overflow-hidden p-4 sm:p-10 flex items-center justify-center"
        style={{
          backgroundImage: `url(${backgroundImage})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        }}
      >
        <div className="queue-scroll relative flex max-h-full w-full max-w-5xl flex-col gap-4 overflow-y-auto rounded-3xl bg-white p-4 shadow-2xl sm:p-6">
          <h1 className="text-center text-2xl font-bold uppercase tracking-wide text-slate-900">
            Airport Simulation
          </h1>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <InputText
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search"
              className="w-full max-w-sm bg-brand-bg"
            />
            <Button
              label="Create"
              onClick={() => setDialogVisible(true)}
              className="font-bold"
            />
          </div>

          {error && <p className="text-red-600">Failed to load simulations: {error.message}</p>}

          <DataTable
            value={data?.results ?? []}
            loading={loading}
            lazy
            paginator
            first={(page - 1) * PAGE_SIZE}
            rows={PAGE_SIZE}
            totalRecords={data?.count ?? 0}
            onPage={onPage}
            onRowClick={(e) => navigate(`/simulation/${(e.data as Simulation).id}/detail`)}
            rowHover
            className="cursor-pointer"
            emptyMessage="No simulations yet"
          >
            <Column field="name" header="Name" headerClassName="text-center" bodyClassName="text-center font-semibold" />
            <Column
              header="Date Requested"
              headerClassName="text-center"
              bodyClassName="text-center"
              body={(row: Simulation) => {
                const { date, time } = formatDateParts(row.createdAt);
                return (
                  <span className="flex flex-col leading-tight">
                    <span>{date}</span>
                    <span>{time}</span>
                  </span>
                );
              }}
            />
            <Column
              header="Duration (Hrs)"
              headerClassName="text-center"
              bodyClassName="text-center"
              body={(row: Simulation) => (row.durationMinutes / 60).toFixed(1).replace(/\.0$/, '')}
            />
            <Column
              field="runwayCount"
              header="Runways"
              headerClassName="text-center"
              bodyClassName="text-center"
            />
            <Column
              header="Aircraft Flow"
              headerClassName="text-center"
              bodyClassName="text-center"
              body={(row: Simulation) => (
                <span className="flex items-center justify-center gap-3">
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
              headerClassName="text-center"
              bodyClassName="text-center"
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
                  className="!text-brand-accent"
                />
              )}
              headerClassName="text-center"
              bodyClassName="text-center"
              body={(row: Simulation) => (
                <Button
                  icon={<FontAwesomeIcon icon={faChevronRight} />}
                  rounded
                  aria-label="View details"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(`/simulation/${row.id}/detail`);
                  }}
                />
              )}
            />
          </DataTable>
        </div>
      </div>

      <SimulationFormDialog
        visible={dialogVisible}
        onHide={() => setDialogVisible(false)}
        onCreated={() => refetch()}
      />
    </div>
  );
}
