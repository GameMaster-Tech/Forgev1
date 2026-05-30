"use client";

/**
 * Spatial resolver — turns deictic references ("this", "selected", "current
 * card") into concrete on-screen targets, using where the user's attention
 * actually is: cursor position, hovered element, focused element, the current
 * text selection, and the viewport.
 *
 * Any element can opt into being a resolvable target by tagging itself:
 *
 *   <div data-presence-id="card-42" data-presence-label="Q3 launch" data-presence-kind="card">
 *
 * A lightweight singleton tracker keeps a live SpatialContext from passive DOM
 * listeners (no polling); `resolveReference` reads it on demand. Eye-tracking is
 * abstracted behind `setGazePoint()` so a future provider can feed gaze the same
 * way the cursor does.
 */

import type { PresenceTarget, SpatialContext, SpatialReference } from "./types";

const ATTR_ID = "data-presence-id";

function readMeta(el: Element): { id: string; label?: string; kind?: PresenceTarget["kind"] } {
  const host = el.closest(`[${ATTR_ID}]`) ?? el;
  const id = host.getAttribute(ATTR_ID) ?? `el_${Math.random().toString(36).slice(2)}`;
  const label = host.getAttribute("data-presence-label") ?? undefined;
  const kind = (host.getAttribute("data-presence-kind") as PresenceTarget["kind"]) ?? undefined;
  return { id, label, kind };
}

function toTarget(el: Element): PresenceTarget {
  const r = el.getBoundingClientRect();
  const meta = readMeta(el);
  return {
    id: meta.id,
    label: meta.label,
    kind: meta.kind,
    rect: { x: r.x, y: r.y, width: r.width, height: r.height },
  };
}

class SpatialTracker {
  private cursor: { x: number; y: number } | null = null;
  private gaze: { x: number; y: number } | null = null;
  private hovered: Element | null = null;
  private started = false;

  start() {
    if (this.started || typeof window === "undefined") return;
    this.started = true;
    window.addEventListener("mousemove", this.onMove, { passive: true });
    window.addEventListener("mouseover", this.onOver, { passive: true });
  }

  stop() {
    if (!this.started) return;
    this.started = false;
    window.removeEventListener("mousemove", this.onMove);
    window.removeEventListener("mouseover", this.onOver);
  }

  private onMove = (e: MouseEvent) => {
    this.cursor = { x: e.clientX, y: e.clientY };
  };

  private onOver = (e: MouseEvent) => {
    const t = e.target as Element | null;
    this.hovered = t?.closest?.(`[${ATTR_ID}]`) ?? null;
  };

  /** Eye-tracking abstraction — a provider can push gaze coords here. */
  setGazePoint(p: { x: number; y: number } | null) {
    this.gaze = p;
  }

  /** Build a fresh attention snapshot. */
  capture(): SpatialContext {
    const active = typeof document !== "undefined" ? (document.activeElement as Element | null) : null;
    const focused = active?.closest?.(`[${ATTR_ID}]`) ?? null;
    const sel = typeof window !== "undefined" ? window.getSelection?.() : null;
    const textSelection = sel && !sel.isCollapsed ? sel.toString().trim() : "";
    const selEl =
      sel && sel.rangeCount > 0
        ? (sel.getRangeAt(0).commonAncestorContainer as Node).parentElement?.closest?.(`[${ATTR_ID}]`) ?? null
        : null;
    return {
      cursor: this.gaze ?? this.cursor,
      hoveredId: this.hovered ? readMeta(this.hovered).id : null,
      selectedId: selEl ? readMeta(selEl).id : null,
      focusedId: focused ? readMeta(focused).id : null,
      textSelection: textSelection || null,
      viewport: {
        width: typeof window !== "undefined" ? window.innerWidth : 0,
        height: typeof window !== "undefined" ? window.innerHeight : 0,
        scrollY: typeof window !== "undefined" ? window.scrollY : 0,
      },
      at: Date.now(),
    };
  }

  /** Element directly under the cursor/gaze right now (for "this" fallback). */
  elementAtPoint(): Element | null {
    const p = this.gaze ?? this.cursor;
    if (!p || typeof document === "undefined") return null;
    const el = document.elementFromPoint(p.x, p.y);
    return el?.closest?.(`[${ATTR_ID}]`) ?? null;
  }
}

export const spatialTracker = new SpatialTracker();

const byId = (id: string | null): Element | null =>
  id && typeof document !== "undefined" ? document.querySelector(`[${ATTR_ID}="${CSS.escape(id)}"]`) : null;

/**
 * Resolve a reference to a concrete target. Resolution order favours the most
 * deliberate signal: explicit selection → hovered → focused → element at point.
 */
export function resolveReference(
  ref: SpatialReference,
  ctx: SpatialContext = spatialTracker.capture(),
): PresenceTarget | null {
  let el: Element | null = null;
  switch (ref) {
    case "selected":
    case "selection":
      el = byId(ctx.selectedId);
      break;
    case "focused":
      el = byId(ctx.focusedId);
      break;
    case "hovered":
    case "this":
    case "that":
    case "it":
      el = byId(ctx.hoveredId) ?? spatialTracker.elementAtPoint();
      break;
    case "current":
    case "current card":
    case "current doc":
      el = byId(ctx.focusedId) ?? byId(ctx.hoveredId) ?? byId(ctx.selectedId);
      break;
    default:
      el = null;
  }
  return el ? toTarget(el) : null;
}

/** Resolve a named target by its data-presence-id (for routed/agent targets). */
export function resolveTargetId(id: string): PresenceTarget | null {
  const el = byId(id);
  return el ? toTarget(el) : null;
}

/** Detect a deictic reference inside a phrase, if present. */
export function detectReference(phrase: string): SpatialReference | null {
  const p = phrase.toLowerCase();
  if (/\bcurrent card\b/.test(p)) return "current card";
  if (/\bcurrent doc(ument)?\b/.test(p)) return "current doc";
  if (/\bselect(ed|ion)\b/.test(p)) return "selected";
  if (/\bfocused\b/.test(p)) return "focused";
  if (/\bcurrent\b/.test(p)) return "current";
  if (/\b(this|that|it)\b/.test(p)) return "this";
  return null;
}
