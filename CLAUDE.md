# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Airport Modelling Group 2 is a full-stack tool for simulating airport runway operations. A user configures a simulation (arrival/departure rates, duration, max wait time, aircraft speed, which runways are available and in what mode, whether random runway closures are enabled). The backend generates synthetic aircraft traffic and runs a discrete-event simulation (SimPy) that queues aircraft for runways, escalates priority for emergencies/low fuel, applies random runway closures, and records the outcome of every aircraft (success, diversion, cancellation) plus runway-closure events. The frontend lets users create simulations, browse simulation history, view aggregate metrics for a completed run, and replay a full animated visualisation of the run (runway occupancy, queues, emergencies, closures) over time.

Two independent apps, developed together:

- `backend/` — Django + DRF API, SimPy simulation engine, `dramatiq`/Redis async task queue, Postgres.
- `frontend/` — React 19 + TypeScript + Vite SPA, PrimeReact components, Tailwind v4.

## Local dev setup

Backend:

```
cd backend
pip install -r requirements.txt
# copy backend/.env.example -> backend/.env, fill in DB/Redis vars
python manage.py migrate
python manage.py runserver          # API at http://localhost:8000
python manage.py rundramatiq        # separate terminal; required to actually process queued simulations
```

Requires Postgres (db `airportdb`) and Redis (used as the dramatiq broker — see `QUEUE_BROKER`/`QUEUE_URL` in `.env`). The dramatiq worker must be restarted manually to pick up code changes to `api/tasks.py` or the simulation engine.

Frontend:

```
cd frontend
# create frontend/.env.local with: VITE_API_BASE_URL=http://localhost:8000
npm install
npm run dev                         # Vite dev server on http://localhost:3000
```

## Working with the running dev processes (Claude Code / agents)

After making *any* code change to the backend or frontend, fully restart all three dev
processes — `rundramatiq`, `runserver`, and `npm run dev` — rather than assuming only
the one you'd expect to be affected needs restarting (e.g. don't assume a serializer-only
change is safe to leave `runserver` running for, or that a frontend-only change needs no
backend restart).

Before restarting, and again after, check for **stray/duplicate processes** rather than
trusting that a previously-tracked background task is the only one running. A restart
performed outside the normal tracked-background-task lifecycle (e.g. a manual
`taskkill`/`nohup` combo instead of stopping and relaunching through the same mechanism)
leaves an orphaned process that keeps running the *old* code indefinitely, silently
competing for the same port/queue as the "real" current process. This has caused real,
confusing bugs in this project: a stray `rundramatiq` worker kept processing simulations
with a fuel model from days earlier, and stray `runserver` processes (one even started
with `--noreload`) kept serving API responses missing fields that had just been added —
in both cases the code looked correct and tests passed, because the bug was purely "which
process actually answered this request," not the code itself.

To check for stray processes on Windows, list everything matching the process name and
compare PIDs/start times against what you believe is currently running, e.g.:

```
powershell -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*rundramatiq*' } | Select-Object ProcessId, CreationDate, CommandLine | Format-List"
```

(swap `rundramatiq` for `runserver` or `vite`/`npm run dev` as needed). Kill *every*
matching process, confirm the list is empty, then start exactly one fresh instance of
each and verify it started cleanly before considering the restart done.

## Common commands

Backend (run from `backend/`):

- `pytest` — run all tests (settings: `tests/settings_test.py`, sqlite in-memory DB, stub dramatiq broker).
- `pytest tests/feature/simulation_creation_test.py` — run one test file.
- `pytest tests/feature/simulation_creation_test.py::TestClassName::test_method_name` — run one test.
- `python manage.py makemigrations` / `python manage.py migrate` — schema changes.

Frontend (run from `frontend/`):

- `npm run dev` — dev server + watch-mode `tsc` in parallel.
- `npm run build` — type-checks (`tsc -b`) then `vite build`.
- `npm run lint` — ESLint over the whole project.
- `npm run preview` — preview a production build.
- There is no frontend test runner/suite configured (no Jest/Vitest, no test files) — don't assume one exists when asked to "run the tests" for frontend changes.

## Backend architecture (`backend/`)

