"use client";

/**
 * GhostCursor — a translucent, agent-owned cursor that visibly executes intent
 * WITHOUT touching the user's real pointer. It springs toward the current
 * presence target (or screen-center when none), colours itself by phase, and
 * pulses while executing. pointer-events: none, so it's purely informational.
 */

import { useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { usePresenceStore } from "@/store/presence";
import type { PresencePhase } from "@/lib/presence/types";

const PHASE_COLOR: Record<PresencePhase, string> = {
  idle: "var(--muted)",
  listening: "var(--cyan)",
  understanding: "var(--violet)",
  navigating: "var(--violet)",
  executing: "var(--violet)",
  confirming: "var(--warm)",
  waiting: "var(--muted)",
  error: "var(--rose)",
  done: "var(--green)",
};

export function GhostCursor() {
  const enabled = usePresenceStore((s) => s.enabled);
  const phase = usePresenceStore((s) => s.phase);
  const target = usePresenceStore((s) => s.target);
  const source = usePresenceStore((s) => s.source);
  const label = usePresenceStore((s) => s.intent?.label ?? null);

  const visible = enabled && phase !== "idle";
  // Aria (voice) gets its own elegant cursor colour; system actions follow phase.
  const color = source === "voice" && phase !== "error" ? "var(--voice)" : PHASE_COLOR[phase];

  const pos = useMemo(() => {
    if (target) {
      return { x: target.rect.x + target.rect.width / 2, y: target.rect.y + target.rect.height / 2 };
    }
    if (typeof window !== "undefined") return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    return { x: 0, y: 0 };
  }, [target]);

  const pulsing = phase === "executing" || phase === "navigating";

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="ghost"
          aria-hidden
          className="pointer-events-none fixed top-0 left-0 z-[70]"
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1, x: pos.x, y: pos.y }}
          exit={{ opacity: 0, scale: 0.6 }}
          transition={{
            x: { type: "spring", stiffness: 420, damping: 32, mass: 0.6 },
            y: { type: "spring", stiffness: 420, damping: 32, mass: 0.6 },
            opacity: { duration: 0.18 },
            scale: { duration: 0.18 },
          }}
          style={{ translateX: "-50%", translateY: "-50%" }}
        >
          {/* Halo */}
          <motion.span
            className="absolute left-1/2 top-1/2 rounded-full"
            style={{
              translateX: "-50%",
              translateY: "-50%",
              width: 34,
              height: 34,
              background: color,
              opacity: 0.16,
            }}
            animate={pulsing ? { scale: [1, 1.5, 1], opacity: [0.18, 0.04, 0.18] } : { scale: 1, opacity: 0.16 }}
            transition={pulsing ? { duration: 1.4, repeat: Infinity, ease: "easeInOut" } : { duration: 0.2 }}
          />
          {/* Core dot */}
          <span
            className="absolute left-1/2 top-1/2 rounded-full"
            style={{
              transform: "translate(-50%, -50%)",
              width: 12,
              height: 12,
              background: color,
              boxShadow: `0 0 0 3px color-mix(in srgb, ${color} 28%, transparent)`,
            }}
          />
          {/* When ghosting toward a target rect, draw a soft focus ring on it */}
          {target && (
            <motion.span
              className="absolute rounded-[6px] border-2"
              style={{
                borderColor: color,
                left: -target.rect.width / 2,
                top: -target.rect.height / 2,
                width: target.rect.width,
                height: target.rect.height,
                opacity: 0.4,
              }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.4 }}
              transition={{ duration: 0.2 }}
            />
          )}
          {/* Tiny intent chip riding under the cursor */}
          {label && (
            <span
              className="absolute left-1/2 top-4 -translate-x-1/2 whitespace-nowrap rounded-[5px] px-2 py-1 text-[10px] font-medium"
              style={{ background: "var(--foreground)", color: "var(--background)" }}
            >
              {label}
            </span>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
