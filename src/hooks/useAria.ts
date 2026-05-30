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

import { useCallback, useEffect, useRef } from "react";
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
    return {
      route,
      currentProjectId,
      currentDocId,
      projects,
      recentDocs: [],
      selection: selId ? { id: selId, label: "", kind: "" } : null,
      textSelection: sc.textSelection,
    };
  }, []);

  const run = useCallback(
    async (transcript: string) => {
      const p = usePresenceStore.getState();
      if (!user) {
        p.fail("Sign in to talk to Aria.");
        return;
      }
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

  return { listen, stopListening, run, supported: StreamingSpeechEngine.isSupported() };
}
