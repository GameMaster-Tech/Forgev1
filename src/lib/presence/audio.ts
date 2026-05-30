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
 * Obtain (or verify) microphone permission, with precise diagnostics.
 *
 * Per Chrome's permission model, a mic in the "denied"/blocked state will NEVER
 * re-prompt — `getUserMedia` just rejects instantly. Same for an embedded iframe
 * with no `allow="microphone"` policy, and for non-secure origins (a LAN IP over
 * HTTP). So before we call `getUserMedia` (which is what actually shows the
 * prompt when the state is "prompt"), we read the Permissions API to tell the
 * user the exact thing to change instead of looping silently on "listening".
 *
 * On success we immediately release the stream — SpeechRecognition opens its own
 * mic; we only wanted the grant.
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

  // Non-secure origin: the browser blocks mic capture and won't prompt.
  if (!window.isSecureContext) {
    return {
      ok: false,
      message:
        "Voice needs a secure connection. Open Forge at http://localhost:3000 (not a 192.168.x.x address) or over HTTPS.",
    };
  }

  const md = navigator.mediaDevices;
  if (!md?.getUserMedia) {
    return {
      ok: false,
      message: inIframe
        ? "The preview frame can't use the microphone. Open Forge in a normal browser tab."
        : "This browser can't access the microphone (mediaDevices unavailable).",
    };
  }

  // Read the current state so we can explain a blocked mic — which never prompts.
  try {
    const status = await navigator.permissions?.query({ name: "microphone" as PermissionName });
    if (status?.state === "denied") {
      return {
        ok: false,
        message: inIframe
          ? "Microphone is blocked in this preview frame. Open Forge in a normal browser tab and allow the mic."
          : "Microphone is blocked for Forge — Chrome won't pop up again once blocked. Click the tune/lock icon at the left of the address bar → Microphone → Allow, then reload.",
      };
    }
  } catch {
    /* Permissions API unsupported for "microphone" — fall through to getUserMedia. */
  }

  // State is "prompt" or "granted": getUserMedia shows the prompt (if needed).
  try {
    const stream = await md.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    return { ok: true };
  } catch (err) {
    const name = (err as { name?: string }).name ?? "";
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
    return { ok: false, message: "Couldn't access the microphone. Check your browser's mic permissions." };
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
    case "service-not-allowed":
      return { message: "Microphone access was blocked. Enable it to use voice.", fatal: true };
    case "audio-capture":
      return { message: "No microphone found.", fatal: true };
    case "no-speech":
      // Benign — the recognizer just heard silence. Don't tear down the session.
      return { message: "Didn't catch that — try again.", fatal: false };
    case "aborted":
      return { message: "Listening stopped.", fatal: false };
    case "network":
      return { message: "Speech service is unreachable right now.", fatal: false };
    default:
      return { message: "Voice input hit a snag — try again.", fatal: false };
  }
}
