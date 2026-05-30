"use client";

/**
 * Presence store — the single source of truth for the AI Presence Layer.
 *
 * The store IS the event bus: every presence change flows through `apply(event)`
 * (a `PresenceEvent` from the controller, the agent stream, or a WebSocket
 * transport), so the ghost cursor, overlay, and confirmation surfaces all read
 * one consistent state. Imperative setters wrap `apply` for ergonomics.
 *
 * Invariant: the workspace is always in exactly one `phase`, and `trail` keeps a
 * bounded, ordered history so the user can always see previous → current → next.
 */

import { create } from "zustand";
import type {
  ConfirmationDecision,
  ConfirmationRequest,
  PredictedIntent,
  PresenceEvent,
  PresencePhase,
  PresenceTarget,
  TrailAction,
} from "@/lib/presence/types";

const TRAIL_CAP = 12;
let seq = 0;
const nextId = () => `pa_${Date.now().toString(36)}_${(seq++).toString(36)}`;

interface PresenceState {
  phase: PresencePhase;
  intent: PredictedIntent | null;
  target: PresenceTarget | null;
  /** Ordered action history (oldest → newest), capped. */
  trail: TrailAction[];
  /** The pending confirmation, if any (one at a time, by design — calm). */
  confirmation: ConfirmationRequest | null;
  /** The most recent confirmation resolution — lets awaiters learn the decision. */
  lastResolved: { id: string; decision: ConfirmationDecision } | null;
  error: string | null;
  /** Whether the presence layer is enabled (user can mute it). */
  enabled: boolean;
  /** Who's driving — "voice" (Aria) gets its own cursor colour. */
  source: "system" | "voice";
  setSource: (source: "system" | "voice") => void;

  /* ── unified dispatch ── */
  apply: (event: PresenceEvent) => void;

  /* ── ergonomic setters (all funnel through apply) ── */
  setPhase: (phase: PresencePhase) => void;
  setIntent: (intent: PredictedIntent | null) => void;
  setTarget: (target: PresenceTarget | null) => void;
  startAction: (a: Omit<TrailAction, "id" | "at" | "status"> & { status?: TrailAction["status"]; id?: string }) => string;
  finishAction: (id: string, status?: TrailAction["status"]) => void;
  requestConfirmation: (r: Omit<ConfirmationRequest, "id" | "createdAt"> & { id?: string }) => string;
  resolveConfirmation: (id: string, decision: ConfirmationDecision) => void;
  fail: (message: string) => void;
  reset: () => void;
  setEnabled: (on: boolean) => void;
}

export const usePresenceStore = create<PresenceState>((set, get) => ({
  phase: "idle",
  intent: null,
  target: null,
  trail: [],
  confirmation: null,
  lastResolved: null,
  error: null,
  enabled: true,
  source: "system",
  setSource: (source) => set({ source }),

  apply: (event) =>
    set((s) => {
      if (!s.enabled && event.type !== "reset") return s;
      switch (event.type) {
        case "phase":
          return { phase: event.phase, error: event.phase === "error" ? s.error : null };
        case "intent":
          return { intent: event.intent };
        case "target":
          return { target: event.target };
        case "action.start": {
          const trail = [...s.trail, event.action].slice(-TRAIL_CAP);
          return { trail };
        }
        case "action.done": {
          const trail = s.trail.map((a) =>
            a.id === event.id ? { ...a, status: event.status } : a,
          );
          return { trail };
        }
        case "confirm.request":
          return { confirmation: event.request, phase: "confirming" };
        case "confirm.resolve":
          return s.confirmation?.id === event.id
            ? {
                confirmation: null,
                lastResolved: { id: event.id, decision: event.decision },
                phase: event.decision === "confirm" ? "executing" : "idle",
              }
            : s;
        case "error":
          return { phase: "error", error: event.message };
        case "reset":
          return { phase: "idle", intent: null, target: null, trail: [], confirmation: null, error: null };
        default:
          return s;
      }
    }),

  setPhase: (phase) => get().apply({ type: "phase", phase, at: Date.now() }),
  setIntent: (intent) => get().apply({ type: "intent", intent, at: Date.now() }),
  setTarget: (target) => get().apply({ type: "target", target, at: Date.now() }),

  startAction: (a) => {
    const action: TrailAction = {
      id: a.id ?? nextId(),
      label: a.label,
      phase: a.phase,
      status: a.status ?? "active",
      confidence: a.confidence,
      targetId: a.targetId,
      at: Date.now(),
    };
    get().apply({ type: "action.start", action, at: action.at });
    return action.id;
  },

  finishAction: (id, status = "done") =>
    get().apply({ type: "action.done", id, status, at: Date.now() }),

  requestConfirmation: (r) => {
    const request: ConfirmationRequest = {
      id: r.id ?? nextId(),
      summary: r.summary,
      risk: r.risk,
      affected: r.affected,
      impact: r.impact,
      undoable: r.undoable,
      anchorTargetId: r.anchorTargetId,
      autoDismissMs: r.autoDismissMs,
      createdAt: Date.now(),
    };
    get().apply({ type: "confirm.request", request, at: request.createdAt });
    return request.id;
  },

  resolveConfirmation: (id, decision) =>
    get().apply({ type: "confirm.resolve", id, decision, at: Date.now() }),

  fail: (message) => get().apply({ type: "error", message, at: Date.now() }),
  reset: () => get().apply({ type: "reset", at: Date.now() }),
  setEnabled: (on) => set({ enabled: on }),
}));
