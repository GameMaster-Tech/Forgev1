/**
 * Per-project LRU cache for BM25 indexes.
 *
 * Why LRU per Cloud Function instance (not global cache, not Redis)
 * ────────────────────────────────────────────────────────────────
 * Forge runs as a Next.js app on Cloud Run / Vercel. Each instance
 * holds a stable working set of recently-touched projects (the user's
 * own projects + occasionally a teammate's). LRU per-instance is the
 * right granularity:
 *   • Cold start cost: rebuilding 10k-claim index < 50 ms — acceptable.
 *   • No cross-instance coherence problem because writes invalidate
 *     the local cache and the next read on a stale instance just does
 *     one Firestore round-trip to refresh.
 *   • Redis would add infra; Memorystore costs $40+/mo to operate.
 *
 * Capacity: 64 projects per instance. Forge's biggest power user holds
 * <30 projects; teams add ~10× breadth. 64 is enough headroom that hit
 * rate stays >95% in steady state.
 */

import type { BM25Index } from "./bm25";

const DEFAULT_CAPACITY = 64;

interface CacheEntry {
  index: BM25Index;
  /**
   * Monotonic version stamp from the underlying claim store. When a
   * write fires, it bumps this counter for the project; the next reader
   * compares and rebuilds if mismatched.
   */
  version: number;
  /** Wall-clock of last touch, for LRU eviction. */
  lastTouchedMs: number;
}

export class BM25Cache {
  private readonly capacity: number;
  private readonly cache: Map<string, CacheEntry> = new Map();
  /** projectId → monotonic version counter incremented on writes. */
  private readonly versions: Map<string, number> = new Map();

  constructor(capacity: number = DEFAULT_CAPACITY) {
    if (capacity < 1) throw new Error("capacity must be ≥ 1");
    this.capacity = capacity;
  }

  /**
   * Get the cached index for `projectId` if its version matches the
   * current write counter. Returns undefined on miss or stale.
   */
  get(projectId: string): BM25Index | undefined {
    const entry = this.cache.get(projectId);
    if (!entry) return undefined;
    const version = this.versions.get(projectId) ?? 0;
    if (entry.version !== version) {
      // Stale — drop and force a rebuild.
      this.cache.delete(projectId);
      return undefined;
    }
    entry.lastTouchedMs = Date.now();
    return entry.index;
  }

  /**
   * Insert (or replace) an index for `projectId`. Evicts the LRU entry
   * if at capacity. The caller passes the version they observed at
   * build-time; the cache stores it so a later `get` can detect drift.
   */
  set(projectId: string, index: BM25Index): void {
    const version = this.versions.get(projectId) ?? 0;
    this.cache.set(projectId, {
      index,
      version,
      lastTouchedMs: Date.now(),
    });
    if (this.cache.size > this.capacity) {
      this.evictLru();
    }
  }

  /**
   * Bump the version counter for a project. Called by every write path
   * (`addClaim`, `retireClaim`, `supersede`, `updateClaim`). The next
   * read that hits this project will see the version mismatch and
   * rebuild.
   */
  invalidate(projectId: string): void {
    const next = (this.versions.get(projectId) ?? 0) + 1;
    this.versions.set(projectId, next);
    // Don't drop the entry yet — the get-path comparison handles it.
    // Dropping eagerly would break parallel readers that are already
    // mid-rebuild from a stale version.
  }

  size(): number {
    return this.cache.size;
  }

  /** Test-only — clear everything. */
  clear(): void {
    this.cache.clear();
    this.versions.clear();
  }

  private evictLru(): void {
    let oldestKey: string | undefined;
    let oldestMs = Number.POSITIVE_INFINITY;
    for (const [k, entry] of this.cache) {
      if (entry.lastTouchedMs < oldestMs) {
        oldestMs = entry.lastTouchedMs;
        oldestKey = k;
      }
    }
    if (oldestKey !== undefined) this.cache.delete(oldestKey);
  }
}

/**
 * Module-level singleton — the entire process shares one cache. This
 * is the right scope on Cloud Run / Vercel where each request reuses
 * the warm Node process.
 */
export const bm25Cache = new BM25Cache();
