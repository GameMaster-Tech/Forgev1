/**
 * Forge Recall — retrieval.
 *
 * One pass, three feeds:
 *
 *   recent   — last N raw turns of THIS conversation (no scoring, always
 *              emitted; this is what Claude/ChatGPT/Gemini also do — kept
 *              because it's the cheapest signal that exists)
 *   pinned   — every snippet with pinnedByUser=true in the project
 *   recalled — BM25 + cosine hybrid over the rest, ranked by:
 *                score = 0.45·bm25 + 0.30·cosine + 0.15·freshness + 0.10·use_boost
 *              "pinned" wins over "recalled" on ties.
 *
 * Plus a transparency pass: every recalled snippet that has
 * `supersededBy` set causes us to also surface the newer side as a
 * `correction` result — the AI sees the old + new together and can
 * present the change honestly instead of echoing stale beliefs.
 *
 * Determinism: same project corpus + same probe + same recent-tail =
 * same output. No randomness, no time-of-day weighting.
 */

import { buildIndex, scoreQuery, type BM25Index } from "@/lib/veritas/memory/retrieval/bm25";
import { cosine } from "@/lib/veritas/memory/embeddings/embedder";
import {
  getProjectSnippets,
  getSnippet,
  getCorrectionsForProject,
} from "./snippet";
import type {
  RecallRequest,
  RecallResult,
  ScoredSnippet,
  Snippet,
} from "./types";

const RECENT_TURN_BUDGET = 8;       // tail length always emitted
const RECALL_TOP_K = 30;            // BM25 prefilter cap
const RECALL_LIMIT = 8;             // final recalled-tier cap
const FRESHNESS_HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

/**
 * The single entry point. Pulls snippets, scores, returns the four
 * feeds the prompt builder needs.
 */
export async function recall(req: RecallRequest): Promise<RecallResult> {
  const allSnippets = await getProjectSnippets(req.projectId, req.ownerId);
  const corrections = await getCorrectionsForProject(req.projectId, req.ownerId);

  // Partition the corpus.
  const recentRaw = pickRecentTail(allSnippets, req.conversationId, RECENT_TURN_BUDGET);
  const recentIds = new Set(recentRaw.map((s) => s.id));
  const pinned = allSnippets.filter((s) => s.pinnedByUser && !recentIds.has(s.id));
  const pinnedIds = new Set(pinned.map((s) => s.id));
  const recallable = allSnippets.filter(
    (s) => !recentIds.has(s.id) && !pinnedIds.has(s.id),
  );

  // Build (per-call, cheap) a BM25 index over the recall candidates.
  // We don't cross-cache between requests because snippet corpora are
  // typically small (<10K) and BM25 build is O(N).
  const index = buildIndex(
    recallable.map((s) => ({ id: s.id, text: s.text })),
  );
  const bm25Scored = scoreQuery(index, req.probe).slice(0, RECALL_TOP_K);
  const maxBm25 = bm25Scored[0]?.score ?? 1;

  const byId = new Map(recallable.map((s) => [s.id, s]));
  const now = Date.now();

  // Score each prefilter candidate.
  const recalled: ScoredSnippet[] = [];
  for (const cand of bm25Scored) {
    const snippet = byId.get(cand.id);
    if (!snippet) continue;
    const bm25Norm = maxBm25 > 0 ? cand.score / maxBm25 : 0;
    let cosineScore = 0;
    if (req.probeEmbedding && snippet.embedding && snippet.embedding.dim === req.probeEmbedding.length) {
      cosineScore = Math.max(0, cosine(req.probeEmbedding, snippet.embedding.vector));
    }
    const freshness = freshnessOf(snippet, now);
    const useBoost = useBoostOf(snippet);
    const score =
      0.45 * bm25Norm +
      0.30 * cosineScore +
      0.15 * freshness +
      0.10 * useBoost;
    recalled.push({
      snippet,
      score,
      via: cosineScore > 0 ? "cosine" : "lexical",
    });
  }
  recalled.sort((a, b) => b.score - a.score);
  const topRecalled = recalled.slice(0, RECALL_LIMIT);

  // Correction transparency: for every recalled snippet that has a
  // newer version, surface the newer version too. Caller's prompt
  // builder presents both with a strikethrough on the old.
  const correctionResults = await resolveCorrections(topRecalled, corrections);

  // Score pinned. Pinned are always emitted, but we still rank them
  // so the prompt builder can truncate if budget is tight.
  const pinnedScored: ScoredSnippet[] = pinned
    .map((s) => ({
      snippet: s,
      score: 0.5 + 0.25 * freshnessOf(s, now) + 0.25 * useBoostOf(s),
      via: "pinned" as const,
    }))
    .sort((a, b) => b.score - a.score);

  // Score recent — deterministic by createdAt asc.
  const recentScored: ScoredSnippet[] = recentRaw
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((s) => ({ snippet: s, score: 1, via: "recent" as const }));

  return {
    recent: recentScored,
    pinned: pinnedScored,
    recalled: topRecalled,
    corrections: correctionResults,
    grounding: groundingCheck(req.probe, [...pinnedScored, ...topRecalled]),
  };
}

