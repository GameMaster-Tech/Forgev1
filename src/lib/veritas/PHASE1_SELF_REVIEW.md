# Veritas Phase 1 — Self-Review

**Status:** complete. `tsc --noEmit` and `eslint src/lib/veritas/` both exit 0.
Integration test (`src/lib/veritas/__tests__/integration.ts`) passes all 4
cases under `tsx`.

---

## 1. What shipped

### 1.1 Async interfaces

| File | Purpose |
|---|---|
| `memory/async-claim-graph.ts` | `AsyncClaimGraph` interface + `asAsyncClaimGraph()` wrapper + `createInMemoryAsyncClaimGraph()` |
| `memory/async-episode-log.ts` | `AsyncEpisodeLog` interface + `asAsyncEpisodeLog()` wrapper + `createInMemoryAsyncEpisodeLog()` |

**Why a parallel interface, not a single async one:** hot paths (contradiction
detection, bench-runner fixtures) do thousands of reads per episode. Forcing
them through promises would waste microtasks on the in-memory reference impl.
Semantics must match step-for-step — divergence is a bug in the impl, not the
interface.

### 1.2 Firestore adapters

| File | Purpose |
|---|---|
| `memory/firestore/collections.ts` | `VERITAS_COLLECTIONS` const — 7 root collection names |
| `memory/firestore/converters.ts` | domain ↔ doc converters + `stripUndefined` |
| `memory/firestore/claim-graph.ts` | `createFirestoreClaimGraph()` — `AsyncClaimGraph` impl |
| `memory/firestore/episode-log.ts` | `createFirestoreEpisodeLog()` — `AsyncEpisodeLog` impl |
| `memory/firestore/index.ts` | barrel |

**Key invariants enforced:**

1. **`ownerId` denormalised on every write** (`{…doc, ownerId}`) so rules do
   `resource.data.ownerId == request.auth.uid` in O(1) without `get()`
   traversals. Stripped on read.
2. **`projectId` present on every write** — rules require `is string`, queries
   scope by it.
3. **`undefined` never crosses the wire.** `stripUndefined()` recursively
   scrubs undefineds while preserving `null`, `[]`, and `{}` (they carry
   meaning).
4. **Dedup + supersede + contradiction lifecycle run inside
   `runTransaction`.** Dedup reads the hash lookup inside the tx; supersede
   touches both endpoints atomically; `addContradiction` verifies both
   referenced claims exist before committing.
5. **Flat root collections, not subcollections.** Enables `collectionGroup`
   queries for future cross-project training-data sampling, keeps rules flat,
   keeps indexes simple.
6. **Pair-dedup for contradictions** via `canonicalPairKey(a,b,detector)` so
   `(a,b)` and `(b,a)` collapse; enforced client-side inside the transaction.

### 1.3 Security rules + indexes

- **`firestore.rules`** — added 7 `veritas*` blocks using two helpers:
  `veritasCreate()` (enforces `ownerId == auth.uid` and `projectId is string`
  on writes) and `veritasAccess()` (enforces `ownerId == auth.uid` on
  read/update/delete). Snapshots are create-only (immutable).
- **`firestore.indexes.json`** — 17 new composite indexes across the 4
  queryable veritas collections, each one paired to a concrete adapter query.

### 1.4 BenchRunner adapters

| File | Purpose |
|---|---|
| `bench/adapters/mock-runner.ts` | `MockBenchRunner` with `oracle` / `zero` / `scripted` modes |
| `bench/adapters/claude-sonnet-runner.ts` | `ClaudeSonnetBenchRunner` stub — prompt renderer ready, transport deliberately stubbed |
| `bench/adapters/index.ts` | barrel |

**Why the stub:**
- `MockBenchRunner(oracle)` lets CI exercise the full `runBench → gradeTask →
  summariseSuite` pipeline without any network; oracle returns the exact
  `expected` shape so grade ≈ 1.0.
