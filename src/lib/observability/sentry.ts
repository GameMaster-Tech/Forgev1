/**
 * Sentry init + thin capture wrappers.
 *
 * The Sentry SDK is loaded lazily inside `initSentry` so the cost is
 * paid only when a DSN is configured. Capture helpers are safe to call
 * regardless — they degrade to no-ops when Sentry hasn't initialised.
 */

import * as Sentry from "@sentry/nextjs";
import { scrub } from ".";

let initialised = false;
let enabled = false;

interface InitOpts {
  runtime: "client" | "server" | "edge";
}

/**
 * Initialise Sentry for the requested runtime. Idempotent: calling
 * twice (e.g. once from instrumentation.ts and once from
 * instrumentation-client.ts in the same process) is a no-op after
 * the first init.
 *
 * Requires `NEXT_PUBLIC_SENTRY_DSN` (client) or `SENTRY_DSN` (server).
 * Without it, Sentry is silently disabled — the local event log keeps
 * working.
 */
export function initSentry({ runtime }: InitOpts): void {
  if (initialised) return;
  initialised = true;

  const dsn =
    runtime === "client"
      ? process.env.NEXT_PUBLIC_SENTRY_DSN
      : process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
    release: process.env.NEXT_PUBLIC_SENTRY_RELEASE ?? process.env.SENTRY_RELEASE,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
    sendDefaultPii: false,
    beforeSend(event) {
      // Strip request body / headers before they leave the box.
      if (event.request) {
        if (event.request.data) event.request.data = scrub(event.request.data);
        if (event.request.headers) event.request.headers = scrub(event.request.headers);
        if (event.request.cookies) event.request.cookies = { redacted: "true" };
      }
      if (event.user) {
        // Keep the opaque id; drop email + ip address.
        const u = event.user;
        event.user = { id: u.id };
      }
      if (event.extra) event.extra = scrub(event.extra);
      if (event.contexts) event.contexts = scrub(event.contexts);
      return event;
    },
    beforeBreadcrumb(crumb) {
      if (crumb.data) crumb.data = scrub(crumb.data);
      if (crumb.message) crumb.message = redactInline(crumb.message);
      return crumb;
    },
  });
  enabled = true;
}

function redactInline(s: string): string {
  return s
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/g, "Bearer [redacted]");
}

/** Push a structured product event as a Sentry breadcrumb. No-op when disabled. */
export function captureEvent(kind: string, envelope: unknown): void {
  if (!enabled) return;
  Sentry.addBreadcrumb({
    category: "product",
    type: "info",
    level: "info",
    message: kind,
    data: envelope as Record<string, unknown>,
  });
}

export function captureException(err: unknown, context?: Record<string, unknown>): void {
  if (!enabled) return;
  Sentry.captureException(err, context ? { extra: context as Record<string, unknown> } : undefined);
}

/** Re-exported for the Next.js `onRequestError` hook. */
export const onRequestError: typeof Sentry.captureRequestError = Sentry.captureRequestError;
