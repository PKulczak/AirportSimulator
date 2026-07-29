import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { zodResolver } from '@hookform/resolvers/zod';
import { InputText } from 'primereact/inputtext';
import { InputNumber } from 'primereact/inputnumber';
import { SelectButton } from 'primereact/selectbutton';
import { Dropdown } from 'primereact/dropdown';
import { Button } from 'primereact/button';
import { Message } from 'primereact/message';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChartLine } from '@fortawesome/free-solid-svg-icons';
import { usePost } from '../functions/axios';
import RunwaySelectionField from './RunwaySelectionField';
import {
  defaultSweepFormValues,
  SWEEP_VARIABLE_OPTIONS,
  sweepFormSchema,
  toCreateSweepRequest,
  type SweepFormValues,
} from '../schemas/simulationForm';
import type { CreateSweepRequest, SweepResponse, SweepVariable } from '../types/simulation';

// The "Simulation Duration" field above displays/edits hours but stores
// minutes; End Value/Step are raw, unconverted numbers. Spelling out the
// expected unit here avoids the confusion of someone entering "4" meaning
// 4 hours where the field actually needs 240 (minutes).
const SWEEP_VARIABLE_UNITS: Record<SweepVariable, string> = {
  arrivalRatePerHour: 'aircraft per hour',
  departureRatePerHour: 'aircraft per hour',
  durationMinutes: 'minutes (not hours)',
  maxWaitMinutes: 'minutes',
};

const CLOSURES_OPTIONS: { label: string; value: boolean }[] = [
  { label: 'No', value: false },
  { label: 'Yes', value: true },
];

const REQUIRED_MARK = <span className="text-red-600">*</span>;

interface SweepFormProps {
  /** Fired once the user dismisses the post-submit summary (Done button). */
  onDone: () => void;
}

