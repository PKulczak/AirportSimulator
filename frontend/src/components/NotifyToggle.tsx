import { useState } from 'react';
import {
  getNotificationPermission,
  requestNotificationPermission,
} from '../functions/notifications';

interface NotifyToggleProps {
  className?: string;
}

/**
 * Opt-in control for Slice D.2 — rendered by a page only while the
 * simulation/sweep it's watching is still Pending/Running. Lets the user
 * grant browser Notification permission so they're alerted even if they've
 * switched tabs or minimised the window by the time it finishes; the actual
 * notification is fired elsewhere via `useNotifyOnComplete`/`notify()` once
 * permission has been granted here.
 */
export default function NotifyToggle({ className }: NotifyToggleProps) {
  const [permission, setPermission] = useState(getNotificationPermission());

  // Nothing actionable to show: the API doesn't exist in this browser, or the
  // user has already blocked notifications for this site at the browser level.
  if (permission === 'unsupported' || permission === 'denied') {
    return null;
  }

  if (permission === 'granted') {
    return (
      <p className={`text-xs text-slate-500 ${className ?? ''}`}>
        <i className="pi pi-bell" aria-hidden /> We&apos;ll notify you when this finishes, even if
        you switch tabs.
      </p>
    );
  }

  return (
    <button
      type="button"
      className={`cursor-pointer text-xs font-semibold text-black underline decoration-brand-accent decoration-2 hover:decoration-brand-accent-hover ${className ?? ''}`}
      onClick={async () => setPermission(await requestNotificationPermission())}
    >
      Notify me when this finishes
    </button>
  );
}
