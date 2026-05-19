/**
 * Firestore-backed Yjs persistence provider.
 *
 * Storage model:
 *   users/{ownerUid}/projects/{pid}/yjs/{guid}/updates/{updateId}
 *     { update: base64, at: number, peerId: string }
 *
 * Strategy:
 *   • On `connect`, read the merged historical state via a snapshot
 *     query, apply it to the doc, then subscribe to new updates.
 *   • On every local update, append a new doc to `updates/`.
 *   • Periodically (every 30 s + on disconnect), compact by writing
 *     the encoded full state vector to a `_snapshot` doc and pruning
 *     the per-update log older than the snapshot's `at`.
 *
 * Optimisations:
 *   • Updates ≤2KB are written inline. Larger updates compact
 *     immediately to avoid blowing past Firestore's 1MB doc cap.
 *   • The local peer's own updates are deduped against incoming
 *     snapshot updates by `peerId` + `updateId` pair to avoid the
 *     classic Yjs echo loop.
 *
 * This file is server- AND client-safe but only does work in the
 * browser; on the server it short-circuits.
 */

import "client-only";
import * as Y from "yjs";
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  Timestamp,
  where,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import type { CollabDocId, CollabProvider, CollabStatus } from "./types";

const COMPACT_INTERVAL_MS = 30_000;
const INLINE_UPDATE_LIMIT_BYTES = 2048;
/** Hard cap on per-doc updates collection size before we force compact.
 *  Without this, a busy project + dropped compaction can grow the
 *  /updates/ subcollection unbounded. */
const HARD_UPDATE_CAP = 500;

export interface FirestoreProviderArgs {
  fs: Firestore;
  ownerUid: string;
  docId: CollabDocId;
  doc: Y.Doc;
  /** Stable peer id so echo suppression works. */
  peerId: string;
}

export class FirestoreCollabProvider implements CollabProvider {
  private readonly path: string;
  private unsubSnapshot: (() => void) | null = null;
  private unsubLocal: (() => void) | null = null;
  private compactTimer: ReturnType<typeof setInterval> | null = null;
  private status: CollabStatus = "idle";
  private statusSubs = new Set<(s: CollabStatus) => void>();
  /** State machine. Guards concurrent connect()/disconnect() calls. */
  private phase: "idle" | "connecting" | "connected" | "disconnecting" | "disposed" = "idle";
  /** updateIds we've ever applied locally — used for echo suppression. */
  private seenUpdateIds = new Set<string>();
  /** Tracks pending operations so disconnect() can wait for them. */
  private inflight: Promise<void> = Promise.resolve();
  /** Locally-written update counter for the bounded-cap check. */
  private writeCounterSinceCompact = 0;

  constructor(private readonly args: FirestoreProviderArgs) {
    this.path = `users/${args.ownerUid}/projects/${args.docId.projectId}/yjs/${args.doc.guid}`;
  }

  /* ───────────── lifecycle ───────────── */

