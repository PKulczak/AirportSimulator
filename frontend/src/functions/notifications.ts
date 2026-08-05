import { useEffect, useRef } from 'react';

/**
 * Thin wrapper around the Web Notifications API — lets a page alert the user
 * when a long-running simulation/sweep finishes after they've switched tabs
 * or minimised the window, without any backend involvement (permission and
 * delivery are both entirely client-side; see nextSteps.md Slice D.2).
 */

/** `Notification.permission` plus an extra state for browsers (e.g. iOS
 * Safari) that don't implement the API at all. */
export type NotificationSupportState = 'unsupported' | NotificationPermission;

export function isNotificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function getNotificationPermission(): NotificationSupportState {
  return isNotificationSupported() ? Notification.permission : 'unsupported';
}

/**
 * Must be called from a user gesture (e.g. a click handler) — Safari silently
 * ignores calls made outside one, and Chrome discourages it even though it
 * technically allows it.
 */
export async function requestNotificationPermission(): Promise<NotificationSupportState> {
  if (!isNotificationSupported()) {
    return 'unsupported';
  }
  return Notification.requestPermission();
}

/**
 * Shows a browser notification if permission has already been granted and
 * the tab isn't currently the one in the foreground — if the user is already
 * looking at this page, the on-page status update is enough, and a system
 * notification on top of it would just be noise. Clicking the notification
 * focuses this tab.
 */
export function notify(title: string, body: string): void {
  if (!isNotificationSupported() || Notification.permission !== 'granted') {
    return;
  }
  if (document.visibilityState === 'visible' && document.hasFocus()) {
    return;
  }
  const notification = new Notification(title, { body });
  notification.onclick = () => {
    window.focus();
    notification.close();
  };
}

/**
 * Calls `onComplete` exactly once, the moment `active` flips from `true` to
 * `false` — i.e. exactly when the thing being watched (a simulation/sweep)
 * transitions out of Pending/Running into a terminal state during this page
 * visit. Deliberately does NOT fire on mount when `active` starts `false`
 * (nothing just completed — it was already done before the page loaded), nor
 * while `active` stays `true` across re-renders.
 */
export function useNotifyOnComplete(active: boolean, onComplete: () => void): void {
  const wasActive = useRef(active);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    if (wasActive.current && !active) {
      onCompleteRef.current();
    }
    wasActive.current = active;
  }, [active]);
}
