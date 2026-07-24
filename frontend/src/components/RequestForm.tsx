import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { InputText } from 'primereact/inputtext';
import { InputNumber } from 'primereact/inputnumber';
import { SelectButton } from 'primereact/selectbutton';
import { Dropdown } from 'primereact/dropdown';
import { DataTable, type DataTableSelectionMultipleChangeEvent } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { Button } from 'primereact/button';
import { Message } from 'primereact/message';
import { useRunways } from '../context/RunwayContext';
import { usePost } from '../functions/axios';
import {
  defaultSimulationFormValues,
  MAX_RUNWAYS,
  simulationFormSchema,
  toCreateSimulationRequest,
  type SimulationFormValues,
} from '../schemas/simulationForm';
import type { CreateSimulationRequest, Simulation } from '../types/simulation';
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

const CLOSURES_OPTIONS: { label: string; value: boolean }[] = [
  { label: 'No', value: false },
  { label: 'Yes', value: true },
];

const REQUIRED_MARK = <span className="text-red-600">*</span>;

interface RequestFormProps {
  onCreated: (simulation: Simulation) => void;
}

export default function RequestForm({ onCreated }: RequestFormProps) {
  const { runways, loading: runwaysLoading } = useRunways();
  const { execute, loading: submitting, error: submitError } = usePost<
    Simulation,
    CreateSimulationRequest
  >('/api/simulations/');

  const {
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<SimulationFormValues>({
    resolver: zodResolver(simulationFormSchema),
    defaultValues: defaultSimulationFormValues,
  });

  const selectedRunwayIds = watch('runwayIds');
  const runwayModes = watch('runwayModes');
  const runwayInitialStatus = watch('runwayInitialStatus');
  const selectedRunways = runways.filter((r) => selectedRunwayIds.includes(r.id));

  const setRunwayMode = (runwayId: number, mode: OperatingMode) => {
    setValue(
      'runwayModes',
      { ...runwayModes, [String(runwayId)]: mode },
      { shouldValidate: true },
    );
  };

  const setRunwayInitialStatus = (runwayId: number, initialStatus: OperationalStatus) => {
    setValue(
      'runwayInitialStatus',
      { ...runwayInitialStatus, [String(runwayId)]: initialStatus },
      { shouldValidate: true },
    );
  };

  // The master runway list (12) deliberately exceeds MAX_RUNWAYS (10), so
  // "select all" has to actually cap rather than just select everything.
  // `isDataSelectable` disables individual checkboxes once the cap is hit;
  // this clip is the backstop that also covers the header select-all
  // checkbox, which can otherwise add many rows in one event.
  const onRunwaySelectionChange = (e: DataTableSelectionMultipleChangeEvent<Runway[]>) => {
    const newIds = e.value.map((r) => r.id).slice(0, MAX_RUNWAYS);
    setValue('runwayIds', newIds, { shouldValidate: true });
    const newModes = { ...runwayModes };
    for (const id of newIds) {
      if (!newModes[String(id)]) {
        newModes[String(id)] = 'Mixed';
      }
    }
    setValue('runwayModes', newModes, { shouldValidate: true });
  };

  const onSubmit = handleSubmit(async (values) => {
    const created = await execute(toCreateSimulationRequest(values));
    if (created) {
      onCreated(created);
    }
  });

  const runwayModesError: string | undefined =
    (errors.runwayModes?.message as string | undefined) ?? errors.runwayIds?.message;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-1">
          <label htmlFor="name" className="min-h-10 text-sm font-bold text-slate-800">
            Name of Simulation {REQUIRED_MARK}
          </label>
          <Controller
            name="name"
            control={control}
            render={({ field }) => (
              <InputText
                id="name"
                value={field.value}
                onChange={(e) => field.onChange(e.target.value)}
                placeholder="Simulation Name"
                className={`bg-brand-bg ${errors.name ? 'p-invalid' : ''}`}
              />
            )}
          />
          {errors.name && <small className="text-red-600">{errors.name.message}</small>}
        </div>

        <div className="flex flex-col gap-1">
          <label className="min-h-10 text-sm font-bold text-slate-800">
            Include Randomised Runway Closure Events? {REQUIRED_MARK}
          </label>
          <Controller
            name="includeClosures"
            control={control}
            render={({ field }) => (
              <SelectButton
                value={field.value}
                onChange={(e) => e.value !== null && field.onChange(e.value)}
                options={CLOSURES_OPTIONS}
                allowEmpty={false}
              />
            )}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="durationHours" className="min-h-10 text-sm font-bold text-slate-800">
            Simulation Duration (Hours) {REQUIRED_MARK}
          </label>
          <Controller
            name="durationMinutes"
            control={control}
            render={({ field }) => (
              <InputNumber
                inputId="durationHours"
                value={field.value / 60}
                onValueChange={(e) => field.onChange(Math.round((e.value ?? 0) * 60))}
                min={1}
                max={24}
                showButtons
                className="w-full"
                inputClassName="w-full"
              />
            )}
          />
          {errors.durationMinutes && (
            <small className="text-red-600">{errors.durationMinutes.message}</small>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="arrivalRate" className="min-h-10 text-sm font-bold text-slate-800">
            Arrivals Per Hour {REQUIRED_MARK}
          </label>
          <Controller
            name="arrivalRate"
            control={control}
            render={({ field }) => (
              <InputNumber
                inputId="arrivalRate"
                value={field.value}
                onValueChange={(e) => field.onChange(e.value ?? 0)}
                min={0}
                max={100}
                showButtons
                className="w-full"
                inputClassName="w-full"
              />
            )}
          />
          {errors.arrivalRate && (
            <small className="text-red-600">{errors.arrivalRate.message}</small>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="departureRate" className="min-h-10 text-sm font-bold text-slate-800">
            Departures Per Hour {REQUIRED_MARK}
          </label>
          <Controller
            name="departureRate"
            control={control}
            render={({ field }) => (
              <InputNumber
                inputId="departureRate"
                value={field.value}
                onValueChange={(e) => field.onChange(e.value ?? 0)}
                min={0}
                max={100}
                showButtons
                className="w-full"
                inputClassName="w-full"
              />
            )}
          />
          {errors.departureRate && (
            <small className="text-red-600">{errors.departureRate.message}</small>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="maxWaitMinutes" className="min-h-10 text-sm font-bold text-slate-800">
            Max Wait Time For Cancellation (Minutes) {REQUIRED_MARK}
          </label>
          <Controller
            name="maxWaitMinutes"
            control={control}
            render={({ field }) => (
              <InputNumber
                inputId="maxWaitMinutes"
                value={field.value}
                onValueChange={(e) => field.onChange(e.value ?? 0)}
                min={1}
                showButtons
                className="w-full"
                inputClassName="w-full"
              />
            )}
          />
          {errors.maxWaitMinutes && (
            <small className="text-red-600">{errors.maxWaitMinutes.message}</small>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-bold text-slate-800">
            Select runways to include in simulation {REQUIRED_MARK}
          </p>
          <p className="text-xs text-slate-500">
            {selectedRunwayIds.length} / {MAX_RUNWAYS} selected
          </p>
        </div>
        {runwaysLoading && <p className="text-sm text-slate-500">Loading runways...</p>}
        <DataTable
          value={runways}
          dataKey="id"
          selectionMode="multiple"
          selection={selectedRunways}
          onSelectionChange={onRunwaySelectionChange}
          isDataSelectable={(e) =>
            selectedRunwayIds.includes((e.data as Runway).id) ||
            selectedRunwayIds.length < MAX_RUNWAYS
          }
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
              <Dropdown
                value={runwayModes[String(row.id)] ?? null}
                options={OPERATING_MODE_OPTIONS}
                onChange={(e) => setRunwayMode(row.id, e.value as OperatingMode)}
                disabled={!selectedRunwayIds.includes(row.id)}
                placeholder="Please..."
                className="w-full"
              />
            )}
          />
          <Column
            header="Operational Status"
            body={(row: Runway) => (
              <Dropdown
                value={runwayInitialStatus[String(row.id)] ?? null}
                options={OPERATIONAL_STATUS_OPTIONS}
                onChange={(e) => setRunwayInitialStatus(row.id, e.value as OperationalStatus)}
                disabled={!selectedRunwayIds.includes(row.id)}
                placeholder="Please..."
                className="w-full"
              />
            )}
          />
        </DataTable>
        {runwayModesError && <small className="text-red-600">{runwayModesError}</small>}
      </div>

      {submitError && (
        <Message
          severity="error"
          text={
            (submitError.body?.detail as string | undefined) ??
            'Failed to create simulation. Please check the form and try again.'
          }
        />
      )}

      {/* Full-bleed footer bar: the negative margins cancel the dialog
       * content's own padding (1.5rem sides, 2rem bottom) so this reaches
       * every edge, matching the design's edge-to-edge submit bar. */}
      <Button
        type="submit"
        label="Submit"
        loading={submitting}
        className="-mx-6 -mb-8 mt-2 !rounded-t-none !rounded-b-md !border-0 !py-3 !text-lg !font-bold"
      />
    </form>
  );
}
