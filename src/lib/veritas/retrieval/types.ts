/**
 * Retrieval-layer shared types.
 * Every adapter (Crossref, OpenAlex, arXiv, PubMed) returns `RetrievedSource`
 * objects so the downstream pipeline is provider-agnostic.
 */

export type SourceProvider = "crossref" | "openalex" | "arxiv" | "pubmed" | "unknown";

export interface RetrievedSource {
  /** Provider-assigned id (DOI when available, else provider-specific). */
  id: string;
  provider: SourceProvider;

  title: string;
  authors: string[];
  abstract?: string;

  doi?: string;
  url?: string;

  year?: number;
  publishedDate?: string;         // ISO 8601
  venue?: string;                 // journal / conference
  publisher?: string;

  /** Citation count (from Crossref / OpenAlex / Semantic Scholar fusion). */
  citationCount?: number;

  /** Keywords / subject tags from the provider. */
  subjects?: string[];

  /** Provider-specific raw payload, kept for debugging. */
  raw?: Record<string, unknown>;
}

export interface RetrievalQuery {
  text: string;
  /** Restrict to these providers; default = all. */
  providers?: SourceProvider[];
  /** Maximum hits per provider (pre-rerank). */
  limit?: number;
  /** Year range filter, inclusive. */
  yearFrom?: number;
  yearTo?: number;
  /** Require open-access only (Crossref/OpenAlex only). */
  openAccessOnly?: boolean;
}

export interface RetrievalResult {
  query: RetrievalQuery;
  sources: RetrievedSource[];
  /** Milliseconds from dispatch to response per provider. */
  timings: Partial<Record<SourceProvider, number>>;
  /** Provider errors, if any. Absence ⇒ success. */
  errors?: Partial<Record<SourceProvider, string>>;
}
