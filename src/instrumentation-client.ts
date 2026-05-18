/**
 * Client-side Sentry init. Loaded by Next.js once the browser bundle
 * boots — separate from `instrumentation.ts` because server/edge
 * SDKs and client SDKs use different transports.
 */

import { initSentry } from "@/lib/observability/sentry";

initSentry({ runtime: "client" });
