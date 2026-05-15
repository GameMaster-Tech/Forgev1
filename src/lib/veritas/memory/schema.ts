/**
 * Veritas Memory Schema (v2.1)
 * ────────────────────────────
 * Source of truth for the data model that powers Forge's persistent project memory.
 *
 * Design principles
 * ─────────────────
 * 1. Dimensions that feed DIFFERENT reward signals stay SEPARATE.
 *    Polarity (±), assertiveness (hedging), source support, extractor certainty
 *    are four distinct concerns — collapsing them loses signal the reasoning
 *    model and DPO reward need.
 *
 * 2. Every claim carries a canonical hash + an embedding pointer.
 *    Hash → O(1) exact-dedup across millions of claims.
 *    Embedding → O(log N) semantic recall via Qdrant / pgvector.
 *
 * 3. Scope is first-class.
 *    Two claims about different populations / doses / time periods are NOT
 *    contradictions. Structured scope lets the detector collapse these cases.
 *
 * 4. Quantitative facts are structured.
 *    "X reduces Y by 22%" gets parsed into {value, unit, direction}, not
 *    buried in free text. Magnitude-reversal becomes a deterministic check.
 *
 * 5. Contradictions are lifecycle objects, not flags.
 *    "Detected" and "Resolved" are separate states with their own rationales.
 *    The resolution record is the strongest DPO signal we have.
 *
 * 6. Reasoning is structured.
 *    Episode.thoughtTrace is ThoughtStep[], not a string blob — round-trips
 *    cleanly into `<think>` tokens at training time.
 *
 * 7. This file is TYPES ONLY. It must stay pure — safe to import in any
 *    execution environment.
 */

/* ─────────────────────────────────────────────────────────────
 *  Primitives
 * ──────────────────────────────────────────────────────────── */

/** ISO 8601 timestamp — `2026-04-21T10:15:30.000Z`. Preferred over epoch ms
 *  for durable fields that need to be human-readable in Firestore admin UI. */
export type IsoTimestamp = string;

/** Milliseconds since epoch — fine for in-process / ephemeral fields. */
export type EpochMs = number;

/** Canonical hex hash of a normalised string — used for O(1) dedup. */
export type CanonicalHash = string;

/** Opaque pointer to a row in the vector DB. Shape:
 *    `qdrant:veritas_claims/<uuid>`
 *    `pgvector:veritas.claim_embeddings/<id>`
 */
export type EmbeddingRef = string;

/* ─────────────────────────────────────────────────────────────
 *  Polarity / Assertiveness / Confidence — the four dimensions
 * ──────────────────────────────────────────────────────────── */

/** The semantic direction of the assertion. */
export type Polarity =
  | "asserts"        // "X does Y"
  | "negates"        // "X does not Y"
  | "descriptive";   // "X is-a Y" (no truth-functional direction)

/** How strongly the original text commits to the claim (hedging signal). */
export type Assertiveness = "hedged" | "qualified" | "direct";

/** Extractor self-reported certainty that the extraction is faithful. */
export type ExtractorCertainty = "low" | "medium" | "high";

/**
 * Strength of source evidence backing the claim. Computed from:
 *   support = f(peer_reviewed, citation_count, venue_impact, replication_count)
 * Stored as a quantile bucket to keep the reward shape stable.
 */
export type SourceSupport =
  | "unsourced"      // 0 sources backing this claim
  | "weak"           // 1 source, low quality
  | "moderate"       // 1–2 reasonable sources
  | "strong"         // 3+ sources or 1 highly-cited peer-reviewed
  | "consensus";     // widely replicated, textbook-grade

/* ─────────────────────────────────────────────────────────────
 *  Provenance — where a claim came from
 * ──────────────────────────────────────────────────────────── */

/** A precise location inside a Forge document. */
export interface DocLocation {
  docId: string;
  /** Character offset (inclusive) where the claim text starts. */
  startOffset: number;
  /** Character offset (exclusive) where the claim text ends. */
  endOffset: number;
  /** Best-effort paragraph index (0-based) for stable deep-linking. */
  paragraphIdx?: number;
}

