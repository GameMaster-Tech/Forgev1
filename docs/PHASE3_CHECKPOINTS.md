# Veritas Phase 3 — Checkpoints (revised 2026-04-26)

> Owner: Rakshit Khanna · Plan: [`VERITAS_TRAINING_PLAN_V2.md`](./VERITAS_TRAINING_PLAN_V2.md) · Datasets: [`CURATED_DATASETS.md`](./CURATED_DATASETS.md)

**Strategy change (2026-04-26):** Forge has zero production users. The training cold-start runs entirely off **curated public datasets** (see `CURATED_DATASETS.md`), staged smallest-first. CP2 (chat-template adapter) and CP4 (synthetic seed-data) are deferred — neither is on the critical path until we have user data or curated coverage gaps to fill.

## Active path

| # | Title | Compute? | Deliverable | Exit criteria |
|---|---|---|---|---|
| **1** | Decide model + technique, scaffold training package | ❌ | `VERITAS_TRAINING_PLAN_V2.md`, this file, `veritas/training/` skeleton, READMEs updated | ✅ done |
| ~~2~~ | ~~Qwen3 chat-template adapter (TS)~~ | ❌ | **ON HOLD** — not on critical path until Phase 4 continual learning produces real episodes that need TS-side rendering. Code already shipped in `src/lib/veritas/training-format/` — kept for forward use. | — |
| **3** | Curated dataset pipeline + Stage 0 smoke training | ✅ CPU | `CURATED_DATASETS.md`, `forge_veritas/train/sft.py`, `forge_veritas/eval/smoke_eval.py`. Stage 0 trains SmolLM2-135M on MATH-500 (50 rows) on CPU. | Smoke run completes; loss decreases monotonically over training; eval shows non-trivial output difference between base and adapter |
| ~~4~~ | ~~Synthetic seed-data generator~~ | ❌ | **ON HOLD** — pulled when curated stages 1-7 leave a measurable gap on ForgeBench-Reason (per CP12 ablation). Earliest activation point is CP12. | — |
| 5 | Pack + dedup SFT dataset | ❌ | `veritas/training/src/forge_veritas/data/pack.py` — token-counts each example, dedups by canonical hash, train/val split (95/5), writes `data/sft/{train,val}.parquet` | Sequence length p99 ≤ 16K; dedup rate logged; total token budget < 200M tokens |
| 6 | **SFT cold-start training run** | ✅ H100 ~18h | `veritas/training/src/forge_veritas/train/sft.py` — Unsloth + TRL `SFTTrainer`, QLoRA r=64 α=128, Liger Kernel. `out/sft-r64/` adapter checkpoint. | Loss curve smooth; eval-loss < train-loss + 0.1 (no overfit); adapter loads in vLLM |
| 7 | SFT eval against ForgeBench-Reason | ✅ H100 ~3h | `veritas/training/src/forge_veritas/eval/forgebench.py` — spins up vLLM, hits it via `VeritasR1BenchRunner` (TS) or Python equivalent, writes scoreboard | Average ≥ **0.55** across 6 suites; citation-resolves ≥ 0.85; no suite below 0.30 |
| 8 | Verifiable-reward env definitions | ❌ | `veritas/training/src/forge_veritas/rewards/` — `citation_resolves.py`, `citation_supports.py`, `abstention_calibration.py`, `contradiction_recall.py`, `format_strict.py`. Each is a pure function `(prompt, completion) -> reward ∈ [-1, 1]`. | Unit-tested on hand-rolled fixtures; gold/zero/random baselines score in expected ranges |
| 9 | **GRPO training run** | ✅ H100 ~36h | `veritas/training/src/forge_veritas/train/grpo.py` — TRL `GRPOTrainer`, 4 rollouts/prompt, KL=0.04. `out/grpo/` adapter checkpoint. | Reward curve trends up; KL stays < 0.5; eval rerun shows ≥ +0.10 over CP7 baseline |
| 10 | DPO preference extractor | ❌ | `veritas/training/src/forge_veritas/data/preferences.py` — pulls resolved contradictions, accept/reject episodes, citation-fail events from Firestore; emits `{prompt, chosen, rejected}` parquet | ≥5K real pairs (or augment-up-to-5K with synth from claim-graph); spot-check 20 pairs |
| 11 | **DPO training run** | ✅ H100 ~12h | `veritas/training/src/forge_veritas/train/dpo.py` — TRL `DPOTrainer`, β=0.1. `out/dpo/` adapter checkpoint. | DPO loss converges; reward-margin > 0; rerun ForgeBench |
| 12 | Final eval + ablation | ✅ H100 ~6h | Scoreboard comparing: base / SFT / SFT+GRPO / SFT+GRPO+DPO. Saved to `veritas/training/results/`. | Final stack ≥ **0.78** average; reject-rate-on-bad-citations ≥ 95% |
| 13 | vLLM serving config | ❌ | `veritas/training/serving/vllm.yaml` + `serving/Dockerfile`. AWQ-int4 quantised. OpenAI-compat `response_format: json_object`. | `VeritasR1BenchRunner` (TS) hits the local container with no code changes; throughput ≥ 30 tok/s on H100, ≥ 8 tok/s on L4 |
| 14 | Modal deployment | ❌ | `veritas/training/serving/modal_app.py` — `@modal.asgi_app` wrapping vLLM. `baseUrl` set in `.env.local`. | Cold-start ≤ 90s; warm latency ≤ 2s first-token in `lightning` mode; 99.9% uptime over 24h canary |
| 15 | Distillation → 3B (Lightning mode, post-beta) | ✅ H100 ~24h | `veritas/training/src/forge_veritas/train/distill.py` — KL distillation from 14B teacher to Qwen3-1.7B / 4B student. | Lightning latency target met (≤800ms first-token at 32K context); ForgeBench-Reason avg ≥ 0.65 (intentionally lower bar — Lightning trades depth for speed) |

