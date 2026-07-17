import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';

interface AlertButtonProps {
  active: boolean;
  /** Smaller footprint for embedding inside a runway card rather than a page header. */
  compact?: boolean;
}

/** Pulses when an emergency event falls within a short trailing window of currentTime. */
export default function AlertButton({ active, compact = false }: AlertButtonProps) {
  return (
    <div
      className={`flex items-center gap-2 rounded-full border font-medium transition-colors ${
        compact ? 'px-2 py-1 text-xs' : 'px-4 py-2 text-sm'
      } ${
        active
          ? 'border-red-300 bg-red-50 text-red-600 animate-pulse'
          : 'border-slate-200 bg-brand-bg text-slate-400'
      }`}
    >
      <FontAwesomeIcon icon={faTriangleExclamation} />
      {active ? 'Emergency in progress' : 'No active emergencies'}
    </div>
  );
}
