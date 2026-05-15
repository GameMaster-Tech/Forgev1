/**
 * GET /api/cron/gcal-sync
 *
 * Cloud Scheduler / Vercel Cron entry point. Iterates every user with
 * status=connected and runs an incremental sync. Each per-user job is
 * isolated so one user's failure can't fail the rest.
 *
 * Auth: header `x-cron-secret: <CRON_SECRET>` (constant-time compared).
 *
 * Concurrency: caps `MAX_CONCURRENT` syncs in flight to stay under
 * Google's per-app QPS. Tune via env `GCAL_SYNC_CONCURRENCY`.
 *
 * Cloud Scheduler config:
 *   schedule:  every 5 minutes
 *   target:    HTTPS GET to this URL with x-cron-secret header
 *   max-retry: 3
 *   attempt-deadline: 540s (the full 9 min Cloud Run limit)
 */

import { NextResponse, type NextRequest } from "next/server";
import { verifyCronSecret } from "@/lib/server/auth";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { runBidirectionalSync } from "@/app/api/integrations/google/sync/route";
import { GoogleApiError } from "@/lib/server/google-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 540;   // seconds, for Vercel hobby/pro caps

interface UserResult {
  uid: string;
  ok: boolean;
  reason?: string;
  durationMs?: number;
}

export async function GET(req: NextRequest): Promise<Response> {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const fs = getAdminFirestore();
  const concurrency = Math.max(1, Math.min(50, parseInt(process.env.GCAL_SYNC_CONCURRENCY ?? "5", 10)));

  // Find all users with a connected integration. Uses collection group
  // so we can find docs at `users/{uid}/integrations/google` directly.
  const connected = await fs.collectionGroup("integrations")
    .where("status", "==", "connected")
    .get();

  const queue = connected.docs
    .filter((d) => d.id === "google")
    .map((d) => d.ref.path.split("/")[1]); // uid

  const now = Date.now();
  const rangeStart = new Date(now - 7 * 86_400_000).toISOString();
  const rangeEnd   = new Date(now + 60 * 86_400_000).toISOString();

  const results: UserResult[] = [];
  await runWithConcurrency(queue, concurrency, async (uid) => {
    const t0 = Date.now();
    try {
      await runBidirectionalSync({ uid, rangeStart, rangeEnd, policy: "prefer-newer" });
      results.push({ uid, ok: true, durationMs: Date.now() - t0 });
    } catch (err) {
      const reason = err instanceof GoogleApiError ? err.kind
        : err instanceof Error ? err.message
        : "unknown";
      results.push({ uid, ok: false, reason, durationMs: Date.now() - t0 });
    }
  });

  return NextResponse.json({
    ok: true,
    processed: results.length,
    succeeded: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    durationMs: Date.now() - now,
    results: process.env.NODE_ENV === "production" ? undefined : results,
  });
}

/* ───────────── helpers ───────────── */

async function runWithConcurrency<T>(items: T[], n: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(n, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      if (item === undefined) break;
      try { await fn(item); } catch {/* per-item swallowed */}
    }
  });
  await Promise.all(workers);
}