export default function SweepForm({ onDone }: SweepFormProps) {
  const navigate = useNavigate();
  const { execute, loading: submitting, error: submitError } = usePost<
    SweepResponse,
    CreateSweepRequest
  >('/api/simulations/sweep/');
  const [result, setResult] = useState<SweepResponse | null>(null);

  const {
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<SweepFormValues>({
    resolver: zodResolver(sweepFormSchema),
    defaultValues: defaultSweepFormValues,
  });

  const selectedRunwayIds = watch('runwayIds');
  const runwayModes = watch('runwayModes');
  const runwayInitialStatus = watch('runwayInitialStatus');
  const variable = watch('variable');

  const onSubmit = handleSubmit(async (values) => {
    const created = await execute(toCreateSweepRequest(values));
    if (created) {
      setResult(created);
    }
  });

  const runwayModesError: string | undefined =
    (errors.runwayModes?.message as string | undefined) ?? errors.runwayIds?.message;

  if (result) {
    const variableLabel =
      SWEEP_VARIABLE_OPTIONS.find((option) => option.value === variable)?.label ?? variable;
    return (
      <div className="flex flex-col gap-4">
        <Message
          severity="success"
          text={`Created ${result.simulations.length} simulation runs sweeping ${variableLabel}.`}
          className="w-full"
        />
        <ul className="max-h-60 list-inside list-disc overflow-y-auto rounded border border-slate-200 p-3 text-sm text-slate-700">
          {result.simulations.map((simulation) => (
            <li key={simulation.id}>{simulation.name}</li>
          ))}
        </ul>
        <p className="text-sm text-slate-500">
          Results chart becomes available once at least 2 runs finish.
        </p>
        <div className="-mx-6 -mb-8 mt-2 grid grid-cols-2 gap-px overflow-hidden rounded-t-none rounded-b-md">
          <Button label="Done" text onClick={onDone} className="!rounded-none !border-0 !py-3" />
          <Button
            label="View Sweep Results"
            icon={<FontAwesomeIcon icon={faChartLine} />}
            onClick={() => {
              onDone();
              navigate(`/batch/${result.batchId}`);
            }}
            className="!rounded-none !border-0 !border-brand-accent-active !bg-brand-accent-active !py-3 !font-bold !text-white"
          />
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[2fr_1fr_1fr]">
        <div className="flex flex-col gap-1">
          <label htmlFor="sweep-name" className="min-h-10 text-sm font-bold text-slate-800">
            Sweep Name {REQUIRED_MARK}
          </label>
          <Controller
            name="name"
            control={control}
            render={({ field }) => (
              <InputText
                id="sweep-name"
                value={field.value}
                onChange={(e) => field.onChange(e.target.value)}
                placeholder="Sweep Name"
                className={`bg-brand-bg ${errors.name ? 'p-invalid' : ''}`}
              />
            )}
          />
          <small className="text-slate-500">
            Each generated run's name is suffixed with the swept variable and its value.
          </small>
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
          <label htmlFor="sweep-randomSeed" className="min-h-10 text-sm font-bold text-slate-800">
            Random Seed (optional)
          </label>
          <Controller
            name="randomSeed"
            control={control}
            render={({ field }) => (
              <InputNumber
                inputId="sweep-randomSeed"
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
            Set to reuse one seed across every run in the sweep; blank gives each run
            independent randomness.
          </small>
          {errors.randomSeed && (
            <small className="text-red-600">{errors.randomSeed.message}</small>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="flex flex-col gap-1">
          <label
            htmlFor="sweep-durationHours"
            className="min-h-10 text-sm font-bold text-slate-800"
          >
            Simulation Duration (Hours) {REQUIRED_MARK}
          </label>
          <Controller
            name="durationMinutes"
            control={control}
            render={({ field }) => (
              <InputNumber
                inputId="sweep-durationHours"
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
          <label htmlFor="sweep-arrivalRate" className="min-h-10 text-sm font-bold text-slate-800">
            Arrivals Per Hour {REQUIRED_MARK}
          </label>
          <Controller
            name="arrivalRate"
            control={control}
            render={({ field }) => (
              <InputNumber
                inputId="sweep-arrivalRate"
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
          <label
            htmlFor="sweep-departureRate"
            className="min-h-10 text-sm font-bold text-slate-800"
          >
            Departures Per Hour {REQUIRED_MARK}
          </label>
          <Controller
            name="departureRate"
            control={control}
            render={({ field }) => (
              <InputNumber
                inputId="sweep-departureRate"
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
          <label
            htmlFor="sweep-maxWaitMinutes"
            className="min-h-10 text-sm font-bold text-slate-800"
          >
            Max Wait Time For Cancellation (Minutes) {REQUIRED_MARK}
          </label>
          <Controller
            name="maxWaitMinutes"
            control={control}
            render={({ field }) => (
              <InputNumber
                inputId="sweep-maxWaitMinutes"
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

      <div className="flex flex-col gap-3 rounded-md border border-slate-200 bg-brand-bg p-3">
        <p className="text-sm font-bold text-slate-800">Sweep Configuration</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="sweep-variable" className="text-sm font-bold text-slate-800">
              Variable to Sweep {REQUIRED_MARK}
            </label>
            <Controller
              name="variable"
              control={control}
              render={({ field }) => (
                <Dropdown
                  inputId="sweep-variable"
                  value={field.value}
                  options={SWEEP_VARIABLE_OPTIONS}
                  onChange={(e) => field.onChange(e.value)}
                  className="w-full"
                />
              )}
            />
            <small className="text-slate-500">
              The value entered above is used as this sweep's starting point.
            </small>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="sweep-rangeEnd" className="text-sm font-bold text-slate-800">
              End Value {REQUIRED_MARK}
            </label>
            <Controller
              name="rangeEnd"
              control={control}
              render={({ field }) => (
                <InputNumber
                  inputId="sweep-rangeEnd"
                  value={field.value}
                  onValueChange={(e) => field.onChange(e.value ?? 0)}
                  showButtons
                  className="w-full"
                  inputClassName="w-full"
                />
              )}
            />
            <small className="text-slate-500">In {SWEEP_VARIABLE_UNITS[variable]}.</small>
            {errors.rangeEnd && (
              <small className="text-red-600">{errors.rangeEnd.message}</small>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="sweep-rangeStep" className="text-sm font-bold text-slate-800">
              Step {REQUIRED_MARK}
            </label>
            <Controller
              name="rangeStep"
              control={control}
              render={({ field }) => (
                <InputNumber
                  inputId="sweep-rangeStep"
                  value={field.value}
                  onValueChange={(e) => field.onChange(e.value ?? 1)}
                  min={1}
                  showButtons
                  className="w-full"
                  inputClassName="w-full"
                />
              )}
            />
            <small className="text-slate-500">In {SWEEP_VARIABLE_UNITS[variable]}.</small>
            {errors.rangeStep && (
              <small className="text-red-600">{errors.rangeStep.message}</small>
            )}
          </div>
        </div>
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
            'Failed to create the sweep. Please check the config and range/step.'
          }
        />
      )}

      <Button
        type="submit"
        label="Create Sweep"
        loading={submitting}
        className="-mx-6 -mb-8 mt-2 !rounded-t-none !rounded-b-md !border-0 !py-3 !text-lg !font-bold"
      />
    </form>
  );
}
