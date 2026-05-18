/**
 * Sharing store — in-memory client store keyed by resource id.
 * Persists to localStorage so reloads keep state. A Firestore-backed
 * adapter can re-implement this contract later without UI churn.
 */

import { createPublicLink, grant, pruneExpired, revoke } from "../scheduler/share";
import type { PublicLinkShare } from "../scheduler/share";
import type { ShareGrant, ShareRole } from "../scheduler/types";
import type { ShareableKind, SharingState } from "./types";

const STORAGE_KEY = "forge.sharing.v1";

type Snapshot = Record<string, SharingState>;

function keyOf(kind: ShareableKind, id: string): string {
  return `${kind}:${id}`;
}

function read(): Snapshot {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Snapshot;
  } catch { return {}; }
}

function write(snap: Snapshot): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snap));
  } catch {/* swallow */}
}

const subs = new Set<() => void>();
function emit(): void {
  for (const fn of subs) {
    try { fn(); } catch {/* swallow */}
  }
}

export function subscribeSharing(handler: () => void): () => void {
  subs.add(handler);
  return () => { subs.delete(handler); };
}

export function getSharingState(kind: ShareableKind, id: string): SharingState {
  const snap = read();
  const k = keyOf(kind, id);
  const state = snap[k] ?? { grants: [], publicLink: null };
  // Prune expired grants on every read.
  const pruned = pruneExpired(state.grants);
  if (pruned.length !== state.grants.length) {
    snap[k] = { ...state, grants: pruned };
    write(snap);
  }
  // Auto-expire public link.
  if (state.publicLink?.expiresAt && new Date(state.publicLink.expiresAt).getTime() < Date.now()) {
    snap[k] = { ...(snap[k] ?? state), publicLink: null };
    write(snap);
    return snap[k];
  }
  return snap[k] ?? state;
}

export function addGrant(
  kind: ShareableKind,
  id: string,
  args: {
    principal: { kind: "user" | "team" | "link"; id: string; displayName?: string };
    role: ShareRole;
    grantedBy: string;
    expiresAt?: string;
  },
): ShareGrant[] {
  const snap = read();
  const k = keyOf(kind, id);
  const current = snap[k] ?? { grants: [], publicLink: null };
  // The store layer doesn't know about resource semantics, but the
  // scheduler `grant` API does — match its shape exactly.
  const next = grant(current.grants, {
    resource: { kind: kind === "project" ? "calendar" : kind, id }, // map "project" → "calendar" for legacy compat
    principal: args.principal,
    role: args.role,
    grantedBy: args.grantedBy,
    expiresAt: args.expiresAt,
  });
  snap[k] = { ...current, grants: next };
  write(snap);
  emit();
  return next;
}

export function revokeGrant(kind: ShareableKind, id: string, grantId: string): ShareGrant[] {
  const snap = read();
  const k = keyOf(kind, id);
  const current = snap[k];
  if (!current) return [];
  const next = revoke(current.grants, grantId);
  snap[k] = { ...current, grants: next };
  write(snap);
  emit();
  return next;
}

export function mintPublicLink(
  kind: "calendar" | "event",
  id: string,
  role: "viewer" | "free-busy",
  ttlHours?: number,
): PublicLinkShare {
  const snap = read();
  const k = keyOf(kind, id);
  const current = snap[k] ?? { grants: [], publicLink: null };
  const link = createPublicLink(role, kind, id, ttlHours);
  snap[k] = { ...current, publicLink: link };
  write(snap);
  emit();
  return link;
}

export function revokePublicLink(kind: ShareableKind, id: string): void {
  const snap = read();
  const k = keyOf(kind, id);
  const current = snap[k];
  if (!current || !current.publicLink) return;
  snap[k] = { ...current, publicLink: null };
  write(snap);
  emit();
}
