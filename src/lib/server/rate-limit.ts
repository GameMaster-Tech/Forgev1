/**
 * Rate-limit utility for API routes.
 *
 * Implementation: in-memory token bucket keyed by `${routeId}::${identifier}`.
 * The identifier is the authenticated uid when available, falling back to
 * the client IP from `x-forwarded-for` / `x-real-ip`.
 *
 * This is a single-process limiter — fine for a single Vercel function or
 * a single self-hosted node, but every replica gets its own bucket. The
 * intention is to (a) survive a casual abuser hammering a single route
 * and (b) keep external-API spend bounded. Production scaling to multiple
 * replicas needs Redis or Firestore backing; the public surface
 * (`enforceRateLimit`) is stable so swapping the store later is cheap.
 *
 * Security rule: every route that calls a metered upstream (EXA,
 * Anthropic, Crossref, Voyage) MUST call `enforceRateLimit` before
 * touching the upstream. Routes that only read/write our own Firestore
 * SHOULD still call it to make brute-force walking expensive.
 *
 * Server-only — never import from a `"use client"` file.
 */

import "server-only";

export interface RateLimitConfig {
  /** Logical route identifier — namespaces buckets across endpoints. */
  routeId: string;
  /** Max requests allowed per window. */
  limit: number;
  /** Window in milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  ok: boolean;
  /** Tokens remaining in the current window (0 when blocked). */
  remaining: number;
  /** Unix-ms timestamp when the window resets. */
  resetAt: number;
  /** Total budget for the window. Echoed for the X-RateLimit-Limit header. */
  limit: number;
}

/** Token-bucket state. */
interface Bucket {
  count: number;
  resetAt: number;
}

// Buckets live for the process lifetime. We sweep stale entries lazily.
const BUCKETS = new Map<string, Bucket>();
const SWEEP_INTERVAL_MS = 60_000;
let _lastSweep = 0;

function sweep(now: number): void {
  if (now - _lastSweep < SWEEP_INTERVAL_MS) return;
  _lastSweep = now;
  for (const [key, bucket] of BUCKETS) {
    if (bucket.resetAt <= now) BUCKETS.delete(key);
  }
}

/**
 * Best-effort client identifier. Prefers the authenticated uid; falls back to
 * the trusted forwarded IP header. Returns "anon" as a last resort so the
 * limiter still bites anonymous attackers (but they all share one bucket —
 * front the app with a real WAF if you need per-IP precision on free tier).
 *
 * `x-forwarded-for` may contain a comma-separated list; we take the first
 * (the original client). Hosting environments that don't set this header
 * MUST not trust user-supplied alternatives.
 */
export function identifyClient(request: Request, uid?: string | null): string {
  if (uid) return `uid:${uid}`;
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return `ip:${xff.split(",")[0].trim()}`;
  const real = request.headers.get("x-real-ip");
  if (real) return `ip:${real.trim()}`;
  return "ip:anon";
}

/**
 * Decrement the bucket. Returns `{ ok: false }` when the bucket is empty.
 * Pure: callers decide whether to 429 or proceed.
 */
export function enforceRateLimit(
  request: Request,
  config: RateLimitConfig,
  identifier?: string,
): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const id = identifier ?? identifyClient(request);
  const key = `${config.routeId}::${id}`;

  let bucket = BUCKETS.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + config.windowMs };
    BUCKETS.set(key, bucket);
  }

  if (bucket.count >= config.limit) {
    return {
      ok: false,
      remaining: 0,
      resetAt: bucket.resetAt,
      limit: config.limit,
    };
  }

  bucket.count += 1;
  return {
    ok: true,
    remaining: Math.max(0, config.limit - bucket.count),
    resetAt: bucket.resetAt,
    limit: config.limit,
  };
}

/**
 * Convenience: build a 429 Response with the standard `Retry-After`,
 * `X-RateLimit-*` headers. Use directly when the limiter says `ok: false`.
 */
export function rateLimitResponse(result: RateLimitResult): Response {
  const retrySeconds = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
  return new Response(
    JSON.stringify({ error: "Rate limit exceeded. Try again shortly." }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(retrySeconds),
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
      },
    },
  );
}

/* ── Preset budgets ─────────────────────────────────────────
 *
 * Tier      | route shape                  | limit          | window
 * ----------+------------------------------+----------------+--------
 * EXPENSIVE | external LLM / search calls  | 20 req         | 60 s
 * MODERATE  | Firestore write paths        | 60 req         | 60 s
 * READ      | Firestore read / SSE         | 240 req        | 60 s
 *
 * Use the matching `RATE_LIMIT_*` preset to keep budgets consistent across
 * routes of the same shape. */

export const RATE_LIMIT_EXPENSIVE: Omit<RateLimitConfig, "routeId"> = {
  limit: 20,
  windowMs: 60_000,
};
export const RATE_LIMIT_MODERATE: Omit<RateLimitConfig, "routeId"> = {
  limit: 60,
  windowMs: 60_000,
};
export const RATE_LIMIT_READ: Omit<RateLimitConfig, "routeId"> = {
  limit: 240,
  windowMs: 60_000,
};
