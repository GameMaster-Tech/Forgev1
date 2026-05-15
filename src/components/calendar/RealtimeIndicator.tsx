"use client";

/**
 * RealtimeIndicator — tiny presence + sync-status badge for the header.
 *
 * Shows:
 *   • current SSE connection status (dot colour)
 *   • presence count (other tabs of yours)
 *   • last sync event timestamp
 */

import { Radio, Loader2, AlertTriangle } from "lucide-react";
import type { StreamStatus } from "@/hooks/useCalendarStream";

interface Props {
  status: StreamStatus;
  presence: number;
  lastSyncAt?: number | null;
}

const STATUS_TONE: Record<StreamStatus, { dot: string; label: string }> = {
  idle:       { dot: "bg-muted",  label: "Idle" },
  connecting: { dot: "bg-warm",   label: "Connecting" },
  open:       { dot: "bg-green",  label: "Live" },
  closed:     { dot: "bg-muted",  label: "Disconnected" },
  error:      { dot: "bg-rose",   label: "Error" },
};

export function RealtimeIndicator({ status, presence, lastSyncAt }: Props) {
  const tone = STATUS_TONE[status];
  return (
    <div className="inline-flex items-center gap-2 border border-border bg-surface px-3 h-9 text-[10px] uppercase tracking-[0.12em] font-semibold">
      <span className="inline-flex items-center gap-1.5">
        {status === "connecting" ? (
          <Loader2 size={10} className="animate-spin text-warm" />
        ) : status === "error" ? (
          <AlertTriangle size={10} className="text-rose" />
        ) : (
          <span className={`w-1.5 h-1.5 ${tone.dot} ${status === "open" ? "animate-pulse" : ""}`} />
        )}
        <span className="text-foreground">{tone.label}</span>
      </span>
      {presence > 1 && (
        <>
          <span className="text-muted">·</span>
          <span className="inline-flex items-center gap-1 text-cyan"><Radio size={9} /> {presence} tabs</span>
        </>
      )}
      {lastSyncAt && status === "open" && (
        <>
          <span className="text-muted">·</span>
          <span className="text-muted tabular-nums">{relative(lastSyncAt)}</span>
        </>
      )}
    </div>
  );
}

function relative(ms: number): string {
  const diff = Math.max(0, Date.now() - ms);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
