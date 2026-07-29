# Next Steps

A backlog of proposed features for Airport Modelling Group 2, broken into **vertical
slices**. Each slice cuts through the whole stack (data model → API → UI → observable
behaviour) and is meant to be shipped and tested on its own, rather than building a whole
layer at a time. Slices within an epic are ordered so each builds on the last, but most
epics are independent of each other.

## How "testable individually" works in this repo

- **Backend** slices are testable with `pytest` — feature/API tests via DRF's `APIClient`
  in `backend/tests/feature/`, engine unit tests in `backend/tests/simulation/`. Prefer
  adding a test per slice.
- **Frontend** has **no test runner today** (see [CLAUDE.md](CLAUDE.md)). Until Slice
  12.4 (add Vitest) lands, "test" for a frontend-only slice means the explicit manual
  steps listed under that slice. Slices are written so those steps are short and concrete.
- Simulations run **async** via dramatiq and the UI does **not** poll — so any slice that
  ends in "watch the status change" depends on Epic 1, or on a manual page refresh until
  then.

Legend: **BE** = backend, **FE** = frontend, **ENG** = simulation engine, **INFRA** = dev/ops.

---

## Epic 1 — Live status updates

The #1 documented gap: runs execute async but no page refreshes itself. Deliver polling
first (small, immediately useful); websockets is an optional later upgrade.

### Slice 1.1 — Poll the history list

- **FE:** In [SimulationHistory.tsx](frontend/src/components/SimulationHistory.tsx), when
  any row is `Pending`/`Running`, re-fetch the list every few seconds; stop when none are.
- **Test (manual):** Create a simulation; without touching the page, watch its row flip
  `Pending → Running → Complete`.

### Slice 1.2 — Poll the metrics detail page

- **FE:** [MetricBasePage.tsx](frontend/src/components/MetricBasePage.tsx) re-fetches
  while status is not `Complete`/`Error`, then renders metrics once done.
- **Test (manual):** Open a running sim's detail page directly; confirm the "not completed
  yet" state auto-replaces with metrics on completion.

### Slice 1.3 — Poll the visualisation page

- **FE:** Same pattern in
  [SimulationVisualisation.tsx](frontend/src/components/SimulationVisualisation.tsx); once
  data arrives, load the replay.
- **Test (manual):** Open a running sim's visualisation directly; confirm the replay
  becomes available without a manual refresh.

### Slice 1.4 — (Optional) Websocket push instead of polling

- **BE:** Add Django Channels; `SimulationRunner` publishes status transitions.
- **FE:** Subscribe and update in place; remove polling.
- **Test:** BE unit test that a status change emits an event; manual FE check that a run
  completes with no polling requests in the network tab.

---

## Epic 2 — Simulation management (CRUD + cancel)

Today the API is only list + create. Each verb below is its own slice.

### Slice 2.1 — Delete a simulation

- **BE:** Add `destroy` to `SimulationViewset`; cascade deletes aircraft/events.
- **FE:** Delete button + confirm dialog in history; remove row on success.
- **Test:** pytest `DELETE /api/simulations/{id}/` → 204 and rows gone. Manual FE confirm.

### Slice 2.2 — Rename a simulation

- **BE:** Allow `PATCH` of `name` (reuse the name validation regex).
- **FE:** Inline edit / rename dialog in history or detail header.
- **Test:** pytest PATCH updates name and rejects invalid characters. Manual FE confirm.

### Slice 2.3 — Clone config into a new run

- **BE:** Ensure a run's full config is fetchable (extend a read DTO if the detail
  endpoint doesn't already expose every create field, incl. runway modes/statuses).
- **FE:** "Duplicate" action pre-fills `RequestForm`/`SimulationFormDialog` from an
  existing run so the user tweaks and re-submits.
- **Test:** pytest that the config DTO round-trips all create fields. Manual FE: clone a
  run, confirm form is pre-populated identically.

### Slice 2.4 — Cancel a Pending/Running simulation

- **BE/ENG:** Add a `Cancelled` status (or reuse `Error` with a reason); `SimulationRunner`
  checks a cancel flag at safe points and stops; add a cancel action to the viewset.
