/**
 * POST /api/integrations/google/sync
 *
 * On-demand bidirectional sync. Body:
 *
 *   { rangeStart?: ISO, rangeEnd?: ISO, conflictPolicy?: "prefer-newer" | "prefer-local" | "prefer-remote" }
 *
 * Pulls remote events, loads local events from Firestore, three-way
 * diffs against the persisted snapshot, applies write classes, resolves
 * conflicts, and updates the snapshot.
 *
 * Idempotent: re-running with the same input is safe; the diff
 * naturally collapses to no-ops once both sides converge.
 *
 * Emits a realtime "sync.complete" event on the user's SSE channel
 * (see /api/realtime/calendar/route.ts).
 */

import { NextResponse, type NextRequest } from "next/server";
import { verifyRequest } from "@/lib/server/auth";
import { ensureFreshAccessToken, makeServerHttpClient, type IntegrationDoc, GoogleApiError } from "@/lib/server/google-api";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { bidirectionalDiff, googleToTimed, resolveSyncConflict, timedToGoogle, type ConflictPolicy, type SyncSnapshotEntry, type TimedEvent } from "@/lib/scheduler";
import { publishCalendarEvent } from "@/lib/server/realtime";
import { log } from "@/lib/observability";
import { FieldValue } from "firebase-admin/firestore";

const DEFAULT_RANGE_DAYS = 60;

interface SyncBody {
  rangeStart?: string;
  rangeEnd?: string;
  conflictPolicy?: ConflictPolicy;
}

