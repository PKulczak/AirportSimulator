import { useMemo, useState } from 'react';
import { DataTable, type DataTablePageEvent } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { Dialog } from 'primereact/dialog';
import { Button } from 'primereact/button';
import { Message } from 'primereact/message';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTrash } from '@fortawesome/free-solid-svg-icons';
import { useDelete, useGet } from '../functions/axios';
import { WEATHER_CONDITION_OPTIONS } from '../schemas/simulationForm';
import type { Page } from '../types/common';
import type { Template } from '../types/template';

const PAGE_SIZE = 10;

interface TemplatePickerDialogProps {
  visible: boolean;
  onHide: () => void;
  /** Called with the chosen template; the caller pre-fills the create form
   * from it (see `templateToFormValues`) and opens it. */
  onSelect: (template: Template) => void;
}

function weatherLabel(condition: Template['weatherCondition']): string {
  return WEATHER_CONDITION_OPTIONS.find((option) => option.value === condition)?.label ?? condition;
}

/** "Load From Template" picker (Slice 8.1) — lists saved config templates
 * (see "Save as Template" in RequestForm.tsx) and lets the user apply one or
 * delete it. Mirrors SimulationHistory.tsx's own list-fetch/paginate/delete
 * patterns at a smaller scale, since this is just one dialog rather than a
 * whole page. */
export default function TemplatePickerDialog({
  visible,
  onHide,
  onSelect,
}: TemplatePickerDialogProps) {
  const [page, setPage] = useState(1);
  const [deleteTarget, setDeleteTarget] = useState<Template | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const url = useMemo(() => `/api/templates/?page=${page}`, [page]);
  const { data, loading, error, refetch } = useGet<Page<Template>>(visible ? url : null);
  // `!== undefined` (not truthiness) is the correct success check here since a
  // 204 delete response's `data` is `''`, which is falsy despite succeeding.
  const { execute: deleteTemplate, loading: deleting } = useDelete(
    deleteTarget ? `/api/templates/${deleteTarget.id}/` : '',
  );

  const onPage = (event: DataTablePageEvent) => {
    setPage(Math.floor((event.first ?? 0) / PAGE_SIZE) + 1);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) {
      return;
    }
    setDeleteError(null);
    const result = await deleteTemplate();
    if (result === undefined) {
      setDeleteError('Failed to delete template. Please try again.');
      return;
    }
    setDeleteTarget(null);
    const remaining = (data?.results?.length ?? 1) - 1;
    if (remaining <= 0 && page > 1) {
      setPage((p) => p - 1);
    } else {
      refetch();
    }
  };

  return (
    <>
      <Dialog
        header="Load From Template"
        visible={visible}
        onHide={onHide}
        style={{ width: '54rem', maxWidth: '95vw' }}
        modal
      >
        {error && (
          <Message
            severity="error"
            text={`Failed to load templates: ${error.message}`}
            className="mb-3 w-full"
          />
        )}
        <DataTable
          value={data?.results ?? []}
          loading={loading && !data}
          lazy
          paginator
          first={(page - 1) * PAGE_SIZE}
          rows={PAGE_SIZE}
          totalRecords={data?.count ?? 0}
          onPage={onPage}
          emptyMessage="No saved templates yet"
        >
          <Column field="name" header="Name" />
          <Column
            header="Runways"
            alignHeader="center"
            align="center"
            body={(row: Template) => row.runways.length}
          />
          <Column
            header="Arrivals/hr"
            alignHeader="center"
            align="center"
            field="arrivalRatePerHour"
          />
          <Column
            header="Departures/hr"
            alignHeader="center"
            align="center"
            field="departureRatePerHour"
          />
          <Column
            header="Weather"
            alignHeader="center"
            align="center"
            body={(row: Template) => weatherLabel(row.weatherCondition)}
          />
          <Column
            header=""
            alignHeader="center"
            align="center"
            body={(row: Template) => (
              <div className="flex justify-end gap-2">
                <Button label="Use" size="small" onClick={() => onSelect(row)} />
                <Button
                  icon={<FontAwesomeIcon icon={faTrash} />}
                  text
                  aria-label={`Delete template ${row.name}`}
                  tooltip="Delete template"
                  onClick={() => setDeleteTarget(row)}
                  className="!border-transparent !bg-transparent !text-red-600"
                />
              </div>
            )}
          />
        </DataTable>
      </Dialog>

      <Dialog
        header="Delete template"
        visible={deleteTarget !== null}
        onHide={() => {
          if (!deleting) {
            setDeleteTarget(null);
          }
        }}
        draggable={false}
        dismissableMask={!deleting}
        style={{ width: '26rem', maxWidth: '90vw' }}
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
          Delete template <span className="font-semibold">{deleteTarget?.name}</span>? This
          cannot be undone.
        </p>
        {deleteError && <Message severity="error" text={deleteError} className="mt-3 w-full" />}
      </Dialog>
    </>
  );
}
