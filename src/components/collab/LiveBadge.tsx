"use client";

/**
 * LiveBadge — "Live · N collaborators" pill that pulses when peers
 * are actively typing/dragging.
 *
 * Inline element designed to sit next to existing tab-count badges in
 * a page's sub-nav.
 */

import { Radio } from "lucide-react";
import type { CollabStatus, PresenceState } from "@/lib/collab";

interface Props {
  peers: PresenceState[];
  status: CollabStatus;
}

export function LiveBadge({ peers, status }: Props) {
  const isActive = peers.some((p) => p.activity?.type === "typing" || p.activity?.type === "dragging");
  if (status !== "connected" && status !== "syncing") return null;
  if (peers.length === 0) return null;
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] font-semibold text-green border border-green/40 bg-green/[0.06] px-2.5 py-1 ${isActive ? "animate-glow-pulse" : ""}`}
      title={`${peers.length} collaborator${peers.length === 1 ? "" : "s"} live`}
    >
      <Radio size={9} strokeWidth={2.25} className={isActive ? "animate-pulse" : ""} />
      Live · {peers.length}
    </span>
  );
}
