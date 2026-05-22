/**
 * Execution-token gating for the Tempo pipeline (spec §4 Phase 3).
 *
 * A client confirms the proposed VisualDeltaMap and asks the server to
 * apply it. We require the same token round-trip the rest of the
 * write-paths use, but with a content-bound HMAC so a stale token
 * can't be replayed against a different delta. The server signs the
 * token at `/api/forge-graph/tempo/sign`, the client surfaces it to
 * the user for confirmation, then submits it to `/api/forge-graph/tempo/apply`
 * which verifies the signature and the freshness window.
 *
 * Server-only by virtue of accessing the encryption key. The matching
 * client-side helper in `tempo-runs.ts` only ships the *opaque* token —
 * never reads or generates it.
 */

import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const TTL_MS = 5 * 60 * 1000; // 5 minutes — the user has time to confirm.
const SECRET_ENV = "SERVER_ENCRYPTION_KEY";

export interface TempoTokenPayload {
  /** Issued-at, ms epoch. */
  iat: number;
  /** Expiry, ms epoch. */
  exp: number;
  /** Caller uid the token is bound to. */
  uid: string;
  /** Project the simulation targets. */
  projectId: string;
  /** Stable hash of the VisualDeltaMap mutation list. */
  deltaHash: string;
  /** One-shot nonce so two identical deltas can't share a token. */
  nonce: string;
}

export interface TempoTokenIssued {
  token: string;
  payload: TempoTokenPayload;
}

export function issueTempoToken(args: {
  uid: string;
  projectId: string;
  deltaHash: string;
}): TempoTokenIssued {
  const now = Date.now();
  const payload: TempoTokenPayload = {
    iat: now,
    exp: now + TTL_MS,
    uid: args.uid,
    projectId: args.projectId,
    deltaHash: args.deltaHash,
    nonce: randomBytes(12).toString("base64url"),
  };
  const body = b64url(JSON.stringify(payload));
  const sig = sign(body);
  return { token: `${body}.${sig}`, payload };
}

export interface TempoTokenVerified {
  ok: true;
  payload: TempoTokenPayload;
}
export interface TempoTokenInvalid {
  ok: false;
  reason: "malformed" | "bad-signature" | "expired" | "uid-mismatch" | "project-mismatch" | "delta-mismatch";
}

export function verifyTempoToken(
  token: string,
  expect: { uid: string; projectId: string; deltaHash: string },
): TempoTokenVerified | TempoTokenInvalid {
  const dot = token.indexOf(".");
  if (dot < 1 || dot === token.length - 1) {
    return { ok: false, reason: "malformed" };
  }
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expectedSig = sign(body);
  if (!timingSafeEqualB64(sig, expectedSig)) {
    return { ok: false, reason: "bad-signature" };
  }

  let payload: TempoTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as TempoTokenPayload;
  } catch {
    return { ok: false, reason: "malformed" };
  }

  if (typeof payload.exp !== "number" || Date.now() > payload.exp) {
    return { ok: false, reason: "expired" };
  }
  if (payload.uid !== expect.uid) return { ok: false, reason: "uid-mismatch" };
  if (payload.projectId !== expect.projectId) return { ok: false, reason: "project-mismatch" };
  if (payload.deltaHash !== expect.deltaHash) return { ok: false, reason: "delta-mismatch" };
  return { ok: true, payload };
}

/**
 * Stable hash of the mutation list. Doesn't include the
 * `globalRiskScore` or timestamps so a legitimate client reroute that
 * recomputes risk later still matches.
 */
export function hashDeltaMutations(mutations: Array<{
  nodeId: string;
  targetField: string;
  proposedValue: unknown;
}>): string {
  const canonical = mutations
    .slice()
    .map((m) => ({
      nodeId: m.nodeId,
      targetField: m.targetField,
      proposedValue: stableStringify(m.proposedValue),
    }))
    .sort((a, b) => {
      const k = a.nodeId.localeCompare(b.nodeId);
      if (k !== 0) return k;
      return a.targetField.localeCompare(b.targetField);
    });
  return sign(JSON.stringify(canonical));
}

/* ───────────── crypto helpers ───────────── */

function getSecret(): string {
  const s = process.env[SECRET_ENV];
  if (!s) {
    throw new Error(
      `${SECRET_ENV} is not configured — Tempo execution tokens cannot be issued.`,
    );
  }
  return s;
}

function sign(body: string): string {
  return createHmac("sha256", getSecret()).update(body).digest("base64url");
}

function b64url(s: string): string {
  return Buffer.from(s, "utf8").toString("base64url");
}

function stableStringify(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function timingSafeEqualB64(a: string, b: string): boolean {
  try {
    const aBuf = Buffer.from(a, "base64url");
    const bBuf = Buffer.from(b, "base64url");
    if (aBuf.length !== bBuf.length) return false;
    return timingSafeEqual(aBuf, bBuf);
  } catch {
    return false;
  }
}
