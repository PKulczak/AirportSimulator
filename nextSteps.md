# Next Steps

The previous backlog (live updates, CRUD, seed reproducibility, compare, sweep,
export, templates, auth/ownership, sharing, dev-ex/CI) is fully implemented.
This is a fresh backlog of what's genuinely still missing, found by reading the
current codebase rather than carried over unchanged — each item below was
verified absent, not assumed.

Same conventions as before: **BE** = backend, **FE** = frontend, **ENG** =
simulation engine, **INFRA** = dev/ops. Vertical slices, cut through the whole
stack, each shippable/testable on its own.

---

## Epic A — Sweep/batch management gaps

The sweep feature (Epic 5 in the old backlog) shipped list/results/delete but
not these two, both real gaps for a sweep that's still running.

### Slice A.1 — Cancel a whole sweep's in-flight runs (Implemented)

- **BE:** `POST /api/simulations/batch/cancel/?id=<batchId>`
  ([simulation_viewset.py](backend/api/views/simulation_viewset.py)) —
  mirrors the per-run `cancel` action's race-safe conditional-UPDATE
  approach, applied per status across the whole batch: every `Pending` run
  in it moves straight to `Cancelled`, every `Running` run gets
  `cancel_requested` flagged for its own watchdog to notice, and already
  `Complete`/`Error`/`Cancelled` runs are left untouched.
- **FE:** A batch row now shows a "Cancel sweep" action (instead of "Delete
  sweep") while it has any `Pending`/`Running` run, with a confirmation
  dialog; "Delete sweep" returns once every run in it is terminal
  ([SimulationHistory.tsx](frontend/src/components/SimulationHistory.tsx)).
- **Test:** pytest in
  [simulation_batch_results_test.py](backend/tests/feature/simulation_batch_results_test.py)
  covers mixed-status batches, the no-op case (only terminal runs), the
  missing-`id`/unknown-batch 400/404s.

### Slice A.2 — Share a sweep or compare view read-only (Implemented)

- **BE:** Two sibling models to `SimulationShareLink`
  ([simulation_batch_share_link.py](backend/api/models/simulation_batch_share_link.py),
  [compare_share_link.py](backend/api/models/compare_share_link.py)) plus
  `POST /api/simulations/batch/share/?id=<batchId>` and
  `POST /api/simulations/compare/share/?ids=1,2,3`
  ([simulation_viewset.py](backend/api/views/simulation_viewset.py)), and
  their read-only counterparts `SharedBatchResultsView`/`SharedCompareView`
  ([shared_simulation_views.py](backend/api/views/shared_simulation_views.py)).
  A compare link only ever includes the caller's *owned* subset of the
  requested ids, normalised (deduped + sorted) so repeat requests for the
  same set are idempotent.
- **FE:** "Share" action on
  [SweepResults.tsx](frontend/src/components/SweepResults.tsx) and
  [CompareRuns.tsx](frontend/src/components/CompareRuns.tsx), same UX as
  the existing per-run share dialog (now extracted into a shared
  [ShareLinkDialog.tsx](frontend/src/components/ShareLinkDialog.tsx)); new
  `/shared/batch/:token` and `/shared/compare/:token` routes.
- **Test:** [simulation_batch_compare_share_test.py](backend/tests/feature/simulation_batch_compare_share_test.py)
  — the token grants read-only access to exactly that batch/compare set and
  nothing else, regardless of `REQUIRE_AUTH`.

---

## Epic B — Accounts & templates

### Slice B.1 — Templates: personal by default, admin-created global templates (Implemented)

`Template` has no `owner` field and `TemplateViewset` applies no per-user
scoping at all ([template.py](backend/api/models/template.py),
[template_viewset.py](backend/api/views/template_viewset.py)) — unlike every
other resource in the app. Decided design: templates are personal by default,
with staff able to publish a "global" one visible to everyone.

- **BE:** Add a nullable `owner` FK to `Template` (mirrors `Simulation.owner`,
  `SET_NULL` on user delete). `owner = null` means "global." A non-staff
  user's created templates always get `owner = request.user` — the API must
  reject/ignore any attempt from a non-staff caller to set `owner = null`
  server-side, not just hide the option client-side.
- **BE:** `TemplateViewset.get_queryset()` scoped like `SimulationViewset`'s:
  staff see and can manage every template; a non-staff user sees their own
  (`owner = user`) plus every global template (`owner__isnull=True`), but can
  only rename/delete their own — never a global one or another user's (404,
  matching the existing ownership-scoping pattern elsewhere).
- **FE:** "Save as template" gets a "Make this template available to
  everyone" checkbox, shown only when the logged-in user is staff (check
  `isStaff` from `/api/auth/me/`). Non-staff users don't see the checkbox;
  their templates are always personal.
- **FE:** The template picker marks global templates (e.g. a small badge) so
  a non-staff user understands why they can see one they didn't create, and
  why it has no delete option for them.
- **Test:** pytest — non-staff sees own + global templates but not another
  user's personal ones; non-staff cannot delete/rename a global template;
  staff can create a global template (`owner is None`) and can delete
  anyone's; a non-staff request that tries to set `owner`/"global" directly
  is rejected or ignored, not silently honored.

