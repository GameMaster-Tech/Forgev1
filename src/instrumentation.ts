/**
 * Next.js instrumentation entrypoint.
 *
 * Runs once per server process before any request is handled. We use
 * it to bring up Sentry for the active runtime. The client SDK is
 * initialised separately by `instrumentation-client.ts`.
 *
 * `onRequestError` is forwarded to Sentry so server-side route errors
 * surface in the dashboard without each route having to wrap itself.
 */

import { initSentry } from "@/lib/observability/sentry";

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    initSentry({ runtime: "server" });
  } else if (process.env.NEXT_RUNTIME === "edge") {
    initSentry({ runtime: "edge" });
  }
}

export { onRequestError } from "@/lib/observability/sentry";
