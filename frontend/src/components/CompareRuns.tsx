import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Button } from 'primereact/button';
import { Message } from 'primereact/message';
import { apiClient, useGet, usePost } from '../functions/axios';
import { isDetailComplete } from '../types/metrics';
import type { SimulationDetail, SimulationDetailResponse } from '../types/metrics';
import type { ShareLink } from '../types/simulation';
import CompareMetricsTable, { type CompareRow } from './CompareMetricsTable';
import LoadingScreen from './LoadingScreen';
import ShareLinkDialog from './ShareLinkDialog';
import backgroundImage from '../assets/Background.png';

const formatMinutes = (value: number | null) => (value != null ? value.toFixed(1) : '—');
const formatCount = (value: number | null) => (value != null ? String(value) : '—');
const formatPercent = (value: number | null) => (value != null ? `${Math.round(value)}%` : '—');

const GENERAL_ROWS: CompareRow[] = [
  { label: 'Total Aircraft Generated', getValue: (r) => r.outcomeCounts.total, format: formatCount },
  {
    label: 'Success Rate',
    getValue: (r) => r.successRate,
    format: formatPercent,
    better: 'higher',
  },
  {
    label: 'Successful Ops',
    getValue: (r) => r.outcomeCounts.success,
    format: formatCount,
    better: 'higher',
  },
  { label: 'Diverted', getValue: (r) => r.outcomeCounts.diverted, format: formatCount, better: 'lower' },
  { label: 'Cancelled', getValue: (r) => r.outcomeCounts.cancelled, format: formatCount, better: 'lower' },
  {
    label: 'Avg Wait (mins)',
    getValue: (r) => r.waitTimeStats.averageMinutes,
    format: formatMinutes,
    better: 'lower',
  },
  {
    label: 'Max Wait (mins)',
    getValue: (r) => r.waitTimeStats.maxMinutes,
    format: formatMinutes,
    better: 'lower',
  },
  {
    label: 'Runway Closure Events',
    getValue: (r) => r.closureEventCount,
    format: formatCount,
    better: 'lower',
  },
];

const ARRIVAL_ROWS: CompareRow[] = [
  {
    label: 'Max Holding Queue',
    getValue: (r) => r.queueDepthStats.arrival,
    format: formatCount,
    better: 'lower',
  },
  {
    label: 'Avg Delay (mins)',
    getValue: (r) => r.delayStats.arrival.averageMinutes,
    format: formatMinutes,
    better: 'lower',
  },
  {
    label: 'Max Delay (mins)',
    getValue: (r) => r.delayStats.arrival.maxMinutes,
    format: formatMinutes,
    better: 'lower',
  },
  { label: 'Diverted', getValue: (r) => r.outcomeCounts.diverted, format: formatCount, better: 'lower' },
  {
    label: 'Configured Arrival Rate (/hr)',
    getValue: (r) => r.arrivalRatePerHour,
    format: formatCount,
  },
];

const DEPARTURE_ROWS: CompareRow[] = [
  {
    label: 'Max Takeoff Queue',
    getValue: (r) => r.queueDepthStats.departure,
    format: formatCount,
    better: 'lower',
  },
  {
    label: 'Avg Delay (mins)',
    getValue: (r) => r.delayStats.departure.averageMinutes,
    format: formatMinutes,
    better: 'lower',
  },
  {
    label: 'Max Delay (mins)',
    getValue: (r) => r.delayStats.departure.maxMinutes,
    format: formatMinutes,
    better: 'lower',
  },
  { label: 'Cancelled', getValue: (r) => r.outcomeCounts.cancelled, format: formatCount, better: 'lower' },
  {
    label: 'Configured Departure Rate (/hr)',
    getValue: (r) => r.departureRatePerHour,
    format: formatCount,
  },
];

const avgOpenPercent = (run: SimulationDetail): number | null => {
  if (run.runwayStats.length === 0 || run.durationMinutes <= 0) {
    return null;
  }
  const totalOpenMinutes = run.runwayStats.reduce((sum, rs) => sum + rs.openMinutes, 0);
  return (totalOpenMinutes / (run.runwayStats.length * run.durationMinutes)) * 100;
};

