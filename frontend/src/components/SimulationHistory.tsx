import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DataTable, type DataTablePageEvent } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { Tag } from 'primereact/tag';
import { Button } from 'primereact/button';
import { InputText } from 'primereact/inputtext';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowsRotate, faChartLine, faPlus } from '@fortawesome/free-solid-svg-icons';
import { useGet } from '../functions/axios';
import type { Page } from '../types/common';
import type { Simulation, SimulationStatus } from '../types/simulation';
import SimulationFormDialog from './SimulationFormDialog';

const PAGE_SIZE = 10;
const SEARCH_DEBOUNCE_MS = 350;

const STATUS_SEVERITY: Record<SimulationStatus, 'info' | 'warning' | 'success' | 'danger'> = {
  Pending: 'info',
  Running: 'warning',
  Complete: 'success',
  Error: 'danger',
};

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
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-slate-200 bg-brand-bg p-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-800">Simulation history</h1>
        <div className="flex items-center gap-2">
          <Button
            icon={<FontAwesomeIcon icon={faArrowsRotate} />}
            outlined
            onClick={() => refetch()}
            aria-label="Refresh"
            tooltip="Refresh"
          />
          <Button
            label="New simulation"
            icon={<FontAwesomeIcon icon={faPlus} className="mr-2" />}
            onClick={() => setDialogVisible(true)}
          />
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-brand-bg p-4 flex flex-col gap-4">
        <InputText
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search by name..."
          className="w-full max-w-sm"
        />

        {error && (
          <p className="text-red-600">Failed to load simulations: {error.message}</p>
        )}

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
          <Column field="name" header="Name" />
          <Column
            field="status"
            header="Status"
            body={(row: Simulation) => (
              <Tag value={row.status} severity={STATUS_SEVERITY[row.status]} />
            )}
          />
          <Column field="arrivalRatePerHour" header="Arrivals/hr" />
          <Column field="departureRatePerHour" header="Departures/hr" />
          <Column field="durationMinutes" header="Duration (min)" />
          <Column
            field="createdAt"
            header="Created"
            body={(row: Simulation) => new Date(row.createdAt).toLocaleString()}
          />
          <Column
            header="Replay"
            body={(row: Simulation) => (
              <Button
                text
                icon={<FontAwesomeIcon icon={faChartLine} />}
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(`/simulation/${row.id}/visualisation`);
                }}
              />
            )}
          />
        </DataTable>
      </div>

      <SimulationFormDialog
        visible={dialogVisible}
        onHide={() => setDialogVisible(false)}
        onCreated={() => refetch()}
      />
    </div>
  );
}
