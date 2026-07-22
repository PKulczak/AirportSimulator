import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { InputText } from 'primereact/inputtext';
import { InputNumber } from 'primereact/inputnumber';
import { InputSwitch } from 'primereact/inputswitch';
import { Checkbox } from 'primereact/checkbox';
import { Dropdown } from 'primereact/dropdown';
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
import type { OperatingMode, OperationalStatus } from '../types/runway';

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

  const toggleRunway = (runwayId: number, checked: boolean) => {
    if (checked) {
      if (selectedRunwayIds.length >= MAX_RUNWAYS) {
        return;
      }
      setValue('runwayIds', [...selectedRunwayIds, runwayId], { shouldValidate: true });
      if (!runwayModes[String(runwayId)]) {
        setValue(
          'runwayModes',
          { ...runwayModes, [String(runwayId)]: 'Mixed' },
          { shouldValidate: true },
        );
      }
    } else {
      setValue(
        'runwayIds',
        selectedRunwayIds.filter((id) => id !== runwayId),
        { shouldValidate: true },
      );
    }
  };

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
      <div className="flex flex-col gap-1">
        <label htmlFor="name" className="text-sm font-medium text-slate-700">
          Simulation name
        </label>
        <Controller
          name="name"
          control={control}
          render={({ field }) => (
            <InputText
              id="name"
              value={field.value}
              onChange={(e) => field.onChange(e.target.value)}
              className={errors.name ? 'p-invalid' : undefined}
            />
          )}
        />
        {errors.name && <small className="text-red-600">{errors.name.message}</small>}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="arrivalRate" className="text-sm font-medium text-slate-700">
            Arrival rate (per hour)
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
              />
            )}
          />
          {errors.arrivalRate && (
            <small className="text-red-600">{errors.arrivalRate.message}</small>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="departureRate" className="text-sm font-medium text-slate-700">
            Departure rate (per hour)
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
              />
            )}
          />
          {errors.departureRate && (
            <small className="text-red-600">{errors.departureRate.message}</small>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="durationMinutes" className="text-sm font-medium text-slate-700">
            Duration (minutes)
          </label>
          <Controller
            name="durationMinutes"
            control={control}
            render={({ field }) => (
              <InputNumber
                inputId="durationMinutes"
                value={field.value}
                onValueChange={(e) => field.onChange(e.value ?? 0)}
                min={10}
              />
            )}
          />
          {errors.durationMinutes && (
            <small className="text-red-600">{errors.durationMinutes.message}</small>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="maxWaitMinutes" className="text-sm font-medium text-slate-700">
            Max wait (minutes)
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
              />
            )}
          />
          {errors.maxWaitMinutes && (
            <small className="text-red-600">{errors.maxWaitMinutes.message}</small>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="aircraftSpeedKnots" className="text-sm font-medium text-slate-700">
            Aircraft speed (knots, optional)
          </label>
          <Controller
            name="aircraftSpeedKnots"
            control={control}
            render={({ field }) => (
              <InputNumber
                inputId="aircraftSpeedKnots"
                value={field.value ?? null}
                onValueChange={(e) => field.onChange(e.value ?? undefined)}
                min={50}
                placeholder="Use server default"
              />
            )}
          />
          {errors.aircraftSpeedKnots && (
            <small className="text-red-600">{errors.aircraftSpeedKnots.message}</small>
          )}
        </div>

        <div className="flex flex-col gap-1 justify-center">
          <label htmlFor="includeClosures" className="text-sm font-medium text-slate-700">
            Random runway closures
          </label>
          <Controller
            name="includeClosures"
            control={control}
            render={({ field }) => (
              <InputSwitch
                inputId="includeClosures"
                checked={field.value}
                onChange={(e) => field.onChange(e.value)}
              />
            )}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-slate-700">Runways</p>
          <p className="text-xs text-slate-500">
            {selectedRunwayIds.length} / {MAX_RUNWAYS} selected
          </p>
        </div>
        {runwaysLoading && <p className="text-sm text-slate-500">Loading runways...</p>}
        <div className="flex flex-col gap-2">
          {runways.map((runway) => {
            const checked = selectedRunwayIds.includes(runway.id);
            const capReached = selectedRunwayIds.length >= MAX_RUNWAYS;
            return (
              <div
                key={runway.id}
                className="flex items-center gap-3 rounded border border-slate-200 p-2"
              >
                <Checkbox
                  inputId={`runway-${runway.id}`}
                  checked={checked}
                  onChange={(e) => toggleRunway(runway.id, e.checked ?? false)}
                  disabled={!checked && capReached}
                />
                <label htmlFor={`runway-${runway.id}`} className="flex-1 text-sm text-slate-700">
                  {runway.identifier}
                </label>
                <Dropdown
                  value={runwayModes[String(runway.id)] ?? null}
                  options={OPERATING_MODE_OPTIONS}
                  onChange={(e) => setRunwayMode(runway.id, e.value as OperatingMode)}
                  disabled={!checked}
                  placeholder="Mode"
                  className="w-44"
                />
                <Dropdown
                  value={runwayInitialStatus[String(runway.id)] ?? 'Available'}
                  options={OPERATIONAL_STATUS_OPTIONS}
                  onChange={(e) =>
                    setRunwayInitialStatus(runway.id, e.value as OperationalStatus)
                  }
                  disabled={!checked}
                  placeholder="Initial status"
                  className="w-48"
                />
              </div>
            );
          })}
        </div>
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

      <Button
        type="submit"
        label="Create simulation"
        loading={submitting}
        className="self-end"
      />
    </form>
  );
}
