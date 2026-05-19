"use client";

/**
 * PresenceStrip — horizontal avatar row of currently-connected peers.
 *
 * Renders up to 4 distinct collaborators as square initials chips with
 * a 2px colored bottom border (matches their cursor color). The
 * 5th + peers collapse into a `+N` overflow chip.
 *
 * Hovering a chip reveals a tooltip with name, activity, and a small
 * cursor color preview. No rounded corners. No avatars-with-gradient.
 *
 * Pure UI — pass the peer list in via props (use `usePresence` to
 * source it).
 */

import { motion } from "framer-motion";
import type { PresenceState } from "@/lib/collab";

const ease = [0.22, 0.61, 0.36, 1] as const;

interface Props {
  peers: PresenceState[];
  /** Max visible chips before collapsing into +N. Default 4. */
  maxVisible?: number;
}

export function PresenceStrip({ peers, maxVisible = 4 }: Props) {
  if (peers.length === 0) return null;
  const visible = peers.slice(0, maxVisible);
  const overflow = peers.length - visible.length;
  return (
    <motion.div
      initial={{ opacity: 0, x: 4 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -4 }}
      transition={{ duration: 0.22, ease }}
      aria-label={`${peers.length} collaborator${peers.length === 1 ? "" : "s"} online`}
      className="inline-flex items-center gap-1"
    >
      {visible.map((peer) => (
        <PresenceChip key={peer.peerId} peer={peer} />
      ))}
      {overflow > 0 && (
        <span
          className="inline-flex items-center justify-center w-7 h-7 border border-border bg-surface text-[10px] uppercase tracking-[0.12em] font-semibold text-muted"
          aria-label={`${overflow} more collaborators`}
          title={peers.slice(maxVisible).map((p) => p.displayName).join(", ")}
        >
          +{overflow}
        </span>
      )}
    </motion.div>
  );
}

function PresenceChip({ peer }: { peer: PresenceState }) {
  const idle = peer.activity?.type === "idle";
  const typing = peer.activity?.type === "typing";
  return (
    <span className="relative group">
      <span
        aria-label={peer.displayName}
        className={`relative inline-flex items-center justify-center w-7 h-7 bg-foreground text-background font-display font-bold text-[10px] tabular-nums tracking-tight ${idle ? "opacity-55" : ""}`}
        style={{ borderBottom: `2px solid ${peer.colourHex}` }}
      >
        {peer.initials}
        {typing && (
          <span
            aria-hidden
            className="absolute -bottom-0.5 right-0 w-1.5 h-1.5 animate-pulse"
            style={{ background: peer.colourHex }}
          />
        )}
      </span>
      <span
        role="tooltip"
        className="pointer-events-none absolute right-0 top-full mt-2 opacity-0 group-hover:opacity-100 translate-y-[-2px] group-hover:translate-y-0 transition-all duration-150 z-50 border border-border bg-foreground text-background px-2 py-1.5 whitespace-nowrap shadow-[0_8px_24px_-12px_rgba(0,0,0,0.5)]"
      >
        <span className="block text-[10px] uppercase tracking-[0.18em] font-semibold leading-tight">{peer.displayName}</span>
        <span className="block text-[9px] uppercase tracking-[0.12em] text-background/60 mt-0.5">
          {peer.activity?.type === "typing" ? `Typing in ${peer.activity.in}` :
           peer.activity?.type === "dragging" ? "Dragging" :
           peer.activity?.type === "idle" ? "Idle" :
           "Viewing"}
        </span>
        <span aria-hidden className="absolute left-1/2 -translate-x-1/2 -top-1 w-2 h-2 rotate-45 bg-foreground border-l border-t border-border" />
      </span>
    </span>
  );
}
