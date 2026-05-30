"use client";

/**
 * useAria — orchestrates Forge's conversational voice agent.
 *
 * Flow: push-to-talk speech → final transcript → POST /api/voice/aria (SSE) →
 * stream Aria's reply → DirectiveParser splits speech from <<do:…>> actions →
 * execute each directive optimistically as it streams (ghost cursor) → speak the
 * reply via on-device TTS. Context (projects, route, selection) is injected so
 * the single shot resolves names → ids without lookups.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useProjectsStore } from "@/store/projects";
import { usePresenceStore } from "@/store/presence";
import { useDocsStore } from "@/store/docs";
import { toConfidence, type PredictedIntent } from "@/lib/presence/types";
import { StreamingSpeechEngine, ensureMicAccess } from "@/lib/presence/audio";
import { spatialTracker, resolveTargetId } from "@/lib/presence/spatial";
import { DirectiveParser } from "@/lib/voice/stream";
import { executeDirective, type ExecDeps } from "@/lib/voice/execute";
import { getIntendedRoute, clearIntendedRoute } from "@/lib/voice/navState";
import { saveVoiceMessage } from "@/lib/firebase/voiceChats";
import type { VoiceContext } from "@/lib/voice/types";

function speak(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.04;
    u.pitch = 1;
    window.speechSynthesis.speak(u);
  } catch {
    /* TTS unavailable */
  }
}

