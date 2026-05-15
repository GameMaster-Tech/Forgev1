/**
 * Unified workspace search.
 *
 * `searchWorkspace(projectId, queryText, opts)` is the one API the rest
 * of Forge calls. It runs the four-stage pipeline:
 *
 *   1. Load the project's indexable items (cached per-project, see cache.ts).
 *   2. BM25 score the lexical query → top-K candidates.
 *   3. Optional cosine rerank on candidates that carry inline embeddings.
 *   4. Recency boost (configurable half-life), final mix, top-N return.
 *
 * Three call shapes use this surface:
 *
 *   • `searchWorkspace`     — the general API used by /research, the
 *                             editor's "find related," the AI's recall path.
 *   • `commandPaletteSearch` — fast title-prefix-first variant used by ⌘K.
 *   • `aiContextSearch`     — diverse-by-kind selector used by Veritas-R1
 *                             when assembling generation context.
 *
 * The three share the same building blocks; the differences are in
 * weighting and caps. Centralising the pipeline means a fix to BM25 or
 * cosine helps every surface at once.
 */

import { buildIndex, scoreQuery, type BM25Index } from "@/lib/veritas/memory/retrieval/bm25";
import { cosine } from "@/lib/veritas/memory/embeddings/embedder";
import { workspaceCache } from "./cache";
import { loadWorkspaceItems } from "./ingest";
import type {
  SearchOptions,
  SearchResult,
  WorkspaceItem,
  WorkspaceItemKind,
} from "./types";

/** Default half-life on recency: 14 days. */
const DEFAULT_RECENCY_HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000;

interface ProjectIndex {
  items: WorkspaceItem[];
  byUid: Map<string, WorkspaceItem>;
  bm25: BM25Index;
}

/**
 * Build (or reuse cached) BM25 + item index for a project. Heavy lift
 * happens once per project per cache lifetime; subsequent calls are
 * sub-millisecond cache hits.
 */
async function getOrBuildIndex(
  projectId: string,
  forceRebuild = false,
): Promise<ProjectIndex> {
  if (!forceRebuild) {
    const cached = workspaceCache.get(projectId);
    if (cached) return cached;
  }
  const items = await loadWorkspaceItems(projectId);
  const bm25 = buildIndex(
    items.map((i) => ({ id: i.uid, text: `${i.title}\n${i.body}` })),
  );
  const byUid = new Map(items.map((i) => [i.uid, i]));
  const index: ProjectIndex = { items, byUid, bm25 };
  workspaceCache.set(projectId, index);
  return index;
}

/**
 * Recency boost — multiplicative factor based on time-since-update.
 * `half-life` ms: an item updated 14 days ago has its score halved
 * relative to one updated just now.
 */
function recencyBoost(item: WorkspaceItem, halfLifeMs: number): number {
  if (!Number.isFinite(halfLifeMs)) return 1;
  if (item.updatedAt <= 0) return 1;
  const ageMs = Math.max(0, Date.now() - item.updatedAt);
  return Math.pow(2, -ageMs / halfLifeMs);
}

/**
 * Main search entry point.
 */