Single Django app `api` inside project `backend`. One settings module (`backend/backend/settings.py`, config via `django-environ`/`.env` — no dev/prod split) plus a test-only override (`backend/tests/settings_test.py`) that swaps in sqlite and dramatiq's stub broker.

Internal layout of `api/`, follow these conventions when adding features:

- `models/` — one file per model, aggregated in `models/__init__.py`.
- `serializers/` — one serializer class per file, named `<purpose>_dto.py`. Split into creation DTOs (cross-field validation, delegate persistence to a manager) and read DTOs (shape API output).
- `managers/` + `managers/querysets/` — business logic and heavy query/aggregation logic lives here, not in views or serializers (e.g. `SimulationManager.create` does the multi-row atomic create; `SimulationQuerySet.with_detail()` annotates aggregate stats with `Avg`/`Max`/`Count`).
- `views/` — thin DRF viewsets that call managers/DTOs.
- `simulation/` — the actual simulation engine, deliberately decoupled from Django/HTTP: `simulation_runner.py` (SimPy-based queueing/runway assignment/closures/priority escalation), `aircraft_data_generator.py` (synthetic aircraft via `faker`/`faker_airtravel`/`airports-py`/`numpy`), `simulation_runway_wrapper.py` (per-runway SimPy resource wrapper).
- `tasks.py` — the single dramatiq actor `run_simulation(id)`, a thin wrapper around `SimulationRunner().run(id)`.

Domain model:

- `Simulation` — root entity; config fields + `status` (Pending/Running/Complete/Error).
- `Runway` — physical runway master data, seeded by a data migration.
- `SimulationRunway` — join of a `Simulation` to a `Runway` for that run; carries `operational_status` and `operating_mode` for that run.
- `Aircraft` — one row per generated flight in a simulation; FK to `Simulation`, nullable FK to assigned `Runway`; tracks timing, fuel, callsign/operator, `was_success`.
- `AircraftEvent` — emergency/priority events for an aircraft (fuel, mechanical failure, passenger health) that escalate its queue priority.
- `SimulationRunwayEvent` — runway closure events, only recorded when `Simulation.include_closures` is enabled.

API (DRF `DefaultRouter`, `api/urls.py`), JSON is camelCase in/out (`djangorestframework-camel-case`):

- `simulations` (`SimulationViewset`): list (paginated, search-by-name) and create (validates, then enqueues `run_simulation` via dramatiq) at `/api/simulations/`; `GET /api/simulations/{id}/detail` for aggregate metrics; `GET /api/simulations/{id}/visualisation` for the full per-aircraft/per-runway event timeline used by the frontend replay feature.
- `runways` (`RunwayViewset`, read-only): master runway list.
- No auth/permission classes are configured — the API is effectively open; CORS is controlled via `CORS_ALLOWED_ORIGINS`.

Async processing: simulations are queued, not run inline. `SimulationViewset.create` enqueues `run_simulation.send(id)`; the `rundramatiq` worker process picks it up, and `SimulationRunner` transitions `Simulation.status` Pending → Running → Complete/Error as it runs. There is **no websocket/push mechanism** — status is only observable by re-fetching from the API (see frontend gap below). Task queue is visible/monitorable in Django admin at `/admin/django_dramatiq/task/` (requires a superuser).

Testing: pytest + `pytest-django`, config in `backend/pytest.ini` (`testpaths = tests`). `backend/tests/feature/` holds API/integration tests through DRF's `APIClient` (shared helpers in `base_test.py`'s `BaseFeatureTest`, e.g. `create_simulations`, `create_runways` — hand-rolled, not a factory library). `backend/tests/simulation/` holds unit tests for the simulation engine itself. `backend/tests/conftest.py` provides `broker`/`worker` fixtures (stub dramatiq broker) to exercise `@dramatiq.actor` tasks synchronously in tests.

Key libraries: Django, DRF, `django-dramatiq`/`dramatiq`/`redis` (async queue), `psycopg` (Postgres driver), `simpy` (simulation engine), `numpy`/`faker`/`faker_airtravel`/`airports-py` (synthetic data generation), `django-environ`, `django-cors-headers`.

## Frontend architecture (`frontend/`)

