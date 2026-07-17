import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Slider, type SliderChangeEvent } from 'primereact/slider';
import { Button } from 'primereact/button';
import { Message } from 'primereact/message';
import { Sidebar } from 'primereact/sidebar';
import { useGet } from '../functions/axios';
import { useRunways } from '../context/RunwayContext';
import {
  deriveRunwayState,
  eventsUpTo,
  normalizeVisualisation,
  processEvents,
} from '../functions/visualisationHelpers';
import { EMERGENCY_LEGEND, MODE_LEGEND } from '../functions/replayTheme';
import type {
  AircraftEventType,
  EmergencyEvent,
  SimulationEvent,
  VisualisationResponseWire,
} from '../types/visualisation';
import Runway, { type RunwayOccupancy } from './Runway';
import QueueTable from './QueueTable';
import SimulationEventLog from './SimulationEventLog';
import backgroundImage from '../assets/Background.png';

// At 1x, one tick fires per second and advances the sim clock by
// BASE_STEP_MINUTES; other speeds scale the per-tick step, not the interval,
// so they stay proportional to this 1x baseline automatically.
const TICK_INTERVAL_MS = 1000;
const BASE_STEP_MINUTES = 1;
const SPEED_OPTIONS = [0.125, 0.25, 0.5, 1, 2, 4, 8];
const EMERGENCY_WINDOW_MINUTES = 5;

export default function SimulationVisualisation() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { runways: masterRunways } = useRunways();
  const { data: raw, loading, error, refetch } = useGet<VisualisationResponseWire>(
    id ? `/api/simulations/${id}/visualisation/` : null,
  );

  const data = useMemo(
    () => (raw && raw.status === 'Complete' ? normalizeVisualisation(raw) : undefined),
    [raw],
  );

  const events = useMemo(() => (data ? processEvents(data) : []), [data]);

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
      setCurrentTime((prev) => Math.min(prev + BASE_STEP_MINUTES * speed, data.durationMinutes));
    }, TICK_INTERVAL_MS);

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
      clearScheduledTick();
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

  if (loading && !raw) {
    return <p className="text-slate-500">Loading visualisation...</p>;
  }

  if (error) {
    return <Message severity="error" text={`Failed to load visualisation: ${error.message}`} />;
  }

  if (!raw) {
    return null;
  }

  if (!data) {
    return (
      <div className="rounded-lg border border-slate-200 bg-brand-bg p-4 flex flex-col gap-4">
        <h1 className="text-2xl font-semibold text-slate-800">{raw.name}</h1>
        <Message
          severity={raw.status === 'Error' ? 'error' : 'info'}
          text={
            raw.status === 'Error'
              ? 'Simulation failed — no replay data available.'
              : `Simulation is ${raw.status.toLowerCase()}. Replay will be available once it completes.`
          }
        />
        <p className="text-sm text-slate-500">
          This page does not auto-refresh while the simulation is running. Use the button
          below to check again.
        </p>
        <Button label="Check again" icon="pi pi-refresh" onClick={() => refetch()} className="self-start" />
      </div>
    );
  }

  const visibleEvents = eventsUpTo(events, currentTime);
  const aircraftById = new Map(data.aircraft.map((a) => [a.id, a]));

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
       * (queue tables, runway list, event log) do. */}
      <div
        className="relative flex-1 min-h-0 overflow-hidden p-4 sm:p-10 flex items-center justify-center"
        style={{
          backgroundImage: `url(${backgroundImage})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        }}
      >
        <div className="relative flex h-full w-full max-w-5xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
          {/* Top bar: page title, then back/name/clock */}
          <div className="flex flex-col gap-3 border-b border-slate-100 p-4">
            <h1 className="text-center text-2xl font-bold uppercase tracking-wide text-slate-900">
              Airport Simulation
            </h1>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Button
                  icon="pi pi-chevron-left"
                  aria-label="Back"
                  onClick={() => navigate(-1)}
                />
                <span className="text-lg font-bold text-slate-900 truncate">{data.name}</span>
              </div>

              <span className="text-lg font-bold text-slate-900">
                Current Time: {Math.round(currentTime)} mins
              </span>
            </div>

            {/* Legend/controls row mirrors the 3-column body grid below, so
             * each group is locked directly above the element it describes:
             * the emergency legend over the holding queue (where the dots
             * appear), the runway-mode legend over the runway list, and the
             * playback controls over the takeoff queue. */}
            <div className="grid grid-cols-1 items-center gap-4 lg:grid-cols-3">
              <div className="flex flex-wrap items-center gap-4">
                {EMERGENCY_LEGEND.map((item) => (
                  <span key={item.label} className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
                    <span className={`h-3 w-3 rounded-sm ${item.dot}`} />
                    {item.label}
                  </span>
                ))}
              </div>

              <div className="flex flex-wrap items-center justify-center gap-4">
                {MODE_LEGEND.map((item) => (
                  <span key={item.mode} className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
                    <span className={`h-3 w-3 rounded-sm ${item.bg}`} />
                    {item.label}
                  </span>
                ))}
              </div>

              <div className="flex flex-wrap items-center justify-end gap-3">
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
                <Button
                  icon="pi pi-list"
                  label="Event Log"
                  onClick={() => setShowEventLog((prev) => !prev)}
                />
              </div>
            </div>
          </div>

          {/* Main content: arrivals queue | runway list | departures queue */}
          <div className="grid flex-1 min-h-0 grid-cols-1 gap-4 overflow-hidden p-4 lg:grid-cols-3">
            <div className="min-h-0">
              <QueueTable
                events={events}
                currentTime={currentTime}
                aircraft={data.aircraft}
                movementType="Arrival"
                activeEmergencyByAircraft={activeEmergencyByAircraft}
              />
            </div>

            <div className="queue-scroll flex min-h-0 flex-col gap-3 overflow-y-auto">
              {data.runways.map((rw) => {
                const state = deriveRunwayState(events, currentTime, rw.runwayId);
                let occupancy: RunwayOccupancy | null = null;
                if (state.occupiedByAircraftId !== null) {
                  const ac = aircraftById.get(state.occupiedByAircraftId);
                  if (ac && ac.runwayAssignedTime !== null && ac.completionTime !== null) {
                    occupancy = {
                      callsign: ac.callsign,
                      startTime: ac.runwayAssignedTime,
                      endTime: ac.completionTime,
                    };
                  }
                }
                const activeEmergency =
                  state.occupiedByAircraftId !== null
                    ? activeEmergencyByAircraft.get(state.occupiedByAircraftId) ?? null
                    : null;
                return (
                  <Runway
                    key={rw.runwayId}
                    identifier={rw.identifier}
                    operatingMode={rw.operatingMode}
                    closed={state.closed}
                    occupancy={occupancy}
                    activeEmergency={activeEmergency}
                    getSmoothTime={getSmoothTime}
                  />
                );
              })}
            </div>

            <div className="min-h-0">
              <QueueTable
                events={events}
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