---

## How to use this list

- **Branching:** one git branch per checkpoint, named `veritas/cp-N-<slug>` (e.g. `veritas/cp-2-chat-template`).
- **PR template:** the PR body must include the checkpoint number, the exit-criteria checklist (with passes), and a ForgeBench-Reason scoreboard delta if applicable.
- **No checkpoint is complete until its exit criteria pass on a fresh checkout.** Re-runnability is the bar.
- **Compute checkpoints run on rented spot.** Costs are itemised in §3 of the v2 plan.
- **Anything that goes wrong in a compute checkpoint** (loss spikes, reward hacking, OOM) gets its own *correction* checkpoint (e.g. CP6.1) before the next numbered checkpoint starts. Don't skip ahead.

---

## Dependency graph

```
CP1 ─┬─► CP2 ─► CP3 ─┐
     │                ├─► CP5 ─► CP6 ─► CP7 ─┐
     └────► CP4 ──────┘                      │
                                             ├─► CP8 ─► CP9 ─┐
                                             │               ├─► CP12 ─► CP13 ─► CP14 ─► CP15 (post-beta)
                                             └─► CP10 ─► CP11┘
```

CP4 (synthetic data) and CP3 (real-data export) run in parallel. CP8 (rewards) and CP10 (DPO data) run in parallel after CP7. Everything funnels into CP12.

---

## What CP1 looks like, fully unpacked

This is the checkpoint we are completing right now.

**Done:**
- [x] Pin base model: **Qwen3-14B** (justification in v2 plan §1)
- [x] Pin training pipeline: SFT → GRPO → DPO (justification in v2 plan §2)
- [x] Resolve all v1 plan inconsistencies (table in v2 plan §5)
- [x] Write `docs/VERITAS_TRAINING_PLAN_V2.md`
- [x] Write `docs/PHASE3_CHECKPOINTS.md` (this file)
- [x] Scaffold `veritas/training/` Python package with `pyproject.toml`, `README.md`, base config, `.gitignore`
- [x] Update `veritas/README.md` and `src/lib/veritas/README.md` to point at v2 plan
- [x] Verify `tsc --noEmit` + integration test 10/10 still green

**Exit criterion check:**
- TS clean ✅
- Integration test green ✅
- `veritas/training/pyproject.toml` parseable ✅
- READMEs link to v2 plan ✅

CP1 done. CP2 (chat-template adapter) is the next session.
