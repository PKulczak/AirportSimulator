# Implementation History

A running log of changes made while working through [nextSteps.md](nextSteps.md). Newest
entries go at the **top**. One entry per shipped slice (or per meaningful standalone
change). Keep entries factual and specific — what changed, where, and how it was verified.

## Entry format

```
## YYYY-MM-DD — <Slice ref or short title>

**Slice:** <e.g. 1.1 — Poll the history list> (or "n/a" for ad-hoc work)
**Status:** Done | In progress | Reverted

**Changes**
- <file/path> — <what changed and why>

**Verification**
- <how it was tested: pytest command + result, manual steps, etc.>

**Notes**
- <follow-ups, caveats, deviations from the plan, or "none">
```

---

<!-- Add new entries below this line, newest first. -->

## 2026-07-30 — Fix: mix slider intermittently showed a spurious "must sum to 100" error

**Slice:** n/a (user-reported bug in the just-shipped weight-class-mix slider redesign)
**Status:** Done

**Symptom (reported):** dragging the new `WeightClassMixSlider` (or toggling "Customize
Aircraft Weight-Class Mix?" on) sometimes showed the "must sum to 100" validation error, even
though the slider's own construction guarantees the three values always sum to exactly 100.

**Root cause:** `handleMixChange`/`handleCustomMixToggle` called `setValue` three times in a
row — once per field — each with `{ shouldValidate: true }`. `setValue`'s value mutation is
synchronous, but so is (the start of) the Zod-resolver validation it triggers: the first call
(`setValue('heavyPercentage', ...)`) ran the whole-schema resolver against the form as it
stood *at that instant* — the new heavy percentage alongside the still-old medium/light — an
intermediate combination that generally doesn't sum to 100, briefly failing validation. The
second and third calls then corrected it, but depending on exactly how React Hook Form
resolved/re-rendered those three back-to-back validations, the stale failure could win and
stick, especially under a fast drag firing many `pointermove`-driven calls per second.

**Fix**
- [frontend/src/components/RequestForm.tsx](frontend/src/components/RequestForm.tsx) — both
  handlers now omit `shouldValidate` from the first two `setValue` calls and only pass it on
  the third, so the resolver runs exactly once, after all three fields already hold their new,
  consistent (summing-to-100) values — there's no longer an intermediate state to validate
  against at all.

**Verification**
- `npx tsc -b --noEmit`, `npm run build`, `npm run lint`, and `npm run test` (46, unrelated)
  all clean. Dev server's `tsc --watch` settled at 0 errors after the edit.
- **Not visually verified in a browser** (no browser-automation tool available in this
  environment) — reasoned through the fix rather than confirmed by dragging it; the previous
  entry's same limitation still applies to this component overall.

**Notes**
- General lesson for this codebase: whenever a single logical change touches more than one
  `react-hook-form` field via multiple `setValue` calls, only the *last* call should carry
  `shouldValidate: true` if the fields are cross-validated together (as `heavyPercentage`/
  `mediumPercentage`/`lightPercentage` are) — validating after every individual call exposes
  every intermediate, partially-applied state to the resolver.

## 2026-07-30 — Redesign: Heavy/Medium/Light mix as a draggable stacked bar

**Slice:** n/a (user-requested UX redesign of Slice 7.1's weight-class-mix input)
**Status:** Done (code clean, not visually verified in a browser — see Verification)

**Request:** replace the three separate Heavy/Medium/Light percentage number inputs in the
create form with a single bar with two draggable dividers (a stacked-proportion slider).

**Frontend**
- [frontend/src/components/WeightClassMixSlider.tsx](frontend/src/components/WeightClassMixSlider.tsx)
  (new) — a self-contained, presentation-only component: a horizontal bar with three colored
  segments (Heavy/Medium/Light, darkest-to-lightest) sized by percentage width, and two
  draggable dividers between them. Dragging the Heavy/Medium divider trades share between
  just those two (Light untouched); dragging the Medium/Light divider trades between those
  two (Heavy untouched) — each divider clamps against the other so they can never cross,
  which is also what keeps the three values always summing to exactly 100 by construction
  (no renormalization step needed). Built on the Pointer Events API (covers mouse/touch/pen
  uniformly) with `setPointerCapture` so a fast drag keeps tracking the divider even if the
  pointer strays off its small hit area; window-level `pointermove`/`pointerup` listeners are
  attached once (via a ref holding the latest value/onChange) rather than re-attached on every
  pixel of movement. Each divider is also a keyboard-operable `role="slider"` (arrow keys nudge
  by 1%) with proper `aria-value*` attributes.
- [frontend/src/schemas/simulationForm.ts](frontend/src/schemas/simulationForm.ts) — added
  `DEFAULT_WEIGHT_CLASS_MIX` (`{heavy: 10, medium: 75, light: 15}`, mirroring the backend's
  `constants.DEFAULT_WEIGHT_CLASS_MIX_PERCENTAGES`), the starting position shown when a user
  turns customization on from blank.
- [frontend/src/components/RequestForm.tsx](frontend/src/components/RequestForm.tsx) — the
  three `heavyPercentage`/`mediumPercentage`/`lightPercentage` `InputNumber`s are gone;
  replaced with a "Customize Aircraft Weight-Class Mix?" Yes/No toggle (reusing the existing
  closures-style `SelectButton`) next to the Weather dropdown, and — only when toggled on —
  the new slider below it. Toggling on writes `DEFAULT_WEIGHT_CLASS_MIX` into all three form
  fields (so what's shown always matches what's actually about to be submitted, rather than
  displaying a default the form doesn't yet hold); toggling off nulls all three, identical to
  the prior "leave blank" behaviour. No schema/validation changes — `simulationFormSchema`'s
  all-or-nothing-summing-to-100 rule is unchanged and unreachable from this UI by construction
  (the slider only ever produces three already-summing-to-100 integers), so the existing
  validation-error rendering (`errors.heavyPercentage`) is kept as a defensive fallback rather
  than removed.

**Verification**
- `npx tsc -b --noEmit`, `npm run build`, `npm run lint`, and `npm run test` (46, unrelated —
  no schema/type change, so no new tests were added or needed; the existing weight-class-mix
  schema/conversion tests from Slice 7.1 still cover the underlying data shape this component
  now edits) all clean.
- **Not visually verified in a browser** (no browser-automation tool available in this
  environment) — reasoned through the drag/clamp math by hand (both dividers clamp against
  each other so they can never cross; each drag recomputes the third value from the other two
  rather than adjusting deltas, so rounding drift can't accumulate) rather than confirmed by
  actually dragging it. The dev server's `tsc --watch` output was checked after every edit
  (including the final pointer-capture addition) and settled at 0 errors, but that only proves
  the code compiles, not that the drag interaction feels right on screen.

**Notes**
- Deliberately scoped to `RequestForm.tsx` only, matching where the three inputs being
  replaced actually lived — `SweepForm.tsx` still has no weight-class-mix UI at all (a
  pre-existing scope cut from Slice 7.1, unrelated to and unchanged by this request).

## 2026-07-30 — Fix: sweep form had no way to set the weather condition

**Slice:** n/a (user-requested follow-up closing a scope cut noted in the Slice 7.2 entry
below)
**Status:** Done

**Request:** the create form (`RequestForm.tsx`) already had a Weather dropdown from Slice
7.2, but the sweep form (`SweepForm.tsx`) didn't — the sweep DTO/schema already accepted and
validated `weatherCondition`, but there was no UI input to actually set it, a scope cut
explicitly called out in the Slice 7.2 entry's Notes.

**Frontend**
- [frontend/src/components/SweepForm.tsx](frontend/src/components/SweepForm.tsx) — added a
  Weather `Dropdown` (reusing `WEATHER_CONDITION_OPTIONS`, same as `RequestForm.tsx`) to the
  top row, next to Random Seed — widened that row's grid template from
  `[2fr_1fr_1fr]` (Name/Closures/Seed) to `[2fr_1fr_1fr_1fr]` to fit it, with a hint that it
  applies to every run in the sweep (matching the existing Random Seed hint's phrasing for
  "applies to every run").

**Verification**
- `npx tsc -b --noEmit`, `npm run build`, `npm run lint`, and `npm run test` (46, unrelated —
  `sweepFormSchema`'s `weatherCondition` handling was already covered by Slice 7.2's tests;
  this change only adds a UI input for a field the schema already validated) all clean.
- Frontend dev server picked up the change live via Vite/tsc watch (confirmed 0 compile
  errors after the edit); not visually verified in a browser (no browser-automation tool
  available in this environment).

**Notes**
- No backend change needed — the sweep endpoint already accepted and applied
  `weatherCondition` to every generated run (Slice 7.2).

## 2026-07-30 — Slice 7.2 — Weather as a scenario parameter

**Slice:** 7.2 — Weather as a scenario parameter (Epic 7, Engine fidelity)
**Status:** Done (code + tests + live-verified against the real dev DB/queue)

**Engine**
- [backend/api/models/simulation.py](backend/api/models/simulation.py) — new
  `Simulation.WeatherCondition` (Clear (VMC) / Windy / Snow / Low Visibility (IMC)) and a
  `weather_condition` field, defaulting to Clear — the neutral baseline (1.0x everywhere),
  matching engine behaviour exactly as it was before this field existed.
  [backend/api/migrations/0011_simulation_weather_condition.py](backend/api/migrations/0011_simulation_weather_condition.py)
  (new, applied to the dev DB).
- [backend/api/simulation/constants.py](backend/api/simulation/constants.py) — added
  `WEATHER_OPERATION_MULTIPLIER` (scales base runway-occupancy time),
  `WEATHER_SEPARATION_MULTIPLIER` (scales each `WAKE_SEPARATION_EXTRA_MINUTES` value from
  Slice 7.1), `WEATHER_CLOSURE_INTERVAL_MULTIPLIER` (scales `CLOSURE_MEAN_INTERVAL_MINUTES`
  — below 1.0 means more frequent closures), and `WEATHER_CLOSURE_REASON_WEIGHTS` (per-
  weather `rng.choice` weights over the existing SnowClearance/RunwayInspection/
  EquipmentFailure reasons — the slice's explicit "ties into existing ... reasons" ask: Snow
  weather is heavily weighted toward SnowClearance, LowVisibility toward RunwayInspection,
  Clear/Windy never produce a snow closure at all). None of these are aviation-accurate
  distance/visibility models — flat multipliers, consistent with how every other constant in
  this file already abstracts real-world rules into simple figures.
- [backend/api/simulation/simulation_runner.py](backend/api/simulation/simulation_runner.py)
  — `_operation_minutes(aircraft_speed_knots, weather_condition=Clear)` and
  `_wake_separation_extra_minutes(wrapper, trailing_class, now, weather_condition=Clear)`
  both gained a `weather_condition` parameter (defaulted to Clear so Slice 7.1's existing
  direct unit-test call sites — which don't pass one — keep testing the same 1.0x-multiplier
  baseline unchanged) that scales their respective outputs by the constants above; both real
  call sites in `_execute`/`_aircraft_process_body` now pass `simulation.weather_condition`.
- [backend/api/simulation/closures.py](backend/api/simulation/closures.py) —
  `closure_process` gained the same defaulted `weather_condition` parameter (keeping the
  three existing direct-call tests in `closures_test.py` valid unchanged): the mean interval
  between closures is scaled by `WEATHER_CLOSURE_INTERVAL_MULTIPLIER`, and which reason gets
  picked now uses `rng.choice` weighted by `WEATHER_CLOSURE_REASON_WEIGHTS` instead of a flat
  uniform pick — falls back to uniform weighting for an unrecognized condition value.

**API / config**
- [backend/api/serializers/simulation_creation_dto.py](backend/api/serializers/simulation_creation_dto.py),
  [simulation_config_dto.py](backend/api/serializers/simulation_config_dto.py),
  [simulation_detail_dto.py](backend/api/serializers/simulation_detail_dto.py) — added
  `weather_condition` to each DTO's field list; the creation DTO needed no explicit field
  override (unlike `random_seed`'s bounds) since `ModelSerializer` auto-derives
  `required=False`/the Clear default straight from the model field, the same way
  `include_closures` already works. Config/detail exposure means Duplicate (Slice 2.3) and
  re-run-with-same-seed (Slice 3.2) both reproduce the same weather, not silently reverting
  to Clear.
- [backend/api/serializers/simulation_sweep_creation_dto.py](backend/api/serializers/simulation_sweep_creation_dto.py)
  — explicit `ChoiceField` (sweep DTOs are plain `Serializer`s, not `ModelSerializer`s, so
  there's no model default to inherit from) passed through to every generated run.

**Frontend**
- [frontend/src/types/simulation.ts](frontend/src/types/simulation.ts) — new
  `WeatherCondition` type; `weatherCondition` on `SimulationConfig` (always present) and
  `CreateSimulationRequest` (optional — omit for the server's Clear default).
  [types/metrics.ts](frontend/src/types/metrics.ts) — same field on `SimulationDetail`.
- [frontend/src/schemas/simulationForm.ts](frontend/src/schemas/simulationForm.ts) — new
  `weatherConditionSchema`/`WEATHER_CONDITION_OPTIONS`; `weatherCondition` added to the
  shared base schema (defaulting to `'Clear'`, always present — unlike the seed/weight-mix
  fields, weather has no "unset" state to model as null); `toCreateSimulationRequest`/
  `detailToRerunRequest`/`configToFormValues` all carry it straight through unconditionally.
- [frontend/src/components/RequestForm.tsx](frontend/src/components/RequestForm.tsx) — a
  required "Weather" `Dropdown` added to the same row as the Slice 7.1 weight-class-mix
  inputs (now a 4-column row: Weather, Heavy%, Medium%, Light%).
- [frontend/src/components/MetricsSimVariables.tsx](frontend/src/components/MetricsSimVariables.tsx)
  — a "Weather" row (using `WEATHER_CONDITION_OPTIONS` for the human-readable label) added
  to the existing Sim Variables read-only panel, next to Closures Included/Random Seed.
  **Not added to the replay** — the slice's own wording ("ENG/BE/FE: A weather setting...")
  doesn't ask for a visualisation-page display the way Slice 7.1 explicitly asked to "show
  class in the replay"; showing it once in Sim Variables (already the established spot for
  every other whole-run config value) was judged sufficient.
- **`SweepForm.tsx` UI left untouched** — same deliberate scope cut as Slice 7.1's weight-
  class mix: the sweep DTO/schema fully validate and pass a fixed `weatherCondition` through
  today, just with no UI input for it yet. *(Closed the same day — see the "sweep form had
  no way to set the weather condition" entry above.)*

**Verification**
- New [backend/tests/simulation/weather_test.py](backend/tests/simulation/weather_test.py)
  (11 tests): `_operation_minutes` strictly increases Clear < Windy < Snow < LowVisibility
  and defaults to Clear when unspecified; `_wake_separation_extra_minutes` scales by the
  weather multiplier and defaults to Clear; an isolated `closure_process` (same seed, only
  weather differs) produces more closures under Snow than Clear; Snow's closures are
  overwhelmingly ($>50\%$) SnowClearance while Clear never produces one; a full
  `SimulationRunner().run()` comparison (same seed/config, `include_closures=False` so the
  *only* weather-affected channel is operation/separation time — with closures off, every
  rng draw the two runs make is otherwise identical, isolating the comparison cleanly) shows
  strictly fewer successes under LowVisibility than Clear — the slice's own literal test.
  Needed a second fix mid-writing: the two comparison runs in one test function each called
  `helper.create_runways(1)` independently, colliding on the same default `"RW0"` identifier
  within the shared test DB — fixed by giving each call an explicit unique identifier.
- [backend/tests/feature/simulation_creation_test.py](backend/tests/feature/simulation_creation_test.py)
  (+3), [simulation_config_test.py](backend/tests/feature/simulation_config_test.py) (+1),
  [simulation_sweep_test.py](backend/tests/feature/simulation_sweep_test.py) (+1) — accepts/
  persists a weather condition; defaults to Clear when omitted; rejects an unrecognized
  value; config exposes a custom condition; sweep applies the same condition to every
  generated run. **Full backend suite: 220 passed** (+14 net new, 220 vs the 206 Slice 7.1
  left off at).
- [frontend/src/schemas/simulationForm.test.ts](frontend/src/schemas/simulationForm.test.ts)
  (+8): schema accepts every valid weather value and rejects an unknown one;
  `toCreateSimulationRequest`/`detailToRerunRequest`/`configToFormValues` all carry the
  condition through. `npm run test`: **46 passed** (+8). `npx tsc -b --noEmit`, `npm run
  build`, and `npm run lint` all clean.
- Live end-to-end against the real dev DB/queue: created two otherwise-identical runs (same
  seed 123, same 1-runway/60-arrival/60-departure/60-min/8-min-max-wait config,
  `includeClosures: false`) differing only in weather — Clear (sim 179) completed **13**
  successes out of 120 aircraft; LowVisibility (sim 180) completed only **8** — confirming
  "worse weather lowers throughput" on a real run through the actual dramatiq worker, not
  just in an isolated test. Separately, two closures-enabled runs (same seed 7, same 2-
  runway/240-min config) differing only in weather: Clear (sim 182) produced 12 closures
  split 7 Runway-inspection/5 Equipment-failure with **zero** Snow-clearance; Snow (sim 181)
  produced **17** closures (more frequent, as expected from the shorter mean interval), 10 of
  them (~59%) Snow clearance — confirming both "raises closures" and "ties into existing
  ... reasons" live. All four verification sims deleted by explicit id afterward.

**Operational notes**
- Restarted `runserver`/`rundramatiq`/`npm run dev` for this slice's engine + migration
  changes. Checked for strays before restarting per CLAUDE.md and found a single clean tree
  of each (no repeat of the Slice 7.1 session's stray-process incident). Used `TaskStop` on
  the three tracked background tasks rather than a manual `taskkill` — but this **did not
  fully tear down the frontend's process tree**: `TaskStop` reported success, yet the actual
  `concurrently`/`vite`/`tsc --watch` processes were still alive and holding port 3000
  afterward (confirmed via the same process-list check), an incident CLAUDE.md doesn't yet
  document — stopping a tracked background task is not by itself sufficient proof its
  process tree is gone; re-checked the process list after every stop/restart rather than
  trusting the stop confirmation, found the survivors, and `taskkill //F //T`'d them
  directly before starting the fresh instance. Confirmed a single clean tree of
  `runserver`/`rundramatiq`/the frontend chain and zero Redis-broker connections before
  starting exactly one fresh instance of each.

**Notes**
- `WEATHER_OPERATION_MULTIPLIER`/`WEATHER_SEPARATION_MULTIPLIER`/
  `WEATHER_CLOSURE_INTERVAL_MULTIPLIER`/`WEATHER_CLOSURE_REASON_WEIGHTS` are illustrative
  flat figures, not sourced from real aviation performance data — same caveat already
  recorded for Slice 7.1's wake-separation matrix and default weight-class mix.
  `weather_condition` is not itself a sweepable variable (`SWEEPABLE_VARIABLES` is unchanged)
  — it's a fixed baseline for a sweep, same treatment as `include_closures`/`random_seed`.
- Visibility/wind aren't modelled as continuous quantities (e.g. an actual METAR-style visual
  range or wind speed) — four discrete named conditions, matching the slice's own "e.g.
  VMC/IMC, wind, snow" phrasing rather than a finer-grained numeric model.

## 2026-07-30 — Slice 7.1 — Aircraft weight classes + wake separation

**Slice:** 7.1 — Aircraft weight classes + wake separation (Epic 7, Engine fidelity)
**Status:** Done (code + tests + live-verified against the real dev DB/queue)

**Engine**
- [backend/api/models/aircraft.py](backend/api/models/aircraft.py) — new `Aircraft.WeightClass`
  (Heavy/Medium/Light) and a `weight_class` field, defaulting to Medium.
- [backend/api/models/simulation.py](backend/api/models/simulation.py) — three optional,
  nullable `heavy_percentage`/`medium_percentage`/`light_percentage` fields; all null (the
  default) means "use the engine's default mix."
  [backend/api/migrations/0010_aircraft_weight_class_and_simulation_weight_mix.py](backend/api/migrations/0010_aircraft_weight_class_and_simulation_weight_mix.py)
  (new, applied to the dev DB).
- [backend/api/simulation/constants.py](backend/api/simulation/constants.py) — added
  `DEFAULT_WEIGHT_CLASS_MIX_PERCENTAGES` (Heavy 10 / Medium 75 / Light 15, a typical
  scheduled-service mix) and `WAKE_SEPARATION_EXTRA_MINUTES`, a `(leading class, trailing
  class) -> extra minutes` matrix approximating ICAO wake-turbulence separation minima as a
  flat extra buffer in this engine's minutes-based model (Heavy leading a Light needs the
  most; Light leaders need none, matching real wake-vortex behaviour).
- [backend/api/simulation/aircraft_data_generator.py](backend/api/simulation/aircraft_data_generator.py)
  — resolves the mix once per generator instance (the simulation's own three percentages if
  all are set, else the default), then draws each generated aircraft's `weight_class` via
  `rng.choice(classes, p=probabilities)` — deterministic under the existing `random_seed`.
- [backend/api/simulation/simulation_runway_wrapper.py](backend/api/simulation/simulation_runway_wrapper.py)
  — wrapper now tracks `last_operation_class`/`last_operation_end_time` (both `None` until
  the runway's first operation), the state the separation calculation reads.
- [backend/api/simulation/simulation_runner.py](backend/api/simulation/simulation_runner.py)
  — new `_wake_separation_extra_minutes(wrapper, trailing_class, now)`: 0 if there's no
  leading operation yet, else `max(0, required_gap - elapsed_since_last)` — so a runway that
  sat idle for a while before the next aircraft arrived only owes whatever separation time
  hasn't already elapsed, not the full amount every time. The winning aircraft's runway hold
  is now `operation_minutes + that extra`, instead of always a flat `operation_minutes`
  (the slice's literal ask: "enforce separation minima between successive operations instead
  of a flat `REFERENCE_OPERATION_MINUTES`"); `last_operation_class`/`last_operation_end_time`
  are updated in the same `finally` block that releases the resource, before any queued
  request for that runway can be granted — this ordering is what makes the calculation see
  the correct leading class/time even though SimPy resolves the next grant on a later event-
  loop step, not synchronously inside the release call.

**API / config**
- [backend/api/serializers/simulation_creation_dto.py](backend/api/serializers/simulation_creation_dto.py)
  — the three percentages are optional inputs; `validate()` enforces all-or-nothing (all
  three or none) and that they sum to exactly 100 when given.
- [backend/api/serializers/simulation_config_dto.py](backend/api/serializers/simulation_config_dto.py),
  [simulation_detail_dto.py](backend/api/serializers/simulation_detail_dto.py) — expose the
  three fields too, so Duplicate (Slice 2.3) and re-run-with-same-seed (Slice 3.2) both
  reproduce the same mix, not silently reverting to the default.
- [backend/api/serializers/simulation_sweep_creation_dto.py](backend/api/serializers/simulation_sweep_creation_dto.py)
  — accepts the same three optional fields and passes them through to every generated run's
  own `SimulationCreationDto` re-validation (same mechanism `random_seed` already uses), so
  a sweep can fix one mix across every step.
- [backend/api/serializers/aircraft_visualisation_dto.py](backend/api/serializers/aircraft_visualisation_dto.py)
  — added `weight_class` so the replay can show it.

**Frontend**
- [frontend/src/types/visualisation.ts](frontend/src/types/visualisation.ts),
  [types/simulation.ts](frontend/src/types/simulation.ts),
  [types/metrics.ts](frontend/src/types/metrics.ts) — new `WeightClass` type; `weightClass`
  on the aircraft wire/normalized types; `heavyPercentage`/`mediumPercentage`/`lightPercentage`
  on `SimulationConfig`, `CreateSimulationRequest`, and `SimulationDetail`.
- [frontend/src/functions/visualisationHelpers.ts](frontend/src/functions/visualisationHelpers.ts)
  — `normalizeVisualisation()` carries `weightClass` through.
- [frontend/src/schemas/simulationForm.ts](frontend/src/schemas/simulationForm.ts) — three
  new nullable form fields plus a shared `weightClassMixIssue()` cross-field check (all
  blank, or all three set summing to 100 — mirrors the backend DTO exactly), applied to both
  `simulationFormSchema` and `sweepFormSchema`; `toCreateSimulationRequest`/
  `detailToRerunRequest`/`configToFormValues` updated to carry the mix through the
  create/duplicate/re-run round trip the same way `randomSeed` already does (omit entirely
  when null, since the three are all-or-nothing).
- [frontend/src/components/RequestForm.tsx](frontend/src/components/RequestForm.tsx) — three
  optional "Heavy/Medium/Light Aircraft %" `InputNumber` fields (percent suffix, "Default
  mix" placeholder) in the create form, with a hint explaining the all-or-nothing rule.
  **Not added to `SweepForm.tsx`** — the sweep DTO/schema already accept and validate the
  mix (so an API-level sweep with a fixed mix works today), but no UI inputs were added
  there; a deliberate scope cut, not a gap in validation.
- [frontend/src/functions/replayTheme.ts](frontend/src/functions/replayTheme.ts) — new
  `WEIGHT_CLASS_STYLE`/`WEIGHT_CLASS_LEGEND` (single-letter H/M/L abbreviations, mirroring
  the existing mode/emergency style maps).
- [frontend/src/components/Runway.tsx](frontend/src/components/Runway.tsx),
  [components/QueueTable.tsx](frontend/src/components/QueueTable.tsx) — the weight-class
  abbreviation now renders next to a callsign everywhere an aircraft appears in the replay
  (runway occupancy, holding/takeoff queues), with the full label as a tooltip.
- [frontend/src/components/SimulationVisualisation.tsx](frontend/src/components/SimulationVisualisation.tsx)
  — passes `weightClass` into `Runway`'s occupancy prop; the previously-empty third legend
  slot (over the departures queue) now shows the H/M/L legend.

**Verification**
- New [backend/tests/simulation/wake_separation_test.py](backend/tests/simulation/wake_separation_test.py)
  (11 tests): pure unit tests of `_wake_separation_extra_minutes` (no leading operation ->
  0; full matrix value when nothing has elapsed; 0 for a same-class pair; partial credit
  when the runway already sat idle for part of the required gap; 0 once enough idle time has
  passed); a fresh `SimulationRunwayWrapper` starts with no recorded operation; two full-
  engine tests (via `SimulationRunner().run()`, monkeypatching `AircraftDataGenerator.generate`
  to return two fixed-class Departures — departures never roll for emergencies, keeping the
  scenario deterministic) proving a Light immediately behind a Heavy takes exactly
  `base + WAKE_SEPARATION_EXTRA_MINUTES[("Heavy","Light")]` to clear the runway, while the
  Heavy's own (nothing-preceding-it) operation is exactly the base time, and a same-class
  (Medium/Medium) pair needs no extra separation at all.
- [backend/tests/simulation/aircraft_data_generator_test.py](backend/tests/simulation/aircraft_data_generator_test.py)
  (+4): every generated aircraft has a valid weight class; the default mix's realized
  proportions land within 3 points of `DEFAULT_WEIGHT_CLASS_MIX_PERCENTAGES` over 500+
  samples; a 100% Heavy override produces only Heavy aircraft; a mix with a 0% share for one
  class produces none of it.
- [backend/tests/feature/simulation_creation_test.py](backend/tests/feature/simulation_creation_test.py)
  (+5), [simulation_config_test.py](backend/tests/feature/simulation_config_test.py) (+1),
  [simulation_sweep_test.py](backend/tests/feature/simulation_sweep_test.py) (+2),
  [simulation_visualisation_test.py](backend/tests/feature/simulation_visualisation_test.py)
  (updated) — accepts/persists a custom mix; defaults to null when omitted; rejects a
  partial mix and one that doesn't sum to 100; accepts a legitimate 0% share; config/sweep
  round-trip the mix; visualisation response includes `weightClass`.
  **Full backend suite: 206 passed** (+29 net new).
- [frontend/src/schemas/simulationForm.test.ts](frontend/src/schemas/simulationForm.test.ts)
  (+9): schema accepts all-blank or all-set-summing-to-100, rejects a partial mix and one
  not summing to 100; `toCreateSimulationRequest`/`detailToRerunRequest`/`configToFormValues`
  omit/include/carry the mix correctly. `npm run test`: **38 passed** (+9). `npx tsc -b
  --noEmit`, `npm run build`, and `npm run lint` all clean.
- Live end-to-end against the real dev DB/queue: created a real run (sim 176) forcing a
  100%-Heavy mix — every generated aircraft came back `weightClass: "Heavy"`, and four
  consecutive Heavy successes occupied the runway back-to-back with zero gap (6-minute
  operations, no separation needed Heavy-behind-Heavy). Created a second run (sim 177) on
  the default mix — the live visualisation data showed a Medium immediately behind a Heavy
  occupying the runway for 7.50 minutes (base 6.0 + the Heavy→Medium matrix value of 1.5)
  and a Light immediately behind a Medium occupying it for 7.00 minutes (base 6.0 + the
  Medium→Light matrix value of 1.0), while every same-or-lighter-leading pair stayed at the
  base 6.00/7.00 minutes with a 0.0-minute gap since the prior completion — the exact
  behaviour the engine change is meant to produce, observed on a real run through the actual
  dramatiq worker, not just in an isolated test. Both verification sims deleted by explicit
  id afterward.

**Operational notes**
- Before touching any process, found (and this time via the process list, not a guess) a
  genuine stray-process situation left over from a prior session: **two separate
  `runserver` process trees alive at once** (one rooted under a `manage.py runserver`
  process whose *own child* had, in turn, spawned a second independent `manage.py runserver`
  pair — not a normal autoreload relationship), plus the `rundramatiq` worker's two
  `multiprocessing.spawn_main` children showing up with live Redis-broker connections but a
  command line containing no mention of "dramatiq" at all — exactly the invisible-orphan
  failure mode CLAUDE.md documents. Killed every matching process tree (`taskkill //F //T`)
  for `runserver`/`rundramatiq`/the frontend `concurrently`/`vite`/`tsc --watch` chain,
  confirmed both the process list and the Redis-connection list were empty, then started
  exactly one fresh `runserver`, one fresh `rundramatiq`, and one fresh `npm run dev` and
  confirmed each came up cleanly before running any live verification against them.

**Notes**
- `WAKE_SEPARATION_EXTRA_MINUTES` values (1.5 min Heavy→Medium, 3.0 min Heavy→Light, 1.0 min
  Medium→Light, 0 otherwise) are a deliberate flat-minutes approximation of real-world
  ICAO wake-turbulence distance-based separation minima, not a literal nm-to-minutes
  conversion — consistent with how every other timing constant in this engine already
  abstracts real-world aviation rules into simple sim-minutes figures.
  `DEFAULT_WEIGHT_CLASS_MIX_PERCENTAGES` (10/75/15) is similarly a reasonable illustrative
  default, not sourced from a specific real airport's actual traffic mix.
  `WAKE_SEPARATION_EXTRA_MINUTES` is not itself exposed as configurable — only the
  Heavy/Medium/Light traffic *mix* is (matching the slice's literal "BE/FE: Optional class
  mix in config" wording); promoting the separation matrix to config too would be a natural
  extension of Slice 7.4 (exposing engine rates/intervals as config) rather than this slice.
- The sweep form's UI (`SweepForm.tsx`) doesn't expose the three percentage inputs even
  though the sweep DTO/schema fully support them — a scope cut given this slice's explicit
  ask was the main create config, not the sweep form specifically; the fields still validate
  correctly if driven directly against the API.
- CSV export (Slice 6.1) was deliberately left untouched — that slice's own scope is
  explicitly the 6 named columns (callsign/movement/outcome/wait/fuel/runway), and adding a
  7th wasn't asked for here.

## 2026-07-30 — Feature: always-persisted seed + always-available re-run

**Slice:** n/a (user-requested follow-up to Slice 3.1/3.2's seed feature)
**Status:** Done (code + tests + live-verified against the real dev DB/queue)

**Request:** an unseeded run's detail page should still show *the* seed that was actually
used (not "Random" with nothing to show), and "re-run with the same seed" should always
be available rather than only appearing when a seed happened to be user-supplied. Also
drop the "Re-run" text label — icon + tooltip only, matching the download/print buttons.

**Root cause of the gap:** `SimulationRunner._execute` seeded the engine's RNG with
`simulation.random_seed` directly — when a user left the seed field blank, that column
was (and stayed) `NULL`, and `np.random.default_rng(None)` seeds itself from OS entropy
without ever exposing what it picked. So an unseeded run's actual seed was never
knowable or reproducible after the fact, and the frontend correctly hid the re-run
button in exactly that case (there was nothing to re-run *with*).

**Backend**
- [backend/api/simulation/simulation_runner.py](backend/api/simulation/simulation_runner.py)
  — `run()` now generates a concrete seed (`random.randint(0, 2147483647)`, matching
  `SimulationCreationDto`'s existing bounds — the signed-32-bit range the column can
  store) whenever `simulation.random_seed is None`, in the same save as the
  Running-transition bookkeeping (`status`/`started_at`/`last_heartbeat_at`), before
  `_execute` ever constructs the RNG. Every run — seeded or not — now has a concrete,
  persisted `random_seed` by the time it's `Running`.

**Frontend**
- [frontend/src/components/MetricBasePage.tsx](frontend/src/components/MetricBasePage.tsx)
  — removed the `data.randomSeed != null &&` guard around the re-run button (it's now
  unconditionally rendered — every *new* completed run has a seed, per the backend fix
  above); removed its `label="Re-run"` text, leaving just the `pi-replay` icon +
  `tooltip` (matching the download/print buttons' icon-only style added earlier); the
  tooltip/aria-label still degrade gracefully (no seed number quoted) for a pre-existing
  legacy run created before this fix shipped, whose `randomSeed` can still be `null`.
  `detailToRerunRequest`/`rerunWithSameSeed` already handled a `null` seed gracefully
  (omits it from the request, same as before) — no changes needed there.
- No change needed in `MetricsSimVariables.tsx`'s "Random Seed" display — it already
  showed the real value whenever one was present and fell back to "Random" otherwise;
  it'll just show a real number for every new run now, automatically.

**Verification**
- [backend/tests/simulation/seed_reproducibility_test.py](backend/tests/simulation/seed_reproducibility_test.py)
  — 2 new tests: an unseeded run ends up with a concrete, persisted, in-bounds
  `random_seed`; two separately-unseeded runs get different auto-generated seeds (not a
  static fallback).
- [backend/tests/feature/simulation_rerun_test.py](backend/tests/feature/simulation_rerun_test.py)
  — replaced `test_rerun_without_seed_defaults_to_random` (asserted the *old*,
  now-intentionally-changed behaviour — a `null` seed round-tripping as `null`) with
  `test_unseeded_run_still_gets_a_concrete_persisted_seed` and
  `test_rerun_of_an_originally_unseeded_run_still_reproduces_identical_metrics` (proves
  the full loop: create with no seed → re-run using the auto-generated seed from its
  detail response → identical `outcomeCounts`/`successRate`). **Full suite: 186 passed**
  (net +2: 2 new engine tests, 1 old test replaced by 2 new ones).
- Frontend `tsc -b --noEmit`, `npm run lint`, and `npm run test` (29, unrelated) all clean.
- Live end-to-end against the real dev DB/queue: created a real run with no `randomSeed`
  in the payload, let the live dramatiq worker complete it, and confirmed
  `GET /api/simulations/172/detail/` returned a concrete `randomSeed` (`1599374532`) —
  not `null`. Verification sim deleted by explicit id afterward.
- Restarted both `runserver` and `rundramatiq` (engine change) — checked for strays
  before and after per CLAUDE.md, confirmed a single clean tree of each and zero
  Redis-broker connections before restarting, then started exactly one fresh instance of
  each.
- Not visually verified in a browser (no browser-automation tool available in this
  environment) — the re-run button's new icon-only appearance and always-visible
  behaviour are unexercised in a real click-through; verified via `tsc`/`eslint` and the
  live API data above.

**Notes**
- A run created *before* this change shipped keeps whatever `random_seed` it already
  had (`null` if it was never explicitly seeded) — this only changes behaviour for runs
  started from here on; there's no backfill/migration for existing rows, matching how
  this repo has handled every other additive field so far (e.g. `last_heartbeat_at`).

## 2026-07-30 — Fix: printed summary had a stray Arrival/Departure label and a blank timeline

**Slice:** n/a (Slice 6.2 robustness fix, user-reported)
**Status:** Done

**Symptom (reported):** in the printed/PDF summary, (1) the Arrival Metrics and Departure
Metrics panels each showed a leftover "Arrival ⇄ Departure" label where the toggle switch
used to be, even though the switch itself was already hidden; (2) the timeline chart
showed nothing at all — an empty box.

**Root cause 1 — orphaned toggle labels:** the earlier fix hid the `InputSwitch` itself
(`.movement-switch { display: none }` in print) but not its two sibling `<span>` text
labels ("Arrival"/"Departure") that sit next to it in `MetricsMovementStats` — those
stayed visible, reading as a redundant, broken-looking label beside a panel that's
already titled "Arrival Metrics"/"Departure Metrics" (doubly redundant now that
`SimulationPrintSummary` shows both panels side by side instead of switching between
them).

**Root cause 2 — invisible timeline:** browsers drop element background colours by
default when printing (an ink-saving default) unless a page explicitly opts back in.
`MetricsTimeline`'s bars/lines and every panel's amber header are pure `background-color`
with no border or text of their own, so on a printed page/PDF they silently render as
blank space — nothing was actually broken in the chart's logic, the colour just never
reached the page.

**Fix**
- [frontend/src/components/MetricsMovementStats.tsx](frontend/src/components/MetricsMovementStats.tsx)
  — added a `movement-toggle` class to the wrapper `<div>` around the switch *and* its
  two labels (not just the switch), so the whole control — not half of it — disappears
  together in print.
- [frontend/src/index.css](frontend/src/index.css) — renamed/widened the print rule from
  `.movement-switch` to `.movement-toggle`; added a new global
  `@media print { * { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }`
  rule so background colours (the timeline, every panel's accent header, etc.) actually
  print instead of being silently dropped.

**Verification**
- `npx tsc -b --noEmit`, `npm run lint`, and `npm run test` (29, unrelated) all clean.
- **Not visually verified in a browser** (no browser-automation tool available in this
  environment) — reasoned from (1) which elements the original CSS selector did and
  didn't cover, and (2) the well-documented browser print default of dropping background
  colours absent `print-color-adjust: exact`. Re-triggering print and eyeballing the
  output — now the third open item stacked on this feature — is the outstanding manual
  step next time this is picked up somewhere a browser can be driven.

**Notes**
- Combined with the earlier "only one page" fix, every print-CSS issue reported so far
  traces back to the same root cause: this app was built with zero print-media
  consideration until Slice 6.2, so every default (fixed-viewport layout, ink-saving
  colour stripping, an interactive-only control) needed an explicit opt-out for print
  specifically. Worth a real once-over in an actual browser rather than continuing to
  patch one symptom at a time from reasoning alone.

## 2026-07-30 — Fix: printed summary only showed one page (cut off after Arrival)

**Slice:** n/a (Slice 6.2 robustness fix, user-reported immediately after shipping)
**Status:** Done

**Symptom (reported):** clicking "Print / Save as PDF" only produced one page, cut off
partway through — Departure metrics and the timeline never appeared.

**Root cause:** the previous fix only neutralized `<main>`'s `overflow-y-auto` (via a
global `@media print` rule targeting `html, body, #root, main` in `index.css`), but
missed the actual clipping ancestor: `MainLayout`'s outer `<div>` has `h-screen
overflow-hidden` — a hard viewport-height clip that sits *around* `<main>`, not inside
it. A browser only prints what's visible inside an `overflow: hidden` (or the current
scroll position of an `overflow: auto`) container, not its full scrollable content — so
with the outer div still clipped to one screen's height, everything below that point
(Departure metrics onward) never made it into the print output, regardless of `<main>`'s
own overflow setting.

**Fix**
- [frontend/src/components/MainLayout.tsx](frontend/src/components/MainLayout.tsx) —
  added `print:h-auto print:overflow-visible` directly to both the outer div (the actual
  culprit) and `<main>` (redundant with the removed global rule below, but now
  co-located with the styles it's overriding instead of a separate generic tag-selector
  rule elsewhere). Also added `print:p-0` on `<main>` to drop its screen-only padding.
- [frontend/src/index.css](frontend/src/index.css) — removed the now-redundant (and
  incomplete — it never covered the real culprit) `@media print { html, body, #root,
  main {...} }` block; the `.movement-switch` print-hide rule is unaffected and stays.

**Verification**
- `npx tsc -b --noEmit` and `npm run lint` clean.
- **Not visually verified in a browser** (no browser-automation tool available in this
  environment) — reasoned through the actual DOM/CSS clipping chain
  (`html/body/#root` → `MainLayout`'s outer div → `<main>` → `<Outlet />` →
  `SimulationPrintSummary`) to find the ancestor the first fix missed, rather than
  confirmed by re-triggering print and inspecting the output. This is the same
  outstanding manual step noted in the Slice 6.2 entry below — still needs an actual
  browser to confirm the multi-page print/PDF output now looks right end-to-end.

**Notes**
- General lesson for any future print-related work in this app: `MainLayout` wraps
  *every* page in a viewport-height, overflow-hidden shell by design (needed for the
  live in-browser UI's fixed-viewport pages, e.g. the replay/history "card" layouts) —
  any printable page needs both layers of that shell (the outer div *and* `<main>`)
  un-clipped when printing, not just the innermost scrolling container.

## 2026-07-30 — Slice 6.2 — PDF / printable summary

**Slice:** 6.2 — PDF / printable summary (Epic 6, Export)
**Status:** Done (code clean, not visually verified in a browser — see Verification)

**Design decision:** the slice allows either a browser print-friendly view or a
server-rendered PDF file. Asked the user, who chose the print-friendly view — no new
backend dependency/rendering pipeline, users get an actual PDF via the browser's own
"Print → Save as PDF" dialog.

**Frontend**
- [frontend/src/components/SimulationPrintSummary.tsx](frontend/src/components/SimulationPrintSummary.tsx)
  (new) — a single-column print layout at a new route, reusing the dashboard's own
  metric components directly (`MetricsSimVariables`, `MetricsRunwayInfo`,
  `MetricsGeneralStats`, `MetricsMovementStats` rendered twice — Arrival and Departure
  both shown, not toggled — and `MetricsTimeline`) rather than duplicating their
  formatting logic; only the page chrome and layout differ from `MetricBasePage`. A
  `print:hidden` toolbar (Back + "Print / Save as PDF" calling `window.print()`) never
  appears in the actual printed/PDF output. Handles the same loading/error/"not complete
  yet" states as the dashboard (a printable summary only makes sense for a `Complete` run).
- [frontend/src/App.tsx](frontend/src/App.tsx) — added the `/simulation/:id/print` route.
- [frontend/src/components/MetricBasePage.tsx](frontend/src/components/MetricBasePage.tsx)
  — a `pi-print` button in the toolbar (beside the CSV download button) navigating to the
  new route.
- [frontend/src/index.css](frontend/src/index.css) — two small `@media print` rules,
  global but with zero on-screen effect: (1) `MainLayout`'s `<main>` is normally a
  height-constrained, scrolling container (needed for the live app's fixed-viewport
  pages) — overridden to `height: auto; overflow: visible` when printing, so content
  flows and paginates across printed pages instead of being clipped to one screen's
  worth of height; (2) `.movement-switch` (the Arrival/Departure toggle inside
  `MetricsMovementStats`, reused as-is on the print page) is hidden when printing
  anywhere in the app — an interactive control is inert on paper/in a PDF, and this way
  it's not a special case only handled on the dedicated summary page.

**Verification**
- `npx tsc -b --noEmit`, `npm run build`, `npm run lint`, and `npm run test` (29,
  unrelated — no frontend test added; the slice's own test is explicitly manual) all
  clean.
- Confirmed via the live dev server (`curl` against `localhost:3000`, HTTP 200) that
  nothing broke; the frontend dev server was left running (Vite HMR), no backend changes
  in this slice.
- **Not visually verified in a browser** (no browser-automation tool available in this
  environment) — actually opening `/simulation/{id}/print`, triggering
  `window.print()`/the browser's print preview, and confirming the summary matches the
  dashboard (the slice's own manual test) is the outstanding step next time this is
  picked up somewhere a browser can be driven.

**Notes**
- `MetricsRunwayInfo`/`MetricsSimVariables`/`MetricsGeneralStats`/`MetricsMovementStats`/
  `MetricsTimeline` all turned out to be reusable as-is outside the dashboard's
  fixed-aspect-ratio card layout — none of them hard-code a parent height assumption
  beyond `flex-1`/`min-h-0` (which simply have no effect without a height-constrained
  ancestor, i.e. they degrade to natural content height), so no changes were needed to
  any of them beyond the two global print-CSS tweaks above.
- `print:break-inside-avoid` wraps each section so a browser's print pagination doesn't
  split a single metrics panel across two pages — not verified visually (see above), but
  a low-risk, purely cosmetic addition if it turns out unnecessary.

## 2026-07-30 — Slice 6.1 — CSV of the per-aircraft table

**Slice:** 6.1 — CSV of the per-aircraft table (Epic 6, Export)
**Status:** Done (code + tests + live-verified against the real dev DB/queue)

⚠️ **Naming note:** this is a *different* feature from the earlier
"2026-07-29 — Slice 6.1 — Wait-time distribution histogram" entry further down this log.
Epic 6 was renumbered (the old "Charts on the metrics dashboard" epic was removed from
`nextSteps.md`, shifting Epics 7–12 down to 6–11 — see the "move all the numbers after 6
down one" entry), so "Slice 6.1" now refers to Epic 6 = Export, not the old Epic 6 =
Charts. The histogram feature itself was reverted (no
`MetricsWaitTimeHistogram.tsx`/`waitTimeDistribution` in the working tree, and no
corresponding commit in `git log`) sometime after it was built, independently of this
renumbering — noted here only so this log's two same-numbered entries aren't read as
duplicates or a contradiction.

**Backend**
- [backend/api/serializers/aircraft_export_csv.py](backend/api/serializers/aircraft_export_csv.py)
  (new) — `aircraft_csv_rows(simulation)`: a generator yielding the header row then one
  row per `Aircraft` (`select_related("runway")`, the model's default `scheduled_time`
  ordering — no explicit `.order_by()` needed). Exactly the 6 columns the slice specifies
  (callsign, movement, outcome, wait, fuel, assigned runway) — deliberately not more (e.g.
  operator/origin-destination), matching the slice's literal scope. Wait/fuel formatted
  to 2 decimal places; wait is blank (not `0` or `None`) for an aircraft that never
  actually queued.
- [backend/api/views/simulation_viewset.py](backend/api/views/simulation_viewset.py) —
  added `export_csv` (`GET /api/simulations/{id}/export.csv/`, via
  `url_path="export.csv"`), and a small `_Echo` pseudo-buffer class (the standard
  Django-docs pattern) so `csv.writer` can drive a `StreamingHttpResponse` row-by-row
  instead of building the whole file in memory first — genuinely streaming, per the
  slice's "BE: ... streaming the aircraft rows" wording, not just a "generate then
  respond" `HttpResponse`. Sets `Content-Disposition: attachment` (so it downloads rather
  than rendering inline) with a `simulation-{id}-aircraft.csv` filename. No status
  restriction — aircraft rows exist as soon as a run starts (some may still be `Pending`
  for a `Running` sim), so gating this on `Complete` would just be an arbitrary
  restriction the slice didn't ask for.

**Frontend**
- [frontend/src/components/MetricBasePage.tsx](frontend/src/components/MetricBasePage.tsx)
  — a `pi-download` icon button in the detail page's top toolbar (matching this
  component's existing PrimeIcons convention, not the FontAwesome one `SimulationHistory`
  uses), alongside Re-run/View-replay. `onClick` just sets `window.location.href` to the
  export URL — a plain navigation, not a fetch+blob: the response's
  `Content-Disposition: attachment` header makes the browser handle the download itself,
  so there's no loading state, blob-URL, or cleanup to manage.

**Verification**
- [backend/tests/feature/simulation_export_test.py](backend/tests/feature/simulation_export_test.py)
  (new, 5 tests): header row + exactly one line per aircraft (the slice's own test,
  literally — includes an aircraft with a null wait and no assigned runway, asserting
  those cells come out blank); zero aircraft → header-only; correct
  `Content-Type`/`Content-Disposition`; 404 for an unknown simulation; available
  regardless of simulation status (checked against a `Running` sim with a `Pending`
  aircraft). **Full suite: 183 passed** (+5).
- Discovered while writing the tests: a bare request to `.../export.csv` (no trailing
  slash) 301-redirects, because DRF's router appends a trailing slash by default — same as
  every other action on this viewset (`/detail/`, `/config/`, `/visualisation/`,
  `/cancel/`). Used the slashed form throughout (tests, the frontend's `downloadCsv`) for
  consistency with the rest of this API, rather than trying to special-case this one
  route to omit it.
- Frontend `tsc -b --noEmit`, `npm run build`, `npm run lint`, and `npm run test` (29,
  unrelated — no frontend test added for this slice, matching its own "pytest asserts..."
  test spec) all clean.
- Live end-to-end against the real dev DB/queue: created a real run (sim 171, 20
  aircraft), let the live dramatiq worker complete it, then fetched
  `GET /api/simulations/171/export.csv/` directly — 21 lines (header + 20), headers
  `Content-Type: text/csv` and `Content-Disposition: attachment;
  filename="simulation-171-aircraft.csv"` both present, row count matching
  `outcomeCounts.total` (20) from the detail endpoint exactly. Verification sim deleted by
  explicit id afterward.
- Not visually verified in a browser (no browser-automation tool available in this
  environment) — the new download button's placement/click-triggers-download behaviour is
  unexercised in a real click-through; verified via `tsc`/`eslint`/Vitest and the live CSV
  content above.

**Operational notes**
- Restarted both `runserver` and `rundramatiq` (viewset change) — checked for strays
  before and after per CLAUDE.md, found the same single clean tree of each from the prior
  session, killed both fully, confirmed zero Redis-broker connections, then started
  exactly one fresh instance of each. Left `npm run dev` running rather than restarting it
  — Vite's HMR applies a new button/import in an existing component live, consistent with
  how every prior frontend-only (or mixed) change in this log has been handled.

**Notes**
- Only the 6 columns the slice names are included. A natural follow-up (not implemented,
  out of scope here) would be adding `operator`/`origin_destination` or a per-aircraft
  timestamp if this export needs to support deeper offline analysis later.

## 2026-07-30 — Slice 11.4 — Add a frontend test runner (Vitest)

**Slice:** 11.4 — Add a frontend test runner (Vitest) (Epic 11, Dev-ex & reliability)
**Status:** Done (code + tests + build/lint/test all clean)

**Changes**
- [frontend/package.json](frontend/package.json) — added `vitest`, `jsdom`,
  `@testing-library/react`, `@testing-library/jest-dom` as dev dependencies; two new
  scripts: `test` (`vitest run` — exits after one pass, CI-friendly) and `test:watch`
  (`vitest`, the interactive dev loop), mirroring the existing `build`/`dev` split.
- [frontend/vite.config.ts](frontend/vite.config.ts) — added a `test` block (reusing the
  same config file as the dev/build Vite config, rather than a separate
  `vitest.config.ts`, so there's one source of truth): `environment: 'jsdom'` (default
  environment ready for component tests, not just the pure-logic ones backfilled here),
  `setupFiles: ['./src/test/setup.ts']`. A `/// <reference types="vitest/config" />`
  triple-slash directive makes the `test` key type-check against `vite.config.ts`'s
  existing `defineConfig` import (avoids needing a second, Vitest-specific
  `defineConfig` import just for the types).
- [frontend/src/test/setup.ts](frontend/src/test/setup.ts) (new) — a single side-effect
  import of `@testing-library/jest-dom/vitest`, extending `expect` with DOM matchers
  (`.toBeInTheDocument()` etc.) for whenever a future slice writes a component test.
- [frontend/src/schemas/simulationForm.test.ts](frontend/src/schemas/simulationForm.test.ts)
  (new, 29 tests) — the "backfill a couple of tests" the slice asks for, against
  `simulationForm.ts` specifically because its Zod `.refine()`/`.superRefine()` chains are
  exactly the kind of cross-field logic that's easy to regress silently and previously had
  no automated coverage at all (Epic 2/3/5's history entries mention at least one bug
  caught by hand-verifying this exact file). Covers: `validateSimulationName` (blank, too
  long, invalid characters, valid-with-punctuation, trims); `simulationFormSchema`'s
  refinements (the max-wait/duration 90% boundary — both sides of it, since it was
  deliberately written as an integer comparison to dodge float rounding; both rates zero;
  a runway missing a mode; no runway accepting the configured arrivals; an
  arrivals-accepting runway not starting `Available`; closures needing ≥2 runways);
  `sweepFormSchema`'s **deliberate** divergence from the create schema (same input that
  fails `simulationFormSchema`'s runway-acceptance rule passes `sweepFormSchema` — a
  regression test for the intentional design decision documented in that schema's own
  comment, not just a coverage box-tick); `toCreateSimulationRequest`/`toCreateSweepRequest`
  (omits `randomSeed` when null, trims the name, defaults a runway's missing initial status
  to `Available`); `configToFormValues` (id-keyed runway maps, seed carried through for
  Duplicate); `detailToRerunRequest` (name gets " (re-run)" and stays within the 120-char
  cap, uses each runway's *initial* status rather than its end-of-run one, seed
  included/omitted correctly).
- [.github/workflows/ci.yml](.github/workflows/ci.yml) — added `npm run test` as a step
  in the existing `frontend` job (after build/lint), so the new suite actually runs on
  every push/PR rather than sitting unused locally.
- [README.md](README.md), [CLAUDE.md](CLAUDE.md), [nextSteps.md](nextSteps.md) — replaced
  the now-stale "no frontend test runner exists" notes (there were three) with how to run
  it, where config/setup files live, and that CI now runs it.

**Verification**
- `npm run test`: **29 passed**. `npx tsc -b --noEmit`, `npm run build`, and `npm run
  lint` all clean with the new config/test files in place.
- Validated `.github/workflows/ci.yml` still parses correctly (via `pyyaml`) after adding
  the new step.
- The actual GitHub Actions run itself was not triggered from this environment (same
  no-push-access limitation noted in the Slice 11.2 entry) — the new `npm run test` CI
  step is unexercised on GitHub itself, though it's the exact command just run locally.

**Notes**
- Chose explicit `import { describe, it, expect } from 'vitest'` per test file over
  Vitest's `globals: true` option — avoids touching `eslint.config.js` to declare
  `describe`/`it`/`expect` as known globals (which `globals: true` would have required to
  keep ESLint's `no-undef`-equivalent checks passing), at the cost of one import line per
  file. Worth revisiting if writing that import repeatedly becomes annoying.
- `@testing-library/user-event` wasn't installed — `@testing-library/react` + `jest-dom`
  is the core "Testing Library" the slice asks for; `user-event` is a natural add-on for
  whichever future slice writes the first real component test and actually needs to
  simulate clicks/typing, not needed for this backfill.
- `npm install` (not `npm ci`) was used to add the new packages — this repo's own `npm
  run dev` (`vite` + `tsc --watch`) was running throughout, and `npm ci`'s full
  `node_modules` wipe hits the same Windows file-lock issue on `lightningcss`'s native
  binary documented in the Slice 11.2 entry. Not a concern for CI (`npm ci` there starts
  from a clean checkout with no competing process).

## 2026-07-29 — Slice 11.3 — Run heartbeat + auto-timeout

**Slice:** 11.3 — Run heartbeat + auto-timeout (Epic 11, Dev-ex & reliability)
**Status:** Done (code + tests + live-verified against the real dev DB/queue)

**Model**
- [backend/api/models/simulation.py](backend/api/models/simulation.py) — added
  `last_heartbeat_at` (nullable `DateTimeField`). Deliberately a new field rather than
  reusing the existing `updated_at` (`auto_now=True`): `updated_at` would silently reset
  on any future unrelated mid-run field write, which would corrupt it as a liveness
  signal — same "keep signals independent" reasoning `cancel_requested` already uses to
  avoid racing with `status`. Migration `0009_simulation_last_heartbeat_at` (applied to
  the dev DB).

**Engine**
- [backend/api/simulation/simulation_runner.py](backend/api/simulation/simulation_runner.py)
  — `run()` now seeds `last_heartbeat_at = started_at` in the same save as the
  Pending→Running transition, so every run that actually starts has a real reference
  point even if its worker dies before the first periodic tick. The existing
  `_cancellation_watchdog` SimPy process (renamed `_watchdog`) now also bumps
  `last_heartbeat_at` to `timezone.now()` on every tick, alongside its existing
  `cancel_requested` re-read — combined into one process rather than two, since a
  cancel-check tick already proves the process is alive and progressing, so it's the
  natural place to also record that liveness.
- [backend/api/simulation/constants.py](backend/api/simulation/constants.py) — added
  `STALLED_RUN_TIMEOUT_REAL_MINUTES = 30.0`, explicitly commented as **real/wall-clock**
  minutes (every other constant in this file is sim-minutes) — generous relative to how
  long a run actually takes in practice (~10s wall-clock even for a large run, per
  CLAUDE.md's documented incidents) so a slow-but-genuinely-alive run is never mistaken
  for a stalled one.

**New: stale-run watchdog command**
- [backend/api/management/commands/check_stalled_simulations.py](backend/api/management/commands/check_stalled_simulations.py)
  (new) — marks any `Running` simulation whose `last_heartbeat_at` is older than
  `STALLED_RUN_TIMEOUT_REAL_MINUTES` as `Error` (with a descriptive `error_message`),
  publishing the status change over the websocket same as every other transition. Falls
  back to `started_at` for the (shouldn't-normally-happen) case of a `Running` row with no
  heartbeat at all, e.g. pre-existing data from before this field existed — a `Running`
  row with neither is left alone rather than guessed at. This command doesn't loop itself;
  something external invokes it periodically (see docker-compose below, or cron/Task
  Scheduler for the manual workflow).
- [docker-compose.yml](docker-compose.yml) — added a `watchdog` service (reuses the
  backend image) that loops `check_stalled_simulations` every 60s, so the Docker Compose
  workflow from Slice 11.1 actually self-heals a dead/stray worker rather than requiring
  someone to remember to run the command by hand.
- [README.md](README.md), [CLAUDE.md](CLAUDE.md) — documented the command, the `watchdog`
  Compose service, and (since it hadn't been written up before) Slice 11.2's CI pipeline.

**Verification**
- [backend/tests/simulation/simulation_runner_status_transitions_test.py](backend/tests/simulation/simulation_runner_status_transitions_test.py)
  — 2 new tests: with the watchdog monkeypatched to a no-op, `last_heartbeat_at` still
  equals the seeded value (isolates the seed-at-transition behaviour); on a real run long
  enough to cross a `CANCELLATION_POLL_MINUTES` tick, `last_heartbeat_at` ends up strictly
  later than `started_at` (proves the periodic bump actually fires).
- [backend/tests/feature/check_stalled_simulations_test.py](backend/tests/feature/check_stalled_simulations_test.py)
  (new, 5 tests): a stale `Running` row → `Error`; a recently-active one is left alone; a
  non-`Running` row is ignored regardless of heartbeat age; a `Running` row with no
  heartbeat falls back to a stale `started_at`; a `Running` row with neither is left alone
  (not enough information to call it stale). **Full suite: 178 passed** (+7 total: 2
  engine + 5 command).
- Live end-to-end against the real dev DB/queue: created a real run (sim 169), let the
  live dramatiq worker complete it, and confirmed via `manage.py shell` that
  `last_heartbeat_at` (16:10:18.585) is strictly after `started_at` (16:10:17.872) —
  the watchdog genuinely ticked during a real run, not just in the test's simulated
  clock. Separately created a synthetic stalled `Running` row directly in the DB (sim
  170, `started_at`/`last_heartbeat_at` both backdated 45 minutes), ran
  `manage.py check_stalled_simulations` for real, and confirmed it printed "Marked 1
  stalled simulation(s) as Error", flipped sim 170 to `Error` with the expected message,
  and left sim 169 (`Complete`) untouched. Both verification sims deleted by explicit id
  afterward.

**Operational notes**
- Restarted both `runserver` and `rundramatiq` (engine + migration change). Checked for
  strays both before and after per CLAUDE.md: found the same two process trees from the
  Slice 11.1/11.2 session, killed both fully (`taskkill //F //T` on each root PID),
  confirmed zero connections to the Redis broker, then started exactly one fresh instance
  of each and reconfirmed a single clean tree plus a matching pair of the fresh worker's
  own `spawn_main` children (by start time) — no orphans.

**Notes**
- The `watchdog` Compose service is the only thing that makes this self-operating out of
  the box; the manual (non-Docker) dev workflow still needs the command wired into a real
  cron/Task Scheduler entry to be more than a manually-run diagnostic — documented in both
  README.md and CLAUDE.md rather than silently assumed.
- 30 real minutes is a fixed timeout, not adaptive to a given simulation's config (e.g. a
  very large `durationMinutes`/aircraft count run that's still fully CPU-bound generating
  data before its first watchdog tick). Given the engine's own documented ~10s wall-clock
  runtime even for large runs, this wasn't judged a realistic risk — worth revisiting if a
  future slice makes runs meaningfully heavier.

## 2026-07-29 — Slice 11.2 — CI pipeline

**Slice:** 11.2 — CI pipeline (Epic 11, Dev-ex & reliability)
**Status:** Done (workflow written and its steps validated locally; the actual GitHub
Actions run itself not triggered — see Verification)

**Changes**
- [.github/workflows/ci.yml](.github/workflows/ci.yml) (new) — two independent jobs on
  `push`/`pull_request`:
  - `backend`: `actions/setup-python@v5` (3.13, matches this repo's actual dev
    interpreter, pip-cached), `pip install -r requirements.txt`, then `pytest`. No
    Postgres/Redis service containers — `pytest.ini` already points at
    `tests/settings_test.py` (sqlite in-memory DB, dramatiq `StubBroker`, in-process
    Channels layer), so the suite needs no external services or a `.env` file, confirmed
    below.
  - `frontend`: `actions/setup-node@v4` (Node 24, matches this repo's actual dev version,
    npm-cached via the existing `package-lock.json`), `npm ci`, `npm run build` (`tsc -b`
    then `vite build`), `npm run lint`. No `.env.local` needed either, confirmed below.
  - Quoted `"on":` rather than bare `on:` — YAML 1.1 (which `pyyaml`/most linters use)
    parses an unquoted `on` as the boolean `true`; GitHub's own parser handles the bare
    form fine (virtually every public workflow uses it unquoted), but quoting sidesteps
    the ambiguity entirely for zero cost, and lets it validate cleanly with a generic
    YAML parser rather than only with GitHub-specific tooling.

**Verification**
- **The GitHub Actions run itself was not triggered from this environment** (no
  push/network access here to actually exercise the pipeline on GitHub) — so "the
  pipeline goes green" per the slice's own test is unverified end-to-end. Verified the
  underlying commands directly instead, simulating a clean-checkout CI environment as
  closely as possible:
  - Backend: temporarily moved `backend/.env` out of the way (so no dev env file was
    present, matching a fresh clone) and ran `pytest` — **171 passed**, confirming the
    suite needs no `.env`/external Postgres/Redis, consistent with `tests/settings_test.py`.
    `.env` restored immediately after.
  - Frontend: temporarily moved `frontend/.env.local` out of the way and ran `npm run
    build` and `npm run lint` against the existing `node_modules` — both clean. `.env.local`
    restored immediately after.
  - Also validated `.github/workflows/ci.yml` parses as valid YAML (via `pyyaml`) and
    that `"on":` deserializes to the string key `"on"` (not the boolean `True` a bare
    `on:` would under YAML 1.1).
  - Did **not** get a clean local `npm ci` run: it failed with a Windows-only `EPERM` on
    `lightningcss.win32-x64-msvc.node`, because this session's own long-running `npm run
    dev` (`vite` + `tsc --watch`) process still holds that native binary open, so `npm
    ci`'s `node_modules` wipe can't unlink it. This is a local file-lock artifact of a
    live dev server on Windows, not something a GitHub Actions Ubuntu runner (fresh
    checkout, no pre-existing `node_modules`) would ever hit — `npm install` (not `ci`)
    plus the build/lint pass above already exercised the same lockfile-resolved
    dependency tree successfully.

**Notes**
- Deliberately two independent jobs (not one), matching the slice's "pytest (backend) and
  `npm run build` + `npm run lint` (frontend)" wording exactly — either can fail/report
  without blocking the other, and they run in parallel.
- Slice 11.1's `docker-compose.yml`/`backend/Dockerfile` were **not** reused here — the
  backend test suite doesn't need Postgres/Redis at all (sqlite + stub broker), so
  spinning up the Docker Compose stack just to run `pytest` would be strictly slower for
  no benefit. That earlier slice's own "Notes" section flagged this as a possible future
  reuse for CI; on inspection it isn't actually needed for *this* pipeline, only for a
  hypothetical end-to-end/integration job against a real Postgres — out of scope for what
  this slice asks for.
- No branch-protection rule was configured to require these checks before merging — that's
  a GitHub repo-settings change (not a file in this repo), out of scope for what was asked
  and not something to change without explicit instruction.

## 2026-07-29 — Slice 11.1 — Docker Compose for local dev

**Slice:** 11.1 — Docker Compose for local dev (Epic 11, Dev-ex & reliability)
**Status:** Done (config written and statically validated; `docker compose up` itself not
run — see Verification)

**Changes**
- [backend/Dockerfile](backend/Dockerfile) (new) — `python:3.13-slim` (matches this repo's
  actual dev Python, confirmed this session), installs `requirements.txt`, copies the app,
  exposes 8000. No entrypoint script — `docker-compose.yml` sets the command per service so
  the same image serves `web`, `worker`, and the one-shot `migrate` step.
- [backend/.dockerignore](backend/.dockerignore) (new) — excludes `venv/`, `__pycache__/`,
  `.env`, `db.sqlite3`, `.pytest_cache/` from the build context (mirrors
  `backend/.gitignore`).
- [docker-compose.yml](docker-compose.yml) (new, repo root) — `postgres` (16-alpine, named
  volume, `pg_isready` healthcheck), `redis` (7-alpine, `redis-cli ping` healthcheck), a
  one-shot `migrate` service (`manage.py migrate --noinput`, waits on Postgres healthy),
  and `web`/`worker` (both wait on `migrate` completing successfully + Redis healthy, so
  neither can start against an unmigrated DB or race each other to migrate). All four
  backend-side services share one `environment:` block via a YAML anchor
  (`x-backend-env`), with `DATABASE_HOST`/`QUEUE_URL`/`CHANNEL_LAYER_URL` pointed at the
  compose service names (`postgres`/`redis`) rather than `localhost` — deliberately
  self-contained (no `env_file: backend/.env` dependency), so `docker compose up` works on
  a fresh clone with no `.env` file created yet, matching the manual "brings the stack up"
  test literally. Per the slice's explicit scope ("web, dramatiq worker, Postgres, Redis"),
  the frontend is **not** included — it still runs via `npm run dev`, pointed at the
  dockerized backend's `localhost:8000` (already the default `CORS_ALLOWED_ORIGINS`).
- [README.md](README.md) — added a "Docker Compose" subsection under the backend setup
  steps, documenting it as an alternative to (not alongside) the manual `venv`/
  `runserver`/`rundramatiq` workflow, since both default to the same Postgres/Redis ports.
- [CLAUDE.md](CLAUDE.md) — updated the stale "no Dockerfile, docker-compose... exists"
  infrastructure note (now false) and added the same alternative-workflow pointer after
  the manual backend setup block.

**Verification**
- **Docker itself is not installed in this environment** (`docker`/`docker compose` not on
  `PATH`, no Docker Desktop install found) — `docker compose up` could not be literally
  executed, so this slice's manual test ("brings the stack up; create a run end-to-end")
  is unexercised end-to-end. Verified what's checkable without Docker instead:
  - `docker-compose.yml` parses as valid YAML and the `x-backend-env` anchor expands
    identically into `migrate`/`web`/`worker`'s `environment:` blocks (checked via
    `pyyaml`).
  - Confirmed `django-environ`'s `Env.read_env()` (`backend/backend/settings.py`) silently
    no-ops on a missing `.env` file (catches `OSError`, just logs) rather than raising —
    so the container's lack of a `.env` file is safe, and `env(...)`/`env.list(...)` calls
    read whatever `docker-compose.yml` injected via `environment:` regardless.
  - `requirements.txt` is the same one this session already confirmed installs cleanly
    under Python 3.13 (this repo's actual dev interpreter) — the Dockerfile installs the
    identical file under `python:3.13-slim`; the main unverified risk is whether every
    package (`psycopg[binary]`, `numpy`) publishes a linux/manylinux wheel for cp313 (no
    network access in this environment to check PyPI directly).
- Frontend unaffected by this slice; not re-verified.

**Notes**
- If a future session has Docker available, the outstanding manual step is exactly the
  slice's own test: `docker compose up` from repo root, then create a simulation via the
  frontend (run with `npm run dev` against `localhost:8000`) and confirm it completes.
- Host ports 5432/6379/8000 are published for convenience (inspecting the DB/queue with a
  local client, hitting the API directly) — documented as a conflict risk with the manual
  workflow's own default ports, not resolved by e.g. randomizing ports, since a fixed
  known port is more useful for local dev than avoiding a collision that's easy to avoid
  by just not running both workflows at once.
- CI (Slice 11.2) could reuse this same `docker-compose.yml`/`Dockerfile` to run the
  backend test suite in a clean, reproducible environment instead of relying on whatever's
  installed on a CI runner — left for that slice rather than pulled forward here.

## 2026-07-29 — Redesign: collapse row actions into a "..." menu; add sweep delete

**Slice:** n/a (user-requested cleanup of Slice 2.1/2.2/2.3's row-actions UX, plus a new
batch-delete endpoint)
**Status:** Done

**Request:** a standalone history row had four separate icon buttons (delete, duplicate,
rename, view) — too many. Collapse Duplicate/Rename/Delete into a single "..." menu where
the delete button used to sit, and use that same freed-up slot on a batch row (which
currently has no action there at all) to add a way to delete an entire sweep.

**Backend**
- [backend/api/views/simulation_viewset.py](backend/api/views/simulation_viewset.py) —
  the existing `batch` action (`GET /api/simulations/batch/?id=`) now also accepts
  `DELETE`: looks up the batch, deletes every `Simulation` with that `batch_id` (cascading
  to their aircraft/events same as a normal single-simulation delete), then deletes the now-
  empty `SimulationBatch` itself, all inside one `transaction.atomic()`. Deleting only the
  `SimulationBatch` row wouldn't have been enough — `Simulation.batch` is `SET_NULL`, so
  that alone would just ungroup the runs (leaving them as N standalone rows) rather than
  actually deleting the sweep's results, which is what "delete this sweep" means from a
  collapsed history row.

**Frontend**
- [frontend/src/components/SimulationHistory.tsx](frontend/src/components/SimulationHistory.tsx)
  — the left-hand action column (previously: null for a batch row, Cancel for an
  active run, a plain trash icon otherwise) is now: a delete (trash) button for a batch
  row (opens a new "Delete sweep" confirm dialog); Cancel unchanged for an active run; a
  "..." (`faEllipsisVertical`) button for a finished standalone row that opens a single
  shared PrimeReact `Menu` (popup) with Duplicate/Rename/Delete. The right-hand action
  column now only has the view chevron — Duplicate and Rename moved into the menu.
  One `Menu` instance serves every row (not one per row): a `rowMenuTarget` **ref** (not
  state) is set to the clicked row immediately before `rowMenuRef.current?.toggle(e)`, and
  each menu item's `command` reads `rowMenuTarget.current` at click time — avoids the
  stale-closure bug that would appear from computing `model` off state set in the same
  handler that calls `toggle()` (state updates aren't applied until the next render, but a
  ref read happens live at command time).
  `duplicatingId` (previously only used for a spinner on the now-removed Duplicate button)
  was removed as dead state — the popup menu has no equivalent per-item loading affordance,
  and the underlying `/config/` fetch is fast enough that dropping the spinner isn't
  noticeable.

**Verification**
- [backend/tests/feature/simulation_batch_results_test.py](backend/tests/feature/simulation_batch_results_test.py)
  — 3 new tests: deleting a batch removes every run in it (and their aircraft) plus the
  batch itself, while an unrelated unbatched simulation survives untouched; 400 on a
  missing `id`; 404 for an unknown batch. **Full suite: 171 passed** (+3, on top of Slice
  6.1's +2 from the same session). Frontend `tsc -b` + `eslint src` clean.
- Live end-to-end against the real dev DB/queue: created a real 3-run sweep via
  `POST /api/simulations/sweep/` (batch 11, ids 162–164), confirmed it collapsed to one
  history row via `GET /api/simulations/?search=...`, then `DELETE
  /api/simulations/batch/?id=11` → 204; re-checking confirmed the history search now
  returns **count: 0**, all three `GET .../detail/` calls 404, and the batch endpoint
  itself 404s too.
- Not visually verified in a browser (no browser-automation tool available in this
  environment) — the new "..." menu's rendering/interaction and the "Delete sweep" dialog
  are unexercised in a real click-through; verified via `tsc`/`eslint` and the live API
  round-trip above.

**Operational notes**
- Before this session's edits, found (and this time correctly diagnosed) a genuine stray-
  process situation: two `runserver` process trees running simultaneously, one of which
  turned out to be this session's own healthy, auto-reloading dev server rather than an
  orphan. Killed both anyway (per CLAUDE.md's "kill every match, don't try to guess which
  one is extra") and started exactly one fresh `runserver` + one fresh `rundramatiq`,
  confirming zero Redis-broker connections before restarting and that the only
  connections afterward were the fresh worker's own two `--processes 2` `spawn_main`
  children (matched by parent PID, not orphans). This session's backend edits (including
  this entry's `DELETE` support on the `batch` action) were picked up live by that same
  fresh `runserver` via `StatReloader` with no further restart needed.

**Notes**
- No equivalent "delete sweep" affordance was added to the `SweepResults` batch-detail
  page (`/batch/:batchId`) itself — only requested for the history row. A follow-up could
  add it there too for symmetry with the per-run delete that page already lacks.

## 2026-07-29 — Fix: batch row's "N runs"/status tags wrapped to 2 lines

**Slice:** n/a (history collapse redesign follow-up, user-reported)
**Status:** Done

**Symptom:** on the history home page, a collapsed batch row's Name cell
("N runs" tag) and Status cell (one tag per non-zero status count) could wrap
onto a second line instead of staying on one.

**Fix**
- [frontend/src/components/SimulationHistory.tsx](frontend/src/components/SimulationHistory.tsx)
  — added `whitespace-nowrap` (text-level — prevents wrapping *within* a
  span/Tag) alongside explicit `flex-nowrap` (flex-level — prevents the icon/
  name/tag or the multiple status tags from wrapping as flex *items*) to both
  cells. The table has no fixed `table-layout`, so the column simply grows to
  fit the now-unwrapped content; the outer container's existing
  `overflow-x-auto` handles horizontal scrolling if the table gets wider than
  the viewport.

**Verification**
- `tsc -b` + `eslint src` clean. Frontend-only; Vite HMR applies it, no
  backend restart needed.
- Not visually verified in a browser (no browser-automation tool available in
  this environment) — reasoned from the DataTable's default (non-fixed)
  table-layout and the absence of any competing `max-width`/`table-layout`
  CSS override in `index.css`.

## 2026-07-29 — Redesign: collapse a sweep's runs into one history row

**Slice:** n/a (ad-hoc redesign of Slice 5.1/5.2/5.3's history UX, user-requested)
**Status:** Done

**Request:** a sweep's N runs each showing up as a separate row in the history
table didn't look good. Instead: one row per batch; clicking it opens the
batch/sweep-results page (not a single run's detail); individual runs are
reachable by clicking through from there; and a batch member's detail page
back button returns to its sweep results, not the history home page (this
last part was already done in the previous "sweep follow-ups" fix below, and
continues to work unchanged here).

**Backend**
- [backend/api/managers/querysets/simulation_queryset.py](backend/api/managers/querysets/simulation_queryset.py)
  — added `for_history()`: collapses every batch down to its earliest-created
  (lowest-id) row via a `Min("id")`-per-`batch_id` subquery, unioned with all
  standalone (`batch_id__isnull`) rows, `select_related("batch")` (so reading
  `swept_variable` needs no extra query), then reuses `with_runway_count()`.
  Safe specifically because a sweep's N runs are all created back-to-back
  inside one request/transaction — nothing else can be created in between
  them, so "first row per batch" can't accidentally split a batch's own runs
  across two different history pages.
- [backend/api/views/simulation_viewset.py](backend/api/views/simulation_viewset.py)
  — the `list` action's queryset is now `Simulation.objects.for_history()`
  instead of `with_runway_count()`. Pagination's `count`/`next`/`previous` all
  now correctly reflect *history items* (a batch counts as 1), not raw rows.
- [backend/api/serializers/simulation_list_dto.py](backend/api/serializers/simulation_list_dto.py)
  — added `batch_summary`: for a batch's representative row, one aggregate
  query (`Count`/`Min`/`Max` in a single `.aggregate()` call, not three) over
  every simulation in that batch, returning `sweptVariable`, `runCount`,
  `statusCounts` (per-status counts, keyed by the model's actual capitalized
  status strings — "Pending"/"Complete"/etc., matching the frontend's
  `SimulationStatus` union exactly), and `rangeMin`/`rangeMax` for the swept
  field. Null for a standalone run.
- [backend/api/serializers/simulation_detail_dto.py](backend/api/serializers/simulation_detail_dto.py)
  — added `batch_id` (already added to the list DTO in the previous fix below;
  this closes the same gap on the single-run detail endpoint, which the batch
  results page's per-run table now also relies on).

**Frontend**
- [frontend/src/types/simulation.ts](frontend/src/types/simulation.ts) — new
  `BatchSummary` type; `Simulation.batchSummary: BatchSummary | null`.
- [frontend/src/types/metrics.ts](frontend/src/types/metrics.ts) — `batchId`
  added to both `SimulationDetail` and `SimulationNotComplete`. New `BatchRun`
  type replaces `SimulationDetailResponse` for `BatchResults.simulations`:
  unlike the single-run `/detail/` endpoint (deliberately modeled as "no
  config fields until Complete"), the batch endpoint's `SimulationDetailDto`
  *always* includes config/metric fields regardless of status (a
  Pending/Running run just has not-yet-meaningful zeros/nulls) — `BatchRun`
  reflects that real shape instead of pretending they're absent.
- [frontend/src/components/SimulationHistory.tsx](frontend/src/components/SimulationHistory.tsx)
  — a batch row now renders as one collapsed item: name has the sweep's base
  name (backend's " (variable: value)" suffix stripped via regex) plus a
  layer-group icon and an "N runs" tag; Status shows one `Tag` per non-zero
  status count instead of a single status; Duration/Aircraft-Flow columns show
  a "min → max" range specifically for whichever column matches the swept
  variable (unaffected columns still show the single representative value);
  Duplicate/Rename and the cancel/delete action are hidden (none map cleanly
  onto "the whole batch" without a batch-level endpoint); row click and the
  chevron both navigate to `/batch/{batchId}` instead of a detail page;
  compare-mode selection now also excludes/dims batch rows (a group isn't one
  comparable result). Removed the now-redundant "view sweep results" icon
  button added in the previous fix — the whole row does that now.
- [frontend/src/functions/statusSeverity.ts](frontend/src/functions/statusSeverity.ts)
  (new) — extracted `STATUS_SEVERITY` out of `SimulationHistory.tsx` (which
  needed to stay component-only for Fast Refresh) so `SweepResults.tsx` could
  reuse the same status→color mapping instead of duplicating it.
- [frontend/src/components/SweepResults.tsx](frontend/src/components/SweepResults.tsx)
  — the bottom table now lists **every** run in the batch (not just `Complete`
  ones), each row clickable straight to `/simulation/{id}/detail`, with a
  status `Tag` and metrics shown as "—" for anything not yet `Complete`. The
  charts above are unchanged (still only plot `Complete` runs, still gated on
  ≥2 of them) but no longer gate the whole page — previously, a batch with
  fewer than 2 Complete runs showed *only* a warning and no way to reach any
  individual run; now the runs table (and the ability to click into any run)
  always renders regardless of chart availability.

**Bug caught during review, fixed before shipping**
- The first draft of `batch_summary`'s `status_counts` used lowercase Python
  dict keys (`"pending"`, `"complete"`, …) while the frontend's
  `SimulationStatus` union is capitalized (`'Pending'`, `'Complete'`). Fixed by
  keying the dict with `Simulation.Status.PENDING.value` etc. (the model's
  actual status strings) instead of hand-typed lowercase literals — caught by
  re-reading the diff against the frontend type before running the tests, then
  confirmed by updating and re-running the backend test assertions.

**Verification**
- **Full backend suite: 168 passed** (test files:
  [simulation_list_test.py](backend/tests/feature/simulation_list_test.py) +5,
  [simulation_detail_test.py](backend/tests/feature/simulation_detail_test.py)
  +2 — a batch collapses to one row with the right representative id; total
  `count` reflects collapsed items; `batchSummary` reports correct
  `runCount`/`statusCounts`/`rangeMin`/`rangeMax`; both null-summary and
  null-batch-id standalone-run cases). Frontend `tsc -b` + `eslint src` clean.
- Live end-to-end against the real dev DB/queue: created a 4-run sweep
  (`arrivalRatePerHour` 10→40 step 10) alongside one standalone run;
  `GET /api/simulations/?search=live` returned **count: 5** (not 6) with the
  sweep collapsed to its representative row (id 150) carrying
  `batchSummary: {sweptVariable: arrivalRatePerHour, runCount: 4,
  statusCounts: {Complete: 4, ...}, rangeMin: 10, rangeMax: 40}`, while the
  standalone run's `batchId`/`batchSummary` were both null; confirmed
  `GET /api/simulations/150/detail/` carries `batchId: 9` (what the detail
  page's back button needs) and `GET /api/simulations/batch/?id=9` lists all 4
  member runs. Deleted the 5 verification sims by explicit id afterward.
- Not visually verified in a browser (no browser-automation tool available in
  this environment) — the collapsed row's rendering (icon/tag/range columns)
  and the batch page's now-always-visible runs table are unexercised in a real
  click-through; verified via `tsc`/`eslint` and the live API data above.

**Notes**
- No batch-level cancel/delete endpoint exists yet, so those actions are
  simply hidden on a collapsed row rather than approximated (e.g. "cancel"
  acting on just the representative run would silently leave its siblings
  running, which would be more confusing than no button at all).
- Restarted both `runserver` and `rundramatiq` — hit the same known
  autoreload-leaves-a-stray-child pattern documented in CLAUDE.md and prior
  entries; cleaned up as usual before starting fresh.

## 2026-07-29 — Fix: sweep follow-ups (unreachable results, broken duration validation)

**Slice:** n/a (Slice 5.2/5.3 robustness fixes, both user-reported)
**Status:** Done

**Fix 1 — no way back to a sweep's results after leaving them**
- Previously the only path to `/batch/:batchId` was the "View Sweep Results"
  button on the sweep-creation success screen — closing that dialog (or
  visiting later) left no way back.
- [backend/api/serializers/simulation_list_dto.py](backend/api/serializers/simulation_list_dto.py)
  — added `batch_id` (reads the model's own `batch_id` column directly, no
  join) to `SimulationListDto`, so `GET /api/simulations/` now reports which
  batch (if any) each run belongs to.
- [frontend/src/types/simulation.ts](frontend/src/types/simulation.ts) —
  `Simulation.batchId: number | null`.
- [frontend/src/components/SimulationHistory.tsx](frontend/src/components/SimulationHistory.tsx)
  — a chart-line icon button appears in a batched row's actions column,
  navigating straight to `/batch/{row.batchId}`; absent entirely for
  standalone (non-swept) runs.
- [backend/tests/feature/simulation_list_test.py](backend/tests/feature/simulation_list_test.py)
  — 2 new tests: a batched run's `batchId` round-trips through the list
  endpoint; a standalone run's is `null`.

**Fix 2 — sweep duration validation compared hours to minutes**
- **Root cause:** in [SweepForm.tsx](frontend/src/components/SweepForm.tsx),
  the "Simulation Duration" field displays/edits **hours** but stores
  **minutes** in form state (same conversion `RequestForm` has always done).
  The sweep's "End Value"/"Step" fields are raw, unconverted numbers. The
  client-side `sweepFormSchema` validation compared `rangeEnd` directly
  against the swept variable's stored value — fine for the rate/max-wait
  variables (no unit conversion involved), but nonsense for `durationMinutes`:
  typing an End Value that matches what's *displayed* (hours) got compared
  against a value in minutes, either falsely rejecting a valid sweep or
  passing a client check that meant something different from what was typed.
- [frontend/src/schemas/simulationForm.ts](frontend/src/schemas/simulationForm.ts)
  — removed the `rangeEnd >= start` refine, the min-2/max-50-steps
  `superRefine`, and the now-dead `sweepStartValue` helper and `MAX_SWEEP_RUNS`
  constant. The backend's `SimulationSweepCreationDto` already independently
  re-validates the same range/step rules in the model's real units (plain
  integers, no hours/minutes ambiguity) and is the actual source of truth here
  — removing the client-side copy removes the broken comparison without
  losing the check itself.
- [frontend/src/components/SweepForm.tsx](frontend/src/components/SweepForm.tsx)
  — added a `SWEEP_VARIABLE_UNITS` hint ("In minutes (not hours)." /
  "In aircraft per hour.") under both End Value and Step, so the unit
  ambiguity that caused the bug is spelled out instead of silently assumed.

**Verification**
- **Full backend suite: 163 passed** (+2, the new `batchId` list tests — the
  removed frontend checks had no backend-side equivalent to update). Frontend
  `tsc -b` + `eslint src` clean.
- Live end-to-end: created a real sweep via `POST /api/simulations/sweep/`,
  confirmed `GET /api/simulations/?search=...` (the exact endpoint
  `SimulationHistory` polls) returns `batchId` matching the created batch for
  each row, then deleted the verification sims by explicit id.
- Not visually verified in a browser (no browser-automation tool available in
  this environment) — the new history button and duration-sweep hint text are
  unexercised in a real click-through; verified via `tsc`/`eslint` and the live
  API check above.

**Notes**
- A sweep over `durationMinutes` still requires the user to enter End
  Value/Step in minutes (matching the dropdown's "Duration (Minutes)" label) —
  this fix removes the broken guess-and-check, it doesn't add hour-aware input
  conversion for that field. If this keeps confusing people, the more thorough
  fix would be converting the End Value/Step inputs themselves whenever
  `durationMinutes` is the selected variable (mirroring the base field), not
  just labeling the expected unit.

## 2026-07-29 — Fix: sweep results chart showed a spike on an otherwise-flat line

**Slice:** n/a (Slice 5.3 robustness fix)
**Status:** Done

**Symptom (reported):** on a batch where a metric (e.g. avg wait) was
consistent throughout — every point displaying "0.0m" — the chart still
rendered a visible jump partway along an otherwise flat line.

**Root cause:** [LineChart.tsx](frontend/src/components/LineChart.tsx)'s Y
domain (`yDomainMax = yMax * 1.15`) scales off the *raw, unrounded* point
values, while labels/tooltips (`formatMinutes`/`formatCount`) round for
display. Two points can display identically (both "0.0m") while their raw
values differ — e.g. one run's average is exactly `0` (SQL `AVG` over
all-zero rows) and another's is a tiny nonzero float (real sub-tenth-of-a-
minute noise, or float-division noise in the throughput calculation
`(success / duration) * 60`, which can land on `24.999999999999996` instead of
`25`). The domain then scales to that tiny nonzero max, so the point carrying
it plots near the top of the chart while the "identical-looking" zeros sit at
the very bottom — a spike that contradicts what every label says.

**Fix**
- [frontend/src/components/SweepResults.tsx](frontend/src/components/SweepResults.tsx)
  — added `roundTo(value, decimals)` and applied it to every metric *before*
  building `LineChartPoint`s, at the same precision each is displayed at:
  success rate to the nearest whole percent, avg wait to 1 decimal, throughput
  to the nearest whole number. A point that reads the same as its neighbors
  now always plots at the same height as them.

**Verification**
- `tsc -b` + `eslint src` clean.
- Simulated the reported scenario (`[0, 0, 0.04, 2e-13]` → all round to `0` at
  1 decimal), confirming the fix collapses near-zero noise before it reaches
  the chart's domain calculation.
- Frontend-only; Vite HMR applies it, no backend restart needed.

**Notes**
- General lesson, not sweep-chart-specific: any chart that derives its scale
  from raw data must round to the same precision it displays, or "identical"
  labels can silently plot at different heights. Worth remembering if Epic 6's
  charts (Slice 6.1–6.3) compute derived rates the same way.

## 2026-07-29 — Slice 5.3 — Sweep results chart

**Slice:** 5.3 — Sweep results chart (Epic 5, Parameter sweep / capacity curve)
**Status:** Done (code + tests + live-verified data pipeline)

**Backend**
- [backend/api/models/simulation_batch.py](backend/api/models/simulation_batch.py) —
  added `swept_variable` (nullable `CharField`, wire-level camelCase name e.g.
  `"arrivalRatePerHour"`, matching `CreateSweepRequest.variable` exactly so the
  frontend needs no second mapping step). Migration
  `0008_simulationbatch_swept_variable` (applied to the dev DB). 5.1 deliberately
  left this off the batch primitive ("belongs to whichever slice actually
  creates sweeps") — this is that slice.
- [backend/api/serializers/simulation_sweep_creation_dto.py](backend/api/serializers/simulation_sweep_creation_dto.py)
  — `create()` now stores `variable` onto the new `SimulationBatch.swept_variable`
  field (one extra kwarg on the existing `SimulationBatch.objects.create()` call).
- [backend/api/managers/querysets/simulation_queryset.py](backend/api/managers/querysets/simulation_queryset.py)
  — added `with_detail_for_batch(batch_id)`: `with_detail()` scoped to the batch
  and explicitly `.order_by("id")` (ascending id = ascending swept-variable
  order, since a sweep's steps are created sequentially in that order — and
  `with_detail()`'s aggregate `annotate()` otherwise silently drops the model's
  default `-created_at` ordering, same caveat as `with_runway_count()`).
- [backend/api/views/simulation_viewset.py](backend/api/views/simulation_viewset.py)
  — `GET /api/simulations/batch/?id=<batchId>`: 400 if `id` is missing/non-
  integer, 404 for an unknown batch, else `{batchId, sweptVariable, simulations:
  [...]}` — one `SimulationDetailDto` block per run in the batch, in step order.
  Mirrors Slice 4.2's `/compare/` shape but scoped by batch instead of explicit ids.

**Frontend**
- Used the `dataviz` skill before writing any chart code. Key decision it drove:
  **three separate single-series line charts (small multiples)**, not one chart
  with three lines — success rate (%), avg wait (minutes), and throughput
  (ops/hr) are different units/scales, and cramming differently-scaled measures
  onto one shared axis is the skill's #1 flagged anti-pattern (the dual-axis
  problem, in spirit, even without literally drawing two scales). Ran
  `validate_palette.js` on the 3 chart accent colors (documented palette slots
  1/2/3 — blue/green/magenta) — passes with a contrast WARN on magenta that's
  satisfied by this chart's direct end-labels + the table view (the skill's
  documented "relief rule").
- [frontend/src/components/LineChart.tsx](frontend/src/components/LineChart.tsx)
  (new) — hand-rolled inline-SVG single-series line chart (no charting library
  added — the app has none, and 2–50 points doesn't need one). Zero-baseline Y
  axis, hairline recessive gridlines, 2px line with round caps, ≥8px end-dots
  with a 2px surface-color ring, a direct label on the last point, gaps in the
  line (not a misleading connecting segment) where a metric has no value for a
  step. Hover: a crosshair + per-point tooltip; `hoveredIndex` is lifted to the
  parent so multiple charts sharing an x-axis can link their crosshairs.
- [frontend/src/components/SweepResults.tsx](frontend/src/components/SweepResults.tsx)
  (new) — route `/batch/:batchId`; fetches the new batch endpoint (one call,
  unlike Compare's N-parallel-fetch, since this endpoint already returns every
  run at once); filters to `Complete` runs (warns about any excluded
  Pending/Running/Error ones, mirroring `CompareRuns`'s pattern), sorts by the
  swept variable's value, and renders the 3 linked `LineChart`s plus a plain
  HTML data table underneath (the "table view" the skill requires as an
  accessibility/exact-values companion to any chart). Requires ≥2 Complete runs
  to draw a curve, same floor as Compare.
- [frontend/src/types/metrics.ts](frontend/src/types/metrics.ts) — `BatchResults`.
- [frontend/src/components/SweepForm.tsx](frontend/src/components/SweepForm.tsx)
  — the post-submit summary now has a "View Sweep Results" button (alongside
  "Done") that navigates straight to `/batch/{batchId}`.
- [frontend/src/App.tsx](frontend/src/App.tsx) — added the `/batch/:batchId` route.

**Verification**
- [backend/tests/feature/simulation_batch_results_test.py](backend/tests/feature/simulation_batch_results_test.py)
  (new, 8 tests): one detail block per simulation in batch/step order;
  `sweptVariable` returned (and null when absent); excludes other batches'
  simulations; 400 on missing/non-integer `id`; 404 for an unknown batch; and an
  end-to-end test that a real `/sweep/` call's `batchId` is retrievable via
  `/batch/`. **Full suite: 161 passed** (+8). Frontend `tsc -b` + `eslint src` clean.
- Live end-to-end against the real dev DB/queue: created a real sweep
  (`arrivalRatePerHour` 5→50 step 15, 2 runways, 60 min), let the live dramatiq
  worker run all 4 to `Complete`, then read `/api/simulations/batch/?id=4` —
  **success rate 100% → 96% → 64.1% → 46.3%** while successful-ops count
  plateaus (10 → 24 → 25 → 25) as the 2-runway capacity saturates — exactly the
  flattening/degrading curve this slice's manual test describes. Deleted the 4
  verification sims by explicit id afterward (batch row 4 itself has no delete
  endpoint — same known gap noted in Slice 5.1 — left as harmless dev-DB cruft).
- Not visually verified in a browser (no browser-automation tool available in
  this environment) — verified via `tsc`/`eslint`, the palette validator, and
  the live API data pipeline above; opening `/batch/4`-style URLs and eyeballing
  the rendered charts is the outstanding manual step.

**Notes**
- This page does not poll — Epic 1's auto-refresh only covers history/detail/
  visualisation. Right after creating a sweep every run is Pending, so the
  results page shows the "must be Complete" warning until the user revisits the
  (bookmarkable, id-based) URL later. Consistent with the app's documented
  polling gap; adding it here was out of scope for this slice.
- Throughput is defined as successful completions per hour
  (`successCount / durationMinutes * 60`), not raw aircraft generated — chosen
  because it's what actually saturates as demand increases.

## 2026-07-29 — Slice 5.2 — Batch-create a sweep

**Slice:** 5.2 — Batch-create a sweep (Epic 5, Parameter sweep / capacity curve)
**Status:** Done (code + tests + live-verified)

**Backend**
- [backend/api/serializers/simulation_sweep_creation_dto.py](backend/api/serializers/simulation_sweep_creation_dto.py)
  (new) — `SimulationSweepCreationDto`: takes the same base-config fields as
  `SimulationCreationDto` plus `variable` (one of `arrivalRatePerHour` /
  `departureRatePerHour` / `durationMinutes` / `maxWaitMinutes` /
  `aircraftSpeedKnots`), `rangeEnd`, `rangeStep`. The base config's own value
  for `variable` is the sweep's start. For each stepped value it builds a full
  run payload and re-validates it through `SimulationCreationDto` independently
  — a value that's fine at the start of a sweep can violate a business rule
  further along (e.g. sweeping `departureRatePerHour` up past what any
  configured runway can accept), so validating the base config once isn't
  enough. Caps at `MAX_SWEEP_RUNS = 50` and requires at least 2 steps. All-or-
  nothing: if any generated step fails validation the whole request 400s with
  no simulations created (validated in a first pass before any DB writes).
  `create()` wraps the whole batch (new `SimulationBatch` + every `Simulation`)
  in one `transaction.atomic()`.
- [backend/api/views/simulation_viewset.py](backend/api/views/simulation_viewset.py)
  — `POST /api/simulations/sweep/`: validates via the DTO above, enqueues
  `run_simulation` for every created simulation, returns
  `{batchId, simulations: [...]}` (each shaped like the list endpoint).
- A supplied `randomSeed` is applied identically to every generated run
  (deliberate: isolates the swept variable as the only thing that changes
  across the sweep, rather than also varying by sampling noise); omitting it
  leaves every run independently random, same as a normal create.

**Frontend**
- [frontend/src/components/RunwaySelectionField.tsx](frontend/src/components/RunwaySelectionField.tsx)
  (new) — extracted the runway-picker table (~230 lines) out of `RequestForm`
  into a shared, prop-driven component (whole-object setters for
  modes/statuses so the bulk "select all" path stays a single merged update,
  matching the original's anti-stale-closure batching) so `SweepForm` doesn't
  duplicate it. [RequestForm.tsx](frontend/src/components/RequestForm.tsx) now
  just calls it.
- [frontend/src/schemas/simulationForm.ts](frontend/src/schemas/simulationForm.ts)
  — extracted `simulationFormBaseSchema` (the raw field shape, pre-`.refine()`)
  so it can be `.extend()`ed; `simulationFormSchema` is now
  `simulationFormBaseSchema.refine(...)...` unchanged. Added `sweepFormSchema`
  (base + `variable`/`rangeEnd`/`rangeStep`, plus range-validity checks
  mirroring the backend's `MAX_SWEEP_RUNS`/minimum-2-steps rules),
  `defaultSweepFormValues`, `toCreateSweepRequest()`. Deliberately does **not**
  re-check the runway-acceptance rules (arrivals/departures need an available
  matching runway) against every swept value client-side — only the backend's
  per-step re-validation is authoritative there; the client would otherwise
  give false confidence checking only the start value.
- [frontend/src/components/SweepForm.tsx](frontend/src/components/SweepForm.tsx) +
  [SweepFormDialog.tsx](frontend/src/components/SweepFormDialog.tsx) (new) —
  same base-config fields as the create form plus a "Sweep Configuration"
  block (variable dropdown, end value, step). On success shows an inline
  summary ("Created N simulation runs sweeping X") listing each generated
  run's name, with a Done button that closes the dialog and refetches history.
- [frontend/src/components/SimulationHistory.tsx](frontend/src/components/SimulationHistory.tsx)
  — added a "Sweep" button (next to Create) opening `SweepFormDialog`.
- [frontend/src/types/simulation.ts](frontend/src/types/simulation.ts) —
  `SweepVariable`, `CreateSweepRequest`, `SweepResponse`.

**Verification**
- [backend/tests/feature/simulation_sweep_test.py](backend/tests/feature/simulation_sweep_test.py)
  (new, 12 tests): N sims created with the variable stepped; all grouped into
  one batch; all enqueued; rejects <2 steps, end-before-start, exceeding
  `MAX_SWEEP_RUNS`, and an unknown variable; a later-step business-rule
  violation rejects the *whole* sweep with zero sims created (atomicity); name
  validation; shared seed applied identically vs. left independently random
  per run; sweeping `durationMinutes` specifically (not just rates). **Full
  suite: 153 passed** (+12). Frontend `tsc -b` + `eslint src` clean.
- Live end-to-end against the real dev DB/queue: `POST /api/simulations/sweep/`
  with `arrivalRatePerHour` 10→30 step 10 created 3 Pending sims in one batch;
  the live dramatiq worker ran all three to `Complete` (confirmed via the
  Slice-4.2 `/compare/` endpoint), then deleted by explicit id afterward.
- Not visually verified in a browser (no browser-automation tool available in
  this environment) — `tsc`/`eslint` plus the live API round-trip are the
  verification for the new dialog/components; the manual "open Sweep, submit,
  see N rows" check is the outstanding manual step.

**Operational notes**
- Restarting `runserver` after this change surfaced another instance of the
  documented autoreload footgun: Django's StatReloader cleanly detected and
  reloaded `simulation_viewset.py` (confirmed in its own log), but the
  *pre-reload* child process didn't actually exit — it just stopped holding
  the port. Not visible via `Get-NetTCPConnection` (which only shows the
  live listener), only via checking the specific PID directly. Killed it
  explicitly. Separately, killing a `runserver` watcher's PID took its actual
  serving child down with it (unlike `rundramatiq`, where the worker's
  `spawn_main` children reliably survive killing the parent) — restarted both
  `runserver` and `rundramatiq` fully clean afterward and reconfirmed zero
  stray processes and zero unexpected Redis connections.
- Frontend (`npm run dev`) was left running rather than restarted — Vite's
  HMR applies component changes live (unlike the backend's manual-restart
  requirement), consistent with how prior frontend-only entries in this log
  have handled it.

## 2026-07-29 — Slice 5.1 — Group runs into a batch

**Slice:** 5.1 — Group runs into a batch (Epic 5, Parameter sweep / capacity curve)
**Status:** Done (code + tests + live-verified)

**Changes**
- [backend/api/models/simulation_batch.py](backend/api/models/simulation_batch.py) (new) —
  `SimulationBatch`: deliberately minimal (just `id` + `created_at`), an identity to hang a
  group of runs off. No sweep-specific fields (swept variable, range) — that metadata belongs
  to whichever of 5.2/5.3 actually creates sweeps, not this grouping primitive.
- [backend/api/models/simulation.py](backend/api/models/simulation.py) — added nullable
  `batch = ForeignKey(SimulationBatch, related_name="simulations", on_delete=SET_NULL)`.
  `SET_NULL` rather than `CASCADE`: deleting a batch grouping shouldn't delete the underlying
  run results, mirroring the "protect the data" precedent set by `Runway`'s `PROTECT` from
  `SimulationRunway`.
- [backend/api/managers/querysets/simulation_queryset.py](backend/api/managers/querysets/simulation_queryset.py)
  — added `SimulationQuerySet.in_batch(batch_id)` (`self.filter(batch_id=batch_id)`).
- Migration `0007_simulationbatch_simulation_batch` (applied to the dev DB).
- No API endpoint or FE change — out of scope for this slice (endpoint comes with 5.2's
  sweep-create; a manual "assign to batch" surface doesn't exist and isn't needed yet).

**Verification**
- [backend/tests/feature/simulation_batch_test.py](backend/tests/feature/simulation_batch_test.py)
  (new, 4 tests): batched sims retrievable as a group via `in_batch()`; the relation is
  reachable from either side (`simulation.batch` / `batch.simulations`); an unbatched sim's
  `batch` is `None`; deleting a batch leaves its simulations intact (`SET_NULL`, not cascaded).
  **Full suite: 141 passed** (+4).
- Live-verified against the real dev DB (not just the test DB): created a batch + 2 sims via
  `manage.py shell` through the freshly-restarted process, confirmed both `batch.simulations`
  and `Simulation.objects.in_batch(id)` returned exactly those two ids, then cleaned up.

**Operational notes**
- Before restarting, found the exact stray-process situation CLAUDE.md warns about: a
  day-old orphaned `dramatiq` `spawn_main` child (parent PID had been recycled by an unrelated
  live `hypercorn` process, so it was invisible to any `*dramatiq*`-filtered listing — only
  the Redis-connection check caught it), a leftover `hypercorn` stack from 2026-07-28, and
  **two separate concurrent `manage.py runserver` invocations** from earlier today. Killed all
  of them (verified via both process-list and `Get-NetTCPConnection -RemoteAddress <redis-ip>`
  down to zero), then started one fresh `runserver` + one fresh `rundramatiq` — and even that
  fresh dramatiq worker's `spawn_main` children survived the parent's `taskkill //F`, exactly
  as documented, and needed killing separately.
- Frontend left untouched — this slice made no frontend changes and the running `npm run dev`
  was already a single clean instance.

## 2026-07-29 — Slice 4.2 — Batched compare endpoint

**Slice:** 4.2 — (Optional) Batched compare endpoint (Epic 4, Run comparison)
**Status:** Done (code + tests; not yet activated live, not yet committed)

**Changes**
- [backend/api/managers/querysets/simulation_queryset.py](backend/api/managers/querysets/simulation_queryset.py)
  — added `SimulationQuerySet.with_detail_for_ids(self, ids)`: `self.with_detail().filter(id__in=ids)`,
  reusing the existing `with_detail()` aggregation/prefetch logic rather than duplicating it.
- [backend/api/views/simulation_viewset.py](backend/api/views/simulation_viewset.py) — added
  `GET /api/simulations/compare/?ids=1,2,3` (a `@action(detail=False, ...)`, router name
  `simulation-compare`). Parses the comma-separated `ids` query param, dedupes while preserving
  request order (`dict.fromkeys`), 400s with `{"detail": ...}` if `ids` is missing or contains a
  non-integer, silently drops unknown ids, and returns a bare JSON array (one `SimulationDetailDto`
  block per found id, in requested order — no new serializer needed, reuses `SimulationDetailDto`
  with `many=True`).

**Verification**
- [backend/tests/feature/simulation_compare_test.py](backend/tests/feature/simulation_compare_test.py)
  (new, 6 tests): one metrics block per id; requested order preserved; unknown ids silently
  omitted; repeated ids deduped; missing `ids` param → 400; non-integer id → 400.
  **Full suite: 137 passed.**
- Not restarted/live-verified against a running hypercorn — verified via the DRF `APIClient`
  feature tests only.

**Notes**
- The frontend (Slice 4.1) does **not** call this endpoint yet — it fetches each run individually
  via the existing per-run `/detail/` endpoint (matches 4.1's spec literally). This batched
  endpoint exists as a follow-up optimisation the compare view could switch to later to cut N
  requests down to 1.
- These backend changes (viewset + queryset + new test file) are uncommitted in the working tree
  as of this entry; Slice 4.1's frontend changes are already committed (`92564a0`).

## 2026-07-29 — Slice 4.1 — Compare two or more completed runs

**Slice:** 4.1 — Compare two or more completed runs (Epic 4, Run comparison)
**Status:** Done (code + tsc/eslint clean; committed)

**Changes**
- [frontend/src/App.tsx](frontend/src/App.tsx) — added route `/compare` → `CompareRuns`.
- [frontend/src/components/CompareRuns.tsx](frontend/src/components/CompareRuns.tsx) (new) —
  reads run ids from the `ids` query param (`?ids=1,2,3`); fetches each run individually via the
  existing `GET /api/simulations/{id}/detail/` endpoint in parallel (`useCompareDetails`);
  requires ≥2 ids and ≥2 `Complete` runs, warning about any excluded/incomplete ones; renders
  `CompareMetricsTable` behind a category dropdown (General Stats / Arrival Metrics / Departure
  Metrics / Runways / Sim Variables).
- [frontend/src/components/CompareMetricsTable.tsx](frontend/src/components/CompareMetricsTable.tsx)
  (new) — generic metric-rows × runs-columns table; highlights the best (green, up-arrow) /
  worst (red, down-arrow) / tied (equals icon) value per row for rows that declare
  `better: 'higher' | 'lower'` — the "deltas highlighted" part of the spec.
- [frontend/src/components/SimulationHistory.tsx](frontend/src/components/SimulationHistory.tsx)
  — added a "Compare runs" toggle (`compareMode`, `faCodeCompare` icon); in compare mode, clicking
  a `Complete` row toggles it into `compareIds` (non-Complete rows dim to indicate they can't be
  picked); a "Compare selected" button (enabled once ≥2 are selected) navigates to
  `/compare?ids=...`.
- No changes needed in `src/types/metrics.ts` — the existing `SimulationDetail` /
  `SimulationDetailResponse` / `isDetailComplete` types were reused as-is.

**Verification**
- `npx tsc -b` and `npx eslint .` both clean.
- **Test (manual, per slice spec — not yet performed this session):** run the same scenario with
  1 vs 2 runways and confirm the compare view shows both with wait/diversion differences
  highlighted.

**Notes**
- Composes with Slice 5.3 (chart building blocks) and pairs with Slice 4.2's batched endpoint as
  a future optimisation (currently unused by this view).
- Committed as `92564a0` — "Front end changes to allow for comparing between different
  simulation."

## 2026-07-28 — Slice 2.4 — Cancel a Pending/Running simulation

**Slice:** 2.4 — Cancel a Pending/Running simulation (Epic 2, Simulation management)
**Status:** Done (code + tests + live-verified)

**Model / migration**
- [backend/api/models/simulation.py](backend/api/models/simulation.py) — added a `Cancelled`
  status, a `TERMINAL_STATUSES` tuple, and a `cancel_requested` boolean. The flag is kept
  separate from `status` on purpose: the web process (cancel endpoint) owns `cancel_requested`,
  the worker owns `status`, so the two processes never race on one column.
- Migration `0006_simulation_cancel_requested_alter_simulation_status` (applied to the dev DB).

**Engine**
- [backend/api/simulation/simulation_runner.py](backend/api/simulation/simulation_runner.py) —
  new `SimulationCancelled` exception + a `_cancellation_watchdog` SimPy process that every
  `CANCELLATION_POLL_MINUTES` (5, new in constants) re-reads `cancel_requested` from the DB and
  raises to unwind `env.run()` at a step boundary (a safe point — no aircraft mid-operation).
  `run()` now (a) skips a run whose status is already terminal (a Pending run the endpoint
  moved straight to Cancelled), and (b) catches `SimulationCancelled` → status Cancelled
  (distinct from the Error path). Stragglers are left Pending — a cancelled run intentionally
  has no full result set.

**API**
- [backend/api/views/simulation_viewset.py](backend/api/views/simulation_viewset.py) —
  `POST /api/simulations/{id}/cancel/`: 409 if already terminal; a Pending run is marked
  Cancelled immediately (with a WS publish); a Running run just gets `cancel_requested=True`
  and the runner's watchdog finishes the transition.

**Frontend**
- `SimulationStatus` gained `Cancelled` ([types/simulation.ts](frontend/src/types/simulation.ts));
  the visualisation wire type now reuses `SimulationStatus`
  ([types/visualisation.ts](frontend/src/types/visualisation.ts)).
- [SimulationHistory.tsx](frontend/src/components/SimulationHistory.tsx) — a cancel (ban) button
  on Pending/Running rows opens a confirm dialog, POSTs cancel, and refetches; Cancelled renders
  as a grey `secondary` tag.
- [MetricBasePage.tsx](frontend/src/components/MetricBasePage.tsx) +
  [SimulationVisualisation.tsx](frontend/src/components/SimulationVisualisation.tsx) — **`isRunning`
  now means Pending/Running only** (previously "anything not Complete/Error"), so a Cancelled run
  no longer polls forever; both show a "was cancelled — no metrics/replay" message with no
  refresh button.

**Verification**
- [simulation_cancel_test.py](backend/tests/feature/simulation_cancel_test.py) (8 tests): endpoint
  (Pending→Cancelled now; Running→flag-only; 409 when terminal; 404); runner (mid-run cancel ends
  Cancelled with unresolved Pending aircraft — "no full result set"; already-Cancelled run is
  skipped, never started; a normal run still Completes untouched by the watchdog). **Full suite:
  131 passed** (+8). Frontend `tsc -b` + full `eslint` clean.
- Applied the migration and restarted **both** worker (engine watchdog) and hypercorn (API/model),
  confirming zero Redis-orphans and a single instance of each. Live: a big run cancelled while
  genuinely `Running` ended `Cancelled` (watchdog path); an immediate cancel also ended
  `Cancelled`; re-cancel → 409. Test sims deleted afterward.

**Notes**
- The mid-run cancel latency is bounded by `CANCELLATION_POLL_MINUTES` in sim-time (≈ sub-second
  wall-clock for typical runs); tune the constant if a run needs snappier cancellation.

## 2026-07-28 — Slice 2.3 — Clone config into a new run

**Slice:** 2.3 — Clone config into a new run (Epic 2, Simulation management)
**Status:** Done (code + tests + live-verified)

**Backend changes**
- [backend/api/serializers/runway_initial_status.py](backend/api/serializers/runway_initial_status.py)
  (new) — extracted the "initial (as-configured) operational status" logic (previously a
  private method on the detail DTO) into a shared `initial_operational_status()` helper.
- [backend/api/serializers/simulation_detail_dto.py](backend/api/serializers/simulation_detail_dto.py)
  — now calls the shared helper (behaviour unchanged; detail tests still green).
- [backend/api/serializers/simulation_config_dto.py](backend/api/serializers/simulation_config_dto.py)
  (new) — `SimulationConfigDto`, shaped to match `SimulationCreationDto` input: rates,
  duration, max-wait, aircraft speed, closures, seed, and `runways` (each with `runwayId`,
  `operatingMode`, and the *initial* `operationalStatus`) — so its output round-trips
  straight back into create.
- [backend/api/views/simulation_viewset.py](backend/api/views/simulation_viewset.py) — added
  `GET /api/simulations/{id}/config/` (prefetches `simulation_runways__closure_events`).

**Frontend changes**
- [frontend/src/types/simulation.ts](frontend/src/types/simulation.ts) — `SimulationConfig` type.
- [frontend/src/schemas/simulationForm.ts](frontend/src/schemas/simulationForm.ts) — added
  `configToFormValues()` (maps a fetched config to create-form values; drops `aircraftSpeedKnots`,
  which isn't a form field — the form defers to the server default).
- [frontend/src/components/RequestForm.tsx](frontend/src/components/RequestForm.tsx) — accepts an
  optional `initialValues` prop and `reset()`s when it changes.
- [frontend/src/components/SimulationFormDialog.tsx](frontend/src/components/SimulationFormDialog.tsx)
  — passes `initialValues` through; header is "Duplicate Simulation" when pre-filled, else "Create
  Simulation".
- [frontend/src/components/SimulationHistory.tsx](frontend/src/components/SimulationHistory.tsx) — a
  copy button per row fetches `/config`, pre-fills the dialog, and opens it for the user to tweak &
  submit (creating a new run). Right-column actions are now [duplicate · rename · view]; the
  Create button opens a blank form. Fetch errors surface as a `Message`.

**Verification**
- [simulation_config_test.py](backend/tests/feature/simulation_config_test.py) (4 tests): config
  exposes all create fields; **config output re-POSTs into an identical run** (the round-trip
  guarantee); reports initial status, not an end-of-run trailing closure; unknown id → 404.
  **Full suite: 123 passed** (+4). Frontend `tsc -b` + `eslint` clean.
- Restarted **hypercorn** (new endpoint, no autoreload); verified live: created a run with
  closures + a started-closed runway + seed, `GET /config` returned the full config, re-POSTed it
  verbatim → a new run with an identical config. Both test runs deleted by explicit id.

**Notes**
- Composes with Slice 3.2: the config includes `randomSeed`, so a duplicate pre-fills the seed too
  (the user can clear it in the form for fresh randomness).
- A form-based duplicate can't reproduce a non-default `aircraftSpeedKnots` (the create form has no
  speed field); the config *DTO* does round-trip it, so an API-level clone preserves it.

## 2026-07-28 — Slice 2.2 — Rename a simulation

**Slice:** 2.2 — Rename a simulation (Epic 2, Simulation management)
**Status:** Done (code + tests + live-verified)

**Backend changes**
- [backend/api/serializers/simulation_rename_dto.py](backend/api/serializers/simulation_rename_dto.py)
  (new) — `SimulationRenameDto` exposes only `name` (+ read-only `id`) so a PATCH can't
  silently change rates/runways/status. Reuses the creation DTO's `NAME_PATTERN`; also
  `.strip()`s and rejects blank.
- [backend/api/views/simulation_viewset.py](backend/api/views/simulation_viewset.py) — added
  `mixins.UpdateModelMixin`, routed `update`/`partial_update` to the rename DTO, and set
  `http_method_names` to exclude **PUT** (full replace → 405); a run's config is immutable
  after create, so only PATCH-rename is allowed.

**Frontend changes**
- [frontend/src/schemas/simulationForm.ts](frontend/src/schemas/simulationForm.ts) — extracted
  `SIMULATION_NAME_REGEX`/`SIMULATION_NAME_MAX`/`validateSimulationName()` and refactored the
  create form's `name` field to use them, so the create form and rename dialog validate
  identically.
- [frontend/src/components/SimulationHistory.tsx](frontend/src/components/SimulationHistory.tsx)
  — a pencil button in the right-hand actions column (beside the view chevron) opens a
  "Rename simulation" `Dialog` with a pre-filled `InputText`. Save is disabled while the name
  is invalid or unchanged; Enter submits; validates client-side (same rule as the backend) and
  surfaces server errors. On success it PATCHes via `apiClient` and refetches. Current row
  layout: trash (far-left column, from Slice 2.1's trial) · Name · … · Status · [rename +
  view] (right column).

**Verification**
- [simulation_rename_test.py](backend/tests/feature/simulation_rename_test.py) (8 tests):
  PATCH updates name; trims whitespace; rejects invalid chars and blank; allows basic
  punctuation; ignores other config fields (rates/duration/status unchanged); PUT → 405;
  unknown id → 404. **Full suite: 119 passed** (+8).
- Frontend `tsc -b` + `eslint` clean.
- Restarted **hypercorn** (web-layer change, no autoreload); verified live: PATCH → 200 with
  the name trimmed, emoji → 400, PUT → 405. Test sim deleted by explicit id afterward.

**Notes**
- Same `reverse("simulation-detail")` collision as Slice 2.1 — PATCH targets the path
  `/api/simulations/{id}/` directly in tests (the name resolves to the metrics action).

## 2026-07-28 — Slice 2.1 — Delete a simulation

**Slice:** 2.1 — Delete a simulation (Epic 2, Simulation management)
**Status:** Done (code + tests + live-verified)

**Backend changes**
- [backend/api/views/simulation_viewset.py](backend/api/views/simulation_viewset.py) — added
  `mixins.DestroyModelMixin`, so `DELETE /api/simulations/{id}/` returns 204. No custom logic
  needed: the FK graph already cascades — `Aircraft`→`Simulation` CASCADE (→ `AircraftEvent`
  CASCADE), `SimulationRunway`→`Simulation` CASCADE (→ `SimulationRunwayEvent` CASCADE). The
  master `Runway` is `PROTECT` from `SimulationRunway`, but the join row is deleted first so
  the master survives. Deleting a Pending/Running sim is safe: `SimulationRunner.run()`
  already handles a missing row (logs + returns, no retry), and `save(update_fields=...)` on
  a deleted row is a 0-row no-op.

**Frontend changes**
- [frontend/src/components/SimulationHistory.tsx](frontend/src/components/SimulationHistory.tsx)
  — a red trash button in the actions column opens a confirm `Dialog` ("Delete <name> and all
  of its results? This cannot be undone."). On confirm it `DELETE`s via the shared `apiClient`
  and refetches; if it was the last row on a page past the first, it steps back a page instead.
  Errors keep the dialog open with a `Message`. Row click still navigates to detail; the trash
  and chevron buttons `stopPropagation`.

**Verification**
- [simulation_delete_test.py](backend/tests/feature/simulation_delete_test.py) (5 tests):
  204 + row gone; cascade to aircraft/events/runways/runway-events; master runway survives;
  only the target is removed; unknown id → 404. **Full suite: 111 passed** (+5).
- Frontend `tsc -b` + `eslint` clean.
- Restarted **hypercorn** (web-layer change, no autoreload) — verified live end-to-end:
  create → 201, `DELETE /api/simulations/{id}/` → 204, subsequent `GET …/detail/` → 404.
  Frontend is HMR (no restart); dramatiq worker untouched (no engine change).

**Notes**
- ⚠️ Route-name collision worth knowing: `reverse("simulation-detail")` resolves to the
  custom metrics action `/{pk}/detail/`, **not** the destroy route `/{pk}/`, because the
  `@action(url_name="detail")` shares the router's `simulation-detail` name. The paths are
  distinct so routing/`apiClient` work fine; only `reverse()`-by-name is ambiguous. Tests hit
  the destroy path directly.
- DB cleanup using the new endpoint: removed my own diagnostic sims 95/96/97 (Slice 3.2) and
  105 (this turn). ⚠️ During an initial overzealous cleanup I searched `?search=smoke` and one
  DELETE landed before I caught it — **sim id 1 (a `*smoke*`-named artifact) was deleted**.
  The other matches errored out (000/never committed) and survive; the remaining
  earlier-session `*-smoke-test` sims (7, 8, 11, 14, 16) were intentionally left untouched.
  Lesson: delete by explicit id, not a substring sweep.

## 2026-07-28 — Fix: pages could stop auto-refreshing when the websocket was "connected"

**Slice:** n/a (Epic 1 / Slice 1.4 robustness fix)
**Status:** Done

**Symptom (reported):** sometimes a page stops polling — assumed to be because the
websocket connected — but then never updates until a manual refresh.

**Root cause:** all three live pages gated polling on `isRunning && !connected`, i.e. push
*replaced* polling entirely once the socket reported connected. But a terminal status
message can be missed, and nothing then refreshes:
- **Subscribe-after-publish race:** the page fetches `Running`, opens the socket, but the
  `Complete`/`Error` transition is published before the client finishes joining the Channels
  group. Groups don't replay, so that frame is lost — and with polling suppressed, the page
  sits stale. Runs finish in ~10s, so this connect window is proportionally large.
- **Half-open socket:** if TCP drops without a close frame, `onclose` doesn't fire for a
  long time, so `connected` stays `true` and polling stays off.

**Fix (frontend only)**
- [frontend/src/functions/socket.ts](frontend/src/functions/socket.ts) — `useSimulationSocket`
  gained an `onOpen` callback that fires on every (re)connect; callers pass `refetch` so the
  page **resyncs immediately on connect**, catching anything published during the connect
  window.
- [frontend/src/functions/axios.ts](frontend/src/functions/axios.ts) — added
  `SAFETY_POLL_INTERVAL_MS = 15000`.
- [MetricBasePage.tsx](frontend/src/components/MetricBasePage.tsx),
  [SimulationVisualisation.tsx](frontend/src/components/SimulationVisualisation.tsx),
  [SimulationHistory.tsx](frontend/src/components/SimulationHistory.tsx) — poll is no longer
  disabled by `connected`. Now: `usePollWhile(isRunning, refetch, connected ?
  SAFETY_POLL_INTERVAL_MS : POLL_INTERVAL_MS)` — always poll while a run is in flight, fast
  (4s) when push is down, slow (15s) as a safety net when it's up. Each also passes `refetch`
  as `onOpen`.

**Net behaviour:** push still delivers instant updates in the normal case; the connect-window
race is closed by refetch-on-open; and any missed/half-open push is caught by the ≤15s safety
poll — so a page always self-refreshes to the terminal state without a manual refresh.

**Verification**
- `tsc -b` + `eslint` clean on all changed files. Vite (:3000) serving (HTTP 200) — HMR
  applies it; no backend restart needed (frontend-only).
- Not browser-automation-tested (no FE test runner); reasoned through each failure mode above.

**Notes / follow-up**
- The visualisation page's safety poll refetches the full aircraft array (~thousands of rows)
  every 15s while `Running` — harmless (ignored until `Complete`, runs are short) but a
  lightweight status-only endpoint would remove even that; candidate follow-up (also noted
  under Slice 1.3).

## 2026-07-28 — Slices 3.1 + 3.2 activated in the dev environment

**Status:** Done — seed + re-run now live in dev.

**Symptom reported:** a set seed showed as "Random" on the detail page and no re-run
button appeared.

**Diagnosis:** not a code bug — stale server/worker processes. The running **hypercorn**
(:8000, started 11:35, no autoreload) predated this session's detail-DTO edit, so
`GET /api/simulations/{id}/detail/` returned **no `randomSeed` key** → the frontend read it
as undefined → "Random" + button hidden. Confirmed live: created a seeded sim, detail
response was missing `randomSeed`. The dramatiq worker (started 10:39) was likewise on
pre-fix engine code.

**What changed operationally**
- Killed the old hypercorn tree and dramatiq worker tree (incl. their `multiprocessing`
  children), then confirmed **zero** processes connected to the Redis broker
  (10.11.90.45:6379) and port 8000 free — no surviving orphans.
- Started exactly one fresh **hypercorn** (`backend.asgi:application` on :8000) and one fresh
  **`manage.py rundramatiq`** worker as tracked background tasks. Verified via the precise
  `hypercorn.exe`/`dramatiq.exe` process list that there is exactly one of each (a couple of
  transient shell wrappers from a failed task attempt appeared briefly and exited; no
  duplicate servers/workers remain).

**Live verification (real worker → Redis → hypercorn)**
- `GET /api/simulations/95/detail/` (seed persisted earlier under the old server) now returns
  `randomSeed: 777001` and each `runwayStats[]` carries `initialOperationalStatus`.
- Full re-run loop end-to-end: created a seeded run (seed 424242, closures on, one runway
  starting SnowClearance), rebuilt the config from its detail response (mirroring
  `detailToRerunRequest`, using `initialOperationalStatus`), re-ran → **identical**
  `outcomeCounts` (15/47/58/0/120), `successRate` (12.5), and `closureEventCount` (7). This
  exercises the fresh worker's closure-determinism fix through the real queue.

**Notes**
- Frontend (vite :3000, HMR) already had the new code; with the backend now returning
  `randomSeed`, the detail page shows the seed and the re-run button. A hard refresh clears
  any stale bundle if needed.
- Left diagnostic sims in the dev DB: ids 95, 96, 97 (no delete endpoint until Slice 2.1).
- hypercorn here runs **without autoreload** — future backend changes still need a manual
  hypercorn + worker restart to take effect (same discipline as always).

## 2026-07-28 — Slice 3.2 — Surface seed + "re-run with same seed"

**Slice:** 3.2 — Surface seed + re-run with same seed (Epic 3, Reproducibility)
**Status:** Done (code complete + verified via tests; live activation note below)
**Note:** Slice 2.3 (generic clone) isn't built yet, so this ships a self-contained
re-run rather than composing with it.

**Engine bug fixed (the important part)**
- [backend/api/simulation/simulation_runway_wrapper.py](backend/api/simulation/simulation_runway_wrapper.py)
  — `_queued_processes` was a plain `set()`. `close()` iterates it to interrupt the
  aircraft still queued for a closing runway, and **set iteration over process objects is
  id()/hash-ordered — nondeterministic between runs.** That order decides which interrupted
  aircraft re-requests (and re-wins) the runway first, so *same seed + closures produced
  different outcomes every run* — silently defeating Epic 3's whole premise for
  closure-enabled runs. Switched to an insertion-ordered dict-as-ordered-set
  (`{}` + `[process] = None` / `.pop(process, None)`); `close()`'s `list(...)`/`.clear()`
  are unchanged. Registration order is driven by SimPy scheduling, which is deterministic
  under a fixed seed, so interruption order is now deterministic too.

**Backend changes**
- [backend/api/serializers/simulation_detail_dto.py](backend/api/serializers/simulation_detail_dto.py)
  — added `random_seed` to the detail fields; added `_initial_operational_status()` +
  exposed it per runway as `initial_operational_status`. `operational_status` on the row is
  mutated by closures during the run (a trailing, never-reopened closure leaves a
  started-Available runway reading back as closed), so the mutated value can't be used to
  reproduce the start config. A runway started closed gets a CLOSED event stamped exactly at
  `started_at` and is never toggled, so it's distinguishable: initial = its stored status if
  it has a start-closure event, else Available.
- [backend/api/serializers/simulation_runway_detail_dto.py](backend/api/serializers/simulation_runway_detail_dto.py)
  — added the `initial_operational_status` field.

**Frontend changes**
- [frontend/src/types/metrics.ts](frontend/src/types/metrics.ts) — `SimulationDetail.randomSeed`
  and `RunwayStat.initialOperationalStatus`.
- [frontend/src/components/MetricsSimVariables.tsx](frontend/src/components/MetricsSimVariables.tsx)
  — shows "Random Seed" (the number, or "Random" when null).
- [frontend/src/schemas/simulationForm.ts](frontend/src/schemas/simulationForm.ts) — added
  `detailToRerunRequest(detail)`: rebuilds a create request from the run's config with the
  fixed seed and each runway's *initial* status; name gets a " (re-run)" suffix (kept ≤120).
- [frontend/src/components/MetricBasePage.tsx](frontend/src/components/MetricBasePage.tsx) —
  a "Re-run" button in the completed-detail header (shown only when `randomSeed != null`)
  POSTs the reconstructed config and navigates to the new run's detail page.

**Verification**
- [seed_reproducibility_test.py](backend/tests/simulation/seed_reproducibility_test.py):
  added `test_same_seed_reproduces_identical_closures` — same seed + closures now reproduces
  identical aircraft outcomes *and* the closure timeline (this test failed before the wrapper
  fix, passes after).
- [simulation_detail_test.py](backend/tests/feature/simulation_detail_test.py): detail
  exposes `randomSeed`; `initialOperationalStatus` ignores a trailing run closure (reports
  Available) and reports a start closure's configured status.
- [simulation_rerun_test.py](backend/tests/feature/simulation_rerun_test.py): full API loop —
  create+run (closures on, one runway started SnowClearance, fixed seed) → read detail →
  rebuild config from the detail (mirroring `detailToRerunRequest`) → re-run → **identical
  outcomeCounts / successRate / closureEventCount**. This is the slice's "metrics identical"
  test, server-side.
- **Full suite: 106 passed** (was 99 after 3.1; +7). Frontend `tsc -b` + full `eslint src` clean.

**Notes**
- The engine fix means the **dramatiq worker must be restarted** to serve the corrected
  closure behaviour; the detail-DTO change needs a web-server restart. Not activated here —
  no airport web server was running, and a stray old `rundramatiq` wrapper is still up on
  pre-fix code (the CLAUDE.md footgun). Verified via pytest against the current code instead.
- Re-run is offered only when the source run has a fixed seed (otherwise "same seed" is
  meaningless); a generic seedless clone is Slice 2.3.

## 2026-07-28 — Slice 3.1 — Accept an optional seed on create

**Slice:** 3.1 — Accept an optional seed on create (Epic 3, Reproducibility)
**Status:** Done (code complete + verified via tests; live activation note below)

**Backend changes**
- [backend/api/serializers/simulation_creation_dto.py](backend/api/serializers/simulation_creation_dto.py)
  — `random_seed` was already listed in the DTO's `fields` (so it was technically accepted),
  but with no explicit validation. Added an explicit `IntegerField` declaration:
  `required=False, allow_null=True, min_value=0, max_value=2147483647`. The lower bound
  guards against numpy's `default_rng` raising on a negative seed (which would mark the run
  `Error` mid-execution); the upper bound matches the model's signed-32-bit `IntegerField`.
  The engine already seeds from `simulation.random_seed` in both
  `aircraft_data_generator.py` and `simulation_runner.py`, so no engine change was needed.

**Frontend changes**
- [frontend/src/types/simulation.ts](frontend/src/types/simulation.ts) — added optional
  `randomSeed?: number` to `CreateSimulationRequest`.
- [frontend/src/schemas/simulationForm.ts](frontend/src/schemas/simulationForm.ts) — added a
  nullable `randomSeed` field (int, 0…2147483647) with default `null`; `toCreateSimulationRequest`
  omits the key entirely when blank so the backend treats it as "no seed" (random).
- [frontend/src/components/RequestForm.tsx](frontend/src/components/RequestForm.tsx) — added an
  optional "Random Seed" `InputNumber` (blank = random) beside the closures selector; widened
  the top grid to `[2fr_1fr_1fr]` to fit it on one row.

**Verification**
- New engine test [seed_reproducibility_test.py](backend/tests/simulation/seed_reproducibility_test.py):
  same seed + identical config → byte-identical per-aircraft outcome fingerprint (callsign,
  operator, origin/destination, movement, outcome, was_success); different seeds → different.
- New feature tests in [simulation_creation_test.py](backend/tests/feature/simulation_creation_test.py):
  create endpoint accepts + persists `randomSeed`, defaults it to null when omitted, and rejects
  a negative seed with 400. **Full suite: 99 passed** (was 94; +5).
- Frontend `tsc -b` + `eslint` clean.

**Notes**
- Ran pytest via `backend/venv/Scripts/python.exe` — the venv has `channels` (from Slice 1.4);
  the bare system `python` does not, so `django.setup()` fails there.
- The create *response* is serialised with `SimulationListDto`, which does not echo the seed
  back — surfacing the seed on the detail page is Slice 3.2, so the feature tests assert
  persistence via the DB rather than the response body.
- Not activated in a live stack: no airport web server was running at implementation time
  (only a stray `dramatiq` wrapper; the `vite preview :4173` processes belong to a different
  project). The DTO change is served by the web process, so a hypercorn/runserver restart is
  needed to exercise it against a live request — verified via the DRF `APIClient` feature test
  instead.

## 2026-07-28 — Runway Info: dot colour by open-time + closure-reason icons

**Slice:** n/a (ad-hoc UI request)
**Status:** Done

**Changes**
- [frontend/src/components/MetricsRunwayInfo.tsx](frontend/src/components/MetricsRunwayInfo.tsx)
  - Status dot colour now keyed off the open-time %: `0%` → red, `100%` → green,
    anything in between → yellow (`dotColorFor`; gray fallback if % is unavailable).
    Dot tooltip describes the open state.
  - Icon: a fully-closed runway (0% open) shows *why* it's down instead of its operating
    mode — Runway Inspection → magnifying glass, Snow Clearance → snowflake, Equipment
    Failure → screwdriver-wrench (`CLOSURE_REASON_ICON`, keyed off `operationalStatus`);
    open runways keep the arrival/departure/mixed icon. Icon tooltip names the reason.

**Verification**
- Confirmed the three Font Awesome icon names exist in the installed package before import.
- `tsc -b` + `eslint` clean.
- Live screenshots: a sim with one Available runway + one of each closed reason showed
  100%→green+mixed, and 0%→red with magnifying-glass / snowflake / screwdriver-wrench
  respectively; a separate 85% runway showed yellow+mixed.

**Notes**
- Frontend-only; Vite HMR applied it. Backend already supplies `openMinutes` +
  `operationalStatus`.

## 2026-07-28 — Runway Info: percentage = open time / simulation duration

**Slice:** n/a (ad-hoc request)
**Status:** Done

**Changes**
- [backend/api/serializers/simulation_detail_dto.py](backend/api/serializers/simulation_detail_dto.py)
  — added `_open_minutes()`: duration minus the sum of closed intervals, derived by pairing
  `Closed`/`Reopened` events (a trailing `Closed` with no reopen counts to the end), each
  interval clamped to the `[0, duration]` window so post-duration engine-tail closures don't
  count; degrades to fully-open when `started_at` is missing. Exposed via
  [simulation_runway_detail_dto.py](backend/api/serializers/simulation_runway_detail_dto.py)
  as `open_minutes`.
- [frontend/src/types/metrics.ts](frontend/src/types/metrics.ts) — `RunwayStat.openMinutes`.
- [frontend/src/components/MetricsRunwayInfo.tsx](frontend/src/components/MetricsRunwayInfo.tsx)
  — replaced the per-runway *success rate* with `round(openMinutes / durationMinutes × 100)`.

**Verification**
- New test `test_runway_open_minutes_reflects_closures` (no-closures=100%, a closed window,
  a trailing never-reopened closure); **full suite 94 passed**. Frontend `tsc`/`eslint` clean.
- Live: a run with closures returned 85% (available, 22 closures) and 0% (started under
  SnowClearance) — confirmed in the API response and the rendered UI (screenshot).

**Notes**
- Web-layer (serializer) change → restarted **hypercorn** only (it serves the changed
  serializer and has no autoreload). The dramatiq worker never serialises detail responses,
  so it was intentionally left running.

## 2026-07-28 — Themed the Pending/Running/Error status screens

**Slice:** n/a (ad-hoc UI request)
**Status:** Done

**Changes**
- [frontend/src/components/MetricBasePage.tsx](frontend/src/components/MetricBasePage.tsx)
  and [frontend/src/components/SimulationVisualisation.tsx](frontend/src/components/SimulationVisualisation.tsx)
  — the not-complete (Pending/Running/Error) branches now use the same shell as every other
  screen: full-bleed background image + bordered white card (matching `LoadingScreen` and the
  completed pages), with the "Airport Simulation" title, a back button, and the status
  message/refresh button centred. Added a back button to the visualisation not-complete state
  (it previously had none).

**Verification**
- `tsc -b` + `eslint` clean; headless screenshot confirmed the themed white-card-over-
  background render for a Running sim.
- A follow-up report that it "still looked off" was diagnosed as a **stale browser bundle**,
  not a code issue: proved `:3000` serves the themed code (screenshot + the vite-served module
  contains the new markup), and there's no service worker or stale `dist/` — so a hard refresh
  / incognito load resolves it.

**Notes**
- Frontend-only; Vite HMR applied it. The rare network "failed to load" error branch was left
  un-themed (out of scope of the request).

## 2026-07-28 — Slice 1.4 activated in the dev environment

**Status:** Done — live push now active in dev.

**What changed operationally**
- Cleanly stopped the old dev backend: killed the `runserver` tree and the `dramatiq`
  worker tree, then confirmed **zero** processes still connected to the Redis broker
  (no surviving `spawn_main` orphans — the CLAUDE.md footgun) and port 8000 free.
- Started fresh, tracked background processes:
  - dramatiq worker (`manage.py rundramatiq`) — now on the publish code.
  - **`hypercorn backend.asgi:application --bind 0.0.0.0:8000`** in place of `runserver`
    (serves REST **and** websockets on :8000; daphne is proxy-blocked here — see prior entry).
  - `npm run dev` (vite on :3000) restarted; tsc reports 0 errors.
- Final check: exactly one of each (worker / hypercorn / vite); no stray `runserver`.

**Live verification (real worker → Redis → hypercorn → browser-shaped client)**
- REST over hypercorn: `GET /api/runways/` → 200.
- Created a real simulation via the API with a WS client on the global feed
  (`ws://localhost:8000/ws/simulations/`, Origin `http://localhost:3000`): client received
  `{"id":83,"status":"Running"}` then `{"id":83,"status":"Complete"}` — the fresh worker's
  real transitions, pushed end-to-end. Frontend `VITE_API_BASE_URL=http://localhost:8000`,
  so the browser resolves the same ws:// URL.

**⚠️ Operational notes for future sessions**
- The backend is now served by **hypercorn, not `runserver`**. hypercorn here runs
  **without autoreload**, so backend code changes require a manual hypercorn restart
  (kill the `backend.asgi:application` master+worker, relaunch) — same discipline the
  worker always needed. hypercorn also doesn't serve Django static files, so `/admin/`
  loses styling (JSON API unaffected).
- To revert to the documented `runserver` workflow, install `daphne` (needs an
  unrestricted network) — with daphne present, `manage.py runserver` serves ASGI/websockets
  itself and no separate server is needed.
- Test sims left in the dev DB from verification: ids 79–83 (no delete endpoint until
  Slice 2.1).

## 2026-07-28 — Slice 1.4 — Websocket push (with polling fallback)

**Slice:** 1.4 — Websocket push instead of polling (Epic 1, Live status updates)
**Status:** Done (code complete + verified in isolation; see activation note)
**Decision:** Kept polling as a fallback (user choice) rather than removing it — the
pages use push when the socket is connected and fall back to `usePollWhile` when it isn't.

**Backend changes**
- `requirements.txt` — added `channels==4.2.0`, `channels-redis==4.2.1`, `daphne==4.1.2`.
- [backend/backend/settings.py](backend/backend/settings.py) — added `channels` to
  INSTALLED_APPS + a guarded `daphne` insert (skipped if not importable, so a missing
  ASGI-server dep never breaks the WSGI dev server / tests); `ASGI_APPLICATION`; and
  `CHANNEL_LAYERS` (RedisChannelLayer via `CHANNEL_LAYER_URL`, default = `QUEUE_URL`).
- [backend/backend/asgi.py](backend/backend/asgi.py) — `ProtocolTypeRouter`: http → Django,
  websocket → `AllowedHostsOriginValidator(URLRouter(...))`.
- [backend/api/notifications.py](backend/api/notifications.py) — group helpers +
  best-effort `publish_simulation_status(id, status)` (never raises into a run).
- [backend/api/consumers.py](backend/api/consumers.py) — `SimulationStatusConsumer`
  (global group for the list, per-sim group for detail/visualisation; push-only, forwards
  `{id, status}`).
- [backend/api/routing.py](backend/api/routing.py) — `ws/simulations/` + `ws/simulations/<id>/`.
- [backend/api/simulation/simulation_runner.py](backend/api/simulation/simulation_runner.py)
  — publishes on each transition (Running / Complete / Error).
- [backend/tests/settings_test.py](backend/tests/settings_test.py) — in-memory channel layer
  for tests (no Redis/ASGI server needed). `.env.example` documents `CHANNEL_LAYER_URL`.

**Frontend changes**
- [frontend/src/functions/socket.ts](frontend/src/functions/socket.ts) — `useSimulationSocket(path, onMessage)`:
  opens a ws(s):// socket (derived from `VITE_API_BASE_URL`), reconnects with a 5s backoff,
  resets `connected=false` on every (re)subscribe so polling covers the connect window.
- 3 views wired: history → global feed while runs active; detail/visualisation → per-sim
  feed while running. Each gates polling on `… && !connected`, so push replaces polling
  when live and polling resumes when the socket is down.

**Verification**
- Backend: full suite green — `93 passed` (4 new in
  [simulation_status_notifications_test.py](backend/tests/feature/simulation_status_notifications_test.py)):
  runner emits Running→Complete and Running→Error; channel layer delivers to a subscribed
  group; consumer forwards `{id,status}` (driven via asgiref `ApplicationCommunicator` —
  `channels.testing` can't be imported without daphne).
- Frontend: `tsc -b` + `eslint` clean.
- Live, cross-process, against the real Redis broker (10.11.90.45), without touching the
  running dev stack:
  1. two separate Python processes — publisher's `publish_simulation_status` reached a
     subscriber via `channels_redis` (proves the real layer works cross-process — what the
     in-memory test can't).
  2. ASGI app booted under `hypercorn` on :8001 and served HTTP 200.
  3. full round-trip: a Node `WebSocket` client (Origin `http://localhost:3000`, accepted by
     `AllowedHostsOriginValidator`) → hypercorn → consumer received `{"id":…,"status":"Running"}`
     then `Complete` from a separate publisher process — exactly the frontend's message shape.
  Scratch hypercorn (:8001) killed afterwards; port confirmed free.

**Notes / activation**
- ⚠️ Corporate proxy (DsFwl001.DorsetSoftware.com) sandbox-blocks newer compiled wheels
  (`daphne`→`twisted`→`zope.interface`, `autobahn`) with 403s, so **daphne could not be
  installed here**. Installed `channels`, `channels-redis`, and `hypercorn` (pure-python)
  instead; verification used hypercorn. In an unrestricted network, `pip install -r
  requirements.txt` gets daphne and `manage.py runserver` serves ASGI directly.
- ⚠️ **Live push is not active in the currently-running dev stack**: the main `runserver` is
  still WSGI (no daphne → no ASGI) and the running worker is on pre-publish code. I did NOT
  restart them — a botched worker restart is the exact footgun CLAUDE.md documents, and
  runserver can't serve ASGI without daphne anyway. Until the stack is restarted with an
  ASGI server (`hypercorn backend.asgi:application`, or daphne once installable) + a fresh
  worker, the frontend **degrades gracefully to the Slice 1.1–1.3 polling** (socket fails →
  `connected=false` → polling stays on). Nothing is broken; the feature is just dormant.
- Extracted no new test test-runner; frontend WS behaviour not click-tested in a browser.

## 2026-07-28 — Slice 1.3 — Poll the visualisation page

**Slice:** 1.3 — Poll the visualisation page (Epic 1, Live status updates)
**Status:** Done

**Changes**
- [frontend/src/components/SimulationVisualisation.tsx](frontend/src/components/SimulationVisualisation.tsx)
  - Imported the shared `usePollWhile`; added `isRunning` (raw present, not `Complete`,
    not `Error`) + `usePollWhile(isRunning, refetch)`, placed above the early returns and
    the many replay hooks so it always runs (rules of hooks).
  - Rewrote the not-complete branch to match Slices 1.1/1.2: "does not auto-refresh…"
    copy became "refreshes automatically", shown only for Pending/Running (not Error);
    button label `Retry` (Error) / `Refresh now` (running).

**Verification**
- `npx tsc -b` clean; `npx eslint` clean.
- Polled `GET /api/simulations/{id}/visualisation/` (the page's exact URL) across a run and
  observed `Pending → Running → Complete` (~11s), so the gate has a real transition to react
  to and the replay only builds once `Complete` (the `data` memo normalizes only then).
- Not verified in-browser (no FE test runner / browser automation); the visual "replay
  appears on its own" check remains a manual step per the slice.

**Notes**
- Efficiency caveat: the visualisation endpoint returns the full aircraft array (~4318 rows
  in the test) even while `Running`, so each poll refetches a large payload. Harmless here
  (FE ignores it until `Complete`; runs finish in ~10s wall-clock), but a lightweight
  status-only endpoint would avoid it — candidate for Slice 1.4 or a small follow-up.
- Epic 1 (polling) now covers all three read views (history, detail, visualisation) via the
  one shared `usePollWhile` hook. Slice 1.4 (websocket push) remains optional.
- Left a third undeletable test sim ("Slice 1.3 vis poll", id 81) — clears with Slice 2.1.

## 2026-07-28 — Slice 1.2 — Poll the metrics detail page

**Slice:** 1.2 — Poll the metrics detail page (Epic 1, Live status updates)
**Status:** Done

**Changes**
- [frontend/src/functions/axios.ts](frontend/src/functions/axios.ts) — extracted a shared
  `usePollWhile(active, refetch, intervalMs?)` hook + `POLL_INTERVAL_MS` constant, so the
  three Epic-1 pollers share one implementation instead of duplicating interval logic.
- [frontend/src/components/MetricBasePage.tsx](frontend/src/components/MetricBasePage.tsx)
  - Added `isRunning` (data present, not `Complete`, not `Error`) + `usePollWhile(isRunning, refetch)`,
    placed above the early returns so the hook runs unconditionally.
  - Rewrote the not-complete branch: the "does not auto-refresh… check again" copy became
    "refreshes automatically", shown only for Pending/Running (not the terminal Error state);
    button label is now `Retry` (Error) / `Refresh now` (running).
- [frontend/src/components/SimulationHistory.tsx](frontend/src/components/SimulationHistory.tsx)
  — refactored Slice 1.1's inline interval to call the new `usePollWhile`; behaviour unchanged.

**Verification**
- `npx tsc -b` clean; `npx eslint` on all three files clean.
- Polled `GET /api/simulations/{id}/detail/` (the exact URL the page uses) across a run:
  observed `Running → Complete` over ~11s, so the poll gate has a real transition to react to
  and stops at the terminal state.
- Noted the detail endpoint returns metric fields even while `Running`; the FE keys off
  `status` (`isDetailComplete`), so metrics stay hidden until `Complete` — gate matches.
- Not verified in-browser (no FE test runner / browser automation); the visual "metrics
  appear on their own" check remains a manual step per the slice.

**Notes**
- Left another undeletable test sim ("Slice 1.2 detail poll", id 80) — clears with Slice 2.1.

## 2026-07-28 — Slice 1.1 — Poll the history list

**Slice:** 1.1 — Poll the history list (Epic 1, Live status updates)
**Status:** Done

**Changes**
- [frontend/src/components/SimulationHistory.tsx](frontend/src/components/SimulationHistory.tsx)
  - Added `POLL_INTERVAL_MS = 4000` with a comment explaining why (async runs, no push).
  - Added a `hasActiveRuns` memo (any row `Pending`/`Running`) and a `useEffect` that
    `setInterval(refetch, …)` while active and clears the interval once none remain.
  - Changed the DataTable overlay to `loading={loading && !data}` so background polls
    refetch in place instead of flashing the spinner every few seconds.
- [frontend/src/functions/axios.ts](frontend/src/functions/axios.ts) — updated the now-stale
  `useGet` doc comment (previously "there is deliberately no polling") to describe the
  component-driven polling pattern; the hook itself still does no polling.

**Verification**
- `npx tsc -b` — clean. `npx eslint` on both changed files — clean.
- End-to-end via the same `GET /api/simulations/` endpoint the UI polls: created a run and
  observed it transition `Pending → Running → Complete` (terminal after ~6s), confirming a
  real status change for the poll to reflect and the point at which polling stops.
- Not verified in-browser (no FE test runner / browser automation set up); the visual
  "row updates without manual refresh" check remains a manual step per the slice.

**Notes**
- Left a test simulation ("Slice 1.1 poll check", id 79) in the dev DB — there's no delete
  endpoint until Slice 2.1, so it can be removed then.
- Fast-completing runs may only be polled once or twice before finishing; the feature still
  reflects the terminal state within one interval. No change needed.

## 2026-07-28 — Backlog + tracking docs created

**Slice:** n/a (planning)
**Status:** Done

**Changes**
- [nextSteps.md](nextSteps.md) — created the feature backlog, organised into 12 epics of
  independently testable vertical slices.
- [implementationHistory.md](implementationHistory.md) — created this change log.

**Verification**
- n/a (documentation only).

**Notes**
- No code changes yet. First planned slice: **1.1 — Poll the history list**.
