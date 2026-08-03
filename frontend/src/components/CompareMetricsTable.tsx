import { useRef } from 'react';
import { Menu } from 'primereact/menu';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowDown, faArrowUp, faChevronDown, faEquals } from '@fortawesome/free-solid-svg-icons';
import type { SimulationDetail } from '../types/metrics';

export interface CompareRow {
  label: string;
  getValue: (run: SimulationDetail) => number | null;
  format: (value: number | null) => string;
  /** Omit for purely informational rows (e.g. config) that shouldn't be
   * highlighted as better/worse across runs. */
  better?: 'higher' | 'lower';
}

interface CompareMetricsTableProps {
  title: string;
  runs: SimulationDetail[];
  rows: CompareRow[];
  className?: string;
  /** All switchable category titles (including this one). When there's more
   * than one, the header becomes a click target that opens a dropdown of the
   * other categories instead of rendering a plain static label. */
  categories?: string[];
  onSelectCategory?: (title: string) => void;
}

/** One comparison panel: a metric-per-row, run-per-column table, with the
 * best/worst value in each row highlighted when the row declares a
 * `better` direction and the runs' values actually differ. */
export default function CompareMetricsTable({
  title,
  runs,
  rows,
  className,
  categories,
  onSelectCategory,
}: CompareMetricsTableProps) {
  const menuRef = useRef<Menu>(null);
  const switchable = (categories?.length ?? 0) > 1;
  const menuItems = (categories ?? [])
    .filter((category) => category !== title)
    .map((category) => ({ label: category, command: () => onSelectCategory?.(category) }));

  return (
    <div className={`flex flex-col overflow-hidden rounded-lg border border-slate-200 ${className ?? ''}`}>
      <h2 className="bg-brand-accent px-3 py-1.5 text-sm font-bold uppercase tracking-wide text-black">
        {switchable ? (
          // A real <button> (not a click handler on the heading itself) so
          // this category switcher — the only way to reach any category
          // besides the initial one in the compare view — is reachable and
          // activatable via keyboard/screen reader, not just a mouse click.
          <button
            type="button"
            onClick={(e) => menuRef.current?.toggle(e)}
            className="flex w-full cursor-pointer select-none items-center justify-between gap-2"
          >
            {title}
            <FontAwesomeIcon icon={faChevronDown} className="text-xs" />
          </button>
        ) : (
          <span className="flex items-center justify-between gap-2">{title}</span>
        )}
      </h2>
      {switchable && <Menu model={menuItems} popup ref={menuRef} />}
      <div className="flex-1 overflow-auto bg-brand-bg">
        <table className="w-full min-w-max text-sm">
          <thead>
            <tr className="border-b-2 border-black">
              <th className="whitespace-nowrap px-3 py-2 text-left font-bold text-slate-800">
                Metric
              </th>
              {runs.map((run) => (
                <th
                  key={run.id}
                  className="whitespace-nowrap px-3 py-2 text-center font-bold text-slate-800"
                >
                  {run.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const values = runs.map((run) => row.getValue(run));
              const numeric = values.filter((v): v is number => v != null);
              const hasDirection = row.better != null;
              const best =
                row.better === 'higher'
                  ? Math.max(...numeric)
                  : row.better === 'lower'
                    ? Math.min(...numeric)
                    : null;
              const worst =
                row.better === 'higher'
                  ? Math.min(...numeric)
                  : row.better === 'lower'
                    ? Math.max(...numeric)
                    : null;
              const showBestWorst = hasDirection && best != null && worst != null && best !== worst;
              const allTied = hasDirection && best != null && worst != null && best === worst;

              return (
                <tr key={row.label}>
                  <td className="whitespace-nowrap px-3 py-1.5 font-semibold text-slate-800">
                    {row.label}
                  </td>
                  {values.map((value, index) => {
                    const isBest = showBestWorst && value === best;
                    const isWorst = showBestWorst && value === worst;
                    const isTied = allTied && value != null;
                    const icon = isBest ? faArrowUp : isWorst ? faArrowDown : isTied ? faEquals : null;
                    const colorClass = isBest
                      ? 'font-bold text-green-700'
                      : isWorst
                        ? 'font-bold text-red-700'
                        : isTied
                          ? 'font-bold text-black'
                          : 'text-slate-700';

                    return (
                      <td key={runs[index].id} className={`px-3 py-1.5 text-center ${colorClass}`}>
                        <span className="inline-flex items-center justify-center gap-1.5">
                          {icon && <FontAwesomeIcon icon={icon} className="text-xs" />}
                          {row.format(value)}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
