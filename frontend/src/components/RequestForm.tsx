import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { InputText } from 'primereact/inputtext';
import { InputNumber } from 'primereact/inputnumber';
import { SelectButton } from 'primereact/selectbutton';
import { Button } from 'primereact/button';
import { Message } from 'primereact/message';
import { usePost } from '../functions/axios';
import RunwaySelectionField from './RunwaySelectionField';
import {
  defaultSimulationFormValues,
  simulationFormSchema,
  toCreateSimulationRequest,
  type SimulationFormValues,
} from '../schemas/simulationForm';
import type { CreateSimulationRequest, Simulation } from '../types/simulation';

const CLOSURES_OPTIONS: { label: string; value: boolean }[] = [
  { label: 'No', value: false },
  { label: 'Yes', value: true },
];

const REQUIRED_MARK = <span className="text-red-600">*</span>;

interface RequestFormProps {
  onCreated: (simulation: Simulation) => void;
  /** Pre-fill the form (the Duplicate flow); omit for a blank create form. */
  initialValues?: SimulationFormValues;
}

export default function RequestForm({ onCreated, initialValues }: RequestFormProps) {
  const { execute, loading: submitting, error: submitError } = usePost<
    Simulation,
    CreateSimulationRequest
  >('/api/simulations/');

  const {
    control,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<SimulationFormValues>({
    resolver: zodResolver(simulationFormSchema),
    defaultValues: initialValues ?? defaultSimulationFormValues,
  });

  // Re-seed the form when the caller swaps in new initial values (e.g. opening
  // Duplicate for a different run without remounting the form).
  useEffect(() => {
    reset(initialValues ?? defaultSimulationFormValues);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialValues]);

  const selectedRunwayIds = watch('runwayIds');
  const runwayModes = watch('runwayModes');
  const runwayInitialStatus = watch('runwayInitialStatus');

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
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[2fr_1fr_1fr]">
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

        <div className="flex flex-col gap-1">
          <label htmlFor="randomSeed" className="min-h-10 text-sm font-bold text-slate-800">
            Random Seed (optional)
          </label>
          <Controller
            name="randomSeed"
            control={control}
            render={({ field }) => (
              <InputNumber
                inputId="randomSeed"
                value={field.value}
                onValueChange={(e) => field.onChange(e.value ?? null)}
                min={0}
                max={2147483647}
                useGrouping={false}
                placeholder="Leave blank for random"
                className="w-full"
                inputClassName="w-full"
              />
            )}
          />
          <small className="text-slate-500">
            Set to reproduce an identical run; blank generates a fresh one.
          </small>
          {errors.randomSeed && (
            <small className="text-red-600">{errors.randomSeed.message}</small>
          )}
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="heavyPercentage" className="min-h-10 text-sm font-bold text-slate-800">
            Heavy Aircraft % (optional)
          </label>
          <Controller
            name="heavyPercentage"
            control={control}
            render={({ field }) => (
              <InputNumber
                inputId="heavyPercentage"
                value={field.value}
                onValueChange={(e) => field.onChange(e.value ?? null)}
                min={0}
                max={100}
                suffix="%"
                placeholder="Default mix"
                className="w-full"
                inputClassName="w-full"
              />
            )}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="mediumPercentage" className="min-h-10 text-sm font-bold text-slate-800">
            Medium Aircraft % (optional)
          </label>
          <Controller
            name="mediumPercentage"
            control={control}
            render={({ field }) => (
              <InputNumber
                inputId="mediumPercentage"
                value={field.value}
                onValueChange={(e) => field.onChange(e.value ?? null)}
                min={0}
                max={100}
                suffix="%"
                placeholder="Default mix"
                className="w-full"
                inputClassName="w-full"
              />
            )}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="lightPercentage" className="min-h-10 text-sm font-bold text-slate-800">
            Light Aircraft % (optional)
          </label>
          <Controller
            name="lightPercentage"
            control={control}
            render={({ field }) => (
              <InputNumber
                inputId="lightPercentage"
                value={field.value}
                onValueChange={(e) => field.onChange(e.value ?? null)}
                min={0}
                max={100}
                suffix="%"
                placeholder="Default mix"
                className="w-full"
                inputClassName="w-full"
              />
            )}
          />
        </div>

        {errors.heavyPercentage && (
          <small className="text-red-600 sm:col-span-3">{errors.heavyPercentage.message}</small>
        )}
        <small className="text-slate-500 sm:col-span-3">
          Leave all three blank to use the default Heavy/Medium/Light traffic mix; set all three
          together (summing to 100%) to override it.
        </small>
      </div>

      <RunwaySelectionField
        runwayIds={selectedRunwayIds}
        runwayModes={runwayModes}
        runwayInitialStatus={runwayInitialStatus}
        onRunwayIdsChange={(ids) => setValue('runwayIds', ids, { shouldValidate: true })}
        onRunwayModesChange={(modes) => setValue('runwayModes', modes, { shouldValidate: true })}
        onRunwayInitialStatusChange={(status) =>
          setValue('runwayInitialStatus', status, { shouldValidate: true })
        }
        error={runwayModesError}
      />

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