/** A precise location inside an external source (paper, preprint). */
export interface SourceLocation {
  sourceId: string;              // SourceRef.id
  /** Page number, if available. */
  page?: number;
  /** Section name, e.g. "Results", "Discussion". */
  section?: string;
  /** Verbatim quoted snippet (≤ 400 chars) — kept for citation-support checks. */
  quote?: string;
}

/* ─────────────────────────────────────────────────────────────
 *  Claim ↔ Entity role — every entity referenced by a claim plays
 *  a specific role in the assertion.
 * ──────────────────────────────────────────────────────────── */

export type ClaimEntityRole =
  | "subject"          // "GLP-1 agonists reduce mortality" — subject
  | "object"           //   "…reduce mortality" — object
  | "intervention"     // the treatment / manipulation
  | "outcome"          // the measured outcome
  | "qualifier"        // setting, population, time, dose
  | "context";         // background reference only

export interface ClaimEntityRef {
  entityId: string;
  role: ClaimEntityRole;
  /** 0..1 — confidence in this specific resolution. */
  confidence?: number;
}

/* ─────────────────────────────────────────────────────────────
 *  Source attribution — how a specific source relates to a claim
 * ──────────────────────────────────────────────────────────── */

export type AttributionRole =
  | "primary-support"    // This source directly asserts the claim
  | "secondary-support"  // This source cites or replicates the claim
  | "partial-support"    // Supports a weaker form of the claim
  | "refutes"            // This source refutes the claim
  | "context";           // Relevant background, no truth commitment

export interface SourceAttribution {
  sourceId: string;                // SourceRef.id
  role: AttributionRole;
  /** 0..1 — how much this source moves our belief in the claim. */
  strength: number;
  location?: SourceLocation;
  /** The exact supporting/refuting snippet from the source. */
  evidenceQuote?: string;
}

/* ─────────────────────────────────────────────────────────────
 *  Scope — the part that collapses false-positive contradictions
 * ──────────────────────────────────────────────────────────── */

/**
 * Declares the conditions under which a claim holds. Two claims are NOT
 * contradictory if their scopes disagree on any axis.
 *
 * Every scope axis is optional — an empty scope means "universal" (claim
 * holds without qualification).
 */
export interface ClaimScope {
  /** e.g. "adults over 65", "mice C57BL/6", "type 2 diabetics". */
  population?: string;

  /** Treatment / intervention identifier (resolved to an Entity id). */
  intervention?: string;

  /** Dose / concentration, normalised. e.g. "10 mg/kg". */
  dose?: string;

  /** Setting: "in vitro", "in vivo", "clinical trial", "observational". */
  setting?: string;

  /** Geography — ISO country code or region label. */
  region?: string;

  /** Epistemic time window during which the claim is believed to hold. */
  validFrom?: IsoTimestamp;
  validTo?: IsoTimestamp;

  /** Additional free-form qualifiers keyed by dimension. */
  other?: Record<string, string>;
}

/**
 * The set of real scope axes — excludes `other` (free-form payload) so it
 * cannot be used as a `differentiatingScopeAxis`. If a new axis is added to
 * `ClaimScope`, add it here too.
 */
export type ClaimScopeAxis =
  | "population"
  | "intervention"
  | "dose"
  | "setting"
  | "region"
  | "validFrom"
  | "validTo";

export const CLAIM_SCOPE_AXES: readonly ClaimScopeAxis[] = [
  "population",
  "intervention",
  "dose",
  "setting",
  "region",
  "validFrom",
  "validTo",
];

/* ─────────────────────────────────────────────────────────────
 *  Quantitative payload — structured numeric claims
 * ──────────────────────────────────────────────────────────── */

export type Direction = "increase" | "decrease" | "no-change" | "unknown";

export interface QuantitativeFact {
  /** Metric being measured — "mortality", "HbA1c", "LDL". */
  metric: string;
  /** Point estimate value. */
  value?: number;
  /** Unit of measurement. "mg/dL", "%", "hazard-ratio". */
  unit?: string;
  /** Direction of effect. */
  direction: Direction;
  /** Confidence interval, if reported. [low, high]. */
  ci?: [number, number];
  /** P-value, if reported. */
  pValue?: number;
  /** Sample size, if reported. */
  n?: number;
}

