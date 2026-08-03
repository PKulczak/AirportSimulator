import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Slider, type SliderChangeEvent } from 'primereact/slider';
import { Button } from 'primereact/button';
import { Message } from 'primereact/message';
import { Sidebar } from 'primereact/sidebar';
import {
  POLL_INTERVAL_MS,
  SAFETY_POLL_INTERVAL_MS,
  useGet,
  usePollWhile,
} from '../functions/axios';
import { useSimulationSocket } from '../functions/socket';
import { useRunways } from '../context/RunwayContext';
import {
  deriveRunwayStates,
  eventsUpTo,
  normalizeVisualisation,
  processEvents,
} from '../functions/visualisationHelpers';
import { EMERGENCY_LEGEND, MODE_LEGEND, WEIGHT_CLASS_LEGEND } from '../functions/replayTheme';
import type {
  AircraftEventType,
  EmergencyEvent,
  SimulationEvent,
  VisualisationResponseWire,
} from '../types/visualisation';
import Runway, { type RunwayOccupancy } from './Runway';
import QueueTable from './QueueTable';
import SimulationEventLog from './SimulationEventLog';
import LoadingScreen from './LoadingScreen';
import backgroundImage from '../assets/Background.png';

// At 1x, one tick fires per second and advances the sim clock by
// BASE_STEP_MINUTES. Other speeds scale the tick interval, not the per-tick
// step — e.g. at 4x, four 1-minute ticks fire per second instead of one
// 4-minute tick, so the clock always advances in fixed 1-minute increments.
const TICK_INTERVAL_MS = 1000;
const BASE_STEP_MINUTES = 1;
const SPEED_OPTIONS = [0.125, 0.25, 0.5, 1, 2, 4, 8];
const EMERGENCY_WINDOW_MINUTES = 5;

