# Veritas — Phase 0 status

Phase 0 = the TypeScript substrate that everything downstream (training,
Firestore, UI) depends on. This file is the hand-off checkpoint.

## Shipped

### `memory/` (schema v2.1)
- `schema.ts` — Claim, ClaimLink (+ symmetric-type helper), Contradiction
  (+ statusHistory), Episode, MemorySnapshot, Entity, Topic, SourceRef
  (+ oaStatus), ThoughtTrace (+ narrowing helpers), ClaimScope,
  QuantitativeFact, ClaimEntityRef, ClaimDerivation, ExtractorSignature.
- `ids.ts` — prefix-scoped ids, ISO timestamps, ES2017-safe FNV-1a dual-seed
  `canonicalHash` (no BigInt).
- `claim-graph.ts` — in-memory ClaimGraph with dedup, topic/entity indices,
  supersede, contradiction lifecycle, lexical `findSimilar`.
- `claim-extractor.ts` — heuristic baseline; stamps every claim with
  `extractedBy` (name + version + timestamp) and `derivation.kind="extracted"`
  so Veritas-R1 can bulk-reprocess cleanly.
- `contradictions.ts` — scope-aware heuristic detector with six signals.
- `episodes.ts` — append-only episode log with search + thought-trace export.
- `index.ts` — barrel.

### `retrieval/`
- Federated search over Crossref / OpenAlex / arXiv / PubMed with DOI dedup
  and weighted reciprocal-rank fusion.
- DOI verifier with predatory-publisher seed list and retraction handling.

### `bench/` (ForgeBench-Reason)
- `types.ts` — discriminated task / response / grade union across six suites.
- `grader.ts` — pure per-suite graders with recall/precision/F1, decoy
  resistance, answer-similarity, length discipline, fabrication detection.
- `runner.ts` — async, concurrency-bounded, abortable.
- `fixtures.ts` — schema-complete fixture builders.
- `suites/` — 5 contra-detect + 3 memory-recall + 2 reasoning-chain +
  2 conversation + 2 citation + 2 abstention = 16 seed tasks.

### Verification
- `npx tsc --noEmit` — clean.
- `npx eslint src/lib/veritas` — clean.

## Deferred (Phase 1+)

- **Firestore wrapper** — `memory/firestore.ts` that mirrors the in-memory
  `ClaimGraph` interface against live collections, plus matching
  `firestore.rules` + `firestore.indexes.json` entries.
- **Python training scaffolding** — `veritas/training/configs/{sft,dpo,kto}.yaml`
  and Unsloth scripts. Not needed until Week 7.
- **Bench task pack expansion** — 16 seed tasks is enough to validate the
  harness; target is ≥ 200 tasks before SFT (Week 7) so regression detection
  is meaningful.

## How to run locally

```bash
# Typecheck everything
npx tsc --noEmit

# Lint the veritas surface
npx eslint src/lib/veritas

# (Once a runner adapter exists)
# import { runBench } from "@/lib/veritas/bench";
# import { ALL_TASKS } from "@/lib/veritas/bench/suites";
# const run = await runBench(ALL_TASKS, myRunner, { concurrency: 4 });
```

## Hand-off to Phase 1

1. Wire a `FirestoreClaimGraph` that satisfies the existing `ClaimGraph`
   interface — no call-site changes required.
2. Add a `@/lib/veritas/adapters/claude-sonnet.ts` `BenchRunner` so we can
   baseline today's capability before Veritas-R1 training starts.
3. Grow the bench pack to 200+ tasks (aim for 60 contra-detect, 40
   memory-recall, 40 reasoning-chain, 30 conversation, 20 citation,
   20 abstention).
