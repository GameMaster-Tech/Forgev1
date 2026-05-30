"use client";

/**
 * Ambient audio chunking — incremental speech → streaming intent.
 *
 * Pipeline:  Audio ─▶ Partial Transcript ─▶ Intent Prediction ─▶ (caller wires
 *            UI preparation + speculative navigation + cache warming).
 *
 * Uses the browser-native Web Speech API with `interimResults`, so we get real
 * partial transcripts as the user speaks — "Forge open the Q3 marketing
 * strategy" fires `onPartial` several times before `onFinal`, letting the
 * Presence Layer ghost-navigate and prefetch before speech ends. No transcription
 * backend required; for non-supporting browsers `isSupported()` returns false and
 * the caller can fall back to typed commands.
 */

import { predictIntent } from "./intent";
import type { PredictedIntent } from "./types";

/* Minimal Web Speech typings (not in lib.dom for all targets). */
interface SpeechRecognitionAlternativeLike { transcript: string; confidence: number }
interface SpeechRecognitionResultLike {0: SpeechRecognitionAlternativeLike; isFinal: boolean; length: number }
interface SpeechRecognitionEventLike { resultIndex: number; results: { length: number; [i: number]: SpeechRecognitionResultLike } }
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface SpeechHandlers {
  onStart?: () => void;
  /** Fires on every interim frame with the running partial intent. */
  onPartial?: (intent: PredictedIntent, transcript: string) => void;
  /** Fires once when the utterance finalises. */
  onFinal?: (intent: PredictedIntent, transcript: string) => void;
  /** `fatal` = the mic is unusable (blocked / no device); the caller should
   *  stop the session rather than retry. Benign codes (no-speech) are retryable. */
  onError?: (message: string, fatal: boolean) => void;
  onEnd?: () => void;
}

/**
 * Obtain (or verify) microphone permission. `getUserMedia` is the SOURCE OF
 * TRUTH — if it resolves, the mic works, full stop. We never block on the
 * Permissions API "denied" state, because it lags behind a fresh grant (the
 * cause of "I allowed it but it's still blocked"). The Permissions state is read
 * only to enrich a failure message. Diagnostics are logged so the exact cause is
 * visible in the console.
 *
 * On success we release the stream and pause briefly so SpeechRecognition can
 * grab the device cleanly (they contend for the same mic).
 */
export async function ensureMicAccess(): Promise<{ ok: boolean; message?: string }> {
  if (typeof window === "undefined") return { ok: false, message: "Voice is only available in the browser." };

  const inIframe = (() => {
    try {
      return window.self !== window.top;
    } catch {
      return true; // cross-origin frame access threw → we're framed
    }
  })();
  const secure = window.isSecureContext;

  if (!secure) {
    console.warn("[aria-mic] insecure context", { origin: window.location?.origin, inIframe });
    return {
      ok: false,
      message:
        "Voice needs a secure connection. Open Forge at http://localhost:3000 (not a 192.168.x.x address) or over HTTPS.",
    };
  }

  const md = navigator.mediaDevices;
  if (!md?.getUserMedia) {
    console.warn("[aria-mic] mediaDevices unavailable", { inIframe });
    return {
      ok: false,
      message: inIframe
        ? "The preview frame can't use the microphone. Open Forge in a normal browser tab."
        : "This browser can't access the microphone (mediaDevices unavailable).",
    };
  }

  // Read state for diagnostics ONLY — never to block.
  let permState: string | undefined;
  try {
    permState = (await navigator.permissions?.query({ name: "microphone" as PermissionName }))?.state;
  } catch {
    /* Permissions API unsupported for "microphone" — fine */
  }

  try {
    const stream = await md.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    // Let the device free up before SpeechRecognition opens its own capture.
    await new Promise((r) => setTimeout(r, 150));
    console.info("[aria-mic] granted", { permState, inIframe });
    return { ok: true };
  } catch (err) {
    const name = (err as { name?: string }).name ?? "";
    console.warn("[aria-mic] getUserMedia failed", { name, permState, inIframe, secure });
    if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") {
      return {
        ok: false,
        message: inIframe
          ? "Microphone blocked in the preview frame. Open Forge in a normal browser tab to allow it."
          : "Microphone is blocked. Click the tune/lock icon in the address bar → Microphone → Allow, then reload — Chrome won't prompt again once blocked.",
      };
    }
    if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      return { ok: false, message: "No microphone found — plug one in and try again." };
    }
    if (name === "NotReadableError" || name === "TrackStartError") {
      return { ok: false, message: "Your microphone is in use by another app. Close it (Zoom/Meet/etc.) and try again." };
    }
    return { ok: false, message: `Couldn't access the microphone (${name || "unknown error"}). Check your browser's mic permissions.` };
  }
}

