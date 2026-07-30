import { useNavigate, useParams } from 'react-router-dom';
import { Button } from 'primereact/button';
import { Message } from 'primereact/message';
import { useGet } from '../functions/axios';
import { isDetailComplete } from '../types/metrics';
import type { SimulationDetailResponse } from '../types/metrics';
import MetricsRunwayInfo from './MetricsRunwayInfo';
import MetricsSimVariables from './MetricsSimVariables';
import MetricsGeneralStats from './MetricsGeneralStats';
import MetricsMovementStats from './MetricsMovementStats';
import MetricsTimeline from './MetricsTimeline';
import LoadingScreen from './LoadingScreen';

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

/** A print-friendly, single-column summary of a completed run: the same
 * metrics as the dashboard (MetricBasePage), laid out for a printed page/
 * saved PDF instead of the dashboard's fixed-aspect-ratio on-screen card.
 * Reuses the dashboard's own metric components directly (same data, same
 * formatting) rather than duplicating their logic — only the layout and the
 * page chrome around them differ. `window.print()` is the "export"; there's
 * no server-rendered file, so no loading/blob state to manage. */
export default function SimulationPrintSummary() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, loading, error } = useGet<SimulationDetailResponse>(
    id ? `/api/simulations/${id}/detail/` : null,
  );

  const backToDetail = () => navigate(`/simulation/${id}/detail`);

  if (loading && !data) {
    return <LoadingScreen />;
  }

  if (error) {
    return (
      <div className="flex flex-col gap-3">
        <Message severity="error" text={`Failed to load simulation: ${error.message}`} />
        <Button label="Back" icon="pi pi-chevron-left" onClick={backToDetail} className="self-start" />
      </div>
    );
  }

  if (!data) {
    return null;
  }

  if (!isDetailComplete(data)) {
    return (
      <div className="flex flex-col gap-3">
        <Message severity="info" text="Only a completed run has a printable summary." />
        <Button label="Back" icon="pi pi-chevron-left" onClick={backToDetail} className="self-start" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 bg-white p-6 text-black print:max-w-none print:p-0">
      {/* Screen-only controls — never shown in the printed/PDF output. */}
      <div className="flex items-center justify-between gap-3 print:hidden">
        <Button icon="pi pi-chevron-left" aria-label="Back to detail" onClick={backToDetail} />
        <Button
          icon="pi pi-print"
          label="Print / Save as PDF"
          onClick={() => window.print()}
          className="!bg-brand-accent-active !border-brand-accent-active"
        />
      </div>

      <div className="flex flex-col gap-1 border-b-2 border-black pb-2">
        <h1 className="text-2xl font-bold uppercase tracking-wide">Simulation Summary</h1>
        <p className="text-lg font-semibold">{data.name}</p>
        <p className="text-sm text-slate-600">Completed {formatDateTime(data.completedAt)}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 print:grid-cols-2 print:break-inside-avoid">
        <MetricsSimVariables detail={data} />
        <MetricsRunwayInfo detail={data} />
      </div>

      <div className="print:break-inside-avoid">
        <MetricsGeneralStats detail={data} />
      </div>
      <div className="print:break-inside-avoid">
        <MetricsMovementStats detail={data} movementType="Arrival" onMovementTypeChange={() => {}} />
      </div>
      <div className="print:break-inside-avoid">
        <MetricsMovementStats detail={data} movementType="Departure" onMovementTypeChange={() => {}} />
      </div>
      <div className="print:break-inside-avoid">
        <MetricsTimeline detail={data} />
      </div>
    </div>
  );
}