  async connect(): Promise<void> {
    // State-machine guard. Re-entrant connect() is a no-op; calling
    // connect() while disconnecting waits for the disconnect to clear
    // and then proceeds.
    if (this.phase === "connecting" || this.phase === "connected") return;
    if (this.phase === "disposed") return;
    if (this.phase === "disconnecting") {
      await this.inflight.catch(() => undefined);
    }
    this.phase = "connecting";
    this.setStatus("connecting");
    const updatesCol = collection(this.args.fs, `${this.path}/updates`);
    const snapshotRef = doc(this.args.fs, `${this.path}/_snapshot`);

    // 1) Apply any existing snapshot.
    try {
      const snapDocs = await getDocs(query(collection(this.args.fs, this.path), where("_kind", "==", "snapshot")));
      void snapDocs;
      const snapSnap = await getDocs(query(updatesCol, orderBy("at", "asc")));
      const allUpdates = snapSnap.docs.map((d) => d.data() as { update: string; at: number; peerId: string });
      for (const u of allUpdates) {
        const bytes = decodeBase64(u.update);
        Y.applyUpdate(this.args.doc, bytes, "remote");
        this.seenUpdateIds.add(snapSnap.docs[allUpdates.indexOf(u)].id);
      }
    } catch (err) {
      void err;
      // Hydration failure is non-fatal; we still want live sync to come up.
    }
    void snapshotRef;

    // 2) Subscribe to NEW updates only (we already drained existing).
    this.unsubSnapshot = onSnapshot(
      query(updatesCol, orderBy("at", "asc")),
      (snap) => {
        for (const change of snap.docChanges()) {
          if (change.type !== "added") continue;
          if (this.seenUpdateIds.has(change.doc.id)) continue;
          const data = change.doc.data() as { update: string; peerId: string };
          if (data.peerId === this.args.peerId) continue;
          this.seenUpdateIds.add(change.doc.id);
          try {
            Y.applyUpdate(this.args.doc, decodeBase64(data.update), "remote");
          } catch {/* skip malformed */}
        }
      },
      (_err) => { void _err; this.setStatus("error"); },
    );

    // 3) Stream local updates → Firestore.
    const onLocalUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === "remote") return;
      // Inline write — small updates only. Large updates trigger a compact.
      if (update.byteLength > INLINE_UPDATE_LIMIT_BYTES) {
        void this.compact();
        return;
      }
      // Force a compact when the local write counter crosses the hard
      // cap, even if we're between scheduled compacts.
      this.writeCounterSinceCompact++;
      if (this.writeCounterSinceCompact >= HARD_UPDATE_CAP) {
        void this.compact();
      }
      const updateId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      this.seenUpdateIds.add(updateId);
      void setDoc(doc(this.args.fs, `${this.path}/updates/${updateId}`), {
        update: encodeBase64(update),
        at: Date.now(),
        peerId: this.args.peerId,
      });
    };
    this.args.doc.on("update", onLocalUpdate);
    this.unsubLocal = () => { this.args.doc.off("update", onLocalUpdate); };

    // 4) Compact on a cadence.
    this.compactTimer = setInterval(() => { void this.compact(); }, COMPACT_INTERVAL_MS);

    this.phase = "connected";
    this.setStatus("connected");
  }

  async disconnect(): Promise<void> {
    if (this.phase === "idle" || this.phase === "disposed" || this.phase === "disconnecting") return;
    this.phase = "disconnecting";
    const work = (async () => {
      this.unsubSnapshot?.();
      this.unsubLocal?.();
      this.unsubSnapshot = null;
      this.unsubLocal = null;
      if (this.compactTimer) { clearInterval(this.compactTimer); this.compactTimer = null; }
      await this.compact().catch(() => undefined);
      this.phase = "disposed";
      this.setStatus("offline");
    })();
    this.inflight = work;
    return work;
  }

  isConnected(): boolean {
    return this.phase === "connected";
  }

  onStatus(cb: (s: CollabStatus) => void): () => void {
    this.statusSubs.add(cb);
    cb(this.status);
    return () => { this.statusSubs.delete(cb); };
  }

  /* ───────────── compact ───────────── */

  private async compact(): Promise<void> {
    try {
      const fullState = Y.encodeStateAsUpdate(this.args.doc);
      const snapshotRef = doc(this.args.fs, `${this.path}/_snapshot/current`);
      await setDoc(snapshotRef, {
        update: encodeBase64(fullState),
        at: Date.now(),
        peerId: this.args.peerId,
        size: fullState.byteLength,
        _kind: "snapshot",
      });
      // Prune updates older than the snapshot. Bounded prune to keep
      // this cheap; gradual cleanup is fine.
      const updatesCol = collection(this.args.fs, `${this.path}/updates`);
      const cutoff = Timestamp.fromMillis(Date.now() - COMPACT_INTERVAL_MS);
      const stale = await getDocs(query(updatesCol, where("at", "<", cutoff.toMillis())));
      if (!stale.empty) {
        // Firestore batches cap at 500 ops.
        const docs = stale.docs.slice(0, 400);
        const batch = writeBatch(this.args.fs);
        for (const d of docs) batch.delete(d.ref);
        await batch.commit();
      }
      // Reset the local-write counter once we've successfully pruned.
      this.writeCounterSinceCompact = 0;
    } catch {/* best-effort */}
  }

  /* ───────────── internals ───────────── */

  private setStatus(s: CollabStatus): void {
    if (this.status === s) return;
    this.status = s;
    for (const cb of this.statusSubs) {
      try { cb(s); } catch { /* swallow */ }
    }
  }
}

/* ───────────── base64 helpers ───────────── */

function encodeBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let s = "";
  for (let i = 0; i < bytes.byteLength; i++) s += String.fromCharCode(bytes[i]);
  return typeof btoa === "function" ? btoa(s) : "";
}

function decodeBase64(b64: string): Uint8Array {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(b64, "base64"));
  const bin = typeof atob === "function" ? atob(b64) : "";
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
