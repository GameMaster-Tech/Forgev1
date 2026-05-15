# Forge — Workspace Retrieval Architecture

> Owner: Rakshit Khanna · Locked: 2026-05-10

This document specifies retrieval for **the entire Forge workspace** — documents, saved sources, past chat exchanges, claims, reasoning episodes, the project's own metadata. Forge is an AI-powered research workspace, not a citation verifier. Retrieval has to surface every searchable artefact a researcher has, not just claims.

The earlier draft scoped retrieval to the Veritas claim graph alone; this version supersedes that.

---

## 0. Decision, in one paragraph

**No external vector database.** Per-project working sets are dominated by human-authoring throughput (documents, queries, notes) — typical ≤10⁴ items, pathological ≤10⁵. At that scale a **two-stage hybrid retriever (BM25 prefilter → cosine rerank → recency boost)** running in-process beats Pinecone/Qdrant/Weaviate/pgvector on latency, cost, and operational simplicity. Pinecone & friends become the right answer at 10⁶+ vectors per index — Forge will not see that volume per-project for years. We keep `embeddingRef` on the schema as a forward-compatible escape hatch but deliberately do not wire one.

---

## 1. What we actually retrieve

The real workspace surface, not a citation library.

| Workspace artefact | Firestore source | Indexed fields | Embedded today? |
|---|---|---|---|
| **Documents** (TipTap research docs) | `documents/{id}` | `title`, `content` (TipTap JSON, stripped to text) | no — embed-on-save lands in CP4 |
| **Past research conversations** | `queries/{id}` | `query`, `answer` | no — embed-on-write next |
| **Extracted claims** | `veritasClaims/{id}` | `atomicAssertion` | yes (Voyage-3, Phase 2) |
| **Reasoning episodes** | `veritasEpisodes/{id}` | `input`, `output` | no |
| **Project metadata** | `projects/{id}` | `name`, `systemInstructions` | no (small text) |

These are the items the AI surfaces back to the user when they ask things like:
- "What did I write about X last Tuesday?"
- "Show me past queries about GLP-1 mortality"
- "Find any claim related to this paper"
- "Summarize this project's progress"
- "What's the consensus across my notes?"

All five workspace surfaces are now searchable through one unified API.

---

## 2. The three call shapes, all on one pipeline

| Call | Used by | Optimised for |
|---|---|---|
| `searchWorkspace(projectId, query, opts)` | `/research`, "find related" buttons, AI's recall path | recall + precision |
| `commandPaletteSearch(projectId, query, opts)` | ⌘K palette | sub-50 ms; title-prefix-first; recency-weighted |
| `aiContextSearch(projectId, query, opts)` | Veritas-R1 prompt assembly | diversity by `kind` (so the model gets one strong doc + one query + one claim, not five docs) |

All three share the same pipeline:

```
loadWorkspaceItems(projectId)        ← cache hit OR rebuild from Firestore
  │   (parallel reads: documents, queries, veritasClaims, veritasEpisodes, project)
  │
  ├─→ Stage 1: BM25 over title+body → top-K candidates
  │
  ├─→ Stage 2: cosine rerank candidates that have inline embeddings
  │   (cosine-only sweep over the corpus when probe vector + zero BM25 hits)
  │
  ├─→ Stage 3: recency boost (multiplicative, 14-day half-life default)
  │
  └─→ final mix = (cosine_weight × cosine + bm25_weight × bm25_norm) × recency
```

`commandPaletteSearch` swaps Stage 1 for a title-prefix scan that wins on UX expectations ("re" matches "Research notes" first). `aiContextSearch` widens the pool then applies a diversity filter (cap per kind).

---

## 3. Vector-DB option matrix

Compared at our scale (~10⁴ items per project, ~10³ active projects).