/* ─────────────────────────────────────────────────────────────
 *  Derivation lineage — for claims produced by model reasoning, not
 *  directly read out of a source. Critical for invalidation propagation:
 *  if any parent claim is retracted or retired, descendants flip to
 *  "needs-review".
 * ──────────────────────────────────────────────────────────── */

export type DerivationKind =
  | "extracted"        // Pulled directly from a source passage
  | "synthesised"      // Produced by the model combining multiple claims
  | "refined"          // Narrower version of a parent claim
  | "aggregated"       // Statistical summary of parent claims
  | "user-authored";   // Written by the human

export interface ClaimDerivation {
  kind: DerivationKind;
  /** Claim ids this claim was derived from. Empty for `extracted` / `user-authored`. */
  parentClaimIds: string[];
  /** Episode during which the derivation happened (for replay + DPO). */
  episodeId?: string;
  /** Short human-readable justification. */
  rationale?: string;
}

/* ─────────────────────────────────────────────────────────────
 *  Extractor signature — tracks WHICH model + version produced a
 *  claim so we can bulk-reprocess after a Veritas-R1 upgrade.
 * ──────────────────────────────────────────────────────────── */

export interface ExtractorSignature {
  /** e.g. "veritas-r1", "claude-sonnet-4.7", "heuristic-baseline". */
  extractor: string;
  /** Semver or commit SHA. */
  version: string;
  /** When the extraction ran. */
  at: IsoTimestamp;
}

/* ─────────────────────────────────────────────────────────────
 *  Claim — the central entity
 * ──────────────────────────────────────────────────────────── */

export interface Claim {
  /** Stable id, prefixed `clm-`. */
  id: string;

  /** Partitioning key — every claim lookup scopes to a project. */
  projectId: string;

  /** User who authored or confirmed the claim (team scenarios). */
  userId: string;

  /**
   * Canonical hash of the normalised atomic assertion.
   * Used for exact-dedup; two claims with the same hash are the same claim.
   */
  canonicalHash: CanonicalHash;

  /** Pointer to the vector DB row holding this claim's embedding.
   *  Kept for forward-compatibility with off-Firestore vector stores
   *  (Qdrant / pgvector). Phase 2 stores vectors INLINE via `embedding`. */
  embeddingRef?: EmbeddingRef;

  /**
   * Inline dense vector for semantic recall (Phase 2).
   * Stored on the claim doc itself rather than a sibling collection because:
   *   • Voyage-3 vectors are 1024 × float32 ≈ 4 KB — well under the 1 MiB
   *     Firestore doc cap, and Forge's per-project claim count is bounded by
   *     human authoring throughput (≤ 10⁴ claims / project realistic).
   *   • Sibling collection lookups would force a second round-trip per
   *     similarity query, which dominates wall-clock for the in-app reader.
   *   • The training data pipeline pulls full claims anyway, so co-locating
   *     vector + metadata simplifies sampling.
   *
   * Vectors are L2-normalised at write time so cosine == dot product downstream.
   * The shape mirrors `Embedding` from `memory/embeddings/embedder.ts`; we keep
   * the field inline (rather than importing the type) so this file stays
   * dependency-free as the schema invariants demand.
   */
  embedding?: {
    vector: number[];
    dim: number;
    modelId: string;
  };

  /** Free text as it appeared in context (~≤ 240 chars). */
  text: string;

  /**
   * Normalised atomic assertion — a single subject-predicate-object reduction.
   * Example: "GLP-1 agonists reduce all-cause mortality in T2DM patients".
   */
  atomicAssertion: string;

  /** Structured dimensions (see types above). */
  polarity: Polarity;
  assertiveness: Assertiveness;
  extractorCertainty: ExtractorCertainty;
  sourceSupport: SourceSupport;

  /** When present, structures the numeric content of the claim. */
  quantitative?: QuantitativeFact;

