import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { InputText } from 'primereact/inputtext';
import { InputNumber } from 'primereact/inputnumber';
import { SelectButton } from 'primereact/selectbutton';
import { Dropdown } from 'primereact/dropdown';
import { Button } from 'primereact/button';
import { Message } from 'primereact/message';
import { Dialog } from 'primereact/dialog';
import { Checkbox } from 'primereact/checkbox';
import { usePost } from '../functions/axios';
import { useAuth } from '../context/AuthContext';
import RunwaySelectionField from './RunwaySelectionField';
import WeightClassMixSlider, { type WeightClassMix } from './WeightClassMixSlider';
import {
  DEFAULT_WEIGHT_CLASS_MIX,
  defaultSimulationFormValues,
  simulationFormSchema,
  SIMULATION_NAME_MAX,
  toCreateSimulationRequest,
  toCreateTemplateRequest,
  validateSimulationName,
  WEATHER_CONDITION_OPTIONS,
  type SimulationFormValues,
} from '../schemas/simulationForm';
import type { CreateSimulationRequest, Simulation } from '../types/simulation';
import type { CreateTemplateRequest, Template } from '../types/template';

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
  const { user } = useAuth();
  const { execute, loading: submitting, error: submitError } = usePost<
    Simulation,
    CreateSimulationRequest
  >('/api/simulations/');

  const {
    execute: createTemplate,
    loading: savingTemplate,
    error: saveTemplateError,
  } = usePost<Template, CreateTemplateRequest>('/api/templates/');

  const {
    control,
    handleSubmit,
    watch,
    setValue,
    reset,
    trigger,
    getValues,
    formState: { errors },
  } = useForm<SimulationFormValues>({
    resolver: zodResolver(simulationFormSchema),
    defaultValues: initialValues ?? defaultSimulationFormValues,
  });

  const [saveTemplateVisible, setSaveTemplateVisible] = useState(false);
  const [templateNameInput, setTemplateNameInput] = useState('');
  const [saveTemplateGlobal, setSaveTemplateGlobal] = useState(false);

  // Re-seed the form when the caller swaps in new initial values (e.g. opening
  // Duplicate for a different run without remounting the form).
  useEffect(() => {
    reset(initialValues ?? defaultSimulationFormValues);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialValues]);

  const selectedRunwayIds = watch('runwayIds');
  const runwayModes = watch('runwayModes');
  const runwayInitialStatus = watch('runwayInitialStatus');

  // All three are validated all-or-nothing (see simulationFormSchema), so
  // checking one is enough to know whether the user has customized the mix.
  const heavyPercentage = watch('heavyPercentage');
  const mediumPercentage = watch('mediumPercentage');
  const lightPercentage = watch('lightPercentage');
  const isCustomMix = heavyPercentage !== null;
  const mixValue: WeightClassMix =
    isCustomMix
      ? { heavy: heavyPercentage as number, medium: mediumPercentage as number, light: lightPercentage as number }
      : DEFAULT_WEIGHT_CLASS_MIX;

  // Only the last of these three setValue calls should trigger validation —
  // each call synchronously updates that one field, and (unlike the value
  // update itself) `shouldValidate` runs the Zod resolver against whatever
  // the form holds *at that instant*. Validating after every call meant the
  // first one or two ran against a still-stale mix (the new heavy percentage
  // alongside the old medium/light), which don't sum to 100 — transiently
  // failing the all-or-nothing/sums-to-100 rule even though the three
  // fields, once all applied, always do.
  const handleMixChange = (next: WeightClassMix) => {
    setValue('heavyPercentage', next.heavy);
    setValue('mediumPercentage', next.medium);
    setValue('lightPercentage', next.light, { shouldValidate: true });
  };

  const handleCustomMixToggle = (customize: boolean) => {
    const next = customize ? DEFAULT_WEIGHT_CLASS_MIX : { heavy: null, medium: null, light: null };
    setValue('heavyPercentage', next.heavy);
    setValue('mediumPercentage', next.medium);
    setValue('lightPercentage', next.light, { shouldValidate: true });
  };

  const onSubmit = handleSubmit(async (values) => {
    const created = await execute(toCreateSimulationRequest(values));
    if (created) {
      onCreated(created);
    }
  });

  // Validates the whole form before opening the naming prompt — a template
  // is meant to be a reusable, well-formed config, so it goes through the
  // same rules a real submission would. Any failures already show up as this
  // form's own inline field errors, so there's nothing extra to display here.
  const openSaveTemplate = async () => {
    const valid = await trigger();
    if (!valid) {
      return;
    }
    setTemplateNameInput('');
    setSaveTemplateGlobal(false);
    setSaveTemplateVisible(true);
  };

  const templateNameError = validateSimulationName(templateNameInput);

  const confirmSaveTemplate = async () => {
    if (templateNameInput.trim() === '' || templateNameError) {
      return;
    }
    const created = await createTemplate(
      toCreateTemplateRequest(templateNameInput, getValues(), saveTemplateGlobal),
    );
    if (created) {
      setSaveTemplateVisible(false);
    }
  };

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
          <label htmlFor="weatherCondition" className="min-h-10 text-sm font-bold text-slate-800">
            Weather {REQUIRED_MARK}
          </label>
          <Controller
            name="weatherCondition"
            control={control}
            render={({ field }) => (
              <Dropdown
                inputId="weatherCondition"
                value={field.value}
                options={WEATHER_CONDITION_OPTIONS}
                onChange={(e) => field.onChange(e.value)}
                className="w-full"
              />
            )}
          />
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
          <label className="min-h-10 text-sm font-bold text-slate-800">
            Customize Aircraft Weight-Class Mix?
          </label>
          <SelectButton
            value={isCustomMix}
            onChange={(e) => e.value !== null && handleCustomMixToggle(e.value)}
            options={CLOSURES_OPTIONS}
            allowEmpty={false}
          />
        </div>
      </div>

      {isCustomMix && (
        <div className="flex flex-col gap-1">
          <label className="text-sm font-bold text-slate-800">Aircraft Weight-Class Mix</label>
          <WeightClassMixSlider value={mixValue} onChange={handleMixChange} />
          <small className="text-slate-500">
            Drag either divider to trade share between the two aircraft classes it separates.
          </small>
          {errors.heavyPercentage && (
            <small className="text-red-600">{errors.heavyPercentage.message}</small>
          )}
        </div>
      )}

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

      <div className="flex justify-end">
        <Button
          type="button"
          label="Save as Template"
          icon="pi pi-save"
          text
          onClick={openSaveTemplate}
        />
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

      <Dialog
        header="Save as Template"
        visible={saveTemplateVisible}
        onHide={() => {
          if (!savingTemplate) {
            setSaveTemplateVisible(false);
          }
        }}
        draggable={false}
        dismissableMask={!savingTemplate}
        style={{ width: '28rem', maxWidth: '90vw' }}
        footer={
          <div className="flex justify-end gap-2">
            <Button
              label="Cancel"
              text
              disabled={savingTemplate}
              onClick={() => setSaveTemplateVisible(false)}
            />
            <Button
              label="Save"
              loading={savingTemplate}
              disabled={templateNameInput.trim() === '' || !!templateNameError}
              onClick={confirmSaveTemplate}
              className="!border-brand-accent-active !bg-brand-accent-active !text-white"
            />
          </div>
        }
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="template-name" className="text-sm font-bold text-slate-800">
            Template Name
          </label>
          <InputText
            id="template-name"
            value={templateNameInput}
            maxLength={SIMULATION_NAME_MAX}
            autoFocus
            onChange={(e) => setTemplateNameInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                confirmSaveTemplate();
              }
            }}
            className={`bg-brand-bg ${templateNameError && templateNameInput ? 'p-invalid' : ''}`}
          />
          <small className="text-slate-500">
            Saves the current form (everything except the name above) so it can be picked from
            &quot;From Template&quot; next time.
          </small>
          {templateNameInput.length > 0 && templateNameError && (
            <small className="text-red-600">{templateNameError}</small>
          )}
          {user?.isStaff && (
            <div className="mt-2 flex items-center gap-2">
              <Checkbox
                inputId="template-global"
                checked={saveTemplateGlobal}
                onChange={(e) => setSaveTemplateGlobal(e.checked ?? false)}
              />
              <label htmlFor="template-global" className="text-sm text-slate-700">
                Make this template available to everyone
              </label>
            </div>
          )}
          {saveTemplateError && (
            <Message
              severity="error"
              text={
                (saveTemplateError.body?.detail as string | undefined) ??
                'Failed to save template. Please try again.'
              }
              className="mt-2 w-full"
            />
          )}
        </div>
      </Dialog>
    </form>
  );
}