export function useAria() {
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();

  const engineRef = useRef<StreamingSpeechEngine | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const pathnameRef = useRef(pathname);
  const historyRef = useRef<{ role: "user" | "assistant"; content: string }[]>([]);
  // True while a turn is being processed — the session loop must not restart
  // listening (or capture Aria's own TTS) until the turn fully settles.
  const processingRef = useRef(false);
  // Monotonic turn id so a barge-in's aborted turn can't clear `processingRef`
  // out from under the turn that replaced it.
  const turnRef = useRef(0);
  // Last route we speculatively prefetched, to dedupe per session.
  const prefetchRef = useRef<string | null>(null);
  pathnameRef.current = pathname;

  useEffect(() => {
    spatialTracker.start();
    return () => spatialTracker.stop();
  }, []);

  // Cold-start kill: once per session, pre-warm the voice path (Groq TLS +
  // route boot) and prefetch the top destinations, so the first command is fast.
  useEffect(() => {
    if (!user || typeof window === "undefined") return;
    try {
      if (window.sessionStorage.getItem("forge.aria.warm")) return;
      window.sessionStorage.setItem("forge.aria.warm", "1");
    } catch {
      /* private mode — warm anyway, just don't dedupe */
    }
    const r = router as { prefetch?: (href: string) => void };
    for (const route of ["/projects", "/research", "/calendar"]) {
      try {
        r.prefetch?.(route);
      } catch {
        /* best-effort */
      }
    }
    let cancelled = false;
    void (async () => {
      try {
        const token = await user.getIdToken();
        if (cancelled) return;
        await fetch("/api/voice/warm", { headers: { Authorization: `Bearer ${token}` } });
      } catch {
        /* warm is best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, router]);

  // When the real route finally commits, drop the optimistic override so we
  // always trust reality once it has caught up (or diverged via manual nav).
  useEffect(() => {
    clearIntendedRoute();
  }, [pathname]);

  const gatherContext = useCallback((): VoiceContext => {
    const projects = useProjectsStore.getState().projects.map((p) => ({ id: p.id, name: p.name }));
    // Prefer where Aria just navigated (router.push lags usePathname) so chained
    // directives reason about the destination, not the route we're leaving.
    const route = getIntendedRoute() ?? pathnameRef.current ?? "/";
    const docMatch = route.match(/\/project\/([^/]+)\/doc\/([^/]+)/);
    const projMatch = route.match(/\/project\/([^/]+)/);
    const currentProjectId = docMatch?.[1] ?? projMatch?.[1] ?? null;
    const currentDocId = docMatch?.[2] ?? null;
    const sc = spatialTracker.capture();
    const selId = sc.selectedId ?? sc.hoveredId;
    // What the user is actually looking at — the main content area.
    const main = typeof document !== "undefined" ? document.getElementById("main-content") : null;
    const visibleText = main?.innerText?.replace(/\s+/g, " ").trim().slice(0, 3000) ?? null;
    // Documents the user owns — so Aria can resolve "open the launch doc" etc.
    // Bias toward the current project, then fill with the rest.
    const allDocs = useDocsStore.getState().docs;
    const recentDocs = [
      ...allDocs.filter((d) => d.projectId === currentProjectId),
      ...allDocs.filter((d) => d.projectId !== currentProjectId),
    ].slice(0, 20);
    return {
      route,
      currentProjectId,
      currentDocId,
      projects,
      recentDocs,
      selection: selId ? { id: selId, label: "", kind: "" } : null,
      textSelection: sc.textSelection,
      visibleText,
    };
  }, []);

  const run = useCallback(
    async (transcript: string) => {
      const p = usePresenceStore.getState();
      if (!user) {
        p.fail("Sign in to talk to Aria.");
        return;
      }
      // Barge-in: a new command cancels any in-flight reply + Aria's speech.
      abortRef.current?.abort();
      if (typeof window !== "undefined" && window.speechSynthesis?.speaking) {
        window.speechSynthesis.cancel();
      }
      const controller = new AbortController();
      abortRef.current = controller;
      // Latch this turn so the session loop won't restart listening mid-turn.
      const myTurn = ++turnRef.current;
      processingRef.current = true;
      p.setSource("voice");
      p.setPhase("understanding");
      p.setIntent({
        action: "unknown",
        label: "…",
        confidence: toConfidence(0.6),
        partial: true,
        transcript,
      });

      const ctx = gatherContext();
      const deps: ExecDeps = {
        user: { uid: user.uid, displayName: user.displayName ?? "", email: user.email ?? "" },
        router,
        projects: ctx.projects,
        currentProjectId: ctx.currentProjectId,
        currentDocId: ctx.currentDocId,
      };
      const created = new Map<string, string>();
      const parser = new DirectiveParser();
      const actionTypes: string[] = [];
      let speech = "";

      try {
        const token = await user.getIdToken();
        const res = await fetch("/api/voice/aria", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ transcript, context: ctx, history: historyRef.current }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          const msg = "Aria is unavailable right now.";
          p.fail(msg);
          speak(msg);
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const frames = buf.split("\n\n");
          buf = frames.pop() ?? "";
          for (const frame of frames) {
            const m = /^data: ([\s\S]*)$/.exec(frame.trim());
            if (!m) continue;
            let evt: { delta?: string; done?: boolean; error?: string };
            try {
              evt = JSON.parse(m[1]);
            } catch {
              continue;
            }
            if (evt.error) usePresenceStore.getState().fail(evt.error);
            if (typeof evt.delta === "string") {
              const { text, directives } = parser.push(evt.delta);
              if (text) {
                speech += text;
                usePresenceStore.getState().setIntent({
                  action: "unknown",
                  label: speech.replace(/\s+/g, " ").trim() || "…",
                  confidence: toConfidence(0.8),
                  partial: true,
                  transcript,
                });
              }
              for (const d of directives) {
                actionTypes.push(d.type);
                void executeDirective(d, deps, created);
              }
            }
            if (evt.done) {
              const tail = parser.flush();
              if (tail.text) speech += tail.text;
            }
          }
        }

        const clean = speech.replace(/\s+/g, " ").trim();
        if (clean) {
          usePresenceStore.getState().setIntent({
            action: "unknown",
            label: clean,
            confidence: toConfidence(0.85),
            partial: false,
            transcript,
          });
          speak(clean);
        } else if (actionTypes.length === 0) {
          // The model returned nothing usable AND took no action — never leave
          // the user with silence. Acknowledge out loud so the loop feels alive.
          const m = "Sorry, I didn't catch that — try again?";
          usePresenceStore.getState().setIntent({
            action: "unknown",
            label: m,
            confidence: toConfidence(0.5),
            partial: false,
            transcript,
          });
          speak(m);
        }
        historyRef.current = [
          ...historyRef.current,
          { role: "user" as const, content: transcript },
          { role: "assistant" as const, content: clean },
        ].slice(-8);

        // Persist the exchange (best-effort; never blocks the voice flow).
        void saveVoiceMessage(user.uid, { transcript, reply: clean, actions: actionTypes });

        const ps = usePresenceStore.getState();
        if (ps.phase !== "confirming") {
          ps.setPhase("done");
          window.setTimeout(() => usePresenceStore.getState().setPhase("idle"), 1400);
        }
      } catch (e) {
        // A barge-in abort is intentional — stay quiet.
        if (e instanceof DOMException && e.name === "AbortError") return;
        const msg = e instanceof Error ? e.message : "Aria hit a snag.";
        usePresenceStore.getState().fail(msg);
        speak(msg);
      } finally {
        // Only the turn that's still current may release the latch — a barge-in
        // turn will have bumped turnRef, so the aborted turn leaves it alone.
        if (turnRef.current === myTurn) processingRef.current = false;
      }
    },
    [user, router, gatherContext],
  );

  /**
   * Speculative layer — the rule-based intent engine runs on every interim
   * frame, but it CANNOT truly parse natural language, so it is allowed only
   * side-effect-free, reversible moves. The streamed LLM directive stays the
   * source of truth and corrects anything this guesses wrong.
   *   1. prefetch the likely route (invisible; a wrong guess costs only a cache warm)
   *   2. lean the ghost toward a nav anchor ONLY when highly confident
   */
  const speculate = useCallback(
    (intent: PredictedIntent) => {
      const route = intent.route;
      if (!route) return;
      if (prefetchRef.current !== route) {
        prefetchRef.current = route;
        try {
          (router as { prefetch?: (href: string) => void }).prefetch?.(route);
        } catch {
          /* prefetch is best-effort */
        }
      }
      if (intent.confidence.band !== "high") return;
      const phase = usePresenceStore.getState().phase;
      if (phase !== "listening" && phase !== "understanding") return;
      const target = resolveTargetId(`nav:${route}`);
      if (!target) return;
      const p = usePresenceStore.getState();
      p.setSource("voice");
      p.setTarget(target); // soft lean only — no router.push, no commit
    },
    [router],
  );

  const listen = useCallback(() => {
    void (async () => {
    const p = usePresenceStore.getState();
    if (!StreamingSpeechEngine.isSupported()) {
      p.fail("Voice isn't supported in this browser.");
      return;
    }
    const access = await ensureMicAccess();
    if (!access.ok && access.hardBlock) {
      const m = access.message ?? "Microphone unavailable.";
      p.fail(m);
      speak(m);
      return;
    }
    // Soft pre-flight failure → proceed; SpeechRecognition may still work, and
    // its onError is the final word.
    const engine = engineRef.current ?? new StreamingSpeechEngine();
    engineRef.current = engine;
    p.setSource("voice");
    p.reset();
    p.setSource("voice");
    p.setPhase("listening");
    engine.start({
      onStart: () => usePresenceStore.getState().setPhase("listening"),
      onPartial: (intent, t) => {
        const st = usePresenceStore.getState();
        st.setIntent({ action: "unknown", label: t, confidence: toConfidence(0.4), partial: true, transcript: t });
        speculate(intent);
      },
      onFinal: (_intent, t) => void run(t),
      onError: (msg, fatal) => {
        usePresenceStore.getState().fail(msg);
        if (fatal) speak(msg);
      },
      onEnd: () => {
        const st = usePresenceStore.getState();
        if (st.phase === "listening") st.setPhase("idle");
      },
    });
    })();
  }, [run, speculate]);

  const stopListening = useCallback(() => engineRef.current?.stop(), []);

  /* ── continuous voice session: one press to start, press again to stop ── */
  const sessionRef = useRef(false);
  const [active, setActive] = useState(false);

  const beginListen = useCallback(() => {
    const engine = engineRef.current ?? new StreamingSpeechEngine();
    engineRef.current = engine;
    const st = usePresenceStore.getState();
    st.setSource("voice");
    if (st.phase === "idle") st.setPhase("listening");
    engine.start({
      onStart: () => {
        const s = usePresenceStore.getState();
        if (s.phase === "idle") s.setPhase("listening");
      },
      onPartial: (intent, t) => {
        usePresenceStore
          .getState()
          .setIntent({ action: "unknown", label: t, confidence: toConfidence(0.4), partial: true, transcript: t });
        speculate(intent);
      },
      onFinal: (_i, t) => void run(t),
      onError: (msg, fatal) => {
        // Benign (no-speech / aborted) — keep the session; onEnd restarts.
        // Fatal (mic blocked / no device) — tear the session down and say why,
        // so we never loop silently on "listening".
        if (!fatal) return;
        sessionRef.current = false;
        setActive(false);
        const p = usePresenceStore.getState();
        p.fail(msg);
        speak(msg);
      },
      onEnd: () => {
        if (!sessionRef.current) {
          const s = usePresenceStore.getState();
          if (s.phase === "listening") s.setPhase("idle");
          return;
        }
        // Listen → think → speak → listen. Restart only once the turn has fully
        // settled (not processing) AND Aria has stopped speaking, so we never
        // clobber a turn or capture her own voice.
        const tryRestart = () => {
          if (!sessionRef.current) return;
          const speaking = typeof window !== "undefined" && !!window.speechSynthesis?.speaking;
          if (processingRef.current || speaking) {
            window.setTimeout(tryRestart, 250);
            return;
          }
          beginListen();
        };
        window.setTimeout(tryRestart, 300);
      },
    });
  }, [run, speculate]);

  const startSession = useCallback(() => {
    void (async () => {
      const p = usePresenceStore.getState();
      if (!StreamingSpeechEngine.isSupported()) {
        p.fail("Voice isn't supported in this browser.");
        return;
      }
      if (sessionRef.current) return;
      // Make sure we actually have the mic (and surface a fix if not) BEFORE we
      // flip the session on — otherwise it would loop on "listening".
      const access = await ensureMicAccess();
      if (!access.ok && access.hardBlock) {
        const m = access.message ?? "Microphone unavailable.";
        p.fail(m);
        speak(m);
        return;
      }
      // Soft pre-flight failure → start anyway; SpeechRecognition may still work.
      sessionRef.current = true;
      setActive(true);
      beginListen();
    })();
  }, [beginListen]);

  const stopSession = useCallback(() => {
    sessionRef.current = false;
    setActive(false);
    engineRef.current?.abort();
    const s = usePresenceStore.getState();
    if (s.phase === "listening" || s.phase === "understanding") s.setPhase("idle");
  }, []);

  const toggleSession = useCallback(() => {
    if (sessionRef.current) stopSession();
    else startSession();
  }, [startSession, stopSession]);

  // Clean up the session if the hook unmounts.
  useEffect(() => () => {
    sessionRef.current = false;
    engineRef.current?.abort();
  }, []);

  return {
    listen,
    stopListening,
    run,
    toggleSession,
    active,
    supported: StreamingSpeechEngine.isSupported(),
  };
}
