"use client";

/**
 * PresenceLayer — the single mount point for the AI Presence Layer. Renders the
 * ghost cursor, the intent overlay, and the confirmation preview, and provides a
 * push-to-talk voice trigger (mic FAB + ⌘/Ctrl-Shift-V).
 *
 * Mount once in AppShell. Agent surfaces (research/Tempo) make their real work
 * visible by calling `usePresenceController().track(...)` around their actions;
 * voice goes through `listen()`.
 */

import { useEffect, useState } from "react";
import { MicOff, HelpCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useTheme } from "next-themes";
import { useAria } from "@/hooks/useAria";
import { AriaIcon } from "./AriaIcon";
import { usePresenceStore } from "@/store/presence";
import { useCommandPalette } from "@/hooks/useCommandPalette";
import { GhostCursor } from "./GhostCursor";
import { PresenceOverlay } from "./PresenceOverlay";
import { ConfirmationPreview } from "./ConfirmationPreview";
import { VoiceCheatSheet } from "./VoiceCheatSheet";

export function PresenceLayer() {
  const { listen, run, toggleSession, active, supported } = useAria();
  const enabled = usePresenceStore((s) => s.enabled);
  const phase = usePresenceStore((s) => s.phase);
  const error = usePresenceStore((s) => s.error);
  const { open: openPalette } = useCommandPalette();
  const { setTheme } = useTheme();
  const [helpOpen, setHelpOpen] = useState(false);

  const listening = phase === "listening" || phase === "understanding";

  // Persistent voice status so users always know whether Aria is on / working /
  // blocked — never a silent mystery.
  const statusLabel =
    phase === "error"
      ? error
        ? error.length > 30
          ? `${error.slice(0, 30)}…`
          : error
        : "Voice issue"
      : phase === "listening"
        ? "Listening…"
        : phase === "understanding"
          ? "Thinking…"
          : phase === "navigating" || phase === "executing"
            ? "Working…"
            : phase === "confirming"
              ? "Confirm?"
              : active
                ? "Aria · on"
                : null;
  const errored = phase === "error";

  // Aria UI bridge: client-only actions Aria can't run from the executor.
  useEffect(() => {
    const onUi = (e: Event) => {
      const d = (e as CustomEvent<{ kind?: string; theme?: string; transcript?: string }>).detail;
      if (!d) return;
      if (d.kind === "command_palette") openPalette();
      else if (d.kind === "theme" && d.theme) setTheme(d.theme);
      else if (d.kind === "start_session" && !active) toggleSession();
      else if (d.kind === "run" && typeof d.transcript === "string") void run(d.transcript);
      else if (d.kind === "voice_help") setHelpOpen(true);
    };
    window.addEventListener("aria:ui", onUi);
    return () => window.removeEventListener("aria:ui", onUi);
  }, [openPalette, setTheme, active, toggleSession, run]);

  // Shortcuts:
  //   F2            — single press toggles Aria's continuous voice session
  //                   (stays active until you press F2 again).
  //   ⌘/Ctrl+⇧+V    — one-shot "talk once" (push to talk).
  useEffect(() => {
    if (!supported) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F2" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        toggleSession();
      } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "v") {
        e.preventDefault();
        listen();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [supported, listen, toggleSession]);

  // "?" anywhere (outside inputs) opens the voice cheat-sheet.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "?") return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      e.preventDefault();
      setHelpOpen((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <GhostCursor />
      <PresenceOverlay />
      <ConfirmationPreview />
      <VoiceCheatSheet open={helpOpen} onClose={() => setHelpOpen(false)} />

      {enabled && supported && (
        <div className="hidden md:flex fixed bottom-5 right-5 z-[60] items-center gap-2">
          {/* What can I say? — discoverability */}
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            aria-label="What can I say to Aria? (?)"
            title="What can I say to Aria? · ?"
            className="flex w-8 h-8 items-center justify-center rounded-full border border-border bg-background/90 backdrop-blur-md text-muted hover:text-[color:var(--voice)] hover:border-[color:color-mix(in_srgb,var(--voice)_45%,var(--border))] transition-colors shadow-[0_10px_28px_-12px_rgba(0,0,0,0.5)]"
          >
            <HelpCircle size={15} strokeWidth={2} />
          </button>
          <AnimatePresence>
            {statusLabel && (
              <motion.div
                key="aria-status"
                initial={{ opacity: 0, x: 8, scale: 0.96 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 8, scale: 0.96 }}
                transition={{ duration: 0.16 }}
                className="flex items-center gap-2 h-8 rounded-full border bg-background/90 backdrop-blur-md px-3 shadow-[0_10px_28px_-12px_rgba(0,0,0,0.5)]"
                style={{
                  borderColor: errored
                    ? "color-mix(in srgb, var(--rose) 45%, var(--border))"
                    : "color-mix(in srgb, var(--voice) 40%, var(--border))",
                }}
              >
                <motion.span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: errored ? "var(--rose)" : "var(--voice)" }}
                  animate={listening ? { opacity: [1, 0.3, 1] } : { opacity: 1 }}
                  transition={listening ? { duration: 1.1, repeat: Infinity, ease: "easeInOut" } : { duration: 0.2 }}
                />
                <span
                  className="text-[11px] font-medium whitespace-nowrap"
                  style={{ color: errored ? "var(--rose)" : "var(--voice)" }}
                >
                  {statusLabel}
                </span>
              </motion.div>
            )}
          </AnimatePresence>
          <div className="relative flex items-center justify-center">
            {/* Sonar pulses radiating while Aria is live/listening */}
            <AnimatePresence>
              {(active || listening) && (
                <>
                  <motion.span
                    key="pulse-1"
                    className="absolute rounded-full pointer-events-none"
                    style={{ width: 48, height: 48, border: "2px solid var(--voice)" }}
                    initial={{ scale: 0.9, opacity: 0.45 }}
                    animate={{ scale: 1.7, opacity: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }}
                  />
                  <motion.span
                    key="pulse-2"
                    className="absolute rounded-full pointer-events-none"
                    style={{ width: 48, height: 48, border: "2px solid var(--voice)" }}
                    initial={{ scale: 0.9, opacity: 0.45 }}
                    animate={{ scale: 1.7, opacity: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut", delay: 0.8 }}
                  />
                </>
              )}
            </AnimatePresence>
            <motion.button
              type="button"
              onClick={() => toggleSession()}
              aria-label={active ? "Aria is listening — press F2 to stop" : "Talk to Aria (F2)"}
              title={active ? "Aria is listening · F2 to stop" : "Talk to Aria · F2"}
              animate={
                active || listening
                  ? { scale: [1, 1.06, 1] }
                  : { scale: 1 }
              }
              transition={
                active || listening
                  ? { duration: 1.6, repeat: Infinity, ease: "easeInOut" }
                  : { duration: 0.2 }
              }
              className={`relative flex w-12 h-12 items-center justify-center rounded-full border transition-colors active:scale-95 ${
                active || listening
                  ? "border-[color:var(--voice)] text-[color:var(--voice)] bg-[color:color-mix(in_srgb,var(--voice)_12%,var(--background))] shadow-[0_0_0_4px_color-mix(in_srgb,var(--voice)_24%,transparent)]"
                  : "bg-background/90 backdrop-blur-md border-border text-muted hover:text-[color:var(--voice)] hover:border-[color:color-mix(in_srgb,var(--voice)_45%,var(--border))] shadow-[0_10px_28px_-12px_rgba(0,0,0,0.5)]"
              }`}
            >
              <AriaIcon size={20} active={active || listening} />
            </motion.button>
          </div>
        </div>
      )}
      {enabled && !supported && (
        <span className="sr-only">
          <MicOff size={1} aria-hidden /> Voice presence unavailable in this browser.
        </span>
      )}
    </>
  );
}
