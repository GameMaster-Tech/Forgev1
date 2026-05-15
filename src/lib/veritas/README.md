# Veritas Runtime (TypeScript)

This is the **data-plane** code that runs inside the Forge Next.js app.
It is shared by API routes, server components, and background workers.

Training code (Python, Unsloth, TRL) lives in [`/veritas/training/`](../../../veritas/training/) at the repo root.

**Plan:** [`docs/VERITAS_TRAINING_PLAN_V2.md`](../../../docs/VERITAS_TRAINING_PLAN_V2.md) (locked CP1)
**Checkpoints:** [`docs/PHASE3_CHECKPOINTS.md`](../../../docs/PHASE3_CHECKPOINTS.md) (15-CP roadmap)
**Phase 2 implementation notes + plan critique:** [`PHASE2_NOTES.md`](./PHASE2_NOTES.md)

## Modules

| Module | Purpose |
|---|---|
| `memory/` | Claim graph, episode log, atomic-claim extractor, contradiction detection |
| `retrieval/` | Crossref, OpenAlex, arXiv, PubMed clients + DOI verification |
| `bench/` | ForgeBench-Reason auto-grader — callable from CI and from training eval loops |

## Import Rules

- All exports use named exports (no default exports).
- All types are exported alongside functions.
- Server-only modules (Firestore admin, fetch-heavy) must NOT be imported from `"use client"` components.
- Pure type-only modules (`schema.ts`) are safe everywhere.

## Surface as of CP1 (veritas:phase-3)

- **Schema v2** + in-memory `ClaimGraph` / `EpisodeLog`
- **Firestore adapters** with denormalised `ownerId`, deterministic ids for transactional dedup, retire cascade
- **Embeddings** — `Embedder` interface, `VoyageEmbedder` (production, voyage-3), `HashEmbedder` (dev fallback). Inline on the claim doc; cosine in `findSimilar` with lexical fallback.
- **Retrieval adapters** — Crossref, OpenAlex, arXiv, PubMed
- **ForgeBench-Reason** — 6 suites with auto-grader; `MockBenchRunner` (CI smoke) + `VeritasR1BenchRunner` (live OpenAI-compatible HTTP, errors loud until the trained endpoint is wired in CP14)

Nothing is routed to production UI yet — that ships at CP14 (Modal deployment + UI cutover).
