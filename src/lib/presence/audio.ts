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
