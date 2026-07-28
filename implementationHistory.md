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
