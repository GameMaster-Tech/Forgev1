/**
 * Per-project workspace index cache.
 *
 * Holds the full `WorkspaceItem[] + BM25Index + uid lookup` per project
 * so subsequent searches (palette, full search, AI context) reuse the
 * heavy lift. LRU-bounded to 64 projects per Node process — fits
 * comfortably in memory at our scale (10⁴ items × 8 KB avg ≈ 80 MB
 * upper bound; typical project ≪).
 *
 * Invalidation is event-driven, not TTL'd. Every write path that mutates
 * an indexable collection calls `invalidate(projectId)`. The next read
 * sees the stale flag and rebuilds.
 *
 * Why per-process and not Redis / Memorystore: same argument as the
 * Veritas BM25 cache — the working set is small, rebuild is cheap
 * (<200 ms even at 10⁴ items), Cloud Run instances stay warm under
 * normal traffic, and Memorystore costs $40+/mo for what's effectively
 * an in-memory map.
 */

import type { BM25Index } from "@/lib/veritas/memory/retrieval/bm25";
import type { WorkspaceItem } from "./types";

const DEFAULT_CAPACITY = 64;

export interface CachedProjectIndex {
  items: WorkspaceItem[];
  byUid: Map<string, WorkspaceItem>;
  bm25: BM25Index;
}

interface CacheEntry {
  index: CachedProjectIndex;
  version: number;
  lastTouchedMs: number;
}

class WorkspaceIndexCache {
  private readonly capacity: number;
  private readonly cache: Map<string, CacheEntry> = new Map();
  private readonly versions: Map<string, number> = new Map();

  constructor(capacity: number = DEFAULT_CAPACITY) {
    if (capacity < 1) throw new Error("capacity must be ≥ 1");
    this.capacity = capacity;
  }

  get(projectId: string): CachedProjectIndex | undefined {
    const entry = this.cache.get(projectId);
    if (!entry) return undefined;
    const cur = this.versions.get(projectId) ?? 0;
    if (entry.version !== cur) {
      this.cache.delete(projectId);
      return undefined;
    }
    entry.lastTouchedMs = Date.now();
    return entry.index;
  }

  set(projectId: string, index: CachedProjectIndex): void {
    const version = this.versions.get(projectId) ?? 0;
    this.cache.set(projectId, {
      index,
      version,
      lastTouchedMs: Date.now(),
    });
    if (this.cache.size > this.capacity) this.evictLru();
  }

  /**
   * Bump the version for a project. Cheap. Call this from every write
   * path that touches an indexable collection (`saveDocument`,
   * `addClaim`, `recordQuery`, etc.). Stale readers detect the bump
   * on their next get() and rebuild.
   */
  invalidate(projectId: string): void {
    this.versions.set(projectId, (this.versions.get(projectId) ?? 0) + 1);
  }

  size(): number {
    return this.cache.size;
  }

  /** Test-only. */
  clear(): void {
    this.cache.clear();
    this.versions.clear();
  }

  private evictLru(): void {
    let oldestKey: string | undefined;
    let oldestMs = Number.POSITIVE_INFINITY;
    for (const [k, e] of this.cache) {
      if (e.lastTouchedMs < oldestMs) {
        oldestMs = e.lastTouchedMs;
        oldestKey = k;
      }
    }
    if (oldestKey !== undefined) this.cache.delete(oldestKey);
  }
}

export const workspaceCache = new WorkspaceIndexCache();
