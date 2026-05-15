/**
 * Sharing & permissions for calendars / events / tasks / goals.
 *
 * Pure data layer. The Firestore rules in `firestore.rules` enforce
 * the same model server-side; this module is the in-memory mirror so
 * the client can render correct UI affordances (eyes on a "viewer"
 * pencil, "free-busy only" badge, expiry countdown).
 */

import type { ShareGrant, ShareRole } from "./types";

const ROLE_RANK: Record<ShareRole, number> = {
  "owner":      100,
  "editor":      80,
  "commenter":   60,
  "viewer":      40,
  "free-busy":   20,
};

/* ───────────── access decisions ───────────── */

export interface AccessDecision {
  allowed: boolean;
  reason: string;
  effectiveRole: ShareRole | null;
}

export type Operation =
  | "read.details"
  | "read.free-busy"
  | "write.update"
  | "write.delete"
  | "write.share"
  | "comment.add";

const OP_MIN_ROLE: Record<Operation, ShareRole> = {
  "read.free-busy":  "free-busy",
  "read.details":    "viewer",
  "comment.add":     "commenter",
  "write.update":    "editor",
  "write.delete":    "editor",
  "write.share":     "owner",
};

export function decideAccess(
  grants: ShareGrant[],
  resource: { kind: "calendar" | "event" | "task" | "goal"; id: string },
  principal: { kind: "user" | "team" | "link"; id: string },
  op: Operation,
  now: number = Date.now(),
): AccessDecision {
  const relevant = grants.filter((g) =>
    g.resource.kind === resource.kind &&
    g.resource.id === resource.id &&
    g.principal.kind === principal.kind &&
    g.principal.id === principal.id,
  );
  // Pick the strongest non-expired grant.
  let best: ShareGrant | null = null;
  for (const g of relevant) {
    if (g.expiresAt && new Date(g.expiresAt).getTime() < now) continue;
    if (!best || ROLE_RANK[g.role] > ROLE_RANK[best.role]) best = g;
  }
  if (!best) return { allowed: false, reason: "no grant", effectiveRole: null };
  const min = OP_MIN_ROLE[op];
  const allowed = ROLE_RANK[best.role] >= ROLE_RANK[min];
  return {
    allowed,
    reason: allowed ? `granted via ${best.role}` : `requires ${min}, has ${best.role}`,
    effectiveRole: best.role,
  };
}

/* ───────────── mutators ───────────── */

export function grant(
  grants: ShareGrant[],
  next: Omit<ShareGrant, "id" | "grantedAt">,
  now = Date.now(),
): ShareGrant[] {
  const id = `g_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  // Idempotent: replace existing grant for the same (resource, principal).
  const without = grants.filter((g) =>
    !(g.resource.kind === next.resource.kind &&
      g.resource.id === next.resource.id &&
      g.principal.kind === next.principal.kind &&
      g.principal.id === next.principal.id),
  );
  return [...without, { ...next, id, grantedAt: now }];
}

export function revoke(grants: ShareGrant[], grantId: string): ShareGrant[] {
  return grants.filter((g) => g.id !== grantId);
}

export function pruneExpired(grants: ShareGrant[], now = Date.now()): ShareGrant[] {
  return grants.filter((g) => !g.expiresAt || new Date(g.expiresAt).getTime() >= now);
}

/* ───────────── public-link shares ───────────── */

export interface PublicLinkShare {
  token: string;
  role: ShareRole;
  resourceKind: "calendar" | "event";
  resourceId: string;
  expiresAt?: string;
}

/**
 * Generate a public, unguessable token. Caller persists this to
 * Firestore + maps the token → resource on the server. For demos we
 * generate client-side; production uses a server-issued nonce.
 */
export function createPublicLink(
  role: Extract<ShareRole, "viewer" | "free-busy">,
  resourceKind: "calendar" | "event",
  resourceId: string,
  ttlHours?: number,
): PublicLinkShare {
  const token = randomToken(32);
  const expiresAt = ttlHours ? new Date(Date.now() + ttlHours * 3600_000).toISOString() : undefined;
  return { token, role, resourceKind, resourceId, expiresAt };
}

function randomToken(bytes: number): string {
  const arr = new Uint8Array(bytes);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < bytes; i++) arr[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

/* ───────────── role display ───────────── */

export const ROLE_LABELS: Record<ShareRole, string> = {
  "owner":      "Owner",
  "editor":     "Editor",
  "commenter":  "Commenter",
  "viewer":     "Viewer",
  "free-busy":  "Free / busy",
};

export const ROLE_DESCRIPTIONS: Record<ShareRole, string> = {
  "owner":      "Full control. Can share or delete.",
  "editor":     "Add, edit, delete events. Can't reshare.",
  "commenter":  "Read everything. Add comments and reactions.",
  "viewer":     "Read everything. No write or comment.",
  "free-busy":  "See only when slots are blocked, not what's in them.",
};