- **FE:** Cancel button on `Pending`/`Running` rows.
- **Test:** pytest that setting cancel mid-run ends it in the cancelled state without a
  full result set. Manual FE confirm.

---

## Epic 3 — Reproducibility (random seed)

`Simulation.random_seed` already exists on the model
([simulation.py:25](backend/api/models/simulation.py#L25)) but isn't user-facing.

### Slice 3.1 — Accept an optional seed on create

- **BE:** Let the creation DTO accept `randomSeed`; the engine already seeds from it.
- **FE:** Optional seed field in the create form
  ([simulationForm.ts](frontend/src/schemas/simulationForm.ts)); blank = random.
- **Test:** pytest — two runs with the same seed + config produce identical aircraft
  outcomes; different seeds differ. (Strong engine-level test, no UI needed.)

### Slice 3.2 — Surface seed + "re-run with same seed"

- **FE:** Show the seed on the detail page; a button clones the config _with_ the seed
  fixed (composes with Slice 2.3).
- **Test (manual):** Re-run with same seed, compare metrics pages are identical.

---

## Epic 4 — Run comparison

### Slice 4.1 — Compare two or more completed runs

- **FE:** A compare view: pick 2+ `Complete` sims, fetch each via the existing
  `/detail` endpoint, render metrics in adjacent columns with deltas highlighted.
- **Test (manual):** Run the same scenario with 1 vs 2 runways; confirm the compare view
  shows both and the wait/diversion differences.

### Slice 4.2 — (Optional) Batched compare endpoint

- **BE:** `GET /api/simulations/compare?ids=…` returns aggregated metrics for several runs
  in one call (moves the aggregation into `SimulationQuerySet`).
- **Test:** pytest that the endpoint returns one metrics block per id.

---

## Epic 5 — Parameter sweep / capacity curve

Run one scenario across a range of a single variable and chart the result. Depends on
Epic 4 for display building blocks.

### Slice 5.1 — Group runs into a batch

- **BE:** Add a `SimulationBatch` (or a nullable `batch_id`/tag on `Simulation`) so a set
  of runs is queryable together.
- **Test:** pytest that batched sims are retrievable as a group.

### Slice 5.2 — Batch-create a sweep

- **BE:** An endpoint that takes a base config + one variable + a range/step, creates N
  sims in the batch, and enqueues each `run_simulation`.
- **FE:** Sweep form (base config + variable picker + range).
- **Test:** pytest that N sims are created with the variable stepped and all enqueued.

### Slice 5.3 — Sweep results chart

- **FE:** For a batch, plot throughput / success rate / avg wait vs. the swept variable to
  reveal the saturation point. (Use the `dataviz` skill for styling.)
- **Test (manual):** Sweep arrival rate 5→50; confirm the curve flattens/degrades as the
  runways saturate.

---

## Epic 7 — Export

### Slice 7.1 — CSV of the per-aircraft table

- **BE:** `GET /api/simulations/{id}/export.csv` streaming the aircraft rows (callsign,
  movement, outcome, wait, fuel, assigned runway).
- **FE:** Download button on the detail page.
- **Test:** pytest asserts header row + one line per aircraft.

### Slice 7.2 — PDF / printable summary

- **FE:** A print-friendly summary (metrics + key charts) or server-rendered PDF.
- **Test (manual):** Export a run, confirm the summary matches the dashboard.

---

## Epic 8 — Engine fidelity

Each slice deepens the model and is unit-testable in `backend/tests/simulation/` with a
fixed seed. Constants live in
[simulation/constants.py](backend/api/simulation/constants.py).

### Slice 8.1 — Aircraft weight classes + wake separation

- **ENG:** Assign Heavy/Medium/Light in `aircraft_data_generator.py`; enforce separation
  minima between successive operations instead of a flat `REFERENCE_OPERATION_MINUTES`.
- **BE/FE:** Optional class mix in config; show class in the replay.
- **Test:** seeded engine test — successive operations respect the larger separation after
  a Heavy.

### Slice 8.2 — Weather as a scenario parameter

- **ENG/BE/FE:** A weather setting (e.g. VMC/IMC, wind, snow) scales capacity/separation
  and closure probability; ties into existing `SnowClearance`/`RunwayInspection` reasons.
- **Test:** seeded engine test — worse weather lowers throughput and raises closures.

### Slice 8.3 — Time-varying demand (rush hours)

- **ENG/BE/FE:** Accept a demand profile/curve instead of a single flat rate per hour.
- **Test:** seeded engine test — arrivals cluster in the configured peak windows.

### Slice 8.4 — Expose emergency/closure rates as config

- **BE/FE:** Promote hardcoded probabilities/intervals (`MECHANICAL_FAILURE_PROBABILITY`,
  `CLOSURE_MEAN_INTERVAL_MINUTES`, …) into optional "advanced" config fields.
- **Test:** pytest that overrides flow through to the runner; seeded engine test that a
  higher rate yields more events.

### Slice 8.5 — Second resource stage: gates / taxi time

- **ENG:** Add a gate/stand `simpy` resource — arrivals need a free stand, departures need
  pushback — turning the single-resource model into a small network.
- **Test:** seeded engine test — with fewer gates than runway capacity, gates become the
  bottleneck and waits rise.

---

## Epic 9 — Scenario templates / presets

### Slice 9.1 — Save & reuse a named config

- **BE:** A `Template` model + endpoints (save a config, list templates).
- **FE:** "Save as template" on the form; a template picker that pre-fills the form.
- **Test:** pytest CRUD on templates; manual FE that picking a template pre-fills the form.

---

## Epic 10 — Auth & ownership

The API is currently open (no permission classes). Do this before any multi-user use.

### Slice 10.1 — Authentication

- **BE:** Add auth (token/session) + a login endpoint; keep endpoints open behind a flag
  until the FE is wired.
- **FE:** Login screen + attach credentials in the axios instance
  ([functions/axios.ts](frontend/src/functions/axios.ts)).
- **Test:** pytest that protected endpoints 401 without creds, 200 with.

### Slice 10.2 — Per-user ownership

- **BE:** FK `owner` on `Simulation`; list/detail scoped to the owner.
- **Test:** pytest that user A cannot see user B's runs.

---

## Epic 11 — Sharing

### Slice 11.1 — Read-only share link

- **BE:** A shareable token that grants read-only access to one run's detail +
  visualisation.
- **FE:** "Share" button producing the link; a read-only route that hides edit actions.
- **Test:** pytest that the token grants read-only access and nothing else; manual FE
  confirm the shared view is read-only.

---

## Epic 12 — Dev-ex & reliability

Motivated directly by the stray-process incidents documented in [CLAUDE.md](CLAUDE.md).

### Slice 12.1 — Docker Compose for local dev

- **INFRA:** `docker-compose.yml` with web, dramatiq worker, Postgres, Redis so there's a
  single source of truth for "which process is running."
- **Test (manual):** `docker compose up` brings the stack up; create a run end-to-end.

### Slice 12.2 — CI pipeline

- **INFRA:** Run `pytest` (backend) and `npm run build` + `npm run lint` (frontend) on push.
- **Test:** the pipeline goes green on a clean checkout.

### Slice 12.3 — Run heartbeat + auto-timeout

- **BE/ENG:** A watchdog marks a run `Error` if it hasn't progressed within a timeout, so
  a dead/stray worker doesn't leave a sim `Running` forever.
- **Test:** pytest that a stalled run transitions to `Error` after the timeout.

### Slice 12.4 — Add a frontend test runner (Vitest)

- **INFRA/FE:** Add Vitest + Testing Library so later frontend slices get automated tests
  instead of manual steps. Backfill a couple of tests (e.g. the form schema refinements in
  [simulationForm.ts](frontend/src/schemas/simulationForm.ts)).
- **Test:** `npm run test` runs and passes.

---

## Suggested order

1. **Epic 1** (live updates) — removes the most jarring UX gap; unblocks "watch it run".
2. **Epic 3** (seed) — cheap, and makes every analysis feature below trustworthy.
3. **Epic 2** (management) — basic hygiene (delete/rename/clone/cancel).
4. **Epic 4 → 5** (compare → sweep) — the analysis story that makes this a real modelling
   tool.
5. **Epic 12** in parallel — Compose/CI early pays for itself given the process-management
   pain already recorded.
6. **Epics 7–11** as demand dictates.