### Slice B.2 — Self-serve signup / password reset (Implemented)

- **BE:** There's no self-serve account creation today — users are
  provisioned via `manage.py createsuperuser` or the Django admin only (see
  `UserDto`'s docstring in
  [user_dto.py](backend/api/serializers/user_dto.py)). Add a registration
  endpoint (and optionally password reset via email) if this is ever used
  beyond a single trusted team.
- **FE:** Signup screen alongside the existing login screen.
- **Test:** pytest that signup creates a usable account; a weak/duplicate
  username is rejected.

---

## Epic C — Production hardening

Motivated by finishing what the recent security/reliability pass started.

### Slice C.1 — Shared cache backend for rate limiting (Implemented)

- **INFRA:** The login throttle (`DEFAULT_THROTTLE_RATES["login"]`) relies on
  Django's default cache, which is per-process (`LocMemCache`) unless
  `CACHES` is configured — in a multi-worker deployment (gunicorn/daphne with
  more than one process) each worker enforces its own independent rate limit,
  weakening the guarantee. Point `CACHES` at Redis (the dramatiq/channels
  Redis instance is already a dependency) for real deployments.
- **Test:** manual — confirm the rate limit holds across multiple worker
  processes.

### Slice C.2 — General per-user simulation-creation rate limit (Implemented)

- **BE:** Single-run creation and the sweep endpoint have per-request size
  caps now (max 10 runways, max 50 sweep runs, capped duration), but nothing
  stops one user from queuing an unbounded *number* of simulations back to
  back, each one legitimately sized. Add a scoped throttle or a simple
  per-user in-flight-run cap.
- **Test:** pytest that exceeding the cap 429s or 400s with a clear message.

---

## Epic D — Quality passes

### Slice D.1 — Accessibility audit (Implemented)

- **FE:** One inaccessible clickable-heading pattern was just fixed in
  `CompareMetricsTable.tsx`; a systematic pass across the app (keyboard
  navigation, ARIA labels, focus order) would catch any siblings — PrimeReact
  components are accessible by default, but custom clickable `div`/`span`
  elements built on top of them are easy to miss.
- **Test (manual):** full keyboard-only pass through simulation creation,
  history, detail, visualisation, and compare.

### Slice D.2 — Notify beyond the open tab (Implemented)

- **BE/FE:** Status push (websocket) and polling both require the page to be
  open. A long sweep or a large simulation someone kicks off and walks away
  from has no way to notify them it's done — a browser notification (Web
  Notifications API, no backend change) is the cheap first step; email/webhook
  is a heavier follow-up.
  - No backend changes — purely client-side, per the slice's own framing.
  - [notifications.ts](frontend/src/functions/notifications.ts): thin wrapper
    around `Notification` (`isNotificationSupported`/`getNotificationPermission`/
    `requestNotificationPermission`/`notify`) plus a `useNotifyOnComplete(active,
    onComplete)` hook that fires exactly once, on the `true -> false` edge of
    `active` (never on mount, never while it stays `true`) — mirrors this
    codebase's existing `isRunning`/`hasActiveRuns` booleans that already drive
    `usePollWhile` on every page that tracks a Pending/Running simulation.
    `notify()` itself only shows a notification if permission is `granted` *and*
    the tab isn't currently focused/visible — if the user is already looking at
    the page, the on-page status update is enough.
  - [NotifyToggle.tsx](frontend/src/components/NotifyToggle.tsx): shared opt-in
    control (a button that requests permission, becoming a "we'll notify you"
    hint once granted; renders nothing if unsupported/denied) — requesting
    permission must happen from a user gesture (a click), so this can't be done
    automatically.
  - Wired into the three pages that already poll for a Pending/Running ->
    terminal transition:
    [MetricBasePage.tsx](frontend/src/components/MetricBasePage.tsx) (a single
    run), [SweepResults.tsx](frontend/src/components/SweepResults.tsx) (every
    run in a sweep reaching a terminal state), and
    [SimulationVisualisation.tsx](frontend/src/components/SimulationVisualisation.tsx)
    (replay becoming available). `SimulationHistory.tsx`'s list view was left
    out — it tracks many runs at once, so "notify when any of them finishes"
    would need per-row tracking to avoid firing repeatedly/ambiguously, a step
    up in scope from the single-resource pages the slice's own test plan
    describes.
- **Test (manual):** start a run, switch tabs/minimize, confirm a
  notification fires on completion. Not performed live — no browser-automation
  tool is available in this environment (see Slice D.1's entry in
  implementationHistory.md for the same standing caveat); verified instead via
  `tsc`/build/lint/test plus reading the actual `Notification`/Page Visibility
  API semantics being relied on.

---

## Suggested order

1. ~~**Epic A**~~ — done (both slices implemented).
2. ~~**Epic B**~~ — done (both slices implemented).
3. ~~**Epic C**~~ — done (both slices implemented).
4. **Epic D** — ongoing hygiene, not a one-time gate.
