"use client";

/**
 * Last-visited document — kills the *returning-user* cold start.
 *
 * The doc page records where you last worked; the Projects page offers a
 * "Continue where you left off" card, and Aria's `open_last` action resumes it
 * by voice ("open the last thing I worked on" / "resume"). Stored in
 * localStorage so it survives reloads without a round-trip.
 */

const KEY = "forge.lastDoc.v1";

export interface LastDoc {
  projectId: string;
  docId: string;
  title: string;
  at: number;
}

export function recordLastDoc(d: Omit<LastDoc, "at">): void {
  if (typeof window === "undefined" || !d.projectId || !d.docId) return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...d, at: Date.now() }));
  } catch {
    /* private mode — fine */
  }
}

export function getLastDoc(): LastDoc | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as LastDoc;
    if (d && typeof d.projectId === "string" && typeof d.docId === "string") return d;
  } catch {
    /* corrupt — ignore */
  }
  return null;
}