export async function POST(req: NextRequest): Promise<Response> {
  const user = await verifyRequest(req);
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as SyncBody;

  const policy: ConflictPolicy = body.conflictPolicy ?? "prefer-newer";
  const rangeStart = body.rangeStart ?? new Date(Date.now() - 7 * 86_400_000).toISOString();
  const rangeEnd   = body.rangeEnd   ?? new Date(Date.now() + DEFAULT_RANGE_DAYS * 86_400_000).toISOString();

  try {
    const stats = await runBidirectionalSync({
      uid: user.uid,
      rangeStart,
      rangeEnd,
      policy,
    });
    log.event("gcal.sync", {
      userId: user.uid,
      direction: "bidirectional",
      applied:
        stats.toCreateRemote + stats.toUpdateRemote + stats.toDeleteRemote +
        stats.toCreateLocal + stats.toUpdateLocal + stats.toDeleteLocal,
      conflicts: stats.conflictsResolved,
      errors: 0,
      durationMs: stats.durationMs,
      trigger: "manual",
    });
    return NextResponse.json({ ok: true, ...stats });
  } catch (err) {
    const status =
      err instanceof GoogleApiError && err.kind === "unauthenticated" ? 401 :
      err instanceof GoogleApiError && err.kind === "revoked"          ? 410 :
      err instanceof GoogleApiError && err.kind === "rate-limited"     ? 429 : 500;
    const message = err instanceof Error ? err.message : "sync failed";
    log.event("gcal.sync", {
      userId: user.uid,
      direction: "bidirectional",
      errors: 1,
      trigger: "manual",
    });
    log.error(err, { route: "gcal.sync", uid: user.uid });
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

/* ───────────── core sync ───────────── */

export interface SyncStats {
  toCreateRemote: number;
  toUpdateRemote: number;
  toDeleteRemote: number;
  toCreateLocal: number;
  toUpdateLocal: number;
  toDeleteLocal: number;
  conflictsResolved: number;
  durationMs: number;
}

export async function runBidirectionalSync(args: {
  uid: string;
  rangeStart: string;
  rangeEnd: string;
  policy: ConflictPolicy;
}): Promise<SyncStats> {
  const t0 = Date.now();
  const fs = getAdminFirestore();
  const integrationRef = fs.doc(`users/${args.uid}/integrations/google`);
  const accessToken = await ensureFreshAccessToken(args.uid);

  // 1. Fetch remote events (paginate).
  const http = makeServerHttpClient();
  const remoteEvents = [];
  let pageToken: string | undefined;
  do {
    const page = await http.listEvents({
      accessToken,
      timeMin: args.rangeStart,
      timeMax: args.rangeEnd,
      pageToken,
    });
    remoteEvents.push(...page.events);
    pageToken = page.nextPageToken;
  } while (pageToken);

  // 2. Fetch local events.
  const eventsCol = fs.collection(`users/${args.uid}/calendar/events`);
  const localQuery = await eventsCol
    .where("start", ">=", args.rangeStart)
    .where("start", "<=", args.rangeEnd)
    .get();
  const localEvents: TimedEvent[] = localQuery.docs.map((d) => d.data() as TimedEvent);

  // 3. Load snapshot.
  const snapCol = fs.collection(`users/${args.uid}/integrations/google/snapshot`);
  const snapQuery = await snapCol.get();
  const snapshot: SyncSnapshotEntry[] = snapQuery.docs.map((d) => d.data() as SyncSnapshotEntry);

  // 4. Diff.
  const diff = bidirectionalDiff({
    local: localEvents,
    remote: remoteEvents,
    snapshot,
  });

  // 5. Apply remote-side writes.
  const batchRemote = await Promise.allSettled([
    ...diff.toCreateRemote.map(async (e) => {
      const inserted = await http.insertEvent({ accessToken, calendarId: "primary", event: timedToGoogle(e) });
      return { localId: e.id, remoteId: inserted.id, remoteEtag: inserted.etag, localFingerprint: fingerprint(e) };
    }),
    ...diff.toUpdateRemote.map(async ({ local, remoteId, etag }) => {
      const patched = await http.patchEvent({ accessToken, calendarId: "primary", eventId: remoteId, patch: timedToGoogle(local), etag });
      return { localId: local.id, remoteId: patched.id, remoteEtag: patched.etag, localFingerprint: fingerprint(local) };
    }),
    ...diff.toDeleteRemote.map(async ({ remoteId }) => {
      await http.deleteEvent({ accessToken, calendarId: "primary", eventId: remoteId });
      return null;
    }),
  ]);

  // 6. Apply local-side writes via chunked batches (Firestore caps at 500 ops/batch).
  const localOps: Array<() => void> = [];
  const localBatchedOps: Array<{ op: "set" | "delete"; path: string; data?: unknown; merge?: boolean }> = [];
  for (const e of diff.toCreateLocal) {
    localBatchedOps.push({ op: "set", path: e.id, data: e });
  }
  for (const { remoteEvent, localId } of diff.toUpdateLocal) {
    const next = googleToTimed(remoteEvent);
    localBatchedOps.push({ op: "set", path: localId, data: { ...next, id: localId }, merge: true });
  }
  for (const { localId } of diff.toDeleteLocal) {
    localBatchedOps.push({ op: "delete", path: localId });
  }
  void localOps;

  // 7. Resolve conflicts.
  let conflictsResolved = 0;
  const snapOps: Array<{ op: "set" | "delete"; key: string; data?: SyncSnapshotEntry }> = [];
  for (const conflict of diff.conflicts) {
    const choice = resolveSyncConflict(conflict, args.policy);
    if (choice === "use-local") {
      const local = localEvents.find((e) => e.id === conflict.localId);
      if (local) {
        try {
          const patched = await http.patchEvent({
            accessToken,
            calendarId: "primary",
            eventId: conflict.remoteId,
            patch: timedToGoogle(local),
          });
          snapOps.push({
            op: "set",
            key: snapshotKey(local.id, patched.id),
            data: {
              localId: local.id,
              remoteId: patched.id,
              remoteEtag: patched.etag,
              localFingerprint: fingerprint(local),
              syncedAt: Date.now(),
            },
          });
          conflictsResolved++;
        } catch {/* swallowed — counted as unresolved */}
      }
    } else {
      const remote = remoteEvents.find((e) => e.id === conflict.remoteId);
      if (remote) {
        const next = googleToTimed(remote);
        localBatchedOps.push({ op: "set", path: conflict.localId, data: { ...next, id: conflict.localId }, merge: true });
        snapOps.push({
          op: "set",
          key: snapshotKey(conflict.localId, remote.id),
          data: {
            localId: conflict.localId,
            remoteId: remote.id,
            remoteEtag: remote.etag,
            localFingerprint: fingerprint(next),
            syncedAt: Date.now(),
          },
        });
        conflictsResolved++;
      }
    }
  }

  // 8. Commit local writes in 400-op chunks (Firestore allows 500 but
  //    we leave headroom for transactional metadata).
  await commitChunked(fs, eventsCol.path, localBatchedOps);

  // 9. Persist snapshot for new mappings + tombstone deletes.
  for (const result of batchRemote) {
    if (result.status !== "fulfilled" || !result.value) continue;
    const entry = result.value;
    snapOps.push({ op: "set", key: snapshotKey(entry.localId, entry.remoteId), data: { ...entry, syncedAt: Date.now() } });
  }
  for (const { remoteId } of diff.toDeleteRemote) {
    const orphans = snapQuery.docs.filter((d) => (d.data() as SyncSnapshotEntry).remoteId === remoteId);
    for (const o of orphans) snapOps.push({ op: "delete", key: o.id });
  }
  for (const { localId } of diff.toDeleteLocal) {
    const orphans = snapQuery.docs.filter((d) => (d.data() as SyncSnapshotEntry).localId === localId);
    for (const o of orphans) snapOps.push({ op: "delete", key: o.id });
  }
  await commitChunked(fs, snapCol.path, snapOps.map((o) => ({ op: o.op, path: o.key, data: o.data })));

  // 10. Stamp lastSyncedAt. Clear lastError via FieldValue.delete(),
  // bypassing the static IntegrationDoc shape (admin SDK accepts it).
  await integrationRef.set({
    lastSyncedAt: Date.now(),
    lastError: FieldValue.delete(),
  } as unknown as Partial<IntegrationDoc>, { merge: true });

  // 11. Publish realtime "sync.complete" so other tabs reload.
  await publishCalendarEvent(args.uid, { kind: "sync.complete", at: Date.now() });

  return {
    toCreateRemote: diff.toCreateRemote.length,
    toUpdateRemote: diff.toUpdateRemote.length,
    toDeleteRemote: diff.toDeleteRemote.length,
    toCreateLocal:  diff.toCreateLocal.length,
    toUpdateLocal:  diff.toUpdateLocal.length,
    toDeleteLocal:  diff.toDeleteLocal.length,
    conflictsResolved,
    durationMs: Date.now() - t0,
  };
}

/* ───────────── helpers ───────────── */

function snapshotKey(localId: string, remoteId: string): string {
  // Deterministic id so re-syncs collapse to upserts.
  return `${localId}__${remoteId}`.slice(0, 1500);
}

/** djb2 fingerprint over the wire-relevant fields. Mirrors gcal.ts. */
function fingerprint(e: TimedEvent): string {
  const blob = [e.title, e.start, e.end, e.location ?? "", e.description ?? "", JSON.stringify(e.attendees ?? [])].join("|");
  let h = 5381;
  for (let i = 0; i < blob.length; i++) h = ((h * 33) ^ blob.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** Commits batched Firestore ops in chunks of 400 to stay under the 500-op limit. */
async function commitChunked(
  fs: FirebaseFirestore.Firestore,
  collectionPath: string,
  ops: Array<{ op: "set" | "delete"; path: string; data?: unknown; merge?: boolean }>,
): Promise<void> {
  const CHUNK = 400;
  for (let i = 0; i < ops.length; i += CHUNK) {
    const batch = fs.batch();
    for (const item of ops.slice(i, i + CHUNK)) {
      const ref = fs.doc(`${collectionPath}/${item.path}`);
      if (item.op === "delete") {
        batch.delete(ref);
      } else {
        batch.set(ref, item.data as FirebaseFirestore.DocumentData, item.merge ? { merge: true } : {});
      }
    }
    await batch.commit();
  }
}
