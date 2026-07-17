import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
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
import type {
  EmergencyEvent,
  SimulationEvent,
  VisualisationResponseWire,
} from '../types/visualisation';
import Runway, { type RunwayEmergency, type RunwayOccupancy } from './Runway';
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

  // Emergencies are attributed to whichever runway the aircraft was (or will
  // be) assigned to, so each runway card shows only the emergencies relevant
  // to it rather than one page-wide mixed feed.
  const emergenciesForRunway = (runwayId: number): RunwayEmergency[] =>
    visibleEvents
      .filter(isEmergencyEvent)
      .filter((evt) => aircraftById.get(evt.aircraftId)?.runwayId === runwayId)
      .map((evt) => ({
        callsign: aircraftById.get(evt.aircraftId)?.callsign ?? `#${evt.aircraftId}`,
        eventType: evt.eventType,
        time: evt.time,
      }))
      .reverse();

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
        className="relative flex-1 min-h-0 overflow-hidden p-3 flex items-center justify-center"
        style={{
          backgroundImage: `url(${backgroundImage})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        }}
      >
        <div className="relative flex h-full w-full max-w-5xl flex-col overflow-hidden rounded-md border border-black bg-white shadow-lg">
          {/* Top bar: title on the left, timeline/speed/event-log controls top right */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-black/10 p-4">
            <h1 className="text-xl font-semibold text-slate-800 truncate">{data.name}</h1>
            <div className="flex flex-wrap items-center justify-end gap-3">
              <Button
                icon={isPlaying ? 'pi pi-pause' : 'pi pi-play'}
                label={isPlaying ? 'Pause' : 'Play'}
                onClick={() => setIsPlaying((prev) => !prev)}
                disabled={currentTime >= data.durationMinutes}
              />
              <Button icon="pi pi-replay" label="Reset" outlined onClick={resetSimulation} />
              <div className="flex flex-col gap-1 w-48">
                <span className="text-xs text-slate-600">Speed: {speed}x</span>
                <Slider
                  value={SPEED_OPTIONS.indexOf(speed)}
                  min={0}
                  max={SPEED_OPTIONS.length - 1}
                  step={1}
                  onChange={(e: SliderChangeEvent) => setSpeed(SPEED_OPTIONS[e.value as number])}
                />
              </div>
              <Button
                icon="pi pi-list"
                label={showEventLog ? 'Hide event log' : 'Show event log'}
                outlined
                onClick={() => setShowEventLog((prev) => !prev)}
              />
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
              />
            </div>

            <div className="flex min-h-0 flex-col gap-4 overflow-y-auto">
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
                const emergencies = emergenciesForRunway(rw.runwayId);
                const emergencyActive = emergencies.some(
                  (e) => currentTime - e.time <= EMERGENCY_WINDOW_MINUTES,
                );
                return (
                  <Runway
                    key={rw.runwayId}
                    identifier={rw.identifier}
                    operatingMode={rw.operatingMode}
                    closed={state.closed}
                    occupancy={occupancy}
                    emergencies={emergencies}
                    emergencyActive={emergencyActive}
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
              />
            </div>
          </div>

          {/* Timeline scrubber, pinned to the bottom of the box */}
          <div className="flex flex-col gap-1 border-t border-black/10 p-4">
            <span className="text-sm text-slate-600">
              t = {currentTime.toFixed(1)} / {data.durationMinutes} min
            </span>
            <Slider
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
