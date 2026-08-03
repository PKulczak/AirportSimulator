import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from 'primereact/button';
import { Message } from 'primereact/message';
import { Dialog } from 'primereact/dialog';
import { InputText } from 'primereact/inputtext';
import {
  apiClient,
  POLL_INTERVAL_MS,
  SAFETY_POLL_INTERVAL_MS,
  useGet,
  usePollWhile,
  usePost,
} from '../functions/axios';
import { useSimulationSocket } from '../functions/socket';
import { isDetailComplete } from '../types/metrics';
import type { SimulationDetailResponse } from '../types/metrics';
import type { CreateSimulationRequest, ShareLink, Simulation } from '../types/simulation';
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
  // Two route entries render this component: /simulation/:id/detail (the
  // owner-scoped, authenticated view) and /shared/:token/detail (Slice
  // 10.1's read-only share link) — exactly one of `id`/`token` is ever set,
  // and `isShared` below drives which fetch URL is used and which
  // owner-only actions (rerun/share) are hidden. CSV export and the print
  // summary are read-only themselves, so they stay available in shared mode
  // too — just pointed at the token-based endpoints/route instead.
  const { id, token } = useParams<{ id?: string; token?: string }>();
  const isShared = !!token;
  const navigate = useNavigate();
  const detailUrl = id
    ? `/api/simulations/${id}/detail/`
    : token
      ? `/api/shared/${token}/detail/`
      : null;
  const { data, loading, error, refetch } = useGet<SimulationDetailResponse>(detailUrl);
  const [movementType, setMovementType] = useState<MovementType>('Arrival');
  const { execute: createRerun, loading: rerunning } = usePost<
    Simulation,
    CreateSimulationRequest
  >('/api/simulations/');
  const { execute: createShare, loading: sharing } = usePost<ShareLink, void>(
    id ? `/api/simulations/${id}/share/` : '',
  );
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [shareCopied, setShareCopied] = useState(false);

  // A plain navigation (not a fetch+blob), so the browser handles the
  // download itself via the response's Content-Disposition: attachment —
  // no loading state or blob-URL cleanup to manage.
  const downloadCsv = () => {
    if (!data) {
      return;
    }
    const path = isShared
      ? `/api/shared/${token}/export.csv/`
      : `/api/simulations/${data.id}/export.csv/`;
    window.location.href = `${apiClient.defaults.baseURL}${path}`;
  };

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

  const openShare = async () => {
    setShareCopied(false);
    const result = await createShare();
    if (result) {
      setShareLink(`${window.location.origin}/shared/${result.token}/detail`);
    }
  };

  const copyShareLink = async () => {
    if (!shareLink) {
      return;
    }
    await navigator.clipboard.writeText(shareLink);
    setShareCopied(true);
  };

  // Keep polling only while the run is still in flight (Pending/Running); stop
  // once it reaches any terminal state (Complete/Error/Cancelled). Keyed off
  // `data.id` (the real simulation id, known once loaded) rather than the
  // route's `id` param so this also works on the token-based shared route.
  const isRunning = !!data && (data.status === 'Pending' || data.status === 'Running');
  // Prefer websocket push for this simulation, refetching on (re)connect to
  // catch anything missed during the connect window. Keep polling while it
  // runs — fast when push is down, slow as a safety net when it's up — so a
  // missed/half-open push never leaves the page stale until a manual refresh.
  const { connected } = useSimulationSocket(
    isRunning && data ? `/ws/simulations/${data.id}/` : null,
    refetch,
    refetch,
  );
  usePollWhile(isRunning, refetch, connected ? SAFETY_POLL_INTERVAL_MS : POLL_INTERVAL_MS);

  // A run that belongs to a sweep goes back to that sweep's results, not the
  // history home page — `data` is null in the loading/error states, so this
  // falls back to home there. Shared visitors have no sweep/history access at
  // all, so there's no back button in that mode (see backButton below).
  const backTarget = data?.batchId != null ? `/batch/${data.batchId}` : '/';
  const backButton = !isShared && (
    <Button
      icon="pi pi-chevron-left"
      aria-label="Back"
      onClick={() => navigate(backTarget)}
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
            {!isShared && (
              <Button
                icon="pi pi-chevron-left"
                aria-label="Back"
                onClick={() => navigate(backTarget)}
                className="!rounded-md !bg-brand-accent-active !border-brand-accent-active"
              />
            )}
            <span className="flex-1 text-center text-lg font-bold text-black">
              {data.name} - {formatDateTime(data.completedAt)}
            </span>
            {!isShared && (
              <Button
                icon="pi pi-replay"
                aria-label="Re-run with the same seed"
                tooltip={
                  data.randomSeed != null
                    ? `Re-run with the same seed (${data.randomSeed}) for an identical run`
                    : 'Re-run with the same seed for an identical run'
                }
                tooltipOptions={{ position: 'left' }}
                loading={rerunning}
                onClick={rerunWithSameSeed}
                className="!rounded-md !bg-brand-accent-active !border-brand-accent-active !text-black"
              />
            )}
            <Button
              icon="pi pi-eye"
              aria-label="View full replay"
              tooltip="View full replay"
              tooltipOptions={{ position: 'left' }}
              onClick={() =>
                navigate(
                  isShared ? `/shared/${token}/visualisation` : `/simulation/${data.id}/visualisation`,
                )
              }
              className="!rounded-md !bg-brand-accent-active !border-brand-accent-active"
            />
            <Button
              icon="pi pi-download"
              aria-label="Download per-aircraft CSV"
              tooltip="Download per-aircraft CSV"
              tooltipOptions={{ position: 'left' }}
              onClick={downloadCsv}
              className="!rounded-md !bg-brand-accent-active !border-brand-accent-active"
            />
            <Button
              icon="pi pi-print"
              aria-label="Print / save summary as PDF"
              tooltip="Print / save summary as PDF"
              tooltipOptions={{ position: 'left' }}
              onClick={() =>
                navigate(isShared ? `/shared/${token}/print` : `/simulation/${data.id}/print`)
              }
              className="!rounded-md !bg-brand-accent-active !border-brand-accent-active"
            />
            {!isShared && (
              <Button
                icon="pi pi-share-alt"
                aria-label="Share a read-only link"
                tooltip="Share a read-only link"
                tooltipOptions={{ position: 'left' }}
                loading={sharing}
                onClick={openShare}
                className="!rounded-md !bg-brand-accent-active !border-brand-accent-active"
              />
            )}
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

      <Dialog
        header="Share this run"
        visible={shareLink !== null}
        onHide={() => setShareLink(null)}
        draggable={false}
        dismissableMask
        style={{ width: '32rem', maxWidth: '90vw' }}
      >
        <div className="flex flex-col gap-2">
          <p className="text-sm text-slate-600">
            Anyone with this link can view this run&apos;s metrics and replay — no account
            required. They can&apos;t rename, delete, re-run, or export it.
          </p>
          <div className="flex gap-2">
            <InputText
              readOnly
              value={shareLink ?? ''}
              onFocus={(e) => e.target.select()}
              className="flex-1 bg-white"
            />
            <Button
              label={shareCopied ? 'Copied!' : 'Copy'}
              icon={shareCopied ? 'pi pi-check' : 'pi pi-copy'}
              onClick={copyShareLink}
              className="!border-brand-accent-active !bg-brand-accent-active !text-black"
            />
          </div>
        </div>
      </Dialog>
    </div>
  );
}