const RUNWAY_ROWS: CompareRow[] = [
  { label: 'Runway Count', getValue: (r) => r.runwayStats.length, format: formatCount },
  { label: 'Avg Open Time', getValue: avgOpenPercent, format: formatPercent, better: 'higher' },
];

const SIM_VARIABLE_ROWS: CompareRow[] = [
  { label: 'Duration (mins)', getValue: (r) => r.durationMinutes, format: formatCount },
  { label: 'Max Wait Config (mins)', getValue: (r) => r.maxWaitMinutes, format: formatCount },
  { label: 'Aircraft Speed (kts)', getValue: (r) => r.aircraftSpeedKnots, format: formatCount },
  {
    label: 'Closures Included',
    getValue: (r) => (r.includeClosures ? 1 : 0),
    format: (v) => (v ? 'Yes' : 'No'),
  },
  { label: 'Random Seed', getValue: (r) => r.randomSeed, format: (v) => (v != null ? String(v) : 'Random') },
];

interface CompareCategory {
  title: string;
  rows: CompareRow[];
}

const CATEGORIES: CompareCategory[] = [
  { title: 'General Stats', rows: GENERAL_ROWS },
  { title: 'Arrival Metrics', rows: ARRIVAL_ROWS },
  { title: 'Departure Metrics', rows: DEPARTURE_ROWS },
  { title: 'Runways', rows: RUNWAY_ROWS },
  { title: 'Sim Variables', rows: SIM_VARIABLE_ROWS },
];

/** Fetches `/detail/` for every id in parallel and keys the results back up
 * by id. `useGet` only handles a single URL, and mounting one child fetcher
 * component per id (rather than this) would work too, but this keeps the
 * comparison table's data in one place instead of threading it back up via
 * per-column callbacks. */
