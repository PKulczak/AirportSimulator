import { useEffect, useRef, useState } from 'react';

/** A simulation status change pushed over the websocket (see backend `SimulationStatusConsumer`). */
export interface SimulationStatusMessage {
  id: number;
  status: string;
}

/** Wait before reconnecting a dropped/failed socket, so a server without
 * websocket support doesn't spin in a tight reconnect loop (polling covers
 * the gap in the meantime). */
const RECONNECT_DELAY_MS = 5000;

/** Build a ws(s):// URL for `path` from the http(s) API base. */
function socketUrl(path: string): string {
  const base = import.meta.env.VITE_API_BASE_URL ?? window.location.origin;
  const url = new URL(base, window.location.origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = path;
  url.search = '';
  url.hash = '';
  return url.toString();
}

/**
 * Opens a websocket to `path` and invokes `onMessage` for each status message,
 * reconnecting if it drops. Returns `{ connected }` so callers can throttle
 * (not disable) their polling fallback while push is live. Pass `path = null`
 * to stay disconnected (e.g. once a simulation has reached a terminal state).
 *
 * The socket is a notification channel only: `onMessage` should refetch via the
 * REST API rather than trust the socket as a data source.
 *
 * `onOpen` fires on every (re)connect: callers pass their `refetch` so the page
 * immediately resyncs after the socket comes up. This closes the race where a
 * status transition is published *before* the client finishes joining the
 * channel group — channel groups don't replay, so that message would otherwise
 * be lost and, with polling suppressed, the page would sit stale until a manual
 * refresh.
 */
export function useSimulationSocket(
  path: string | null,
  onMessage: (message: SimulationStatusMessage) => void,
  onOpen?: () => void,
): { connected: boolean } {
  const [connected, setConnected] = useState(false);
  // Keep the latest callbacks without making them effect dependencies, so a new
  // inline callback each render doesn't tear down and rebuild the socket.
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  useEffect(() => {
    // Reset on every (re)subscribe: assume disconnected until the socket opens,
    // so polling stays active during the connect window and after path changes.
    setConnected(false);
    if (!path) {
      return;
    }

    let stopped = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (stopped) {
        return;
      }
      try {
        socket = new WebSocket(socketUrl(path));
      } catch {
        scheduleReconnect();
        return;
      }
      socket.onopen = () => {
        if (!stopped) {
          setConnected(true);
          // Resync immediately: catch any transition published during the
          // connect window (before we joined the group), which push won't replay.
          onOpenRef.current?.();
        }
      };
      socket.onmessage = (event) => {
        try {
          onMessageRef.current(JSON.parse(event.data) as SimulationStatusMessage);
        } catch {
          // Ignore malformed frames — the polling fallback still refreshes.
        }
      };
      socket.onclose = () => {
        if (stopped) {
          return;
        }
        setConnected(false);
        scheduleReconnect();
      };
      // onerror is followed by onclose; closing here makes that deterministic.
      socket.onerror = () => socket?.close();
    };

    const scheduleReconnect = () => {
      if (stopped || reconnectTimer) {
        return;
      }
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, RECONNECT_DELAY_MS);
    };

    connect();

    return () => {
      stopped = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      // Detach handlers before closing so the teardown doesn't trigger a reconnect.
      if (socket) {
        socket.onclose = null;
        socket.onerror = null;
        socket.close();
      }
    };
  }, [path]);

  return { connected };
}
