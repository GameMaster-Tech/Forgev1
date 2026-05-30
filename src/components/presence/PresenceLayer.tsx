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
import { MicOff } from "lucide-react";
import { useTheme } from "next-themes";
import { useAria } from "@/hooks/useAria";
import { AriaIcon } from "./AriaIcon";
import { usePresenceStore } from "@/store/presence";
import { useCommandPalette } from "@/hooks/useCommandPalette";
import { GhostCursor } from "./GhostCursor";
import { PresenceOverlay } from "./PresenceOverlay";
import { ConfirmationPreview } from "./ConfirmationPreview";

export function PresenceLayer() {
  const { listen, run, toggleSession, active, supported } = useAria();
  const enabled = usePresenceStore((s) => s.enabled);
  const phase = usePresenceStore((s) => s.phase);
  const { open: openPalette } = useCommandPalette();
  const { setTheme } = useTheme();

  const listening = phase === "listening" || phase === "understanding";

  // Aria UI bridge: client-only actions Aria can't run from the executor.
  useEffect(() => {
    const onUi = (e: Event) => {
      const d = (e as CustomEvent<{ kind?: string; theme?: string; transcript?: string }>).detail;
      if (!d) return;
      if (d.kind === "command_palette") openPalette();
      else if (d.kind === "theme" && d.theme) setTheme(d.theme);
      else if (d.kind === "start_session" && !active) toggleSession();
      else if (d.kind === "run" && typeof d.transcript === "string") void run(d.transcript);
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

  return (
    <>
      <GhostCursor />
      <PresenceOverlay />
      <ConfirmationPreview />

      {enabled && supported && (
        <button
          type="button"
          onClick={() => toggleSession()}
          aria-label={active ? "Aria is listening — press F2 to stop" : "Talk to Aria (F2)"}
          title={active ? "Aria is listening · F2 to stop" : "Talk to Aria · F2"}
          className={`hidden md:flex fixed bottom-5 right-5 z-[60] w-12 h-12 items-center justify-center rounded-full border transition-all active:scale-95 ${
            active || listening
              ? "border-[color:var(--voice)] text-[color:var(--voice)] bg-[color:color-mix(in_srgb,var(--voice)_12%,var(--background))] shadow-[0_0_0_4px_color-mix(in_srgb,var(--voice)_24%,transparent)]"
              : "bg-background/90 backdrop-blur-md border-border text-muted hover:text-[color:var(--voice)] hover:border-[color:color-mix(in_srgb,var(--voice)_45%,var(--border))] shadow-[0_10px_28px_-12px_rgba(0,0,0,0.5)]"
          }`}
        >
          <AriaIcon size={20} active={active || listening} />
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