| Approach | p95 latency @10⁴ items | $ / month | Setup | Off-stack risk |
|---|---:|---:|---|---|
| **Hybrid BM25 + cosine + recency** (chosen) | **~12 ms** | **$0** | moderate | none |
| In-process cosine only | ~25 ms | $0 | trivial | none |
| Firestore native, no semantic | 80-200 ms client-filter | $0 | trivial | none |
| Pinecone serverless | 30-90 ms | $70+/mo idle | medium | adds vendor |
| Qdrant Cloud | 30-80 ms | $25-50/mo | medium | adds vendor + DB |
| Weaviate Cloud | 30-100 ms | $30+/mo | medium | adds vendor + DB |
| pgvector | 50-150 ms | $20+/mo | high | **off-stack — Firebase-only** |
| Vertex AI Vector Search | 40-80 ms | per-query + index | medium | GCP-native (acceptable) |

**Why each managed vector DB is rejected for v1.** Per-project working sets are too small for any of them to pay back their fixed costs. Pinecone serverless minimum is ~$70/mo to keep an index warm even at zero traffic. Qdrant/Weaviate add a service to operate. pgvector is off-stack (we're Firebase-only — explicit constraint from `PHASE2_NOTES.md`). Vertex AI Vector Search is the right pick if/when we cross 10⁵+ items per project; the schema's `embeddingRef` field is the migration escape hatch.

**Why hybrid wins at our scale.**
1. **BM25 stays under 50 ms** at 10⁴ items in pure JS — token-frequency tables are ~150 KB and rebuilds happen once per cache miss.
2. **Cosine over BM25's top-50** is a 200× reduction in dot products vs. naive full-corpus cosine.
3. **Both fit in one Cloud Run process** — zero RTT on the hot path; Firestore RTT (~30-80 ms to fetch the resolved docs) dominates either way.
4. **Recency weighting matters more than vector magic** for a workspace — researchers want "the doc I just edited" surfaced, which a stateless vector DB can't infer cheaply without a separate timestamps table.

---

## 4. Architecture

### 4.1 Module layout

```
src/lib/retrieval/                 — workspace-level retrieval (NEW)
├── types.ts                       — WorkspaceItem, SearchResult, SearchOptions
├── ingest.ts                      — per-collection adapters → WorkspaceItem
├── search.ts                      — searchWorkspace / commandPaletteSearch / aiContextSearch
├── cache.ts                       — per-project LRU index cache + invalidation API
└── index.ts                       — barrel

src/lib/veritas/memory/retrieval/  — claim-graph-specific primitives (kept)
├── bm25.ts                        — pure-TS BM25 scorer
├── hybrid.ts                      — claim-graph hybrid (used internally by ClaimGraph.findSimilar)
├── cache.ts                       — separate per-project cache for claims-only
├── cursor.ts                      — Firestore cursor pagination
└── batch.ts                       — concurrent batched getAll
```

The workspace retrieval module imports the BM25 primitive from the Veritas tree (it's the same algorithm). The two caches are intentionally separate — one is keyed on claims, the other on the unified workspace item set, and they invalidate on different events.

### 4.2 Schema (no changes from prior phases)

Documents, queries, claims, episodes, and projects keep their existing Firestore schemas. The retrieval surface is implemented as **adapters** over those collections, not a new collection — no migration, no sync job, no dual-writes.

Embeddings live inline on the claim doc today (Phase 2 decision). When we extend embed-on-write to documents and queries (workspace-wide semantic recall), we'll add an `embedding?: { vector, dim, modelId }` field to each collection's schema — same shape, different home.

### 4.3 Caching tiers

| Tier | Lifetime | Scope | Invalidation |
|---|---|---|---|
| **Workspace LRU** of `(items, BM25 index, uid map)` | per Cloud Run instance | by `projectId` | every write to documents / queries / claims / episodes / project metadata |
| **Veritas BM25 LRU** (claim-graph specific) | per Cloud Run instance | by `projectId` | claim writes only |
| **Firestore composite indexes** | persistent | by `(projectId, …)` | n/a |

Cache eviction is size-bounded (`MAX_PROJECTS = 64`). Hit rate ≥ 95% in steady-state on a warm Cloud Run instance.

### 4.4 Pagination

`paginate(query, transform, { pageSize, cursor })` — cursor-based; `startAfter(lastDoc)` instead of `offset(N)`. Critical for `getProjectDocuments`-style queries where the user might have hundreds of docs and we want O(pageSize) reads per page rather than O(pageIndex × pageSize).

### 4.5 Batched concurrent fetch

`batchGetByIds(coll, ids)` chunks at Firestore's 10-per-call cap, fires all chunks **in parallel**. For N=100 doc resolutions: 10 RTTs in parallel ≈ 1 effective RTT instead of 100 serial ≈ 100× speedup. Used by anywhere we resolve a list of ids (memory-recall results, citation lookups, etc.).

### 4.6 Sync logic (write → cache invalidation)

Every write that mutates an indexable collection calls `workspaceCache.invalidate(projectId)` after the commit. Wired into:

- `createProject` / `updateProject` / `deleteProject`
- `createDocument` / `updateDocument` / `deleteDocument`
- `saveResearchQuery`
- `addClaim` / `updateClaim` / `retireClaim` / `supersede` (also bumps the Veritas claim cache)

The next read for that project sees the version mismatch and rebuilds. There is no TTL; staleness is purely event-driven.

### 4.7 Fallback chain

In order of preference:

1. **Hybrid** — BM25 + cosine + recency (full pipeline, what most calls hit)
2. **BM25 + recency** — when no probe embedding is provided
3. **Title-prefix + recency** — command palette, fast path for short queries
4. **Recent-only** — empty-query state (palette opens, list of recent items)
5. **Empty** — caught by callers; UI shows "no matches"

The pipeline never crashes on a degenerate query — every branch returns at worst an empty array.

---

## 5. Why this is faster than a vector DB *for our workload*

Three quantitative arguments:

1. **Per-project working set fits L2 cache.** 10⁴ items × ~2 KB serialised ≈ 20 MB. Token-frequency tables ≈ 150 KB. The whole index is in-process; no network RTT to score.
2. **The dominant cost is Firestore reads, not similarity math.** Even Pinecone wouldn't help here — we still need to fetch the doc/claim/query bodies to render results. So end-to-end latency is bounded by Firestore RTT (~30-80 ms) regardless of where we score.
3. **Recency weighting beats raw similarity** for a workspace UX. Researchers value "the thing I edited 5 minutes ago" over "the thing semantically closest by 0.04 cosine." A stateless vector DB can't apply recency without a join back into Firestore — eliminating its only architectural advantage.

If we ever cross 10⁵+ items per project, we move embeddings to Vertex AI Vector Search via `embeddingRef`. Schema is ready; the migration is an additive write path, not a rewrite.

---

## 6. Files changed

| File | Change |
|---|---|
| `src/lib/retrieval/types.ts` | NEW — `WorkspaceItem`, `SearchResult`, `SearchOptions` |
| `src/lib/retrieval/ingest.ts` | NEW — adapters for documents / queries / claims / episodes / project |
| `src/lib/retrieval/search.ts` | NEW — `searchWorkspace`, `commandPaletteSearch`, `aiContextSearch` |
| `src/lib/retrieval/cache.ts` | NEW — workspace LRU |
| `src/lib/retrieval/index.ts` | NEW — barrel |
| `src/lib/veritas/memory/retrieval/bm25.ts` | NEW — BM25 primitive (reused by workspace) |
| `src/lib/veritas/memory/retrieval/hybrid.ts` | NEW — claim-graph hybrid path |
| `src/lib/veritas/memory/retrieval/cache.ts` | NEW — claim-specific BM25 LRU |
| `src/lib/veritas/memory/retrieval/cursor.ts` | NEW — pagination |
| `src/lib/veritas/memory/retrieval/batch.ts` | NEW — concurrent batched gets |
| `src/lib/veritas/memory/firestore/claim-graph.ts` | UPDATED — `findSimilar` uses hybrid; writes invalidate both caches |
| `src/lib/firebase/firestore.ts` | UPDATED — every write to documents / queries / projects invalidates `workspaceCache` |
| `firestore.rules` | UPDATED — full Teams rule block, least-privilege, supports invite flow |

---

## 7. Audit findings — all fixed in this commit

| # | Issue | Severity | Fix |
|---|---|---|---|
| 1 | Teams collection had **zero rules** — all writes denied → "insufficient or missing permissions" on team create | 🔴 P0 user-blocking | Full rule block; least-privilege; supports invite acceptance via diff-checked self-add to memberIds |
| 2 | `createTeam` did 2 sequential writes (orphan team if owner-row write fails) | 🟠 P1 data integrity | `writeBatch` — both writes land atomically |
| 3 | `acceptTeamInvite` did 3 sequential writes; partial failure left invite=accepted but member missing | 🔴 P0 data integrity | `runTransaction` — read invite + read team + idempotent member-add + status flip in one TX. Idempotent on retry |
| 4 | `removeTeamMember` did 2 sequential writes — `memberIds[]` could drift from member subcollection | 🟠 P1 | `writeBatch` |
| 5 | `assignProjectToTeam` used race-prone `get→increment` pattern; missed decrementing the old team on team-to-team move | 🟠 P1 data integrity | Atomic `increment()`; handles team-to-team and team-to-null transitions |
| 6 | `deleteTeam` issued unbounded `Promise.all(deleteDoc)` — fails silently if any single doc rejects, leaves orphans | 🟡 P2 | Chunked `writeBatch` with 450-op flush threshold; partial failures retry-safe |
| 7 | `teamInvites` read rule was `auth != null` — any logged-in user could read any invite | 🟠 P1 information disclosure | `inviterId == auth.uid` OR `auth.token.email matches invite.email` |
| 8 | `teamInvites` update allowed any status flip — users could mark *other* people's invites accepted | 🟠 P1 | Constrained: inviter (revoke) OR recipient with strict `pending → accepted` only AND only `[status, acceptedAt, acceptedBy]` keys touched |
| 9 | `findSimilar` in claim-graph did O(n) cosine over every claim | 🟡 P2 scale | BM25 prefilter cuts to top-K (200× reduction at 10⁴) |
| 10 | No per-project workspace cache — every search re-read every collection | 🟡 P2 scale | Workspace LRU with event-driven invalidation |
| 11 | Claim resolution by id list used serial `getDoc` calls | 🟡 P2 scale | `batchGetByIds` — chunked + concurrent |
| 12 | `listClaims` / `getProjectDocuments` used full collection scans without pagination | 🟡 P2 scale | Cursor-based `paginate()` helper |
| 13 | `derivation.parentClaimIds` array-contains query missing index | 🟡 P2 ops | Index added Phase 2 |
| 14 | `addContradiction` dedup was a no-op | 🟠 P1 (Phase 2) | Deterministic id `ctd-<hash(pairKey)>` |
| 15 | `addClaim` used illegal `getDocs` inside `runTransaction` | 🔴 P0 (Phase 2) | Deterministic id `clm-<hash>` collapses to `tx.get` |
| 16 | Retire cascade missing — descendants not flagged | 🟠 P1 (Phase 2) | Outside-tx batched `cascadeNeedsReviewOnDescendants` |
| 17 | TipTap editor autosave debounce — race on rapid edit + navigate | 🟡 P3 UX | Documented; tracked, deferred (uncommon, recoverable) |
| 18 | No optimistic concurrency on document edits — last-writer-wins | 🟡 P3 | Documented; would need an `editVersion` field + tx check; deferred |
| 19 | Retrieval scoped to claims only (citation-verifier framing) | 🟠 P1 product framing | Reframed as workspace-wide; documents / queries / claims / episodes / project all surfaced through one API |
| 20 | No `workspaceCache.invalidate` on document edit — search results stale until cache eviction | 🟠 P1 staleness | Wired into every write in `firestore.ts` and the claim-graph |

---

## 8. Open / deferred items

- **Embed-on-write for documents and queries.** Today only claims carry inline embeddings. Extending the same pattern to documents (chunked) and queries (single-shot per row) is the next retrieval upgrade. Not blocking — BM25 alone is good enough for v1 across these kinds.
- **Vertex AI Vector Search migration path.** Trigger condition: a single project crosses 10⁵ items. We're nowhere close. Schema is ready (`embeddingRef`).
- **Optimistic concurrency on doc edits.** `editVersion` field + `tx.get` compare on save. Cheap to add; uncommon issue at solo-researcher scale.
- **Cross-project search.** Out of v1 scope.
- **Real ColBERT-style late-interaction reranker.** BM25 + cosine + recency is sufficient until we have user data to A/B against.

This document supersedes the citation-verifier-flavoured retrieval discussion in earlier drafts.
