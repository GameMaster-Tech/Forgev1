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
import { toConfidence } from "@/lib/presence/types";
import { StreamingSpeechEngine } from "@/lib/presence/audio";
import { spatialTracker } from "@/lib/presence/spatial";
import { DirectiveParser } from "@/lib/voice/stream";
import { executeDirective, type ExecDeps } from "@/lib/voice/execute";
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
  pathnameRef.current = pathname;

  useEffect(() => {
    spatialTracker.start();
    return () => spatialTracker.stop();
  }, []);

  const gatherContext = useCallback((): VoiceContext => {
    const projects = useProjectsStore.getState().projects.map((p) => ({ id: p.id, name: p.name }));
    const route = pathnameRef.current ?? "/";
    const docMatch = route.match(/\/project\/([^/]+)\/doc\/([^/]+)/);
    const projMatch = route.match(/\/project\/([^/]+)/);
    const currentProjectId = docMatch?.[1] ?? projMatch?.[1] ?? null;
    const currentDocId = docMatch?.[2] ?? null;
    const sc = spatialTracker.capture();
    const selId = sc.selectedId ?? sc.hoveredId;
    // What the user is actually looking at — the main content area.
    const main = typeof document !== "undefined" ? document.getElementById("main-content") : null;
    const visibleText = main?.innerText?.replace(/\s+/g, " ").trim().slice(0, 3000) ?? null;
    return {
      route,
      currentProjectId,
      currentDocId,
      projects,
      recentDocs: [],
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
          p.fail("Aria is unavailable right now.");
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
        usePresenceStore.getState().fail(e instanceof Error ? e.message : "Aria hit a snag.");
      }
    },
    [user, router, gatherContext],
  );

  const listen = useCallback(() => {
    const p = usePresenceStore.getState();
    if (!StreamingSpeechEngine.isSupported()) {
      p.fail("Voice isn't supported in this browser.");
      return;
    }
    const engine = engineRef.current ?? new StreamingSpeechEngine();
    engineRef.current = engine;
    p.setSource("voice");
    p.reset();
    p.setSource("voice");
    p.setPhase("listening");
    engine.start({
      onStart: () => usePresenceStore.getState().setPhase("listening"),
      onPartial: (_intent, t) => {
        const st = usePresenceStore.getState();
        st.setIntent({ action: "unknown", label: t, confidence: toConfidence(0.4), partial: true, transcript: t });
      },
      onFinal: (_intent, t) => void run(t),
      onError: (msg) => usePresenceStore.getState().fail(msg),
      onEnd: () => {
        const st = usePresenceStore.getState();
        if (st.phase === "listening") st.setPhase("idle");
      },
    });
  }, [run]);

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
      onPartial: (_i, t) =>
        usePresenceStore
          .getState()
          .setIntent({ action: "unknown", label: t, confidence: toConfidence(0.4), partial: true, transcript: t }),
      onFinal: (_i, t) => void run(t),
      onError: () => {
        /* transient (no-speech, etc.) — keep the session; onEnd restarts */
      },
      onEnd: () => {
        if (!sessionRef.current) {
          const s = usePresenceStore.getState();
          if (s.phase === "listening") s.setPhase("idle");
          return;
        }
        // Echo-safe restart: wait until Aria finishes speaking, then listen again.
        const tryRestart = () => {
          if (!sessionRef.current) return;
          if (typeof window !== "undefined" && window.speechSynthesis?.speaking) {
            window.setTimeout(tryRestart, 300);
            return;
          }
          beginListen();
        };
        window.setTimeout(tryRestart, 350);
      },
    });
  }, [run]);

  const startSession = useCallback(() => {
    if (!StreamingSpeechEngine.isSupported()) {
      usePresenceStore.getState().fail("Voice isn't supported in this browser.");
      return;
    }
    if (sessionRef.current) return;
    sessionRef.current = true;
    setActive(true);
    beginListen();
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
