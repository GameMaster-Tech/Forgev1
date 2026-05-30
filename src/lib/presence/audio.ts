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
  onError?: (message: string) => void;
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
      handlers.onError?.("Speech recognition isn't supported in this browser.");
      return;
    }
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onstart = () => {
      this.active = true;
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
      const intent = predictIntent(transcript, !isFinal);
      if (isFinal) handlers.onFinal?.(intent, transcript);
      else handlers.onPartial?.(intent, transcript);
    };

    rec.onerror = (e) => {
      handlers.onError?.(humanizeSpeechError(e.error));
    };

    rec.onend = () => {
      this.active = false;
      this.rec = null;
      handlers.onEnd?.();
    };

    this.rec = rec;
    try {
      rec.start();
    } catch (err) {
      handlers.onError?.(err instanceof Error ? err.message : "Couldn't start the microphone.");
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

function humanizeSpeechError(code: string): string {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone access was blocked. Enable it to use voice.";
    case "no-speech":
      return "Didn't catch that — try again.";
    case "audio-capture":
      return "No microphone found.";
    case "network":
      return "Speech service is unreachable right now.";
    default:
      return "Voice input hit a snag — try again.";
  }
}
