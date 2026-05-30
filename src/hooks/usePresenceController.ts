"use client";

/**
 * usePresenceController — the imperative driver that wires the speech engine,
 * intent prediction, spatial resolver, router, and presence store together.
 *
 * Two entry points:
 *   • listen()           — push-to-talk voice: streams partial intent, warms the
 *                          cache + ghost-navigates speculatively, then executes
 *                          (or asks for confirmation on destructive actions).
 *   • track(label, …, fn) — wrap ANY async action (the research/Tempo agent's
 *                          tool calls) so its intent shows up in the trail and
 *                          the ghost — making real agent work visible.
 *
 * The hook never subscribes to store *state* (it only dispatches via
 * getState()), so it triggers no re-renders of its host.
 */

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { usePresenceStore } from "@/store/presence";
import { StreamingSpeechEngine } from "@/lib/presence/audio";
import { isDestructive } from "@/lib/presence/intent";
import {
  detectReference,
  resolveReference,
  resolveTargetId,
  spatialTracker,
} from "@/lib/presence/spatial";
import type { PredictedIntent, PresencePhase, PresenceTarget } from "@/lib/presence/types";

function centerRect(): PresenceTarget["rect"] {
  const w = typeof window !== "undefined" ? window.innerWidth : 1280;
  const h = typeof window !== "undefined" ? window.innerHeight : 800;
  return { x: w / 2 - 12, y: h / 2 - 12, width: 24, height: 24 };
}

export function usePresenceController() {
  const router = useRouter();
  const engineRef = useRef<StreamingSpeechEngine | null>(null);

  // Live attention tracking for spatial reference resolution.
  useEffect(() => {
    spatialTracker.start();
    return () => spatialTracker.stop();
  }, []);

  const moveGhostToRoute = useCallback((route?: string, label?: string) => {
    if (!route) return;
    const s = usePresenceStore.getState();
    const t = resolveTargetId(`nav:${route}`);
    s.setTarget(t ?? { id: `route:${route}`, label, kind: "nav", rect: centerRect() });
  }, []);

  const execute = useCallback(
    async (intent: PredictedIntent) => {
      const s = usePresenceStore.getState();

      // Resolve a deictic target ("assign this …", "summarize selected") so the
      // ghost lands on the thing the user meant.
      const ref = intent.targetPhrase ? detectReference(intent.targetPhrase) : null;
      const spatialTarget = ref ? resolveReference(ref) : null;
      if (spatialTarget) s.setTarget(spatialTarget);

      // Destructive → non-blocking confirmation, never auto-run.
      if (isDestructive(intent.action)) {
        s.requestConfirmation({
          summary: intent.label,
          risk: spatialTarget ? "high" : "critical",
          affected: spatialTarget
            ? [{ id: spatialTarget.id, label: spatialTarget.label ?? "this item", kind: "card" }]
            : [],
          impact: "Reversible — you can undo right after.",
          undoable: true,
          anchorTargetId: spatialTarget?.id,
          autoDismissMs: 9000,
        });
        return;
      }

      // Navigation → real route push (cache already warmed speculatively).
      if ((intent.action === "navigate" || intent.action === "open") && intent.route) {
        s.setPhase("navigating");
        moveGhostToRoute(intent.route, intent.label);
        const id = s.startAction({ label: intent.label, phase: "navigating", confidence: intent.confidence });
        router.push(intent.route);
        s.finishAction(id, "done");
        s.setPhase("done");
        window.setTimeout(() => usePresenceStore.getState().setPhase("idle"), 1200);
        return;
      }

      // Everything else is handed to the model-backed agent elsewhere; here we
      // surface it as a tracked, visible action so nothing is hidden.
      const id = s.startAction({ label: intent.label, phase: "executing", confidence: intent.confidence });
      s.setPhase("executing");
      s.finishAction(id, "done");
      s.setPhase("done");
      window.setTimeout(() => usePresenceStore.getState().setPhase("idle"), 1200);
    },
    [router, moveGhostToRoute],
  );

  const listen = useCallback(() => {
    const s = usePresenceStore.getState();
    if (!StreamingSpeechEngine.isSupported()) {
      s.fail("Voice input isn't supported in this browser.");
      return;
    }
    const engine = engineRef.current ?? new StreamingSpeechEngine();
    engineRef.current = engine;
    s.reset();
    s.setPhase("listening");

    engine.start({
      onStart: () => usePresenceStore.getState().setPhase("listening"),
      onPartial: (intent) => {
        const st = usePresenceStore.getState();
        st.setPhase("understanding");
        st.setIntent(intent);
        // Speculative: warm the route + lean the ghost toward it before speech ends.
        if (intent.route && intent.confidence.value >= 0.5) {
          router.prefetch(intent.route);
          st.setPhase("navigating");
          moveGhostToRoute(intent.route, intent.label);
        }
      },
      onFinal: (intent) => {
        usePresenceStore.getState().setIntent(intent);
        void execute(intent);
      },
      onError: (m) => usePresenceStore.getState().fail(m),
      onEnd: () => {
        const st = usePresenceStore.getState();
        if (st.phase === "listening") st.setPhase("idle");
      },
    });
  }, [router, moveGhostToRoute, execute]);

  const stopListening = useCallback(() => {
    engineRef.current?.stop();
  }, []);

  /**
   * Wrap a real async action so its intent is visible (the agent's tool calls
   * call this). Updates phase + the action trail; never swallows errors.
   */
  const track = useCallback(
    async <T>(label: string, phase: PresencePhase, fn: () => Promise<T>): Promise<T> => {
      const s = usePresenceStore.getState();
      const id = s.startAction({ label, phase });
      s.setPhase(phase);
      try {
        const r = await fn();
        s.finishAction(id, "done");
        s.setPhase("done");
        window.setTimeout(() => usePresenceStore.getState().setPhase("idle"), 1000);
        return r;
      } catch (e) {
        s.finishAction(id, "failed");
        s.fail(e instanceof Error ? e.message : "Action failed");
        throw e;
      }
    },
    [],
  );

  return {
    listen,
    stopListening,
    track,
    supported: StreamingSpeechEngine.isSupported(),
  };
}