- `MockBenchRunner(zero)` returns the worst *legal* answer per suite so we
  test the grader's failure paths too.
- `ClaudeSonnetBenchRunner.renderPrompt()` is final — tests can inspect the
  rendered prompt without a key. `run()` intentionally throws a labelled
  error until Phase 2 wires transport, so misconfiguration surfaces as an
  error rather than silent zero-scores.

### 1.5 Integration test

`src/lib/veritas/__tests__/integration.ts` — 4 self-contained test cases,
zero-dep (only `node:assert/strict`):

1. **AsyncClaimGraph round-trip** — add / dedup / supersede / contradiction
   open→resolve / links.
2. **AsyncEpisodeLog round-trip** — append / chronological list / recent
   (newest-first) / ofType / forClaim / search / clear.
3. **Firestore converters round-trip** — every schema type: `claim`, `link`,
   `contradiction`, `episode` round-trip preserves domain shape; `ownerId`
   injected on write, stripped on read; `stripUndefined` spec.
4. **MockBenchRunner pipeline** — oracle passes every task and scores ~1.0,
   zero fails every task, neither produces malformed responses.

Run: `npx tsx src/lib/veritas/__tests__/integration.ts` → exit 0.

---

## 2. Invariants worth repeating

- **`Claim.canonicalHash` is the dedup key.** Never change how it's computed
  without a migration plan — we'd duplicate millions of claims.
- **`Contradiction.statusHistory` is append-only.** It's the highest-signal
  DPO training source; never mutate entries in place.
- **`ownerId` is adapter-private.** Domain types don't declare it; converters
  are the only surface that know about it. If code outside
  `memory/firestore/` ever reads `.ownerId`, it's a leak.
- **Every query in the Firestore adapters maps to a composite index** in
  `firestore.indexes.json`. Adding a new query without an index is a
  production outage.

---

## 3. Not shipped (deferred to Phase 2)

1. **Live transport for `ClaudeSonnetBenchRunner`.** Stub throws a labelled
   error when `apiKey` is absent. Phase 2 wires the Anthropic
   `/v1/messages` call using `opts.fetchImpl` (or global fetch) + structured
   JSON extraction with a retry on JSON-parse failure.
2. **pgvector / Qdrant-backed `findSimilar`.** Current impl is Jaccard
   token overlap. Phase 2 should add an embedding-backed index and keep
   the Jaccard path as a fallback for offline/dev.
3. **Firebase emulator harness.** The integration test exercises the in-
   memory async shape and the converter round-trip (pure functions), which
   covers every piece of adapter logic that's testable without a live
   Firestore. A follow-up task should add `firebase-tools`-based emulator
   tests against the real rules — that's the only thing that proves the
   rules actually deny unauthorised reads.
4. **Retire cascade.** `retireClaim` currently flips the flag only. A
   derivation-aware retire would flip every descendant's `needsReview` to
   `true`. Schema supports it (`ClaimDerivation.parentClaimIds`); impl is
   Phase 2.

---

## 4. Open questions for review

- **Contradiction pair dedup is client-side inside a transaction.** A race
  between two clients could create duplicates. Should we also back it with
  a uniqueness enforcement via a pre-known doc id of `con-<pairKey>`?
  Tradeoff: we lose the generated id space for contradictions.
- **Episode `forClaim` runs 3 parallel `array-contains` queries.** Works
  cleanly but burns 3 index hits per call. Worth considering a single
  denormalised `allClaimIds` array field.
- **`MockBenchRunner(scripted)` throws on missing task id.** Should it
  fall back to `oracle` instead? Current behaviour favours explicit.

---

## 5. Verification commands

```bash
# Typecheck
npx tsc --noEmit

# Lint
npx eslint src/lib/veritas/

# Integration test
npx tsx src/lib/veritas/__tests__/integration.ts
```

All three green as of Phase 1 sign-off.
