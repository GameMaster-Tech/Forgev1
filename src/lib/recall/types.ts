/**
 * Forge Recall — typed core.
 *
 * Three primitives. That's it.
 *
 *   Snippet    — atomic 1–3 sentence chunk of meaning
 *   Correction — supersedes link between two snippets
 *   Pin        — boolean flag on a snippet (user-anchored truth)
 *
 * No 4-axis confidence vector, no chain-of-trust enum, no salience
 * weight table. The whole design is "atomic chunks the AI can quote
 * verbatim, plus a way to mark them corrected or pinned."
 *
 * See `docs/RECALL.md` for the rationale and the Claude/ChatGPT/Gemini
 * comparison.
 */

export type SnippetOrigin = "user" | "ai" | "doc" | "web" | "tool";

export interface Snippet {
  id: string;
  projectId: string;
  ownerId: string;

  text: string;                 // 1–3 sentences, kept verbatim
  origin: SnippetOrigin;
  sourceRef?: string;           // documentId / URL / messageId

  pinnedByUser: boolean;        // explicit "remember this" anchor
  uses: number;                 // accepted retrievals — drives freshness
  lastUsedAt: number;           // epoch-ms
  createdAt: number;

  /** Newer snippet that supersedes this one. Both stay in the store —
   *  retrieval prefers the new but surfaces the old as "corrected". */
  supersededBy?: string;

  /** Optional — present if conversation-scoped; null for project-wide. */
  conversationId?: string;

  /** Optional embedding for cosine recall. Cheap to skip — BM25 still
   *  works without one. */
  embedding?: { vector: number[]; dim: number; modelId: string };
}

export interface Correction {
  id: string;
  projectId: string;
  oldSnippetId: string;
  newSnippetId: string;
  trigger: string;              // the user phrase that signalled the change
  createdAt: number;
}

/* ── Retrieval shapes ────────────────────────────────────────── */

export interface RecallRequest {
  projectId: string;
  ownerId: string;
  probe: string;
  conversationId?: string;
  /** Token budget for recalled (non-recent) snippets. */
  budget?: number;
  probeEmbedding?: number[];
}

export interface ScoredSnippet {
  snippet: Snippet;
  score: number;
  via: "recent" | "pinned" | "lexical" | "cosine" | "correction";
  /** If true, this snippet is the *old* side of a correction the
   *  retriever surfaced for transparency. */
  isSuperseded?: boolean;
}

export interface RecallResult {
  recent: ScoredSnippet[];      // raw last-N turn snippets (deterministic order)
  pinned: ScoredSnippet[];      // user-anchored
  recalled: ScoredSnippet[];    // hybrid pull
  corrections: ScoredSnippet[]; // old-side pairs for each correction hit
  /** Grounded-refusal verdict from `checkGrounding`. */
  grounding: {
    pass: boolean;
    required: number;
    available: number;
  };
}
