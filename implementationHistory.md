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
