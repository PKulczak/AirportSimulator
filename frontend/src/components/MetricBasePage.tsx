import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from 'primereact/button';
import { Message } from 'primereact/message';
import { useGet } from '../functions/axios';
import { isDetailComplete } from '../types/metrics';
import type { SimulationDetailResponse } from '../types/metrics';
import type { MovementType } from '../types/visualisation';
import MetricsRunwayInfo from './MetricsRunwayInfo';
import MetricsSimVariables from './MetricsSimVariables';
import MetricsGeneralStats from './MetricsGeneralStats';
import MetricsMovementStats from './MetricsMovementStats';
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

  const backButton = (
    <Button
      icon="pi pi-chevron-left"
      aria-label="Back to home"
      onClick={() => navigate('/')}
      className="self-start"
    />
  );

  if (loading && !data) {
    return <p className="text-slate-500">Loading simulation details...</p>;
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
    return (
      <div className="rounded-lg border border-slate-200 bg-brand-bg p-4 flex flex-col gap-4">
        {backButton}
        <h1 className="text-2xl font-semibold text-slate-800">{data.name}</h1>
        <Message
          severity={data.status === 'Error' ? 'error' : 'info'}
          text={
            data.status === 'Error'
              ? `Simulation failed: ${data.errorMessage ?? 'Unknown error'}`
              : `Simulation is ${data.status.toLowerCase()}. Metrics will appear once it completes.`
          }
        />
        <p className="text-sm text-slate-500">
          This page does not auto-refresh while the simulation is running. Use the button
          below to check again.
        </p>
        <Button
          label="Check again"
          icon="pi pi-refresh"
          onClick={() => refetch()}
          className="self-start"
        />
      </div>
    );
  }

  return (
    <div className="-m-6 h-[calc(100%+3rem)] flex flex-col">
      <div
        className="relative flex-1 min-h-0 overflow-hidden p-4 sm:p-10 flex items-center justify-center"
        style={{
          backgroundImage: `url(${backgroundImage})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        }}
      >
        <div className="queue-scroll relative flex max-h-full w-full max-w-5xl flex-col gap-3 overflow-y-auto rounded-3xl bg-white p-4 shadow-2xl sm:p-6">
          <h1 className="text-center text-2xl font-bold uppercase tracking-wide text-slate-900">
            Airport Simulation
          </h1>

          <div className="flex items-center gap-3 rounded-full bg-brand-accent px-3 py-2">
            <Button
              icon="pi pi-chevron-left"
              aria-label="Back to home"
              onClick={() => navigate('/')}
              className="!rounded-full !bg-brand-accent-active !border-brand-accent-active"
            />
            <span className="flex-1 text-center text-lg font-bold text-black">
              {data.name} - {formatDateTime(data.completedAt)}
            </span>
            <Button
              icon="pi pi-eye"
              aria-label="View full replay"
              onClick={() => navigate(`/simulation/${data.id}/visualisation`)}
              className="!rounded-full !bg-brand-accent-active !border-brand-accent-active"
            />
          </div>

          <div className="grid grid-cols-1 items-stretch gap-3 lg:grid-cols-3">
            <div className="flex flex-col gap-3 lg:col-span-1">
              <MetricsRunwayInfo detail={data} />
              <MetricsSimVariables detail={data} className="flex-1" />
            </div>

            <div className="flex flex-col gap-3 lg:col-span-2">
              <MetricsGeneralStats detail={data} />
              <MetricsMovementStats
                detail={data}
                movementType={movementType}
                onMovementTypeChange={setMovementType}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