export class StreamingSpeechEngine {
  private rec: SpeechRecognitionLike | null = null;
  private active = false;

  static isSupported(): boolean {
    return getCtor() !== null;
  }

  start(handlers: SpeechHandlers) {
    if (this.active) return;
    const Ctor = getCtor();
    if (!Ctor) {
      handlers.onError?.("Speech recognition isn't supported in this browser.", true);
      return;
    }
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    // Per-utterance bookkeeping so we never lose a trailing phrase.
    let lastTranscript = "";
    let firedFinal = false;

    rec.onstart = () => {
      this.active = true;
      lastTranscript = "";
      firedFinal = false;
      handlers.onStart?.();
    };

    rec.onresult = (e) => {
      // Accumulate the best transcript across all results in this utterance.
      let transcript = "";
      let isFinal = false;
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        transcript += r[0]?.transcript ?? "";
        if (r.isFinal) isFinal = true;
      }
      transcript = transcript.trim();
      if (!transcript) return;
      lastTranscript = transcript;
      const intent = predictIntent(transcript, !isFinal);
      if (isFinal) {
        firedFinal = true;
        handlers.onFinal?.(intent, transcript);
      } else {
        handlers.onPartial?.(intent, transcript);
      }
    };

    rec.onerror = (e) => {
      console.warn("[aria-speech] recognition error:", e.error);
      const { message, fatal } = classifySpeechError(e.error);
      handlers.onError?.(message, fatal);
    };

    rec.onend = () => {
      this.active = false;
      this.rec = null;
      // Finalize-on-end: Chrome routinely ends recognition on a trailing
      // pause *before* emitting a final result, silently dropping the
      // utterance. If that happened, promote the last partial to a final so
      // the turn actually runs instead of vanishing into a restart loop.
      if (!firedFinal && lastTranscript.length > 1) {
        firedFinal = true;
        handlers.onFinal?.(predictIntent(lastTranscript, false), lastTranscript);
      }
      handlers.onEnd?.();
    };

    this.rec = rec;
    try {
      rec.start();
    } catch (err) {
      handlers.onError?.(err instanceof Error ? err.message : "Couldn't start the microphone.", true);
    }
  }

  stop() {
    try {
      this.rec?.stop();
    } catch {
      /* already stopped */
    }
  }

  abort() {
    try {
      this.rec?.abort();
    } catch {
      /* noop */
    }
    this.active = false;
    this.rec = null;
  }

  get isActive() {
    return this.active;
  }
}

function classifySpeechError(code: string): { message: string; fatal: boolean } {
  switch (code) {
    case "not-allowed":
      // The mic device permission was refused.
      return { message: "Microphone is blocked. Allow it via the address-bar icon, then reload.", fatal: true };
    case "service-not-allowed":
      // NOT the device — Chrome's online speech *service* is unavailable. Happens
      // in some Chromium builds (Brave/Edge), offline, or on non-secure origins.
      return {
        message:
          "Chrome's speech service isn't available here. Use Google Chrome, make sure you're online, and open Forge on http://localhost or HTTPS.",
        fatal: true,
      };
    case "audio-capture":
      return { message: "No microphone found.", fatal: true };
    case "no-speech":
      // Benign — the recognizer just heard silence. Don't tear down the session.
      return { message: "Didn't catch that — try again.", fatal: false };
    case "aborted":
      return { message: "Listening stopped.", fatal: false };
    case "network":
      return { message: "Speech service is unreachable — check your connection.", fatal: false };
    default:
      return { message: `Voice input hit a snag (${code || "unknown"}) — try again.`, fatal: false };
  }
}
