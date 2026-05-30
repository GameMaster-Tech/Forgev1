"use client";

/**
 * PresenceOverlay — always-honest readout of what the agent is doing: current
 * phase, the live intent label, a confidence meter, and the action trail
 * (previous → current → next). Calm, corner-anchored, never blocking.
 */

import { AnimatePresence, motion } from "framer-motion";
import { usePresenceStore } from "@/store/presence";
import { PHASE_META, type TrailAction } from "@/lib/presence/types";

const ease = [0.22, 0.61, 0.36, 1] as const;

const STATUS_DOT: Record<TrailAction["status"], string> = {
  predicted: "bg-muted/40",
  active: "bg-violet",
  done: "bg-green",
  failed: "bg-rose",
  skipped: "bg-muted/30",
};

export function PresenceOverlay() {
  const enabled = usePresenceStore((s) => s.enabled);
  const phase = usePresenceStore((s) => s.phase);
  const intent = usePresenceStore((s) => s.intent);
  const trail = usePresenceStore((s) => s.trail);
  const error = usePresenceStore((s) => s.error);

  const visible = enabled && phase !== "idle";
  const meta = PHASE_META[phase];
  const conf = intent?.confidence;
  const recent = trail.slice(-4);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.98 }}
          transition={{ duration: 0.22, ease }}
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed bottom-5 left-5 z-[60] w-[300px] bg-background/90 backdrop-blur-md border border-border rounded-[var(--radius)] shadow-[0_18px_50px_-22px_rgba(0,0,0,0.55)] overflow-hidden"
        >
          {/* Header: phase + confidence */}
          <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-border/60">
            <span className="relative flex items-center justify-center w-3 h-3">
              <span className={`w-2 h-2 rounded-full ${meta.dot}`} />
              {(phase === "executing" || phase === "navigating" || phase === "listening") && (
                <span className={`absolute inset-0 rounded-full ${meta.dot} animate-ping opacity-60`} />
              )}
            </span>
            <span className={`text-[9px] uppercase tracking-[0.18em] font-bold ${meta.tone}`}>
              {meta.label}
            </span>
            {conf && (
              <span className="ml-auto flex items-center gap-1.5">
                <span className="text-[8.5px] uppercase tracking-[0.14em] text-muted/70 font-mono">
                  {Math.round(conf.value * 100)}%
                </span>
                <span className="w-12 h-1 bg-surface-light rounded-full overflow-hidden">
                  <motion.span
                    className="block h-full bg-violet rounded-full"
                    animate={{ width: `${Math.round(conf.value * 100)}%` }}
                    transition={{ duration: 0.25, ease }}
                  />
                </span>
              </span>
            )}
          </div>

          {/* Current intent */}
          <div className="px-3.5 py-2.5">
            <p className="text-[13px] text-foreground font-medium leading-snug">
              {error ? (
                <span className="text-rose">{error}</span>
              ) : (
                intent?.label ?? "Listening…"
              )}
            </p>

            {/* Action trail */}
            {recent.length > 0 && (
              <ul className="mt-2.5 space-y-1.5">
                {recent.map((a) => (
                  <li key={a.id} className="flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[a.status]}`} />
                    <span
                      className={`text-[11px] truncate ${
                        a.status === "active"
                          ? "text-foreground font-medium"
                          : a.status === "failed"
                            ? "text-rose"
                            : "text-muted"
                      }`}
                    >
                      {a.label}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
