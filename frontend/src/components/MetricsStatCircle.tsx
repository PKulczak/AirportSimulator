interface MetricsStatCircleProps {
  value: string;
  label: string;
}

/** A single stat rendered as a bordered circle with the value inside and a
 * label underneath — the repeating "6 circles in a row" unit used by both
 * the general-stats panel and the switchable arrival/departure panel. */
export default function MetricsStatCircle({ value, label }: MetricsStatCircleProps) {
  return (
    <div className="flex flex-col items-center gap-1.5 text-center">
      <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full border-4 border-brand-accent bg-white text-xl font-bold text-slate-800">
        {value}
      </div>
      <p className="text-xs font-medium text-slate-600">{label}</p>
    </div>
  );
}
