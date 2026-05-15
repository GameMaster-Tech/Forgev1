# Veritas Phase 2 — implementation notes & plan critique

This file captures the **what / why** of the Phase 2 changes and the
**logical and functional inconsistencies** in the existing planning docs that
need to be reconciled before Phase 3 (training) starts.

---

## What Phase 2 delivers

| Area | Phase 1 state | Phase 2 state |
|---|---|---|
| BenchRunner | `MockBenchRunner` only | `MockBenchRunner` + `VeritasR1BenchRunner` (live OpenAI-compatible HTTP, errors loud until endpoint exists) |
| Third-party model adapters | `claude-sonnet-runner.ts` stub (was throwing) | **Removed.** Veritas-R1 is the only model the user-path runs against. |
| Embeddings | None | `Embedder` interface + `HashEmbedder` (dev) + `VoyageEmbedder` (production, voyage-3) |
| `findSimilar` | Lexical Jaccard | Cosine over inline L2-normalised vectors, with Jaccard fallback for un-embedded claims |
| Embedding storage | n/a | Inline on the `Claim` doc (`claim.embedding`) — single round-trip read, fits well under the 1 MiB Firestore doc cap |
| `addClaim` dedup | **BUG**: ran `getDocs(query(...))` inside `runTransaction` — illegal in the Firestore SDK. | Fixed: deterministic doc id `clm-<canonicalHash>` collapses dedup to a single `tx.get(ref)`. |
| `addContradiction` dedup | **BUG**: docstring claimed pair-key dedup but no lookup was actually performed. Two concurrent `addContradiction` calls on the same pair created two rows. | Fixed: deterministic id `ctd-<hash(pairKey)>` makes dedup real and transactional. |
| Retire cascade | Missing — `needsReview` field declared but never set. | `retireClaim` and `supersede` now flip `needsReview = true` on every claim whose `derivation.parentClaimIds` references the retired one (single-level cascade, idempotent). |
| Firestore index for cascade | Not present | `(projectId, derivation.parentClaimIds array-contains)` added to `firestore.indexes.json` |
| Integration tests | 4 cases | 10 cases — added embedding cosine ranking, lexical fallback, retire cascade, supersede cascade, deterministic-id contract, VeritasR1BenchRunner stub-fetch + loud-error |

### Files touched

```
src/lib/veritas/memory/embeddings/embedder.ts           NEW
src/lib/veritas/memory/embeddings/voyage-embedder.ts    NEW
src/lib/veritas/memory/embeddings/index.ts              NEW
src/lib/veritas/memory/schema.ts                        Claim.embedding inline field
src/lib/veritas/memory/ids.ts                           deterministicClaim/Contradiction id helpers
src/lib/veritas/memory/claim-graph.ts                   findSimilar cosine path, retire cascade
src/lib/veritas/memory/async-claim-graph.ts             embedder option, findSimilar passthrough
src/lib/veritas/memory/firestore/claim-graph.ts         bugfixes, embedder, cascade, deterministic ids
src/lib/veritas/memory/index.ts                         export embeddings barrel
src/lib/veritas/bench/adapters/veritas-r1-runner.ts     NEW
src/lib/veritas/bench/adapters/claude-sonnet-runner.ts  DELETED
src/lib/veritas/bench/adapters/index.ts                 dropped Claude export
src/lib/veritas/__tests__/integration.ts                +6 Phase 2 cases
firestore.indexes.json                                  +1 cascade index
```

### Phase 3 prerequisite — what's left for next phase

- [ ] Wire `VOYAGE_API_KEY` into the production claim-graph factory (currently
      passed through the `embedder` option — production wire-up call site
      still needs to read `process.env.VOYAGE_API_KEY` and choose between
      `VoyageEmbedder` and `HashEmbedder`).
- [ ] Set `baseUrl` for `VeritasR1BenchRunner` once the Phase 3 SFT cold-start
      lands and the model is served behind vLLM / SGLang / Modal. **No third
      party model adapter is wired** — this is the only path.
- [ ] Backfill embeddings for any claims persisted before Phase 2 ships (one
      bulk `embedBatch` job per project).
- [ ] Firebase emulator harness (`__tests__/firestore-emulator.ts`) — Phase 2
      is fully validated against the in-memory impl; live Firestore behaviour
      is enforced via the converter round-trip + the deterministic-id
      contract test, but a true end-to-end emulator suite is still a TODO.

---

## Plan critique — inconsistencies that must be reconciled before Phase 3

These came out of an end-to-end read of `veritas/README.md`,
`docs/FORGE_SAI_TRAINING_PLAN.md`, the schema (`memory/schema.ts`), and the
adapter source. They are **not Phase 2 blockers** — Phase 2 ships with all of
them flagged but unresolved — but every one of them needs a decision before
Phase 3 starts spending compute.

### 1. Two different base models claimed

| Source | Base model | Param count |
|---|---|---|
| `src/lib/veritas/README.md` | DeepSeek-R1-Distill-Qwen-14B | 14B |
| `docs/FORGE_SAI_TRAINING_PLAN.md` | Qwen-3.5 | 32B |

These imply different memory budgets, different LoRA rank choices, different
serving costs, and different distillation strategies (the DeepSeek distill is
already a reasoning-tuned checkpoint; Qwen-3.5 32B is a general base). Pick
**one** and update both docs before kicking off Phase 3 data prep.

