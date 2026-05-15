/**
 * Workspace retrieval types.
 *
 * Forge is an AI-powered workspace, not a citation verifier. The retrieval
 * pipeline must surface ANY searchable artefact a researcher has in a
 * project — documents, saved sources, past chat exchanges, extracted
 * claims, reasoning episodes, the project's own metadata. The unified
 * `WorkspaceItem` type below is what every search/recall API returns,
 * regardless of which underlying Firestore collection the row came from.
 *
 * Ingest adapters in `ingest.ts` convert each collection's row into this
 * shape; search/recall functions consume only this shape. That's the
 * seam that lets us add new content kinds (sticky notes, embedded
 * images-with-OCR, calendar events, etc.) without touching the search
 * surface.
 */

/** What kind of workspace artefact this is. */
export type WorkspaceItemKind =
  | "document"      // TipTap research doc
  | "query"         // Past research-panel chat (user query + AI answer)
  | "claim"         // Veritas-R1 extracted assertion
  | "episode"       // Reasoning session
  | "project"       // The project itself (matched by name / instructions)
  | "source";       // Saved external source / paper

export interface WorkspaceItem {
  /** Globally-unique within the project. Composite of `${kind}:${id}`. */
  uid: string;
  /** Original Firestore doc id (within its native collection). */
  id: string;
  kind: WorkspaceItemKind;
  /** projectId scope. Every searchable item belongs to exactly one project. */
  projectId: string;

  /** Display title — shown as the primary line in result rows / palette. */
  title: string;

  /**
   * Search-indexable body text. The ingest adapter is responsible for
   * stripping markup (HTML, TipTap nodes, etc.) so this is a flat
   * searchable string. May be truncated by the adapter to keep BM25
   * stats bounded.
   */
  body: string;

  /**
   * Optional inline embedding for semantic recall. Only populated for
   * kinds that have one stored on their native doc (claims today;
   * documents + queries when the embed-on-write pipeline lands).
   */
  embedding?: { vector: number[]; dim: number; modelId: string };

  /**
   * Last-touched timestamp (ms since epoch). Used by recency weighting
   * in command-palette ranking and AI-context selection.
   */
  updatedAt: number;

  /**
   * Free-form metadata the result UI may render. Kept loose because
   * each kind surfaces different fields:
   *   document → wordCount, citationCount
   *   query    → mode, sourceCount
   *   claim    → polarity, sourceSupport
   *   episode  → type, claimCount
   *   source   → doi, year, journal
   */
  meta?: Record<string, unknown>;
}

/**
 * A single ranked search result. Carries enough provenance for both UI
 * rendering (snippet, highlights) and downstream rerank/auditing.
 */
export interface SearchResult {
  item: WorkspaceItem;
  /** Final mixed score in [0, 1] (after normalisation). */
  score: number;
  /** Lexical (BM25) component, raw. */
  bm25Score: number;
  /** Semantic (cosine) component when embeddings fired, else undefined. */
  cosineScore?: number;
  /** Recency multiplier applied (1.0 means no boost). */
  recencyBoost: number;
  /** Which retrieval stage(s) surfaced this result. */
  via: "hybrid" | "bm25" | "cosine" | "title-prefix" | "recent";
}

/**
 * Caller-supplied options for the unified search surface.
 *
 * The defaults bias toward "good for everything" — the specialised
 * call-sites (`commandPaletteSearch`, `aiContextSearch`) override.
 */
export interface SearchOptions {
  /** Final result cap. Default 10. */
  limit?: number;
  /** BM25 prefilter cap. Default 100. */
  topK?: number;
  /** Restrict to specific item kinds. Default: all kinds. */
  kinds?: WorkspaceItemKind[];
  /**
   * Optional probe embedding for cosine rerank. Caller is responsible
   * for computing it (we accept any L2-normalised vector that matches
   * the corpus model's dim).
   */
  probeEmbedding?: number[];
  /** Cosine weight in the final mix. Default 0.6. */
  cosineWeight?: number;
  /**
   * Recency half-life in milliseconds. Items get a multiplicative boost
   * of `2^(-Δt / halfLife)`. Default 14 days; set to `Infinity` to
   * disable recency weighting entirely.
   */
  recencyHalfLifeMs?: number;
  /** Force-rebuild the cached BM25 index for this projectId. */
  forceRebuild?: boolean;
}
