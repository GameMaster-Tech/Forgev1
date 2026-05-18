/**
 * Version store — in-memory implementation with subscriber fanout.
 *
 * The aggregator (versions/aggregator.ts) is the canonical writer in
 * the client; this store is the canonical reader. A future Firestore
 * adapter can re-implement the same `VersionStore` interface without
 * touching the consumer code (UI subscribes via `subscribe()`).
 */

import type { RestoreProposal, Version, VersionFilter, VersionStore } from "./types";

/* ───────────── factories ───────────── */

const RING_SIZE = 500; // bounded so the in-memory store doesn't grow forever.

class InMemoryVersionStore implements VersionStore {
  private ring: Version[] = [];
  private subs = new Set<(v: Version) => void>();
  private idCounter = 0;

  async push(v: Omit<Version, "id">): Promise<Version> {
    const id = `v_${Date.now().toString(36)}_${(this.idCounter++).toString(36)}`;
    const full: Version = { ...v, id };
    this.ring.push(full);
    if (this.ring.length > RING_SIZE) this.ring.shift();
    // Fire-and-forget so a slow subscriber can't block writes.
    for (const fn of this.subs) {
      try { fn(full); } catch { /* swallow */ }
    }
    return full;
  }

  async list(filter: VersionFilter = {}): Promise<Version[]> {
    const limit = filter.limit ?? 100;
    const out: Version[] = [];
    // Walk newest-first.
    for (let i = this.ring.length - 1; i >= 0 && out.length < limit; i--) {
      const v = this.ring[i];
      if (filter.sources && !filter.sources.includes(v.source)) continue;
      if (filter.projectId && v.projectId !== filter.projectId) continue;
      if (filter.from && v.at < filter.from) continue;
      if (filter.to && v.at > filter.to) continue;
      if (filter.search) {
        const q = filter.search.toLowerCase();
        if (!v.title.toLowerCase().includes(q) && !v.summary.toLowerCase().includes(q)) continue;
      }
      out.push(v);
    }
    return out;
  }

  async get(id: string): Promise<Version | null> {
    return this.ring.find((v) => v.id === id) ?? null;
  }

  async proposeRestore(id: string): Promise<RestoreProposal | null> {
    const v = await this.get(id);
    if (!v || !v.restorable) return null;
    return proposeRestoreFor(v);
  }

  /** Non-interface helper: subscribe to new versions. Returns an unsub. */
  subscribe(handler: (v: Version) => void): () => void {
    this.subs.add(handler);
    return () => { this.subs.delete(handler); };
  }
}

const SINGLETON = new InMemoryVersionStore();

export function getVersionStore(): InMemoryVersionStore {
  return SINGLETON;
}

/* ───────────── restore-proposal builder ───────────── */

function proposeRestoreFor(v: Version): RestoreProposal {
  switch (v.source) {
    case "sync.patch":
      return {
        description: `Re-propose the inverse of patch "${v.title}". You'll review it in Sync before applying.`,
        source: v.source,
        action: { invertedFromVersionId: v.id, originalPatch: v.detail.patch },
        safety: "review-required",
      };
    case "pulse.refactor.accept":
      return {
        description: "Restore the previous body of this block (re-applies the pre-refactor text).",
        source: v.source,
        action: { blockId: v.detail.blockId, restore: "previous-body" },
        safety: "safe",
      };
    case "pulse.refactor.reject":
      return {
        description: "Re-surface this refactor proposal so you can accept it after all.",
        source: v.source,
        action: { blockId: v.detail.blockId, resurface: true },
        safety: "safe",
      };
    case "lattice.rebranch":
      return {
        description: "Pin the current task tree shape so the next rebranch can't prune it.",
        source: v.source,
        action: { rebranchVersionId: v.id, pinAll: true },
        safety: "review-required",
      };
    case "calendar.event.upsert":
    case "calendar.event.delete":
      return {
        description: `Revert the calendar change to "${v.title}". Re-syncs through your normal calendar flow.`,
        source: v.source,
        action: { eventId: v.detail.eventId, revert: true },
        safety: "safe",
      };
    case "habit.completed":
      return {
        description: "Undo this habit completion (decrements streak if it was today).",
        source: v.source,
        action: { habitId: v.detail.habitId, date: v.detail.date },
        safety: "safe",
      };
    default:
      return {
        description: "This kind of version cannot be auto-restored. View detail and decide manually.",
        source: v.source,
        action: { versionId: v.id },
        safety: "review-required",
      };
  }
}
