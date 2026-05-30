"use client";

/**
 * FirstRunWelcome — the cold-start moment.
 *
 * A brand-new user lands in an empty Forge and doesn't know Aria (the voice
 * agent) exists. This overlay introduces her on first run: it grants the mic
 * via a real user gesture (the only reliable way to surface Chrome's prompt),
 * has Aria *speak* a greeting, teaches the F2 shortcut, and hands off straight
 * into a live voice session. Shown once per browser (localStorage flag); a
 * "skip" path never traps anyone.
 *
 * Mounted once in AppShell.
 */

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, X } from "lucide-react";
import { AriaIcon } from "@/components/presence/AriaIcon";
import { ensureMicAccess } from "@/lib/presence/audio";

const FLAG = "forge.aria.welcomed.v1";

const TRY_SAYING = [
  "Create a project called Market Research",
  "Open my calendar",
  "Write a doc about onboarding in this project",
];

function speak(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.03;
    window.speechSynthesis.speak(u);
  } catch {
    /* TTS unavailable — the modal still works visually */
  }
}

export function FirstRunWelcome() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      if (!window.localStorage.getItem(FLAG)) setOpen(true);
    } catch {
      /* private mode — just don't show */
    }
  }, []);

  const remember = () => {
    try {
      window.localStorage.setItem(FLAG, "1");
    } catch {
      /* ignore */
    }
  };

  const dismiss = () => {
    remember();
    setOpen(false);
  };

  const enableVoice = async () => {
    setBusy(true);
    setError(null);
    const access = await ensureMicAccess();
    if (!access.ok) {
      // Don't close — let the user fix the mic and retry with the exact guidance.
      setError(access.message ?? "Microphone unavailable.");
      setBusy(false);
      return;
    }
    speak("Hi, I'm Aria. Press F2 any time and just tell me what you'd like to do.");
    remember();
    // Hand off into a live session (PresenceLayer's aria:ui bridge starts it).
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("aria:ui", { detail: { kind: "start_session" } }));
    }
    setBusy(false);
    setOpen(false);
  };

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[80] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={dismiss}
            aria-hidden
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Meet Aria"
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            transition={{ duration: 0.22, ease: [0.22, 0.61, 0.36, 1] }}
            className="relative w-full max-w-md bg-background border border-border rounded-[0.625rem] shadow-[0_40px_90px_-30px_rgba(0,0,0,0.6)] overflow-hidden"
          >
            <button
              type="button"
              onClick={dismiss}
              aria-label="Close"
              className="absolute top-3 right-3 p-1.5 rounded-[0.375rem] text-muted hover:text-foreground hover:bg-foreground/[0.05] transition-colors"
            >
              <X size={15} strokeWidth={2} />
            </button>

            <div className="px-7 pt-8 pb-7">
              {/* Aria mark */}
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center mb-4 text-[color:var(--voice)]"
                style={{ background: "color-mix(in srgb, var(--voice) 14%, var(--background))" }}
              >
                <AriaIcon size={26} active />
              </div>

              <h2 className="font-display font-bold text-foreground text-[1.6rem] tracking-[-0.02em] leading-[1.1]">
                Meet <span className="text-[color:var(--voice)]">Aria</span>
              </h2>
              <p className="text-[13px] text-muted leading-relaxed mt-2">
                Forge is voice-native. Aria is your built-in agent — she navigates,
                creates, edits, and researches for you. Just talk; she does the rest.
              </p>

              {/* Try saying */}
              <div className="mt-5 space-y-1.5">
                <div className="text-[10px] uppercase tracking-[0.16em] text-muted/70 font-semibold">
                  Try saying
                </div>
                {TRY_SAYING.map((t) => (
                  <div
                    key={t}
                    className="text-[12.5px] text-foreground/85 bg-foreground/[0.04] border border-border rounded-[0.375rem] px-3 py-1.5"
                  >
                    “{t}”
                  </div>
                ))}
              </div>

              {error ? (
                <div className="mt-4 text-[12px] text-rose bg-rose/[0.06] border border-rose/30 rounded-[0.375rem] px-3 py-2 leading-relaxed">
                  {error}
                </div>
              ) : null}

              {/* Actions */}
              <div className="mt-6 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void enableVoice()}
                  disabled={busy}
                  className="flex-1 inline-flex items-center justify-center gap-2 h-10 rounded-[0.375rem] bg-[color:var(--voice)] text-white text-[12.5px] font-semibold tracking-[0.01em] hover:opacity-90 active:scale-[0.99] transition disabled:opacity-60"
                >
                  <Mic size={14} strokeWidth={2.25} />
                  {busy ? "Enabling…" : error ? "Try again" : "Enable voice & say hello"}
                </button>
                <button
                  type="button"
                  onClick={dismiss}
                  className="h-10 px-3 rounded-[0.375rem] text-[12px] text-muted hover:text-foreground hover:bg-foreground/[0.05] transition-colors"
                >
                  Explore on my own
                </button>
              </div>

              <p className="mt-3 text-[11px] text-muted/70">
                Tip: press{" "}
                <kbd className="px-1.5 py-0.5 rounded border border-border bg-foreground/[0.05] text-foreground/80 text-[10px] font-medium">
                  F2
                </kbd>{" "}
                any time to talk to Aria — press it again to stop.
              </p>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
