/**
 * Observability — typed event log + Sentry forwarding.
 *
 * Public surface:
 *   - log.event(kind, payload)   — record a structured event
 *   - log.error(err, context)    — record an exception with context
 *   - log.scrub(input)           — PII scrubber used by both paths
 *
 * Four flagship event kinds are tracked end-to-end:
 *   1. oauth.exchange — Google OAuth code → tokens
 *   2. gcal.sync     — calendar diff/apply
 *   3. sync.compile  — Sync engine constraint compile
 *   4. pulse.sync    — Pulse reality-sync run
 *
 * Anything else passed through the catch-all "custom" kind is
 * still scrubbed and forwarded, but isn't part of the canonical
 * dashboard taxonomy.
 */

import { captureEvent, captureException } from "./sentry";

/* ───────────── canonical event taxonomy ───────────── */

export type LogEventKind =
  | "oauth.exchange"
  | "gcal.sync"
  | "sync.compile"
  | "pulse.sync"
  | "custom";

export interface OAuthExchangePayload {
  provider: "google";
  status: "ok" | "denied" | "error";
  userId?: string;
  email?: string;
  reason?: string;
  durationMs?: number;
}

export interface GcalSyncPayload {
  userId?: string;
  direction: "pull" | "push" | "bidirectional";
  applied?: number;
  conflicts?: number;
  errors?: number;
  durationMs?: number;
  trigger?: "cron" | "webhook" | "manual";
}

export interface SyncCompilePayload {
  projectId?: string;
  assertions?: number;
  violations?: number;
  patches?: number;
  durationMs?: number;
}

export interface PulseSyncPayload {
  projectId?: string;
  blocksScanned?: number;
  decayed?: number;
  refactors?: number;
  durationMs?: number;
}

export type LogEventPayload =
  | { kind: "oauth.exchange"; data: OAuthExchangePayload }
  | { kind: "gcal.sync"; data: GcalSyncPayload }
  | { kind: "sync.compile"; data: SyncCompilePayload }
  | { kind: "pulse.sync"; data: PulseSyncPayload }
  | { kind: "custom"; data: Record<string, unknown> };

/* ───────────── PII scrubbing ───────────── */

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_RE = /(?:\+?\d{1,3}[ .-]?)?\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}/g;
const TOKEN_KEYS = new Set([
  "password",
  "pwd",
  "token",
  "accessToken",
  "refreshToken",
  "id_token",
  "idToken",
  "authorization",
  "cookie",
  "set-cookie",
  "ssn",
  "creditCard",
  "apiKey",
  "api_key",
  "secret",
  "clientSecret",
  "client_secret",
  "privateKey",
]);

function redactString(s: string): string {
  return s.replace(EMAIL_RE, "[redacted-email]").replace(PHONE_RE, "[redacted-phone]");
}

/**
 * Recursive PII scrubber. Returns a defensive copy — never mutates input.
 * Email & phone patterns inside strings are masked; well-known
 * secret-bearing keys (`password`, `token`, …) are dropped entirely.
 */
export function scrub<T>(input: T, depth = 0): T {
  if (depth > 6 || input == null) return input;
  if (typeof input === "string") return redactString(input) as unknown as T;
  if (typeof input !== "object") return input;
  if (Array.isArray(input)) {
    return input.map((v) => scrub(v, depth + 1)) as unknown as T;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (TOKEN_KEYS.has(k) || TOKEN_KEYS.has(k.toLowerCase())) {
      out[k] = "[redacted]";
      continue;
    }
    out[k] = scrub(v, depth + 1);
  }
  return out as unknown as T;
}

/* ───────────── runtime context detection ───────────── */

function runtime(): "browser" | "edge" | "node" {
  if (typeof window !== "undefined") return "browser";
  if (typeof (globalThis as { EdgeRuntime?: unknown }).EdgeRuntime !== "undefined") return "edge";
  return "node";
}

/* ───────────── public logger ───────────── */

interface LogEnvelope {
  kind: LogEventKind;
  at: string;
  runtime: "browser" | "edge" | "node";
  data: unknown;
}

function emit(envelope: LogEnvelope): void {
  // Local console — always on so devs can `npm run dev` and see events.
  // Sentry breadcrumb + event — silently no-op if Sentry isn't configured.
  console.log(`[event] ${envelope.kind}`, envelope);
  captureEvent(envelope.kind, envelope);
}

export const log = {
  /**
   * Record a typed product event. Payloads are scrubbed before they
   * leave this process boundary — neither the local console nor the
   * upstream sink ever sees raw PII or secrets.
   */
  event<K extends LogEventPayload["kind"]>(
    kind: K,
    payload: Extract<LogEventPayload, { kind: K }>["data"],
  ): void {
    const scrubbed = scrub(payload);
    emit({ kind, at: new Date().toISOString(), runtime: runtime(), data: scrubbed });
  },

  /**
   * Record an exception. The error and any structured context attached
   * to it are forwarded to Sentry (when configured) and to the local
   * console.
   */
  error(err: unknown, context?: Record<string, unknown>): void {
    const safeCtx = context ? scrub(context) : undefined;
    captureException(err, safeCtx);
    console.error("[error]", err, safeCtx);
  },

  /** Re-export the scrubber so callers can sanitize ad-hoc payloads. */
  scrub,
};

export type { LogEnvelope };
