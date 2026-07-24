import type { SimulationDetail, TimelineEvent } from '../types/metrics';

/** Target number of time buckets across the run — bucket width is derived
 * from this (rounded up), not fixed, so both a 60-minute and a 1200-minute
 * simulation end up with a similarly readable number of bars. */
const TARGET_BUCKET_COUNT = 100;

/** Widest a closure line ever gets, however many runways close in the same
 * bucket — keeps one extreme bucket from dwarfing every other bar. */
const MAX_CLOSURE_LINE_PX = 10;

interface Bucket {
  startMinutes: number;
  endMinutes: number;
  diverted: number;
  cancelled: number;
  closures: number;
}

function buildBuckets(events: TimelineEvent[], durationMinutes: number): Bucket[] {
  const bucketMinutes = Math.max(1, Math.ceil(durationMinutes / TARGET_BUCKET_COUNT));
  const bucketCount = Math.max(1, Math.ceil(durationMinutes / bucketMinutes));

  const buckets: Bucket[] = Array.from({ length: bucketCount }, (_, i) => ({
    startMinutes: i * bucketMinutes,
    endMinutes: Math.min(durationMinutes, (i + 1) * bucketMinutes),
    diverted: 0,
    cancelled: 0,
    closures: 0,
  }));

  for (const event of events) {
    const index = Math.min(bucketCount - 1, Math.max(0, Math.floor(event.timeMinutes / bucketMinutes)));
    if (event.type === 'Diverted') {
      buckets[index].diverted += 1;
    } else if (event.type === 'Cancelled') {
      buckets[index].cancelled += 1;
    } else {
      buckets[index].closures += 1;
    }
  }

  return buckets;
}

function bucketTooltip(bucket: Bucket): string {
  const parts = [`${bucket.startMinutes}–${bucket.endMinutes} min`];
  const removed = bucket.diverted + bucket.cancelled;
  if (removed > 0) {
    parts.push(`${bucket.diverted} diverted, ${bucket.cancelled} cancelled`);
  }
  if (bucket.closures > 0) {
    parts.push(`${bucket.closures} closure${bucket.closures === 1 ? '' : 's'}`);
  }
  return parts.join(' — ');
}

/** Summary chart: cancellations/diversions per time bucket as bar height,
 * runway closures as a red vertical line whose thickness scales with how
 * many closures landed in that bucket — bolder means more closures at once.
 * Deliberately not the animated replay — a quick "when did things go wrong"
 * overview at a glance, with the full detail (queues, runway occupancy)
 * still one click away via replay. Kept flat/wide (fixed short height, one
 * thin bar per bucket) rather than a tall chart, to match the compact strip
 * this replaced. */
export default function MetricsTimeline({ detail }: { detail: SimulationDetail }) {
  const { timelineEvents, durationMinutes } = detail;
  const buckets = buildBuckets(timelineEvents, durationMinutes);
  const maxRemoved = Math.max(1, ...buckets.map((b) => b.diverted + b.cancelled));
  const maxClosures = Math.max(1, ...buckets.map((b) => b.closures));

  return (
    <div className="shrink-0 rounded-lg overflow-hidden border border-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-brand-accent px-3 py-1.5">
        <span className="text-sm font-bold uppercase tracking-wide text-black">
          Cancellations &amp; Closures Over Time
        </span>
        <div className="flex items-center gap-3 text-xs font-medium text-black">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm bg-amber-500" />
            Diverted/cancelled
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-1 shrink-0 rounded-sm bg-red-600" />
            Runway closure (bolder = more)
          </span>
        </div>
      </div>

      <div className="bg-brand-bg px-4 py-2 [@media(min-height:950px)]:py-4">
        {timelineEvents.length === 0 ? (
          <p className="text-center text-sm text-slate-500">
            No diversions, cancellations, or closures occurred during this run.
          </p>
        ) : (
          <div className="flex h-10 items-end gap-px overflow-hidden [@media(min-height:950px)]:h-20">
            {buckets.map((bucket, index) => {
              const removed = bucket.diverted + bucket.cancelled;
              const removedHeightPct = (removed / maxRemoved) * 100;
              const closureWidthPx =
                bucket.closures > 0
                  ? Math.min(MAX_CLOSURE_LINE_PX, 2 + (bucket.closures / maxClosures) * (MAX_CLOSURE_LINE_PX - 2))
                  : 0;
              return (
                <div
                  key={index}
                  title={bucketTooltip(bucket)}
                  className="relative h-full min-w-px flex-1"
                >
                  {bucket.closures > 0 && (
                    <div
                      className="absolute inset-y-0 left-1/2 -translate-x-1/2 rounded-sm bg-red-600/70"
                      style={{ width: `${closureWidthPx}px` }}
                    />
                  )}
                  {removed > 0 && (
                    <div
                      className="absolute inset-x-0 bottom-0 rounded-t-sm bg-amber-500"
                      style={{ height: `${Math.max(6, removedHeightPct)}%` }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
        <div className="mt-1 flex justify-between text-xs text-slate-500">
          <span>0 min</span>
          <span>{durationMinutes} min</span>
        </div>
      </div>
    </div>
  );
}
