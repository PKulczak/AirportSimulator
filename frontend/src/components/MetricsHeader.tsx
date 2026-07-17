import { Tag } from 'primereact/tag';
import type { SimulationDetail } from '../types/metrics';

export default function MetricsHeader({ detail }: { detail: SimulationDetail }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-brand-bg p-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold text-slate-800">{detail.name}</h1>
        <p className="text-sm text-slate-500">
          Completed{' '}
          {detail.completedAt ? new Date(detail.completedAt).toLocaleString() : 'unknown'}
        </p>
      </div>
      <Tag value={detail.status} severity="success" />
    </div>
  );
}