function useCompareDetails(ids: number[]) {
  const [data, setData] = useState<Record<number, SimulationDetailResponse>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idsKey = ids.join(',');

  useEffect(() => {
    if (ids.length === 0) {
      setData({});
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all(
      ids.map((id) =>
        apiClient
          .get<SimulationDetailResponse>(`/api/simulations/${id}/detail/`)
          .then((res) => [id, res.data] as const),
      ),
    )
      .then((pairs) => {
        if (!cancelled) {
          setData(Object.fromEntries(pairs));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError('Failed to load one or more runs for comparison.');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  return { data, loading, error };
}

/** Shared-link counterpart to useCompareDetails above: one request for the
 * whole (already-resolved, server-side) set of ids instead of N parallel
 * per-id fetches — there's no authenticated `ids` query param to drive N
 * fetches from in shared mode, just the token. */
function useSharedCompareDetails(token: string | null) {
  const { data, loading, error } = useGet<SimulationDetailResponse[]>(
    token ? `/api/shared/compare/${token}/` : null,
  );
  return {
    ids: useMemo(() => data?.map((d) => d.id) ?? [], [data]),
    data: useMemo(
      () => (data ? Object.fromEntries(data.map((d) => [d.id, d])) : {}),
      [data],
    ),
    loading,
    error: error ? 'Failed to load this shared comparison.' : null,
  };
}

export default function CompareRuns() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Two route entries render this component: /compare?ids=... (the
  // owner-scoped, authenticated view) and /shared/compare/:token (Slice
  // A.2's read-only share link) — exactly one of the `ids` query param /
  // `token` route param is ever meaningful.
  const { token } = useParams<{ token?: string }>();
  const isShared = !!token;
  const [activeTitle, setActiveTitle] = useState(CATEGORIES[0].title);
  const activeCategory = CATEGORIES.find((c) => c.title === activeTitle) ?? CATEGORIES[0];
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);

  const ids = useMemo(() => {
    const raw = searchParams.get('ids') ?? '';
    const parsed = raw
      .split(',')
      .map((part) => Number(part.trim()))
      .filter((n) => Number.isInteger(n) && n > 0);
    return Array.from(new Set(parsed));
  }, [searchParams]);

  const authedResult = useCompareDetails(isShared ? [] : ids);
  const sharedResult = useSharedCompareDetails(token ?? null);
  const effectiveIds = isShared ? sharedResult.ids : ids;
  const data = isShared ? sharedResult.data : authedResult.data;
  const loading = isShared ? sharedResult.loading : authedResult.loading;
  const error = isShared ? sharedResult.error : authedResult.error;

  const {
    execute: createShare,
    loading: sharing,
    error: shareError,
  } = usePost<ShareLink, void>(
    !isShared && ids.length >= 2 ? `/api/simulations/compare/share/?ids=${ids.join(',')}` : '',
  );

  const openShare = async () => {
    setShareCopied(false);
    const result = await createShare();
    if (result) {
      setShareLink(`${window.location.origin}/shared/compare/${result.token}`);
    }
  };

  const copyShareLink = async () => {
    if (!shareLink) {
      return;
    }
    setCopyError(false);
    try {
      await navigator.clipboard.writeText(shareLink);
      setShareCopied(true);
    } catch {
      setCopyError(true);
    }
  };

  // Shared visitors have no account/history to go back to, same reasoning as
  // MetricBasePage's/SweepResults's own `!isShared` back-button guard.
  const backButton = !isShared && (
    <Button
      icon="pi pi-chevron-left"
      aria-label="Back to home"
      onClick={() => navigate('/')}
      className="self-start"
    />
  );

  const shell = (content: ReactNode) => (
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
          {content}
        </div>
      </div>

      <ShareLinkDialog
        header="Share this comparison"
        description="Anyone with this link can view this comparison — no account required. They can't change which runs are included."
        visible={shareLink !== null}
        onHide={() => setShareLink(null)}
        shareLink={shareLink}
        copied={shareCopied}
        onCopy={copyShareLink}
        copyError={copyError}
      />
    </div>
  );

  const header = (
    <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3">
      {backButton}
      <h1 className="text-center text-2xl font-bold uppercase tracking-wide text-slate-900">
        Compare Runs
      </h1>
      {!isShared && ids.length >= 2 ? (
        <Button
          icon="pi pi-share-alt"
          aria-label="Share a read-only link"
          tooltip="Share a read-only link"
          tooltipOptions={{ position: 'left' }}
          loading={sharing}
          onClick={openShare}
          className="justify-self-end"
        />
      ) : (
        <span aria-hidden className="w-10" />
      )}
    </div>
  );

  if (!isShared && ids.length < 2) {
    return shell(
      <>
        {header}
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <Message
            severity="info"
            text="Select 2 or more completed runs from the history page to compare."
          />
          <Button label="Back to history" onClick={() => navigate('/')} />
        </div>
      </>,
    );
  }

  if (loading) {
    return <LoadingScreen />;
  }

  if (error) {
    return shell(
      <>
        {header}
        <Message severity="error" text={error} />
      </>,
    );
  }

  const details = effectiveIds
    .map((id) => data[id])
    .filter((d): d is SimulationDetailResponse => d != null);
  const completeRuns = details.filter(isDetailComplete);
  const incompleteCount = details.length - completeRuns.length;

  if (completeRuns.length < 2) {
    return shell(
      <>
        {header}
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <Message
            severity="warn"
            text={
              isShared
                ? "This shared comparison doesn't have enough Complete runs to display."
                : 'At least 2 of the selected runs must be Complete to compare. Go back and pick different runs.'
            }
          />
          {!isShared && <Button label="Back to history" onClick={() => navigate('/')} />}
        </div>
      </>,
    );
  }

  return shell(
    <>
      {header}
      {shareError && (
        <Message severity="error" text={`Failed to create a share link: ${shareError.message}`} />
      )}
      {incompleteCount > 0 && (
        <Message
          severity="warn"
          text={`${incompleteCount} selected run${incompleteCount === 1 ? '' : 's'} ${
            incompleteCount === 1 ? "isn't" : "aren't"
          } Complete and ${incompleteCount === 1 ? 'is' : 'are'} excluded from this comparison.`}
        />
      )}
      <CompareMetricsTable
        title={activeCategory.title}
        runs={completeRuns}
        rows={activeCategory.rows}
        categories={CATEGORIES.map((c) => c.title)}
        onSelectCategory={setActiveTitle}
        className="flex-1"
      />
    </>,
  );
}
