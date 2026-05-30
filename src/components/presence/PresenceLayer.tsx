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

import { useEffect } from "react";
import { Mic, MicOff } from "lucide-react";
import { usePresenceController } from "@/hooks/usePresenceController";
import { usePresenceStore } from "@/store/presence";
import { GhostCursor } from "./GhostCursor";
import { PresenceOverlay } from "./PresenceOverlay";
import { ConfirmationPreview } from "./ConfirmationPreview";

export function PresenceLayer() {
  const { listen, supported } = usePresenceController();
  const enabled = usePresenceStore((s) => s.enabled);
  const phase = usePresenceStore((s) => s.phase);

  const listening = phase === "listening" || phase === "understanding";

  // Global shortcut: ⌘/Ctrl + Shift + V → start listening.
  useEffect(() => {
    if (!supported) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "v") {
        e.preventDefault();
        listen();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [supported, listen]);

  return (
    <>
      <GhostCursor />
      <PresenceOverlay />
      <ConfirmationPreview />

      {enabled && supported && (
        <button
          type="button"
          onClick={() => listen()}
          aria-label={listening ? "Listening…" : "Talk to Forge (⌘⇧V)"}
          title={listening ? "Listening…" : "Talk to Forge (⌘⇧V)"}
          className={`hidden md:flex fixed bottom-5 right-5 z-[60] w-11 h-11 items-center justify-center rounded-full border transition-all active:scale-95 ${
            listening
              ? "bg-violet border-violet text-white shadow-[0_0_0_4px_color-mix(in_srgb,var(--violet)_25%,transparent)]"
              : "bg-background/90 backdrop-blur-md border-border text-muted hover:text-violet hover:border-violet/40 shadow-[0_10px_28px_-12px_rgba(0,0,0,0.5)]"
          }`}
        >
          {listening ? <Mic size={17} className="animate-pulse" /> : <Mic size={17} />}
        </button>
      )}
      {enabled && !supported && (
        <span className="sr-only">
          <MicOff size={1} aria-hidden /> Voice presence unavailable in this browser.
        </span>
      )}
    </>
  );
}