export async function searchWorkspace(
  projectId: string,
  queryText: string,
  opts: SearchOptions = {},
): Promise<SearchResult[]> {
  const limit = opts.limit ?? 10;
  const topK = opts.topK ?? 100;
  const cosineWeight = clamp01(opts.cosineWeight ?? 0.6);
  const bm25Weight = 1 - cosineWeight;
  const halfLife = opts.recencyHalfLifeMs ?? DEFAULT_RECENCY_HALF_LIFE_MS;
  const kindFilter = opts.kinds ? new Set(opts.kinds) : null;

  const idx = await getOrBuildIndex(projectId, opts.forceRebuild);
  if (idx.items.length === 0) return [];

  // Stage 1 — BM25 (handles empty queryText gracefully — returns []).
  const bm25Scored = scoreQuery(idx.bm25, queryText);
  const maxBm25 = bm25Scored[0]?.score ?? 1;
  const candidatesUids = bm25Scored.slice(0, topK).map((c) => c.id);
  const bm25ByUid = new Map(bm25Scored.map((c) => [c.id, c.score]));

  // Stage 2 — cosine rerank if probe vector + corpus has any embeddings.
  // We always include the BM25 candidates plus, when an embedding probe
  // is provided, ALSO a cosine-only sweep over items that BM25 missed
  // entirely. This keeps the "I asked semantically and BM25 returned 0"
  // path well-served.
  const consider = new Set<string>(candidatesUids);
  if (opts.probeEmbedding && idx.items.length > 0) {
    for (const it of idx.items) consider.add(it.uid);
  }

  const scored: SearchResult[] = [];
  for (const uid of consider) {
    const item = idx.byUid.get(uid);
    if (!item) continue;
    if (kindFilter && !kindFilter.has(item.kind)) continue;

    const bm25 = bm25ByUid.get(uid) ?? 0;
    const bm25Norm = maxBm25 > 0 ? bm25 / maxBm25 : 0;

    let cosineScore: number | undefined;
    let mixed = bm25Norm;
    let via: SearchResult["via"] = "bm25";

    if (
      opts.probeEmbedding &&
      item.embedding &&
      item.embedding.dim === opts.probeEmbedding.length
    ) {
      cosineScore = cosine(opts.probeEmbedding, item.embedding.vector);
      const csClamped = Math.max(0, cosineScore);
      mixed = cosineWeight * csClamped + bm25Weight * bm25Norm;
      via = bm25 > 0 ? "hybrid" : "cosine";
    } else if (opts.probeEmbedding && bm25 === 0) {
      // No embedding AND no lexical match — drop it.
      continue;
    }

    if (mixed <= 0) continue;

    const boost = recencyBoost(item, halfLife);
    const finalScore = mixed * boost;

    scored.push({
      item,
      score: finalScore,
      bm25Score: bm25,
      cosineScore,
      recencyBoost: boost,
      via,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/* ─────────────────────────────────────────────────────────────
 *  Command palette — title-prefix-first, recency-weighted.
 *
 *  Goals: sub-50 ms response, prioritise titles, prioritise recent.
 *  This is what powers ⌘K.
 * ──────────────────────────────────────────────────────────── */

export async function commandPaletteSearch(
  projectId: string,
  queryText: string,
  opts: { limit?: number; kinds?: WorkspaceItemKind[] } = {},
): Promise<SearchResult[]> {
  const limit = opts.limit ?? 8;
  const idx = await getOrBuildIndex(projectId);
  if (idx.items.length === 0) return [];
  const kindFilter = opts.kinds ? new Set(opts.kinds) : null;

  const q = queryText.toLowerCase().trim();

  // Empty query → most-recent items, no scoring.
  if (q.length === 0) {
    const all = idx.items.filter((i) => !kindFilter || kindFilter.has(i.kind));
    all.sort((a, b) => b.updatedAt - a.updatedAt);
    return all.slice(0, limit).map((item) => ({
      item,
      score: 1,
      bm25Score: 0,
      recencyBoost: 1,
      via: "recent",
    }));
  }

  // 1. Exact title-prefix matches go to the top — what users actually
  //    expect from a command palette ("re" → "Research notes" first).
  const prefixHits: SearchResult[] = [];
  const seen = new Set<string>();
  for (const item of idx.items) {
    if (kindFilter && !kindFilter.has(item.kind)) continue;
    if (item.title.toLowerCase().startsWith(q)) {
      const boost = recencyBoost(item, DEFAULT_RECENCY_HALF_LIFE_MS);
      prefixHits.push({
        item,
        score: 2 * boost, // dominate over BM25
        bm25Score: 0,
        recencyBoost: boost,
        via: "title-prefix",
      });
      seen.add(item.uid);
    }
  }
  prefixHits.sort((a, b) => b.score - a.score);

  // 2. Fall back to BM25 for body matches not captured above.
  const bm25Scored = scoreQuery(idx.bm25, queryText);
  const maxBm25 = bm25Scored[0]?.score ?? 1;
  const lexHits: SearchResult[] = [];
  for (const c of bm25Scored) {
    if (seen.has(c.id)) continue;
    const item = idx.byUid.get(c.id);
    if (!item) continue;
    if (kindFilter && !kindFilter.has(item.kind)) continue;
    const boost = recencyBoost(item, DEFAULT_RECENCY_HALF_LIFE_MS);
    lexHits.push({
      item,
      score: (c.score / (maxBm25 || 1)) * boost,
      bm25Score: c.score,
      recencyBoost: boost,
      via: "bm25",
    });
    if (prefixHits.length + lexHits.length >= limit) break;
  }

  return [...prefixHits, ...lexHits].slice(0, limit);
}

/* ─────────────────────────────────────────────────────────────
 *  AI context — diverse top-K for Veritas-R1 prompt assembly.
 *
 *  When the model needs context to answer a user's question, we want a
 *  spread across kinds (one strong document, one or two relevant past
 *  queries, the most-on-point claims, etc.) rather than 5 documents.
 *  The diversity heuristic: cap each kind at `perKindCap`, fill from
 *  the highest-scored remainder if budget is left over.
 * ──────────────────────────────────────────────────────────── */

export async function aiContextSearch(
  projectId: string,
  queryText: string,
  opts: { totalK?: number; perKindCap?: number; probeEmbedding?: number[] } = {},
): Promise<SearchResult[]> {
  const totalK = opts.totalK ?? 8;
  const perKindCap = opts.perKindCap ?? 3;

  // Wider net than the default search — we want to choose from a
  // larger pool before applying diversity.
  const wide = await searchWorkspace(projectId, queryText, {
    limit: totalK * 5,
    topK: totalK * 10,
    probeEmbedding: opts.probeEmbedding,
    cosineWeight: 0.65,
    recencyHalfLifeMs: 30 * 24 * 60 * 60 * 1000, // 30 days — slower decay for AI context
  });

  // Greedy diversity: walk the sorted pool, keep up to perKindCap from
  // each kind. Once full, fill remaining budget from the leftover pool.
  const picked: SearchResult[] = [];
  const counts = new Map<WorkspaceItemKind, number>();
  const pool: SearchResult[] = [];
  for (const r of wide) {
    const cur = counts.get(r.item.kind) ?? 0;
    if (cur < perKindCap && picked.length < totalK) {
      picked.push(r);
      counts.set(r.item.kind, cur + 1);
    } else {
      pool.push(r);
    }
  }
  for (const r of pool) {
    if (picked.length >= totalK) break;
    picked.push(r);
  }
  return picked;
}

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0.6;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}