  /** Scope under which the claim is asserted. Empty ⇒ universal. */
  scope: ClaimScope;

  /** Per-source attributions — ordered, authoritative source list. */
  attributions: SourceAttribution[];

  /** Resolved entity ids (denormalised flat list, derived from entityRefs). */
  entities: string[];

  /** Structured entity references with role — preferred for new writers. */
  entityRefs?: ClaimEntityRef[];

  /** Topic id — references a `Topic` record, not free text. */
  topicId?: string;

  /** Location in the authoring Forge document, if any. */
  docLocation?: DocLocation;

  /** How this claim came into being (extraction, synthesis, user). */
  derivation?: ClaimDerivation;

  /** Which model + version produced this claim. Needed for bulk-reprocessing. */
  extractedBy?: ExtractorSignature;

  /**
   * When any parent in `derivation.parentClaimIds` is retracted / retired,
   * this flag flips true and the UI surfaces it for re-verification.
   */
  needsReview?: boolean;

  /** Ids of claims this claim contradicts (denormalised for fast reads). */
  contradicts: string[];

  /** Ids of claims superseded by this claim (denormalised for fast reads). */
  supersedes: string[];

  /** If this claim has itself been superseded by a newer one, its id. */
  supersededBy?: string;

  /** Soft-delete marker (retained for audit; never hard-delete claims). */
  retired: boolean;

  /** Optional model-generated rationale for the extraction. */
  extractionRationale?: string;

  /** When the claim was first written to the graph. */
  createdAt: IsoTimestamp;
  /** Last mutation time. */
  updatedAt: IsoTimestamp;
}

/* ─────────────────────────────────────────────────────────────
 *  Claim Link (graph edge) — supports / refines / cites / restates
 *  Contradictions live in their own entity for lifecycle tracking.
 * ──────────────────────────────────────────────────────────── */

export type ClaimLinkType = "supports" | "refines" | "restates" | "cites";

/**
 * Link types whose semantics are inherently bidirectional — if A restates B,
 * B restates A. Query layers should union `linksFrom(id)` and `linksTo(id)`
 * for these types before rendering.
 *
 * `supports`, `refines`, and `cites` are DIRECTIONAL and must not appear here.
 */
export const SYMMETRIC_LINK_TYPES: readonly ClaimLinkType[] = ["restates"];

export function isSymmetricLinkType(t: ClaimLinkType): boolean {
  return SYMMETRIC_LINK_TYPES.includes(t);
}

export interface ClaimLink {
  id: string;
  projectId: string;
  from: string;                // claim id
  to: string;                  // claim id
  type: ClaimLinkType;
  /** 0..1 confidence that the relation holds. */
  strength: number;
  rationale?: string;
  createdAt: IsoTimestamp;
}

/* ─────────────────────────────────────────────────────────────
 *  Contradiction — detected, lifecycle-tracked
 * ──────────────────────────────────────────────────────────── */

export type ContradictionDetector =
  | "heuristic"                // In-process baseline detector
  | "model-veritas"            // Veritas-R1 flagged it
  | "user"                     // User explicitly reported it
  | "external";                // Imported from Retraction Watch etc.

export type ContradictionStatus =
  | "open"                     // Detected, not yet reviewed
  | "dismissed"                // User / model determined it's not a real conflict
  | "resolved-a-wins"          // Claim A is correct, B retired
  | "resolved-b-wins"          // Claim B is correct, A retired
  | "resolved-coexist"         // Both hold under different scopes
  | "resolved-refined";        // Neither fully — a new, more-precise claim created

/** The specific signals that triggered detection. */
export type ContradictionSignal =
  | "opposite-polarity"
  | "negation-flip"
  | "antonym-verb"
  | "magnitude-reversal"
  | "direction-reversal"
  | "scope-overlap"
  | "user-flagged"
  | "retraction-watch";

/**
 * A single transition in a contradiction's lifecycle. Kept as an append-only
 * log so we can (a) audit who / what resolved it, (b) mine the transitions as
 * DPO preference pairs.
 */
