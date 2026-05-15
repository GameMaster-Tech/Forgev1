/**
 * Federated search — fans a query out across all retrieval adapters in
 * parallel, aggregates by DOI, and returns a merged list sorted by naive
 * relevance (provider-weighted rank fusion).
 *
 * This is the one-stop entry point for the rest of the Veritas runtime.
 */

import type {
  RetrievedSource,
  RetrievalQuery,
  RetrievalResult,
  SourceProvider,
} from "./types";
import { crossrefSearch } from "./crossref";
import { openAlexSearch } from "./openalex";
import { arxivSearch } from "./arxiv";
import { pubmedSearch } from "./pubmed";

const ALL_PROVIDERS: SourceProvider[] = ["crossref", "openalex", "arxiv", "pubmed"];

const HANDLERS: Record<Exclude<SourceProvider, "unknown">, (q: RetrievalQuery) => Promise<RetrievedSource[]>> = {
  crossref: crossrefSearch,
  openalex: openAlexSearch,
  arxiv: arxivSearch,
  pubmed: pubmedSearch,
};

/**
 * Provider weight for rank fusion — Crossref and OpenAlex get a bonus because
 * they provide richer metadata (DOIs, citation counts). arXiv and PubMed are
 * still included because they surface content Crossref cannot.
 */
const PROVIDER_WEIGHT: Record<SourceProvider, number> = {
  crossref: 1.15,
  openalex: 1.1,
  arxiv: 1.0,
  pubmed: 1.0,
  unknown: 0.8,
};

export async function federatedSearch(query: RetrievalQuery): Promise<RetrievalResult> {
  const providers = (query.providers ?? ALL_PROVIDERS).filter(
    (p): p is Exclude<SourceProvider, "unknown"> => p !== "unknown",
  );

  const timings: Partial<Record<SourceProvider, number>> = {};
  const errors: Partial<Record<SourceProvider, string>> = {};

  const runs = providers.map(async (p) => {
    const t0 = Date.now();
    try {
      const sources = await HANDLERS[p](query);
      timings[p] = Date.now() - t0;
      return sources;
    } catch (err) {
      timings[p] = Date.now() - t0;
      errors[p] = err instanceof Error ? err.message : String(err);
      return [] as RetrievedSource[];
    }
  });

  const results = await Promise.all(runs);
  const flat = results.flat();
  const merged = dedupByDoi(flat);
  const fused = rankFuse(merged, providers, query.limit ?? 20);

  const out: RetrievalResult = {
    query,
    sources: fused,
    timings,
  };
  if (Object.keys(errors).length > 0) out.errors = errors;
  return out;
}

/* ─────────────────────────────────────────────────────────────
 *  Merge / dedup
 * ──────────────────────────────────────────────────────────── */

function dedupByDoi(all: RetrievedSource[]): RetrievedSource[] {
  const byKey = new Map<string, RetrievedSource>();
  for (const src of all) {
    const key = src.doi ? `doi:${src.doi.toLowerCase()}` : src.id.toLowerCase();
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, src);
    } else {
      byKey.set(key, mergeSources(existing, src));
    }
  }
  return Array.from(byKey.values());
}

function mergeSources(a: RetrievedSource, b: RetrievedSource): RetrievedSource {
  // Prefer the richer record. Crossref is authoritative for DOI metadata,
  // OpenAlex for citation counts and concepts, arXiv for preprint PDFs.
  return {
    ...a,
    ...b,
    abstract: a.abstract ?? b.abstract,
    authors: a.authors.length >= b.authors.length ? a.authors : b.authors,
    citationCount: Math.max(a.citationCount ?? 0, b.citationCount ?? 0) || undefined,
    subjects: unique([...(a.subjects ?? []), ...(b.subjects ?? [])]),
    doi: a.doi ?? b.doi,
    url: a.url ?? b.url,
    year: a.year ?? b.year,
    publishedDate: a.publishedDate ?? b.publishedDate,
    venue: a.venue ?? b.venue,
    publisher: a.publisher ?? b.publisher,
  };
}

function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

/* ─────────────────────────────────────────────────────────────
 *  Rank fusion — weighted reciprocal rank
 * ──────────────────────────────────────────────────────────── */

function rankFuse(
  sources: RetrievedSource[],
  providersUsed: SourceProvider[],
  limit: number,
): RetrievedSource[] {
  const RR_K = 60;
  const scores = new Map<string, number>();

  // Seed positional ranks per provider.
  for (const p of providersUsed) {
    const withP = sources.filter((s) => s.provider === p);
    withP.forEach((src, idx) => {
      const base = PROVIDER_WEIGHT[p] * (1 / (RR_K + idx + 1));
      scores.set(src.id, (scores.get(src.id) ?? 0) + base);
    });
  }

  // Mild citation-count boost.
  for (const src of sources) {
    if (src.citationCount && src.citationCount > 0) {
      const cc = Math.log10(1 + src.citationCount);
      scores.set(src.id, (scores.get(src.id) ?? 0) + cc * 0.01);
    }
  }

  return [...sources]
    .sort((x, y) => (scores.get(y.id) ?? 0) - (scores.get(x.id) ?? 0))
    .slice(0, limit);
}