export default function SimulationVisualisation() {
  // Two route entries render this component: /simulation/:id/visualisation
  // (the owner-scoped, authenticated view) and /shared/:token/visualisation
  // (Slice 10.1's read-only share link) — exactly one of `id`/`token` is
  // ever set. Every action on this page (play/pause/reset/scrub/event log)
  // is purely client-side replay of already-fetched data, so nothing needs
  // hiding here in shared mode — only the fetch URL differs.
  const { id, token } = useParams<{ id?: string; token?: string }>();
  const navigate = useNavigate();
  const { runways: masterRunways } = useRunways();
  const visualisationUrl = id
    ? `/api/simulations/${id}/visualisation/`
    : token
      ? `/api/shared/${token}/visualisation/`
      : null;
  const { data: raw, loading, error, refetch } = useGet<VisualisationResponseWire>(
    visualisationUrl,
  );

  const data = useMemo(
    () => (raw && raw.status === 'Complete' ? normalizeVisualisation(raw) : undefined),
    [raw],
  );

  const events = useMemo(() => (data ? processEvents(data) : []), [data]);

  // Poll only while the run is still in flight (Pending/Running) so the replay
  // appears on its own once it completes; stop at any terminal state
  // (Complete/Error/Cancelled). Kept above the early returns below so the hook
  // always runs (rules of hooks).
  const isRunning = !!raw && (raw.status === 'Pending' || raw.status === 'Running');
  // Prefer websocket push for this simulation, refetching on (re)connect to
  // catch anything missed during the connect window. Keep polling while it
  // runs — fast when push is down, slow as a safety net when it's up — so a
  // missed/half-open push never leaves the page stale until a manual refresh.
  // Keyed off `raw.id` (the real simulation id, known once loaded) rather
  // than the route's `id` param so this also works on the token-based
  // shared route.
  const { connected } = useSimulationSocket(
    isRunning && raw ? `/ws/simulations/${raw.id}/` : null,
    refetch,
    refetch,
  );
  usePollWhile(isRunning, refetch, connected ? SAFETY_POLL_INTERVAL_MS : POLL_INTERVAL_MS);

  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [showEventLog, setShowEventLog] = useState(false);

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // `currentTime` only ticks a few times a second (it drives data derivation —
  // queue/log/runway-open-closed state — which doesn't need per-frame
  // precision). Animating straight off it looks stepped. This anchor lets
  // `getSmoothTime()` extrapolate the sim clock continuously between ticks
  // off wall-clock elapsed time, at exactly the rate the tick loop advances
  // it, so the two stay in sync with no visible correction when the next
  // tick lands.
  const clockAnchorRef = useRef({ simTime: 0, wallClockMs: 0, minutesPerMs: 0 });

  useEffect(() => {
    clockAnchorRef.current = {
      simTime: currentTime,
      wallClockMs: performance.now(),
      minutesPerMs: isPlaying ? (BASE_STEP_MINUTES * speed) / TICK_INTERVAL_MS : 0,
    };
  }, [currentTime, isPlaying, speed]);

  const getSmoothTime = useCallback(() => {
    const anchor = clockAnchorRef.current;
    const elapsedMs = performance.now() - anchor.wallClockMs;
    const projected = anchor.simTime + elapsedMs * anchor.minutesPerMs;
    const max = data?.durationMinutes ?? projected;
    return Math.min(Math.max(projected, 0), max);
  }, [data]);

  const clearScheduledTick = useCallback(() => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  // setTimeout-driven replay loop (not setInterval): each tick schedules the
  // next one, so pausing/scrubbing just needs to clear the pending timeout —
  // there's no drifting interval to reconcile.
  useEffect(() => {
    if (!isPlaying || !data) {
      return;
    }

    timeoutRef.current = setTimeout(() => {
      setCurrentTime((prev) => Math.min(prev + BASE_STEP_MINUTES, data.durationMinutes));
    }, TICK_INTERVAL_MS / speed);

    return clearScheduledTick;
  }, [isPlaying, speed, data, currentTime, clearScheduledTick]);

  useEffect(() => {
    if (data && currentTime >= data.durationMinutes) {
      setIsPlaying(false);
    }
  }, [currentTime, data]);

  useEffect(() => clearScheduledTick, [clearScheduledTick]);

  const jumpToTime = useCallback(
    (t: number) => {
      // Scrubbing while playing raced the autoplay tick loop for ownership of
      // `currentTime`: both the drag's `onChange` and the tick's own
      // `setTimeout` called `setCurrentTime`, so whichever fired last "won"
      // on any given render, leaving the clock stuck wherever the tick loop
      // happened to land after the drag — while the runway animation (driven
      // separately, off wall-clock time via `getSmoothTime`) kept extrapolating
      // as if still playing, and the play/pause button never got a state
      // change to reflect since `isPlaying` itself was never touched. Pausing
      // here removes the second writer entirely, matching how scrubbing
      // behaves in most media players.
      clearScheduledTick();
      setIsPlaying(false);
      setCurrentTime(Math.max(0, Math.min(t, data?.durationMinutes ?? t)));
    },
    [clearScheduledTick, data],
  );

  const resetSimulation = useCallback(() => {
    clearScheduledTick();
    setIsPlaying(false);
    setCurrentTime(0);
    setSpeed(1);
  }, [clearScheduledTick]);

  const runwayIdentifier = useCallback(
    (runwayId: number) =>
      data?.runways.find((r) => r.runwayId === runwayId)?.identifier ??
      masterRunways.find((r) => r.id === runwayId)?.identifier ??
      `Runway ${runwayId}`,
    [data, masterRunways],
  );

  // `data.aircraft` is a stable reference for the whole replay (only changes
  // on a fresh fetch — see the `data` useMemo above), but this component
  // re-renders every tick — memoize the O(n) lookup map instead of rebuilding
  // it from scratch on every tick. Must sit above the early returns below
  // (Rules of Hooks), hence the `data?.` guard.
  const aircraftById = useMemo(
    () => new Map((data?.aircraft ?? []).map((a) => [a.id, a])),
    [data],
  );

  if (loading && !raw) {
    return <LoadingScreen />;
  }

  if (error) {
    return (
      <div className="-m-6 flex h-[calc(100%+3rem)] flex-col items-center justify-center gap-3 p-6">
        <Message severity="error" text={`Failed to load visualisation: ${error.message}`} />
        <div className="flex gap-2">
          <Button icon="pi pi-chevron-left" label="Back" onClick={() => navigate(-1)} />
          <Button icon="pi pi-refresh" label="Retry" onClick={() => refetch()} />
        </div>
      </div>
    );
  }

  if (!raw) {
    return null;
  }

  if (!data) {
    const isError = raw.status === 'Error';
    const isCancelled = raw.status === 'Cancelled';
    return (
      <div className="-m-6 h-[calc(100%+3rem)] flex flex-col">
        <div
          className="relative flex-1 min-h-0 overflow-x-auto overflow-y-hidden p-4 sm:p-10 flex items-center justify-center"
          style={{
            backgroundImage: `url(${backgroundImage})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
          }}
        >
          <div
            className="queue-scroll relative flex min-w-[800px] flex-col gap-4 overflow-y-auto rounded-lg border-2 border-black bg-white p-4 shadow-2xl sm:p-6"
            style={{ width: '100%', maxWidth: '1600px', maxHeight: '100%', aspectRatio: '1.5' }}
          >
            <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3">
              <Button
                icon="pi pi-chevron-left"
                aria-label="Back"
                onClick={() => navigate(-1)}
                className="self-start"
              />
              <h1 className="text-center text-2xl font-bold uppercase tracking-wide text-slate-900">
                Airport Simulation
              </h1>
              <span aria-hidden className="w-10" />
            </div>
            <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
              <h2 className="text-2xl font-semibold text-slate-800">{raw.name}</h2>
              <Message
                severity={isError ? 'error' : isCancelled ? 'warn' : 'info'}
                text={
                  isError
                    ? 'Simulation failed — no replay data available.'
                    : isCancelled
                      ? 'This simulation was cancelled — no replay is available.'
                      : `Simulation is ${raw.status.toLowerCase()}. Replay will be available once it completes.`
                }
              />
              {!isError && !isCancelled && (
                <p className="text-sm text-slate-500">
                  This page refreshes automatically — the replay will appear as soon as the
                  simulation completes.
                </p>
              )}
              {!isCancelled && (
                <Button
                  label={isError ? 'Retry' : 'Refresh now'}
                  icon="pi pi-refresh"
                  onClick={() => refetch()}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const visibleEvents = eventsUpTo(events, currentTime);
  const runwayStates = deriveRunwayStates(visibleEvents);

  const isEmergencyEvent = (evt: SimulationEvent): evt is EmergencyEvent =>
    evt.type === 'emergency';

  // The most recent emergency (if any, within the trailing alert window) per
  // aircraft — looked up by whichever component is currently displaying that
  // aircraft (a queue row or the runway it's occupying), so there's one
  // source of truth for "is this aircraft currently having an emergency".
  const activeEmergencyByAircraft = new Map<number, AircraftEventType>();
  for (const evt of visibleEvents) {
    if (isEmergencyEvent(evt) && currentTime - evt.time <= EMERGENCY_WINDOW_MINUTES) {
      activeEmergencyByAircraft.set(evt.aircraftId, evt.eventType);
    }
  }

  return (
    <div className="-m-6 h-[calc(100%+3rem)] flex flex-col">
      {/* Background image layer, sized to cover the whole area, with the
       * fixed replay "box" floating on top of it. `-m-6`/`h-[calc(100%+3rem)]`
       * on the root above cancel out MainLayout's `<main>` padding so this
       * reaches every edge instead of leaving a plain-background gap around
       * it. `min-h-0` + `overflow-hidden` keep this pinned to its
       * flex-allocated share of the viewport — it never grows with content,
       * so the page itself never scrolls; only elements inside the box
       * (queue tables, runway list, event log) do. The box itself uses a
       * fixed `aspectRatio` plus `maxWidth`/`maxHeight` (below) so it scales
       * up in both dimensions together on a larger viewport instead of just
       * stretching taller — the same "shrink/grow to fit, keep proportions"
       * behavior as `object-fit: contain`, applied to a plain div via CSS
       * rather than JS. */}
      <div
        className="relative flex-1 min-h-0 overflow-x-auto overflow-y-hidden p-4 sm:p-10 flex items-center justify-center"
        style={{
          backgroundImage: `url(${backgroundImage})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        }}
      >
        <div
          className="relative flex min-w-[800px] flex-col overflow-hidden rounded-lg border-2 border-black bg-white shadow-2xl"
          style={{ width: '100%', maxWidth: '1600px', maxHeight: '100%', aspectRatio: '1.5' }}
        >
          {/* Top bar: page title, then back/name/clock/controls all on one row */}
          <div className="flex flex-col gap-1 border-b border-slate-100 px-4 pb-1 pt-4">
            <h1 className="text-center text-2xl font-bold uppercase tracking-wide text-slate-900">
              Airport Simulation
            </h1>
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 py-2">
              <div className="flex min-w-0 items-center gap-3 justify-self-start">
                <Button
                  icon="pi pi-chevron-left"
                  aria-label="Back"
                  onClick={() => navigate(-1)}
                />
                <span className="text-lg font-bold text-slate-900 truncate">{data.name}</span>
              </div>

              <span className="whitespace-nowrap text-lg font-bold text-slate-900 justify-self-center">
                Current Time: {Math.round(currentTime)} mins
              </span>

              <div className="flex flex-nowrap items-center gap-3 justify-self-end">
                <Button
                  icon={isPlaying ? 'pi pi-pause' : 'pi pi-play'}
                  aria-label={isPlaying ? 'Pause' : 'Play'}
                  onClick={() => setIsPlaying((prev) => !prev)}
                  disabled={currentTime >= data.durationMinutes}
                />
                <Button
                  icon="pi pi-replay"
                  aria-label="Reset"
                  className="!bg-slate-800 !border-slate-800 !text-white hover:!bg-slate-700"
                  onClick={resetSimulation}
                />
                <div className="flex flex-col items-center gap-1 w-24">
                  <span className="text-xs font-semibold text-slate-600">{speed}x</span>
                  <Slider
                    className="w-full"
                    value={SPEED_OPTIONS.indexOf(speed)}
                    min={0}
                    max={SPEED_OPTIONS.length - 1}
                    step={1}
                    onChange={(e: SliderChangeEvent) => setSpeed(SPEED_OPTIONS[e.value as number])}
                  />
                </div>
                <Button size="small" onClick={() => setShowEventLog((prev) => !prev)}>
                  <span className="flex items-center gap-1.5">
                    <i className="pi pi-list text-xs" />
                    <span className="flex flex-col text-left text-xs font-semibold leading-tight">
                      <span>Event</span>
                      <span>Log</span>
                    </span>
                  </span>
                </Button>
              </div>
            </div>

            {/* Legend row sits directly above the queues/runways block, each
             * group locked over the element it describes: the emergency
             * legend over the holding queue (where the dots appear), the
             * runway-mode legend over the runway list, and the weight-class
             * legend (relevant to both queues and runway occupancy) over the
             * departures queue. */}
            <div className="grid grid-cols-1 gap-2 lg:grid-cols-3">
              <div className="flex items-center justify-center gap-3">
                {EMERGENCY_LEGEND.map((item) => (
                  <span
                    key={item.label}
                    className="flex max-w-[33.333%] items-center gap-1 text-[10px] font-medium text-slate-600"
                  >
                    <span
                      className={`h-4 w-4 shrink-0 rounded-sm border border-black ${item.dot}`}
                    />
                    <span className="inline-block leading-tight">{item.label}</span>
                  </span>
                ))}
              </div>

              <div className="flex items-center justify-center gap-3">
                {MODE_LEGEND.map((item) => (
                  <span
                    key={item.mode}
                    className="flex max-w-[33.333%] items-center gap-1 text-[10px] font-medium text-slate-600"
                  >
                    <span
                      className={`h-4 w-4 shrink-0 rounded-sm border border-black ${item.bg}`}
                    />
                    <span className="inline-block leading-tight">{item.label}</span>
                  </span>
                ))}
              </div>

              <div className="flex items-center justify-center gap-3">
                {WEIGHT_CLASS_LEGEND.map((item) => (
                  <span
                    key={item.weightClass}
                    className="flex items-center gap-1 text-[10px] font-medium text-slate-600"
                  >
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-black bg-white text-[9px] font-bold">
                      {item.abbreviation}
                    </span>
                    <span className="inline-block leading-tight">{item.label}</span>
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Main content: arrivals queue | runway list | departures queue */}
          <div className="grid flex-1 min-h-0 grid-cols-1 gap-4 overflow-hidden px-4 pb-4 pt-0 lg:grid-cols-3">
            <div className="min-h-0">
              <QueueTable
                visibleEvents={visibleEvents}
                currentTime={currentTime}
                aircraft={data.aircraft}
                movementType="Arrival"
                activeEmergencyByAircraft={activeEmergencyByAircraft}
              />
            </div>

            <div className="queue-scroll flex min-h-0 flex-col gap-3 overflow-y-auto">
              {data.runways.map((rw) => {
                const state = runwayStates.get(rw.runwayId) ?? {
                  occupiedByAircraftId: null,
                  closureReason: null,
                };
                let occupancy: RunwayOccupancy | null = null;
                if (state.occupiedByAircraftId !== null) {
                  const ac = aircraftById.get(state.occupiedByAircraftId);
                  if (ac && ac.runwayAssignedTime !== null && ac.completionTime !== null) {
                    occupancy = {
                      callsign: ac.callsign,
                      weightClass: ac.weightClass,
                      startTime: ac.runwayAssignedTime,
                      endTime: ac.completionTime,
                      movementType: ac.movementType,
                    };
                  }
                }
                return (
                  <Runway
                    key={rw.runwayId}
                    identifier={rw.identifier}
                    operatingMode={rw.operatingMode}
                    closureReason={state.closureReason}
                    occupancy={occupancy}
                    getSmoothTime={getSmoothTime}
                  />
                );
              })}
            </div>

            <div className="min-h-0">
              <QueueTable
                visibleEvents={visibleEvents}
                currentTime={currentTime}
                aircraft={data.aircraft}
                movementType="Departure"
                activeEmergencyByAircraft={activeEmergencyByAircraft}
              />
            </div>
          </div>

          {/* Timeline scrubber, pinned to the bottom of the box */}
          <div className="flex items-center gap-4 border-t border-slate-100 p-4">
            <span className="shrink-0 text-sm font-medium text-slate-500">
              {Math.round(currentTime)} / {data.durationMinutes}
            </span>
            <Slider
              className="flex-1"
              value={currentTime}
              min={0}
              max={data.durationMinutes}
              step={0.5}
              onChange={(e: SliderChangeEvent) => jumpToTime(e.value as number)}
            />
          </div>
        </div>
      </div>

      <Sidebar
        visible={showEventLog}
        onHide={() => setShowEventLog(false)}
        position="right"
        className="w-full sm:w-[28rem]"
      >
        <SimulationEventLog
          events={visibleEvents}
          aircraft={data.aircraft}
          runwayIdentifier={runwayIdentifier}
        />
      </Sidebar>
    </div>
  );
}