export interface ContradictionStatusChange {
  from: ContradictionStatus;
  to: ContradictionStatus;
  at: IsoTimestamp;
  /** Episode that caused the transition, if any. */
  episodeId?: string;
  /** User or extractor that effected the change — "user:<uid>" | "veritas-r1" | "heuristic". */
  actor?: string;
  /** Short justification. */
  rationale?: string;
}

export interface Contradiction {
  id: string;
  projectId: string;
  a: string;                   // claim id
  b: string;                   // claim id
  detector: ContradictionDetector;
  signals: ContradictionSignal[];
  /** 0..1 aggregate likelihood the contradiction is real. */
  score: number;

  status: ContradictionStatus;

  /** When status ≠ open, this is the episode that resolved it. */
  resolutionEpisodeId?: string;
  /** When status ≠ open, explanation of the resolution. */
  resolutionRationale?: string;
  /** When status = resolved-coexist, the scope axis that differentiates them.
   *  Narrowed to real scope axes — `other` is excluded because it's a
   *  free-form payload, not an axis. */
  differentiatingScopeAxis?: ClaimScopeAxis;
  /** When status = resolved-refined, the id of the new refined claim. */
  refinedClaimId?: string;

  /** Append-only audit trail of every status transition. */
  statusHistory?: ContradictionStatusChange[];

  detectedAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

/* ─────────────────────────────────────────────────────────────
 *  Thought / Reasoning Trace — structured for training data
 * ──────────────────────────────────────────────────────────── */

export type ThoughtStepKind =
  | "think"              // Freeform reasoning token (goes inside <think>)
  | "recall"             // Memory recall of prior claim / episode
  | "retrieve"           // External retrieval call
  | "verify"             // DOI / claim verification call
  | "tool-call"          // Other tool invocation
  | "decide"             // Decision commitment
  | "answer";            // Final assistant turn

export interface ThoughtStep {
  kind: ThoughtStepKind;

  /** Freeform text for `think` / `decide` / `answer`. */
  text?: string;

  /** For `recall` — claim ids pulled from memory. */
  recalledClaims?: string[];
  /** For `recall` — episode ids pulled from memory. */
  recalledEpisodes?: string[];

  /** For `retrieve` / `tool-call` — the tool name. */
  tool?: string;
  /** For `retrieve` / `tool-call` — JSON-serialisable input. */
  toolInput?: unknown;
  /** For `retrieve` / `tool-call` / `verify` — JSON-serialisable output. */
  toolOutput?: unknown;

  /** 0..1 confidence the model placed in this step at emission time. */
  confidence?: number;

  /** Monotonic index within the trace. */
  index: number;
}

export interface ThoughtTrace {
  steps: ThoughtStep[];
  /** Total wall-clock ms from first to last step. */
  durationMs?: number;
  /** Model id that produced the trace. */
  model?: string;
}

/* ─────────────────────────────────────────────────────────────
 *  ThoughtStep narrowing helpers — enforce the discipline that
 *  each kind carries the right payload shape. The training-data
 *  pipeline relies on these to skip malformed traces silently.
 * ──────────────────────────────────────────────────────────── */

/** A well-formed `think` / `decide` / `answer` step has non-empty text. */
export function isTextualStep(
  s: ThoughtStep,
): s is ThoughtStep & { kind: "think" | "decide" | "answer"; text: string } {
  return (
    (s.kind === "think" || s.kind === "decide" || s.kind === "answer") &&
    typeof s.text === "string" &&
    s.text.length > 0
  );
}

/** A well-formed `recall` step references at least one claim or episode. */
export function isRecallStep(
  s: ThoughtStep,
): s is ThoughtStep & { kind: "recall" } {
  return (
    s.kind === "recall" &&
    ((Array.isArray(s.recalledClaims) && s.recalledClaims.length > 0) ||
      (Array.isArray(s.recalledEpisodes) && s.recalledEpisodes.length > 0))
  );
}

/** A well-formed tool-ish step has a tool name. */
export function isToolStep(
  s: ThoughtStep,
): s is ThoughtStep & {
  kind: "retrieve" | "verify" | "tool-call";
  tool: string;
} {
  return (
    (s.kind === "retrieve" || s.kind === "verify" || s.kind === "tool-call") &&
    typeof s.tool === "string" &&
    s.tool.length > 0
  );
}

/** A step is "well-formed" if it satisfies the shape required by its kind. */
export function isWellFormedStep(s: ThoughtStep): boolean {
  return isTextualStep(s) || isRecallStep(s) || isToolStep(s);
}

/* ─────────────────────────────────────────────────────────────
 *  Episode (session log)
 * ──────────────────────────────────────────────────────────── */

export type EpisodeType =
  | "query"              // User asked a research question
  | "write"              // User authored / edited prose in the editor
  | "verify"             // Citation was verified
  | "accept"             // User accepted an AI suggestion / citation
  | "reject"             // User rejected one
  | "contradiction"      // System surfaced a contradiction
  | "resolve"            // User resolved a contradiction
  | "snapshot";          // System took a memory snapshot

export interface Episode {
  id: string;
  projectId: string;
  userId: string;
  timestamp: IsoTimestamp;

