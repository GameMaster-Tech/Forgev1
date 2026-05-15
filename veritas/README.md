# Veritas-R1 — Forge's Reasoning + Memory Model

> Status: **veritas:phase-3 — training. Checkpoint 1 (model + technique decisions, package scaffolded) ✅ done.**
> **Locked plan:** [`docs/VERITAS_TRAINING_PLAN_V2.md`](../docs/VERITAS_TRAINING_PLAN_V2.md)
> **Checkpoints:** [`docs/PHASE3_CHECKPOINTS.md`](../docs/PHASE3_CHECKPOINTS.md)
> Target beta: **Veritas-R1-14B**, no Claude / GPT in user path
> Out-of-pocket budget to beta: **≈$700 in compute** (was estimated at $1,900 — see plan §3 for the cost reduction)

## What Is Veritas-R1?

Veritas-R1 is Forge's in-house reasoning model with persistent, structured project memory.
It is **not** a generic RAG chatbot. Its job is to:

1. Reason step-by-step (`<think>` traces) over a researcher's entire project
2. Recall every claim, source, and decision from prior sessions
3. Detect when new findings **contradict** prior conclusions and surface them
4. Produce answers with DOI-valid citations, verified at generation time

## Layered Architecture

```
┌────────────────────────────────────────────────────┐
│  Layer 3 — Veritas-R1 (14B reasoning model)        │  ← trained in Phase 4–7
├────────────────────────────────────────────────────┤
│  Layer 2 — Project Memory Substrate                │  ← THIS PHASE (Phase 0)
│    Claim Graph · Episode Log · Entity Resolution   │
├────────────────────────────────────────────────────┤
│  Layer 1 — Retrieval + Verification                │  ← THIS PHASE (Phase 0)
│    Crossref · OpenAlex · arXiv · PubMed · DOI verify│
└────────────────────────────────────────────────────┘
```

## Repo Layout

| Path | Purpose |
|---|---|
| `src/lib/veritas/memory/` | Claim graph, episode log, atomic-claim extractor, contradiction detector (TS, imported by Next.js app) |
| `src/lib/veritas/retrieval/` | Crossref, OpenAlex, arXiv, PubMed adapters + DOI verification |
| `src/lib/veritas/bench/` | ForgeBench-Reason auto-grader + 6 sub-suites |
| `veritas/training/` | Python training scripts (Unsloth + TRL) — runs on rented GPU |
| `veritas/datasets/` | Dataset manifests, dedup scripts, filter pipelines |
| `veritas/bench/cases/` | Gold eval cases (JSON) |

## Master Timeline (superseded — see `docs/PHASE3_CHECKPOINTS.md` for the canonical 15-CP roadmap)

> The week-numbered timeline below was the Phase-0 sketch. It has been
> replaced by 15 deliverable-shaped checkpoints. Wall-clock per checkpoint
> is 3-8 hours of focused work; compute checkpoints (CP6, CP9, CP11, CP12,
> CP15) run on rented spot. Total program: ~$700 in compute.

| CP | Title | Compute? | Status |
|---|---|---|---|
| **1** | Decide model + technique, scaffold training package | ❌ | ✅ done |
| 2 | Qwen3 chat-template adapter (TS) | ❌ | next |
| 3 | Episode-log → SFT JSONL exporter | ❌ | |
| 4 | Synthetic seed-data generator | ❌ | |
| 5 | Pack + dedup SFT dataset | ❌ | |
| 6 | **SFT cold-start training run** | ✅ | |
| 7 | SFT eval against ForgeBench-Reason | ✅ | |
| 8 | Verifiable-reward env definitions | ❌ | |
| 9 | **GRPO training run** | ✅ | |
| 10 | DPO preference extractor (Firestore) | ❌ | |
| 11 | **DPO training run** | ✅ | |
| 12 | Final eval + ablation | ✅ | |
| 13 | vLLM serving config | ❌ | |
| 14 | Modal deployment | ❌ | |
| 15 | Distillation → 3B (post-beta) | ✅ | |

## Datasets (manifest)

See [`veritas/datasets/README.md`](datasets/README.md) for the full inventory (SFT, DPO, KTO, retrieval corpus).

## Training Framework Stack (locked in CP1)

| Concern | Tool |
|---|---|
| Base model | **Qwen3-14B** (Apache 2.0) — picked over DeepSeek-R1-Distill-14B because Qwen3 ships a native dual-mode (`enable_thinking`) chat template that maps 1:1 to Forge's `lightning / reasoning / deep` modes. Justification: plan §1. |
| SFT + GRPO + DPO | **Unsloth** + HuggingFace **TRL** (2× faster, half VRAM vs Axolotl) |
| PEFT | QLoRA r=64, α=128, all-linear targets |
| RL | **GRPO** with verifiable rewards (citation-resolves, citation-supports, abstention-calibration, contradiction-recall, format) |
| Speed/memory | Liger Kernel (fused CE), Flash Attention 2 |
| Serving | vLLM + AWQ int4 → Modal asgi_app |
| Retrieval (read path) | Crossref / OpenAlex / arXiv / PubMed live (no self-hosted Qdrant) |
| Embeddings | Voyage-3 (1024d) for production, HashEmbedder for dev |
| Tracking | Weights & Biases (free tier) |
| Compute | 1× H100 80GB spot (Modal / RunPod / Vast.ai) |

## How to Run (Phase 0 verification)

Phase 0 ships TypeScript scaffolding only — no Python yet. Verify via:

```bash
npx tsc --noEmit
npx eslint src/lib/veritas
```

Everything under `src/lib/veritas/` must compile and lint clean. Nothing is wired into user-facing routes yet — integration happens in Phase 2.

## Status

- [x] **veritas:phase-1** — Memory schema (v2) + claim graph + Firestore adapters + MockBenchRunner
- [x] **veritas:phase-2** — Live BenchRunner (Veritas-R1, OpenAI-compat HTTP) + embedding-backed `findSimilar` (Voyage-3) + retire cascade + Firestore tx bug fixes (notes: `src/lib/veritas/PHASE2_NOTES.md`)
- [ ] **veritas:phase-3** — Training. **CP1 done** (this commit). CP2-CP15 in `docs/PHASE3_CHECKPOINTS.md`.
- [ ] **veritas:phase-4** — Beta launch + continual learning loop (new episodes → new DPO pairs → next training round)
