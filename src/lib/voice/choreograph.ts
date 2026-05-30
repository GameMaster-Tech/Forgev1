"use client";

/**
 * Choreographer — the layer that makes Aria *inhabit* the canvas.
 *
 * Instead of teleporting the ghost cursor and firing a mutation instantly, the
 * choreographer plays a short, legible sequence a human collaborator would:
 *
 *     travel → dwell → click → (perform) → settle
 *
 * It drives ONLY the presence store (target + phase + click pulse); the actual
 * side effect (router.push, Firestore write, aria:ui event) is passed in as a
 * callback and run at the exact beat where a real click would have fired. So
 * the visible motion and the real work stay in lock-step without the cursor
 * ever touching the user's pointer.
 *
 * Targets are resolved from semantic DOM anchors (`data-presence-id`) via the
 * spatial resolver, so rects are read live — the choreography survives window
 * resizing, scrolling, and layout shifts. When an anchor is absent we fall back
 * to screen-center so a missing tag degrades gracefully instead of breaking.
 *
 * Timing is intentionally snappy (not theatrical): the spring in GhostCursor
 * does the easing; these awaits just sequence the beats.
 */

import { usePresenceStore } from "@/store/presence";
import { resolveTargetId } from "@/lib/presence/spatial";
import type { PresencePhase, PresenceTarget } from "@/lib/presence/types";

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Beat durations (ms). Tight on purpose — the real action fires right after the
 *  click beat, so these directly gate how soon the UI updates vs. Aria's speech.
 *  Kept just long enough to read as "travel → click", not as a delay. */
const TRAVEL_MS = 190; // the GhostCursor spring is fast; don't wait for full settle
const DWELL_MS = 40; // brief pause on arrival
const CLICK_MS = 70; // let the click ripple register, then act

function centerTarget(label?: string): PresenceTarget {
  const w = typeof window !== "undefined" ? window.innerWidth : 1280;
  const h = typeof window !== "undefined" ? window.innerHeight : 800;
  return { id: "screen:center", label, kind: "region", rect: { x: w / 2 - 12, y: h / 2 - 12, width: 24, height: 24 } };
}

/** Move the ghost to a resolved target and let the spring catch up. */
export async function travelTo(target: PresenceTarget, phase: PresencePhase = "navigating"): Promise<void> {
  const p = usePresenceStore.getState();
  p.setPhase(phase);
  p.setTarget(target);
  await wait(TRAVEL_MS);
}

/** Play a visible click at the current target. */
export async function clickHere(): Promise<void> {
  const p = usePresenceStore.getState();
  await wait(DWELL_MS);
  p.click();
  await wait(CLICK_MS);
}

/**
 * Travel to a semantic anchor (by data-presence-id), click it, then run the
 * real side effect at the click beat. Falls back to screen-center if the anchor
 * isn't mounted. Returns once the side effect has fired.
 *
 *   await choreographClick("nav:/projects", "Projects", () => router.push("/projects"))
 */
export async function choreographClick(
  anchorId: string,
  label: string,
  perform: () => void | Promise<void>,
  phase: PresencePhase = "navigating",
): Promise<void> {
  const target = resolveTargetId(anchorId) ?? centerTarget(label);
  await travelTo({ ...target, label }, phase);
  await clickHere();
  await perform();
}

/**
 * Travel to a target (anchor or center) and run work there WITHOUT a click —
 * for "acting in place" beats like writing into a region. Keeps the cursor
 * parked on the relevant spot while the executor does its thing.
 */
export async function choreographAt(
  anchorId: string | null,
  label: string,
  perform: () => void | Promise<void>,
  phase: PresencePhase = "executing",
): Promise<void> {
  const target = (anchorId ? resolveTargetId(anchorId) : null) ?? centerTarget(label);
  await travelTo({ ...target, label }, phase);
  await perform();
}