  type: EpisodeType;

  /** The input that triggered the episode. */
  input: string;

  /** Structured reasoning trace — survives round-tripping to training data. */
  thoughtTrace?: ThoughtTrace;

  /** Final model / system output shown to the user. */
  output?: string;

  /** Claim ids referenced by the reasoning trace. Denormalised from trace. */
  claimsReferenced: string[];

  /** Claim ids created as a side-effect of this episode. */
  claimsCreated: string[];

  /** Claim ids retired as a side-effect of this episode. */
  claimsRetired: string[];

  /** Contradictions detected or resolved in this episode. */
  contradictionIds: string[];

  /**
   * For accept / reject: the id of the artefact acted upon
   * (citation id, suggestion id, contradiction id).
   */
  targetId?: string;

  /** For reject: freeform reason from the user, if given. Feeds DPO. */
  rejectReason?: string;

  /** Link to the memory snapshot taken at the start of the episode. */
  snapshotId?: string;
}

/* ─────────────────────────────────────────────────────────────
 *  Memory Snapshot — point-in-time view of project knowledge
 * ──────────────────────────────────────────────────────────── */

export interface MemorySnapshot {
  id: string;
  projectId: string;
  createdAt: IsoTimestamp;

  /** Claim ids live at snapshot time (not retired, not superseded). */
  activeClaimIds: string[];

  /** Count summary — cheap to render in UI without fetching claims. */
  counts: {
    claims: number;
    sources: number;
    entities: number;
    contradictions: number;
    openContradictions: number;
  };

  /** Rolling hash — lets us detect drift without comparing full lists. */
  hash: CanonicalHash;
}

/* ─────────────────────────────────────────────────────────────
 *  Entity resolution
 * ──────────────────────────────────────────────────────────── */

export type EntityKind =
  | "concept"
  | "person"
  | "organization"
  | "method"
  | "compound"
  | "dataset"
  | "metric"
  | "other";

export interface Entity {
  id: string;
  projectId: string;
  canonical: string;          // "CRISPR-Cas9"
  aliases: string[];          // ["CRISPR/Cas9", "Cas9 system", ...]
  kind: EntityKind;
  /** Optional external identifier (Wikidata QID, MeSH ID, ORCID). */
  externalId?: string;
  /** How often this entity is referenced in the project. Updated async. */
  mentionCount: number;
  /** 0..1 confidence in the entity resolution. */
  resolutionConfidence: number;
  embeddingRef?: EmbeddingRef;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

/* ─────────────────────────────────────────────────────────────
 *  Topic — normalised, not free-form
 * ──────────────────────────────────────────────────────────── */

export interface Topic {
  id: string;
  projectId: string;
  slug: string;               // "gene-editing"
  label: string;              // "Gene editing"
  /** Parent topic id, if this topic refines a broader one. */
  parentId?: string;
  /** How many claims are tagged with this topic. */
  claimCount: number;
  createdAt: IsoTimestamp;
}

/* ─────────────────────────────────────────────────────────────
 *  External source reference
 * ──────────────────────────────────────────────────────────── */

/**
 * Open-access status — tracked so the reader can always link to the most
 * readable version, and so the training data pipeline can preferentially
 * sample freely-redistributable text.
 */
/**
 * Open-access status. Absence of the field ⇒ unknown; we don't need a
 * dedicated "unknown" variant because the field is optional.
 */
export type OpenAccessStatus =
  | "gold"          // Published open access in an OA journal
  | "green"         // Self-archived preprint / repository copy
  | "hybrid"        // OA in an otherwise paywalled journal
  | "bronze"        // Freely readable but no clear OA license
  | "closed";       // Paywalled, no OA copy found

export interface SourceRef {
  id: string;                 // `src-<doi>` when known
  doi?: string;
  url?: string;
  title: string;
  authors?: string[];
  year?: number;
  journal?: string;
  venue?: string;

