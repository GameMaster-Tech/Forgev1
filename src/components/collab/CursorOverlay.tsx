"use client";

/**
 * CursorOverlay — renders remote cursors on non-TipTap canvases
 * (Lattice tree, Sync graph, Calendar grid).
 *
 * The parent canvas calls `setCursor({type: "screen", x, y})` on its
 * own mousemove. Other peers then receive that payload and we draw
 * their cursor as a colored arrowhead with a name tag.
 *
 * Motion: position changes are interpolated via `transform 90ms cubic-bezier`.
 * First paint is hard-cut. Idle peers fade to opacity-40 after 5s.
 */

import { useEffect, useState } from "react";
import type { PresenceState } from "@/lib/collab";

interface Props {
  peers: PresenceState[];
  /** When true, hide cursors that aren't on this surface. */
  surfaceId?: string;
}

const IDLE_FADE_MS = 5_000;
const HIDE_MS = 30_000;

export function CursorOverlay({ peers }: Props) {
  // We re-render every 5s to retire idle/hidden cursors. Cheaper than
  // per-peer timers. `now` lives in state so it's a pure read at render.
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const handle = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(handle);
  }, []);

  const visible = peers.filter((p) => {
    if (!p.cursor || p.cursor.type !== "screen") return false;
    return now - p.lastActiveAt < HIDE_MS;
  });
  return (
    <div className="pointer-events-none fixed inset-0 z-30" aria-hidden>
      {visible.map((p) => {
        const cursor = p.cursor!;
        if (cursor.type !== "screen") return null;
        const stale = now - p.lastActiveAt > IDLE_FADE_MS;
        return (
          <RemoteCursor
            key={p.peerId}
            x={cursor.x}
            y={cursor.y}
            name={p.displayName}
            color={p.colourHex}
            stale={stale}
          />
        );
      })}
    </div>
  );
}

interface RemoteCursorProps {
  x: number;
  y: number;
  name: string;
  color: string;
  stale: boolean;
}

function RemoteCursor({ x, y, name, color, stale }: RemoteCursorProps) {
  // We use transform for cheap GPU compositing. The transition lives
  // in inline style so we can pin it to our timing curve.
  return (
    <span
      className="absolute top-0 left-0 will-change-transform"
      style={{
        transform: `translate3d(${x}px, ${y}px, 0)`,
        transition: "transform 90ms cubic-bezier(0.22, 0.61, 0.36, 1), opacity 400ms cubic-bezier(0.22, 0.61, 0.36, 1)",
        opacity: stale ? 0.4 : 1,
      }}
    >
      {/* Arrowhead — pure CSS triangle so we don't need an asset. */}
      <svg width="14" height="16" viewBox="0 0 14 16" style={{ display: "block" }} aria-hidden>
        <path d="M0,0 L0,14 L4,10 L7.5,15.5 L10,14 L6.5,8.5 L13,8 Z" fill={color} stroke="#FAF9F7" strokeWidth="0.6" />
      </svg>
      <span
        className="inline-block translate-x-3 -translate-y-1 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.14em] font-semibold text-white whitespace-nowrap"
        style={{ background: color }}
      >
        {name}
      </span>
    </span>
  );
}