React 19 + TypeScript, built with Vite, styled with Tailwind v4 (CSS-based config in `src/index.css`, no `tailwind.config.js`) plus PrimeReact as the primary component library (DataTable, Dialog, Slider, Sidebar, etc.) and Font Awesome for icons. Forms use `react-hook-form` + `zod` validation. HTTP via a single `axios` instance.

Structure:

- `src/App.tsx` — all routing (`react-router-dom`): `/` → `SimulationHistory`, `/simulation/:id/detail` → `MetricBasePage`, `/simulation/:id/visualisation` → `SimulationVisualisation`, `*` → `PageNotFound`; all wrapped in `MainLayout`.
- `src/components/` — flat (no nested feature folders): creation flow (`RequestForm.tsx`, `SimulationFormDialog.tsx`), history (`SimulationHistory.tsx`), metrics dashboard (`MetricBasePage.tsx` + `MetricsGrid`/`MetricsHeader`/`MetricsRunways`/`MetricsSimVariables`), visualisation/replay (`SimulationVisualisation.tsx`, `Runway.tsx`, `QueueTable.tsx`, `SimulationEventLog.tsx`, `AlertButton.tsx`).
- `src/types/` — domain types (`simulation.ts`, `runway.ts`, `visualisation.ts`, `metrics.ts`), plus `common.ts` (`Page<T>` for DRF-style pagination) and `axios.ts`.
- `src/functions/axios.ts` — the API client layer: single `axios.create({ baseURL: import.meta.env.VITE_API_BASE_URL })` plus `useGet`/`usePost`/`usePut` hooks (built on a generic `useAxios` with `AbortController` cancellation and loading/error state).
- `src/context/RunwayContext.tsx` — fetches `/api/runways/` once at app root and exposes it app-wide; this is essentially the only global state. There is no Redux/Zustand/React Query — everything else is local `useState`/Context.
- `src/schemas/simulationForm.ts` — zod schema/refinements for the create-simulation form.

Visualisation/replay feature (`SimulationVisualisation.tsx` + `src/functions/visualisationHelpers.ts` + `src/types/visualisation.ts`): not canvas/SVG/a charting library — it fetches the entire simulation event data once, converts it into a sorted `SimulationEvent[]` timeline (`processEvents()`), then replays it client-side with a `setTimeout` loop driving a `currentTime` cursor (speed slider 0.125x–8x, scrubber via `jumpToTime()`). `Runway.tsx` animates aircraft occupancy by manipulating a ref's `style.width` in `requestAnimationFrame`, not CSS transitions. When touching this feature, be aware of `resetSimulation()` in `SimulationVisualisation.tsx` — a prior bug there (fixed under `32991-VisualisationRunwayReset`) involved runway occupancy/status not being cleared correctly on restart.

Known gap: neither `MetricBasePage.tsx` nor `SimulationVisualisation.tsx` poll or subscribe for updates — each does a single fetch on mount, and if the simulation is still Pending/Running they just render a static "not completed yet" message with no auto-refresh. `SimulationHistory.tsx` only refreshes on a manual button click. Given the backend runs simulations asynchronously via a queue, any change touching simulation status should account for this lack of polling/websockets rather than assuming the UI updates automatically.

## Infrastructure notes

- No Dockerfile, docker-compose, or CI/CD config exists anywhere in the repo (checked both `backend/` and `frontend/`, and repo-wide for `*.yml`/`*.yaml`/`Dockerfile*`) — there is no defined deployment pipeline yet; local dev is the only supported workflow today.
- Backend requires Postgres (default local DB `airportdb`) and Redis (dramatiq broker) running locally; both are configured entirely through `backend/.env` (copy from `backend/.env.example`). Key vars: `SECRET_KEY`, `DATABASE_*`, `DEBUG`, `ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS`, `LOG_LEVEL`, `QUEUE_BROKER`, `QUEUE_URL`, `AIRCRAFT_SPEED_IN_KNOTS`.
- Frontend only needs `VITE_API_BASE_URL` in `frontend/.env.local` (no `.env.example` provided for frontend, unlike backend).
- The `rundramatiq` worker process is separate from `runserver` and must be running for any created simulation to actually execute; it also needs to be manually restarted to pick up backend code changes during development.