> Recommendation: **DeepSeek-R1-Distill-Qwen-14B**.
> (a) The reasoning posterior is already in the weights — Phase 3 SFT is a
>     refinement, not a cold-start.
> (b) 14B fits a single H100 80GB at FP8 with batch room for the long
>     reasoning traces ForgeBench-Reason demands.
> (c) The DPO stage's KL anchor stays close to the same family that produced
>     the cold-start data, which improves preference-pair stability.

### 2. Two different budget figures

`docs/FORGE_SAI_TRAINING_PLAN.md` lists both **$1,900** (per-run estimate)
and **$320,000** (program-level) without making the relationship explicit.
Either:
  - "$1,900" is the cost of **one** SFT run and "$320K" is total program (data
    licensing + multiple training rounds + serving + headcount), in which
    case the doc needs a one-line table that breaks the $320K down so the
    delta is auditable.
  - Or the figures are stale from two different planning rounds and one of
    them is wrong.

> Recommendation: a 1-page **`docs/PHASE3_BUDGET.md`** that itemises every
> line item (compute hours × spot price, data licenses, eval harness, serving)
> so the per-run vs program totals are reconcilable line-by-line.

### 3. `pgvector` referenced inside a Firebase-only stack

The schema's `EmbeddingRef` doc-comment names `pgvector:veritas.claim_embeddings/<id>`
as a sample format, and `claim-graph.ts`'s old findSimilar comment said the
"in production… same interface is backed by Firestore (entity store) +
pgvector/Qdrant". But the rest of the project is Firebase-only (Firestore +
Auth + firebase-admin) — there is **no Postgres** in the stack and the user
has explicitly said to use Firebase, not Supabase.

Phase 2 sidesteps this by storing vectors **inline on the claim doc**
(within the 1 MiB cap, well under the practical claim count per project). For
Phase 3:
  - If Forge stays Firebase-only, drop the pgvector / Qdrant references from
    docs and schema comments.
  - If we ever exceed inline-vector practicality (10⁵+ claims/project), the
    natural next step on Firebase is **Vertex AI Vector Search** (it speaks
    GCP-native auth) or a sibling `veritasClaimEmbeddings` collection
    referenced by `embeddingRef`. Postgres is **not** the right answer for
    this stack.

### 4. Three different "Phase 3" definitions across docs

Three docs use the phrase "Phase 3" with three different scopes:
  1. **`veritas/README.md`** — "Phase 3 = SFT cold-start training of Veritas-R1"
  2. **`docs/FORGE_SAI_TRAINING_PLAN.md`** — "Phase 3 = data curation, then DPO"
  3. **`docs/FORGE_PHASES.md`** (program-level) — "Phase 3 = product launch"

These collide whenever someone says "let's start Phase 3". Phase 2 was
delayed by exactly this confusion (the user originally asked to "begin Phase
3" meaning "wire the live BenchRunner stage of Veritas Phase 2"). Adopt a
namespaced naming convention:
  - `veritas:phase-2`, `veritas:phase-3` for the Veritas track
  - `forge:phase-3` for product launch
  - `training:phase-3` for SFT/DPO if you want a third axis

Wire the convention into commit subjects, doc headers, and CI tags so it
stays consistent.

### 5. `claude-sonnet-runner.ts` vestigial wiring (resolved this phase)

The Phase 1 code shipped a Claude Sonnet bench-runner stub that threw
`"transport not implemented"`. It was kept as a placeholder while Veritas-R1
training was pending — but the user has been explicit: **no third-party model
adapters; Veritas-R1 is the only path**. Phase 2 deletes it. If at any point
a third-party comparator becomes desirable (for ablations only), revive it as
`bench/adapters/_comparators/` clearly outside the user-path.

### 6. `embeddingRef` vs inline `embedding` — single source of truth

The schema now has both:
  - `embeddingRef?: EmbeddingRef` (string pointer to an external store)
  - `embedding?: { vector, dim, modelId }` (inline)

Phase 2 reads from `embedding` and ignores `embeddingRef`. The two fields are
left side-by-side intentionally so a future migration to Vector Search can
populate `embeddingRef` without dropping inline values during the cutover.
**Once a vector-store migration is decided** (issue #TBD), one of the two
fields should be deprecated and removed in a follow-up phase to prevent
write-time confusion.

### 7. Self-supersede / dangling-ref defensive checks

The in-memory graph guards against `supersede(x, x)` and dangling references
in `addContradiction`. The Phase 2 Firestore graph mirrors both checks. The
plan docs do **not** mention these invariants — worth lifting them into the
schema doc so a future re-implementer in another language preserves them.

---

## Quick reference — design decisions baked into Phase 2

1. **Deterministic ids** for claims and contradictions. The grep-friendly
   suffix is dropped in favour of dedup correctness inside Firestore
   transactions. Random ids on the in-memory impl remain intact so Phase 1
   tests don't churn.
2. **Inline embeddings on the claim doc.** Easier transactional integrity,
   one round-trip reads, fits within Firestore limits at expected per-project
   scale. Sibling collection is the next architectural step if scale shifts.
3. **Cosine ranking with lexical fallback.** A claim without a vector still
   shows up in `findSimilar` results; pure-Jaccard score is multiplied by
   0.5 when a probe vector is available, so well-embedded matches always
   rank above un-embedded ones. Avoids a "results disappear during the
   embedding backfill" footgun.
4. **`VeritasR1BenchRunner` errors loudly** when no `baseUrl` is set rather
   than silently scoring 0. CI surfaces the missing deployment immediately.
5. **No mocks of the production model.** `MockBenchRunner` exists for CI
   smoke (oracle / zero / scripted modes) — it never pretends to be
   Veritas-R1, and the runner adapter list now reflects that explicitly.
