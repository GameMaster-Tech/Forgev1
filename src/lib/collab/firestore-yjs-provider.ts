/**
 * FirestoreYjsProvider — a minimal Yjs sync provider backed by a
 * Firestore subcollection (`documents/{docId}/yUpdates`).
 *
 * Why Firestore instead of a websocket server: it reuses the existing
 * Firebase auth + security rules (owner-only, inherited from the parent
 * document) and needs no extra infrastructure. Each local change is
 * coalesced and written as one append-only update row; remote rows
 * stream back via `onSnapshot` and are applied to the shared Y.Doc.
 *
 * This is a *document-content* transport only — ephemeral awareness
 * (live cursors / presence) is intentionally out of scope because
 * Firestore is a poor fit for high-frequency cursor broadcast.
 *
 * Update rows are append-only and never mutated. Compaction (folding
 * many small updates into one snapshot) is a future optimisation; Yjs
 * applies updates idempotently so an un-compacted log stays correct,
 * just larger.
 */

import {
  applyUpdate,
  mergeUpdates,
  type Doc as YDoc,
} from "yjs";
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  serverTimestamp,
  type Firestore,
  type Unsubscribe,
} from "firebase/firestore";

/** Debounce window for coalescing local edits into a single write. */
const FLUSH_DELAY_MS = 600;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(
      ...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)),
    );
  }
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export type ProviderStatus = "connecting" | "synced";

export class FirestoreYjsProvider {
  readonly doc: YDoc;
  /** Resolves true once the initial snapshot has been applied. */
  readonly whenSynced: Promise<boolean>;
  /** True after first sync iff the document already had persisted state. */
  hadInitialState = false;

  private readonly db: Firestore;
  private readonly docId: string;
  private unsubscribe: Unsubscribe | null = null;
  private pending: Uint8Array[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  /** Update-row ids this client wrote, so we don't re-apply our own echo. */
  private readonly ownWrites = new Set<string>();
  private resolveSynced!: (hadState: boolean) => void;

  constructor(db: Firestore, docId: string, doc: YDoc) {
    this.db = db;
    this.docId = docId;
    this.doc = doc;
    this.whenSynced = new Promise<boolean>((resolve) => {
      this.resolveSynced = resolve;
    });
    this.doc.on("update", this.onLocalUpdate);
    this.connect();
  }

  private get colRef() {
    return collection(this.db, "documents", this.docId, "yUpdates");
  }

  private connect() {
    let firstSnapshot = true;
    this.unsubscribe = onSnapshot(
      query(this.colRef, orderBy("createdAt", "asc")),
      (snap) => {
        if (this.destroyed) return;
        for (const change of snap.docChanges()) {
          if (change.type !== "added") continue;
          if (this.ownWrites.has(change.doc.id)) continue;
          const u = change.doc.data().u as string | undefined;
          if (!u) continue;
          // origin = this so onLocalUpdate ignores it (no re-broadcast).
          applyUpdate(this.doc, fromBase64(u), this);
        }
        if (firstSnapshot) {
          firstSnapshot = false;
          this.hadInitialState = snap.size > 0;
          this.resolveSynced(this.hadInitialState);
        }
      },
      (err) => {
        console.error("FirestoreYjsProvider snapshot error:", err);
        if (firstSnapshot) {
          firstSnapshot = false;
          this.resolveSynced(false);
        }
      },
    );
  }

  private onLocalUpdate = (update: Uint8Array, origin: unknown) => {
    // Updates we applied from Firestore carry `origin === this`; only
    // persist genuinely local edits.
    if (origin === this || this.destroyed) return;
    this.pending.push(update);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => void this.flush(), FLUSH_DELAY_MS);
  };

  private async flush() {
    this.flushTimer = null;
    if (this.destroyed || this.pending.length === 0) return;
    const merged = mergeUpdates(this.pending);
    this.pending = [];
    try {
      const ref = await addDoc(this.colRef, {
        u: toBase64(merged),
        c: this.doc.clientID,
        createdAt: serverTimestamp(),
      });
      this.ownWrites.add(ref.id);
    } catch (err) {
      // Re-queue so the edit isn't silently lost on a transient failure.
      this.pending.unshift(merged);
      console.error("FirestoreYjsProvider flush failed:", err);
    }
  }

  destroy() {
    this.destroyed = true;
    this.doc.off("update", this.onLocalUpdate);
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    // Best-effort final flush so the last keystrokes aren't dropped on
    // unmount. Fire-and-forget — the page is tearing down.
    if (this.pending.length > 0) {
      const merged = mergeUpdates(this.pending);
      this.pending = [];
      void addDoc(this.colRef, {
        u: toBase64(merged),
        c: this.doc.clientID,
        createdAt: serverTimestamp(),
      }).catch(() => {});
    }
    this.unsubscribe?.();
    this.unsubscribe = null;
  }
}
