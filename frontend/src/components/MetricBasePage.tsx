import { Link, useParams } from 'react-router-dom';
import { Button } from 'primereact/button';
import { Message } from 'primereact/message';
import { useGet } from '../functions/axios';
import { isDetailComplete } from '../types/metrics';
import type { SimulationDetailResponse } from '../types/metrics';
import MetricsHeader from './MetricsHeader';
import MetricsSimVariables from './MetricsSimVariables';
import MetricsGrid from './MetricsGrid';
import MetricsRunways from './MetricsRunways';

export default function MetricBasePage() {
  const { id } = useParams<{ id: string }>();
  const { data, loading, error, refetch } = useGet<SimulationDetailResponse>(
    id ? `/api/simulations/${id}/detail/` : null,
  );

  if (loading && !data) {
    return <p className="text-slate-500">Loading simulation details...</p>;
  }

  if (error) {
    return (
      <div className="rounded-lg border border-slate-200 bg-brand-bg p-4 flex flex-col gap-3">
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
    <div className="flex flex-col gap-6">
      <MetricsHeader detail={data} />
      <MetricsSimVariables detail={data} />
      <MetricsGrid detail={data} />
      <MetricsRunways detail={data} />
      <Link
        to={`/simulation/${data.id}/visualisation`}
        className="self-start text-black underline decoration-brand-accent decoration-2 hover:decoration-brand-accent-hover"
      >
        View full replay &rarr;
      </Link>
    </div>
  );
}