/* ── scoring helpers ─────────────────────────────────────────── */

function freshnessOf(s: Snippet, now: number): number {
  // Half-life decay from lastUsedAt, falling back to createdAt for
  // brand-new snippets that haven't been used yet.
  const anchor = s.lastUsedAt > 0 ? s.lastUsedAt : s.createdAt;
  if (anchor <= 0) return 0;
  const dt = Math.max(0, now - anchor);
  return Math.pow(2, -dt / FRESHNESS_HALF_LIFE_MS);
}

function useBoostOf(s: Snippet): number {
  // log1p so the 100th use counts much less than the 1st. Keeps
  // popular snippets from monopolising recall.
  return Math.min(1, Math.log1p(s.uses) / 4);
}

function pickRecentTail(
  all: Snippet[],
  conversationId: string | undefined,
  n: number,
): Snippet[] {
  if (!conversationId) return [];
  return all
    .filter((s) => s.conversationId === conversationId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, n);
}

/* ── correction surfacing ─────────────────────────────────────── */

async function resolveCorrections(
  recalled: ReadonlyArray<ScoredSnippet>,
  corrections: Awaited<ReturnType<typeof getCorrectionsForProject>>,
): Promise<ScoredSnippet[]> {
  const out: ScoredSnippet[] = [];
  const byOld = new Map(corrections.map((c) => [c.oldSnippetId, c]));
  const seen = new Set<string>();
  for (const r of recalled) {
    if (!r.snippet.supersededBy) continue;
    const correction = byOld.get(r.snippet.id);
    if (!correction) continue;
    if (seen.has(correction.newSnippetId)) continue;
    seen.add(correction.newSnippetId);
    const newer = await getSnippet(correction.newSnippetId);
    if (!newer) continue;
    // Emit both as a pair — old marked isSuperseded so the prompt
    // builder can strike it through.
    out.push({
      snippet: newer,
      score: r.score + 0.05, // edge over the old version on ties
      via: "correction",
    });
    out.push({ ...r, via: "correction", isSuperseded: true });
  }
  return out;
}

/* ── grounded-refusal gate ────────────────────────────────────── */

const GROUND_THRESHOLD = 1;

function groundingCheck(
  probe: string,
  available: ReadonlyArray<ScoredSnippet>,
): RecallResult["grounding"] {
  const required = estimateClaimDensity(probe);
  // Available = anything originating from user/doc/tool (not ai/web).
  // ai-origin snippets aren't "evidence" — they're prior reasoning we
  // already trust the model to have. web/tool origin still counts.
  const groundShards = available.filter(
    (s) => s.snippet.origin === "user" || s.snippet.origin === "doc" || s.snippet.origin === "tool",
  );
  return {
    required,
    available: groundShards.length,
    pass: groundShards.length >= required * GROUND_THRESHOLD,
  };
}

function estimateClaimDensity(probe: string): number {
  const p = probe.toLowerCase();
  if (/^(hi|hello|hey|thanks|thank you|ok|cool)\b/.test(p)) return 0; // small talk needs no grounding
  if (/^(how many|when did|who is|what is the [a-z]+ of)\b/.test(p)) return 1;
  if (/\b(compare|difference|versus|vs\.?)\b/.test(p)) return 2;
  if (/\b(summari[sz]e|explain|overview)\b/.test(p)) return 3;
  if (/\b(tell me about|describe|walk me through)\b/.test(p)) return 3;
  return 1;
}
