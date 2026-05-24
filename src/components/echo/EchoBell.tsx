"use client";

/**
 * EchoBell — small trigger that opens the EchoTray.
 *
 * Two visual variants so it works on the sidebar (icon-only) AND
 * on a future top-bar / dashboard (icon + label + count):
 *
 *   <EchoBell variant="rail" />   — 28px icon, badge, tooltip
 *   <EchoBell variant="inline" /> — icon + "Echo · 3" pill
 *
 * State (open / closed) and the tray itself live in AppShell so
 * the panel is rendered exactly once globally — see
 * `src/components/app/AppShell.tsx`. Each bell instance just calls
 * the shared store.
 */

import { motion } from "framer-motion";
import { Wand2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useEchoNotices } from "@/hooks/useEchoNotices";
import { useEchoStore } from "@/store/echo";

interface EchoBellProps {
  variant?: "rail" | "inline";
  className?: string;
}

export function EchoBell({ variant = "rail", className = "" }: EchoBellProps) {
  const { user } = useAuth();
  const notices = useEchoNotices(user?.uid ?? null);
  const open = useEchoStore((s) => s.open);

  const count = notices.unseenCount;
  const hasHigh = notices.active.some((n) => n.severity === "high");

  if (variant === "inline") {
    return (
      <button
        type="button"
        onClick={() => open()}
        className={`inline-flex items-center gap-2 px-2.5 py-1 border border-violet/40 text-violet hover:bg-violet/[0.08] text-[11px] uppercase tracking-[0.12em] font-semibold transition-colors ${className}`}
      >
        <Wand2 size={11} strokeWidth={2} />
        Echo
        {count > 0 ? (
          <span className="text-[9px] tabular-nums px-1 py-px bg-violet text-white">
            {count}
          </span>
        ) : null}
      </button>
    );
  }

  // Rail variant — fits the dark sidebar background. Pulses gently
  // when there are unseen notices; pulses faster when any are high.
  return (
    <button
      type="button"
      onClick={() => open()}
      aria-label={count > 0 ? `Echo · ${count} unseen` : "Echo"}
      className={`group relative flex items-center justify-center transition-colors duration-150 text-background/55 hover:text-background hover:bg-white/[0.05] ${className}`}
    >
      <Wand2 size={14} />
      {count > 0 ? (
        <>
          <span
            aria-hidden
            className={`absolute top-1 right-1 w-1.5 h-1.5 ${hasHigh ? "bg-rose" : "bg-violet"}`}
          />
          {hasHigh ? (
            <motion.span
              aria-hidden
              className="absolute top-1 right-1 w-1.5 h-1.5 bg-rose"
              animate={{ opacity: [0.6, 0, 0.6], scale: [1, 2.4, 1] }}
              transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
            />
          ) : null}
        </>
      ) : null}
    </button>
  );
}
