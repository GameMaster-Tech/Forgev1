"use client";

/**
 * useCalendarStream — subscribe to /api/realtime/calendar over SSE.
 *
 * Lifecycle:
 *   • Opens the stream on mount.
 *   • Auto-reconnects with exponential backoff on close.
 *   • Pauses while the tab is hidden (visibilitychange) to save
 *     server fan-out work.
 *   • Tears down on unmount cleanly.
 *
 * The hook returns:
 *   { status, lastEvent, presence, reconnect }
 *
 * Where `presence` is a count of currently-connected tabs for this
 * user (decoded from `presence` events).
 */

import { useCallback, useEffect, useReducer, useRef } from "react";

export type StreamStatus = "idle" | "connecting" | "open" | "closed" | "error";

interface CalendarRealtimeEvent {
  kind: string;
  at: number;
  [k: string]: unknown;
}

interface State {
  status: StreamStatus;
  lastEvent: CalendarRealtimeEvent | null;
  presence: number;
  reconnectAttempt: number;
}

type Action =
  | { type: "open" }
  | { type: "close"; attempt: number }
  | { type: "error" }
  | { type: "event"; event: CalendarRealtimeEvent };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "open":  return { ...state, status: "open", reconnectAttempt: 0 };
    case "close": return { ...state, status: "closed", reconnectAttempt: action.attempt };
    case "error": return { ...state, status: "error" };
    case "event": {
      let presence = state.presence;
      if (action.event.kind === "presence") {
        const status = action.event.status as "join" | "leave" | undefined;
        if (status === "join") presence += 1;
        else if (status === "leave") presence = Math.max(0, presence - 1);
      }
      return { ...state, lastEvent: action.event, presence };
    }
  }
}

export interface UseCalendarStreamOptions {
  /** Provide a bearer ID token if your auth flow needs it. */
  getIdToken?: () => Promise<string | null>;
  /** Filter to events you care about. Default: all. */
  onEvent?: (e: CalendarRealtimeEvent) => void;
  /** Disable auto-reconnect (tests). */
  reconnect?: boolean;
}

export function useCalendarStream(opts: UseCalendarStreamOptions = {}) {
  const [state, dispatch] = useReducer(reducer, {
    status: "idle",
    lastEvent: null,
    presence: 0,
    reconnectAttempt: 0,
  });
  const esRef = useRef<EventSource | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disposedRef = useRef(false);

  const connect = useCallback(async () => {
    if (disposedRef.current) return;
    if (typeof window === "undefined" || typeof EventSource === "undefined") return;
    if (document.visibilityState === "hidden") return; // wait until visible
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    // EventSource doesn't support custom headers. For Bearer-token auth,
    // tunnel the token through a one-shot `?ticket=` query param that
    // the server route accepts as a fallback (not implemented here for
    // brevity — see server route to add).
    const token = opts.getIdToken ? await opts.getIdToken() : null;
    const tabId = sessionStorage.getItem("forge.tabId") ?? cryptoRandomToken();
    sessionStorage.setItem("forge.tabId", tabId);
    const url = `/api/realtime/calendar?tab=${encodeURIComponent(tabId)}${token ? `&token=${encodeURIComponent(token)}` : ""}`;
    const es = new EventSource(url, { withCredentials: true });
    esRef.current = es;

    es.onopen = () => dispatch({ type: "open" });
    es.onerror = () => {
      dispatch({ type: "error" });
      es.close();
      esRef.current = null;
      if (opts.reconnect === false || disposedRef.current) return;
      const attempt = state.reconnectAttempt + 1;
      const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5));
      dispatch({ type: "close", attempt });
      reconnectTimer.current = setTimeout(() => void connect(), delay);
    };
    es.onmessage = (msg) => {
      try {
        const parsed = JSON.parse(msg.data) as CalendarRealtimeEvent;
        dispatch({ type: "event", event: parsed });
        opts.onEvent?.(parsed);
      } catch {/* ignore malformed */}
    };
    // Server uses named events; bind common ones.
    const kinds = ["sync.complete", "sync.error", "event.upsert", "event.delete", "task.upsert", "task.delete", "habit.completed", "plan.replanned", "presence"];
    for (const kind of kinds) {
      es.addEventListener(kind, (ev) => {
        try {
          const parsed = JSON.parse((ev as MessageEvent).data) as CalendarRealtimeEvent;
          dispatch({ type: "event", event: parsed });
          opts.onEvent?.(parsed);
        } catch {/* ignore */}
      });
    }
  }, [opts, state.reconnectAttempt]);

  // Mount + visibility.
  useEffect(() => {
    disposedRef.current = false;
    void connect();
    const onVisibility = () => {
      if (document.visibilityState === "visible" && !esRef.current && !disposedRef.current) {
        void connect();
      } else if (document.visibilityState === "hidden" && esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposedRef.current = true;
      document.removeEventListener("visibilitychange", onVisibility);
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      esRef.current?.close();
      esRef.current = null;
    };
  // We want a single setup per mount; connect callback is stable enough.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reconnect = useCallback(() => {
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    void connect();
  }, [connect]);

  return { status: state.status, lastEvent: state.lastEvent, presence: state.presence, reconnect };
}

function cryptoRandomToken(): string {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const a = new Uint8Array(8);
    crypto.getRandomValues(a);
    return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  return Math.random().toString(36).slice(2, 10);
}
