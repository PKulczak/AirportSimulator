import { DataTable } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { Tag } from 'primereact/tag';
import { Link } from 'react-router-dom';
import type { RunwayStat, SimulationDetail } from '../types/metrics';
import { OPERATIONAL_STATUS_STYLE } from '../functions/replayTheme';

export default function MetricsRunways({ detail }: { detail: SimulationDetail }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-slate-200 bg-brand-bg p-4 text-left">
        <h2 className="text-lg font-semibold text-slate-800 mb-3">Runway stats</h2>
        <DataTable value={detail.runwayStats} emptyMessage="No runway data">
          <Column field="identifier" header="Runway" />
          <Column field="operatingMode" header="Mode" />
          <Column
            field="operationalStatus"
            header="Status"
            body={(row: RunwayStat) => (
              <Tag
                value={OPERATIONAL_STATUS_STYLE[row.operationalStatus].label}
                severity={row.operationalStatus === 'Available' ? 'success' : 'warning'}
              />
            )}
          />
          <Column field="totalAssigned" header="Aircraft assigned" />
          <Column field="successCount" header="Succeeded" />
          <Column field="closureCount" header="Closures" />
        </DataTable>
      </div>

      {detail.includeClosures && (
        <div className="rounded-lg border border-slate-200 bg-brand-bg p-4 text-left">
          <h2 className="text-lg font-semibold text-slate-800 mb-3">Closure events</h2>
          <p className="text-sm text-slate-600">
            {detail.closureEventCount > 0
              ? `${detail.closureEventCount} closure event${detail.closureEventCount === 1 ? '' : 's'} occurred during this run.`
              : 'No closure events recorded.'}{' '}
            {detail.closureEventCount > 0 && (
              <Link
                to={`/simulation/${detail.id}/visualisation`}
                className="text-black underline decoration-brand-accent decoration-2 hover:decoration-brand-accent-hover"
              >
                View them in the replay &rarr;
              </Link>
            )}
          </p>
        </div>
      )}
    </div>
  );
}