  verified: boolean;
  retracted: boolean;
  suspectedPredatory: boolean;

  /** Venue impact metric — JIF / h5-index / SJR. Optional, unit-agnostic. */
  venueImpact?: number;
  /** Crossref / OpenAlex citation count at ingest. */
  citationCount?: number;

  /** Open-access status — drives reader routing and training-data filtering. */
  oaStatus?: OpenAccessStatus;
  /** Canonical URL of the open-access copy, when one exists. */
  oaUrl?: string;

  firstSeenAt: IsoTimestamp;
  lastVerifiedAt?: IsoTimestamp;
}

/* ─────────────────────────────────────────────────────────────
 *  Type guards
 * ──────────────────────────────────────────────────────────── */

const POLARITY_SET = new Set<Polarity>(["asserts", "negates", "descriptive"]);
const ASSERTIVENESS_SET = new Set<Assertiveness>(["hedged", "qualified", "direct"]);
const EXTRACTOR_CERTAINTY_SET = new Set<ExtractorCertainty>(["low", "medium", "high"]);
const SOURCE_SUPPORT_SET = new Set<SourceSupport>([
  "unsourced",
  "weak",
  "moderate",
  "strong",
  "consensus",
]);

export function isClaim(v: unknown): v is Claim {
  if (!v || typeof v !== "object") return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.id === "string" &&
    typeof c.projectId === "string" &&
    typeof c.userId === "string" &&
    typeof c.canonicalHash === "string" &&
    typeof c.text === "string" &&
    typeof c.atomicAssertion === "string" &&
    typeof c.polarity === "string" &&
    POLARITY_SET.has(c.polarity as Polarity) &&
    typeof c.assertiveness === "string" &&
    ASSERTIVENESS_SET.has(c.assertiveness as Assertiveness) &&
    typeof c.extractorCertainty === "string" &&
    EXTRACTOR_CERTAINTY_SET.has(c.extractorCertainty as ExtractorCertainty) &&
    typeof c.sourceSupport === "string" &&
    SOURCE_SUPPORT_SET.has(c.sourceSupport as SourceSupport) &&
    c.scope !== null &&
    typeof c.scope === "object" &&
    Array.isArray(c.attributions) &&
    Array.isArray(c.entities) &&
    Array.isArray(c.contradicts) &&
    Array.isArray(c.supersedes) &&
    typeof c.retired === "boolean" &&
    typeof c.createdAt === "string" &&
    typeof c.updatedAt === "string"
  );
}

export function isEpisode(v: unknown): v is Episode {
  if (!v || typeof v !== "object") return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.id === "string" &&
    typeof e.projectId === "string" &&
    typeof e.userId === "string" &&
    typeof e.timestamp === "string" &&
    typeof e.type === "string" &&
    Array.isArray(e.claimsReferenced) &&
    Array.isArray(e.claimsCreated)
  );
}

export function isContradiction(v: unknown): v is Contradiction {
  if (!v || typeof v !== "object") return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.id === "string" &&
    typeof c.projectId === "string" &&
    typeof c.a === "string" &&
    typeof c.b === "string" &&
    typeof c.status === "string"
  );
}
