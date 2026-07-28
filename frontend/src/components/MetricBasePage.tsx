import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from 'primereact/button';
import { Message } from 'primereact/message';
import {
  POLL_INTERVAL_MS,
  SAFETY_POLL_INTERVAL_MS,
  useGet,
  usePollWhile,
  usePost,
} from '../functions/axios';
import { useSimulationSocket } from '../functions/socket';
import { isDetailComplete } from '../types/metrics';
import type { SimulationDetailResponse } from '../types/metrics';
import type { CreateSimulationRequest, Simulation } from '../types/simulation';
import { detailToRerunRequest } from '../schemas/simulationForm';
import type { MovementType } from '../types/visualisation';
import MetricsRunwayInfo from './MetricsRunwayInfo';
import MetricsSimVariables from './MetricsSimVariables';
import MetricsGeneralStats from './MetricsGeneralStats';
import MetricsMovementStats from './MetricsMovementStats';
import MetricsTimeline from './MetricsTimeline';
import LoadingScreen from './LoadingScreen';
import backgroundImage from '../assets/Background.png';

/** e.g. "26/06/2026 12:17" — a fixed format so it doesn't depend on the
 * viewer's browser locale. */
function formatDateTime(iso: string | null): string {
  if (!iso) {
    return 'unknown';
  }
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function MetricBasePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, loading, error, refetch } = useGet<SimulationDetailResponse>(
    id ? `/api/simulations/${id}/detail/` : null,
  );
  const [movementType, setMovementType] = useState<MovementType>('Arrival');
  const { execute: createRerun, loading: rerunning } = usePost<
    Simulation,
    CreateSimulationRequest
  >('/api/simulations/');

  // Clone this run's config *with its fixed seed* and navigate to the new run.
  const rerunWithSameSeed = async () => {
    if (!data || !isDetailComplete(data)) {
      return;
    }
    const created = await createRerun(detailToRerunRequest(data));
    if (created) {
      navigate(`/simulation/${created.id}/detail`);
    }
  };

  // Keep polling only while the run is still in flight (Pending/Running); stop
  // once it reaches any terminal state (Complete/Error/Cancelled).
  const isRunning = !!data && (data.status === 'Pending' || data.status === 'Running');
  // Prefer websocket push for this simulation, refetching on (re)connect to
  // catch anything missed during the connect window. Keep polling while it
  // runs — fast when push is down, slow as a safety net when it's up — so a
  // missed/half-open push never leaves the page stale until a manual refresh.
  const { connected } = useSimulationSocket(
    isRunning && id ? `/ws/simulations/${id}/` : null,
    refetch,
    refetch,
  );
  usePollWhile(isRunning, refetch, connected ? SAFETY_POLL_INTERVAL_MS : POLL_INTERVAL_MS);

  const backButton = (
    <Button
      icon="pi pi-chevron-left"
      aria-label="Back to home"
      onClick={() => navigate('/')}
      className="self-start"
    />
  );

  if (loading && !data) {
    return <LoadingScreen />;
  }

  if (error) {
    return (
      <div className="rounded-lg border border-slate-200 bg-brand-bg p-4 flex flex-col gap-3">
        {backButton}
        <Message severity="error" text={`Failed to load simulation: ${error.message}`} />
        <Button label="Retry" onClick={() => refetch()} className="self-start" />
      </div>
    );
  }

  if (!data) {
    return null;
  }

  if (!isDetailComplete(data)) {
    const isError = data.status === 'Error';
    const isCancelled = data.status === 'Cancelled';
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
              {backButton}
              <h1 className="text-center text-2xl font-bold uppercase tracking-wide text-slate-900">
                Airport Simulation
              </h1>
              <span aria-hidden className="w-10" />
            </div>
            <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
              <h2 className="text-2xl font-semibold text-slate-800">{data.name}</h2>
              <Message
                severity={isError ? 'error' : isCancelled ? 'warn' : 'info'}
                text={
                  isError
                    ? `Simulation failed: ${data.errorMessage ?? 'Unknown error'}`
                    : isCancelled
                      ? 'This simulation was cancelled — no metrics are available.'
                      : `Simulation is ${data.status.toLowerCase()}. Metrics will appear once it completes.`
                }
              />
              {!isError && !isCancelled && (
                <p className="text-sm text-slate-500">
                  This page refreshes automatically — metrics will appear as soon as the
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
          className="queue-scroll relative flex min-w-[800px] flex-col gap-2 overflow-y-auto rounded-lg border-2 border-black bg-white p-4 shadow-2xl sm:p-6"
          style={{ width: '100%', maxWidth: '1600px', maxHeight: '100%', aspectRatio: '1.5' }}
        >
          <h1 className="text-center text-2xl font-bold uppercase tracking-wide text-slate-900">
            Airport Simulation
          </h1>

          <div className="flex items-center gap-3 rounded-md bg-brand-accent px-1.5 py-1">
            <Button
              icon="pi pi-chevron-left"
              aria-label="Back to home"
              onClick={() => navigate('/')}
              className="!rounded-md !bg-brand-accent-active !border-brand-accent-active"
            />
            <span className="flex-1 text-center text-lg font-bold text-black">
              {data.name} - {formatDateTime(data.completedAt)}
            </span>
            {data.randomSeed != null && (
              <Button
                icon="pi pi-replay"
                label="Re-run"
                aria-label={`Re-run with the same seed (${data.randomSeed})`}
                tooltip={`Re-run with the same seed (${data.randomSeed}) for an identical run`}
                loading={rerunning}
                onClick={rerunWithSameSeed}
                className="!rounded-md !bg-brand-accent-active !border-brand-accent-active !text-black"
              />
            )}
            <Button
              icon="pi pi-eye"
              aria-label="View full replay"
              onClick={() => navigate(`/simulation/${data.id}/visualisation`)}
              className="!rounded-md !bg-brand-accent-active !border-brand-accent-active"
            />
          </div>

          <div className="grid flex-1 grid-cols-1 items-stretch gap-2 lg:grid-cols-3 lg:grid-rows-1">
            <div className="flex flex-col gap-2 lg:col-span-1">
              <MetricsRunwayInfo detail={data} className="flex-1" />
              <MetricsSimVariables detail={data} />
            </div>

            <div className="flex flex-col gap-2 lg:col-span-2">
              <MetricsGeneralStats detail={data} className="flex-1" />
              <MetricsMovementStats
                detail={data}
                movementType={movementType}
                onMovementTypeChange={setMovementType}
                className="flex-1"
              />
            </div>
          </div>

          <MetricsTimeline detail={data} />
        </div>
      </div>
    </div>
  );
}
