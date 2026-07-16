import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';

interface AlertButtonProps {
  active: boolean;
}

/** Pulses when an emergency event falls within a short trailing window of currentTime. */
export default function AlertButton({ active }: AlertButtonProps) {
  return (
    <div
      className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
        active
          ? 'border-red-300 bg-red-50 text-red-600 animate-pulse'
          : 'border-slate-200 bg-white text-slate-400'
      }`}
    >
      <FontAwesomeIcon icon={faTriangleExclamation} />
      {active ? 'Emergency in progress' : 'No active emergencies'}
    </div>
  );
}
