# Veritas-R1 — Training Plan v2 (FINAL)

> Status: **Locked. This document supersedes both `docs/FORGE_SAI_TRAINING_PLAN.md` and the timeline in `veritas/README.md`.**
> Owner: Rakshit Khanna
> Date: 2026-04-25
> Phase: kicks off **veritas:phase-3** (training).

---

## 0. TL;DR

1. **Base model:** **Qwen3-14B** (Apache-2.0, dense, native dual-mode chat template).
2. **Why this base, not the others:** Qwen3-14B is the **only** mid-size open base whose chat template ships a native `enable_thinking` flag — `<think>…</think>` for deep research, plain assistant turns for conversational mode. One model, two modes. That maps 1:1 to Forge's `lightning | reasoning | deep` UI and to the `ThoughtTrace.steps` schema we already persist. Both prior candidates (Qwen-3.5-32B-Reasoning and DeepSeek-R1-Distill-Qwen-14B) are *reasoning-only* — they think when you don't want them to and waste tokens on chitchat.
3. **Training recipe:** **SFT cold-start → GRPO (verifiable rewards) → DPO** (preferences from real Firestore data) → **optional distillation to 3B** for Lightning mode after beta.
4. **Compute envelope:** 1× H100 80GB spot (Modal / RunPod / Vast.ai). All four stages fit in **<$2,000 in compute**, consistent with the founder-budget constraint in `veritas/README.md`. The $180K-$1.1M numbers in `docs/FORGE_SAI_TRAINING_PLAN.md` are correct for the *32B + retrieval-index + multi-engineer* version of this product. We are not building that. We are building Forge SAI-14B-Single, and the budget reflects it.
5. **Roadmap:** **15 short checkpoints** in `docs/PHASE3_CHECKPOINTS.md`. Checkpoint 1 (this commit) finalises the decision and scaffolds the training package. Checkpoints 2-7 are data + SFT. Checkpoints 8-11 are RL + DPO. Checkpoints 12-15 are eval + deployment.

---

## 1. Why Qwen3-14B (and not the alternatives)

### What "conversational + deep research with complex reasoning" actually demands
- **Mode toggle without a model swap.** A user asking "what's the deadline?" should not get a 4,000-token reasoning trace. A user asking "synthesise the last 12 papers in my project" must get one. The model must support both within a single inference server.
- **Reasoning trace shape we already persist.** The `ThoughtTrace.steps` schema (`memory/schema.ts`) emits `think | recall | retrieve | verify | tool-call | decide | answer` steps. Qwen3's `<think>` block round-trips cleanly into the `think` step kind — zero glue code.
- **128K context for whole-project recall.** Forge's claim graph + episode log can run hundreds of thousands of tokens for a long-running project. The base must support this without YaRN tricks at training time.
- **Tool/function calling out-of-box.** We need `retrieve`, `verify-citation`, `check-claims` to feel native. Qwen3 has the standard tool-call chat template; the others require custom prompt engineering.
- **Apache-2.0 license.** No downstream license risk for Forge users.

### Comparison table (April 2026 candidates)

| Candidate | Params | Chat template thinking-mode | Tool-call template | Context | License | Conversational quality* | Verdict |
|---|---:|---:|---:|---:|---:|---:|---|
| **Qwen3-14B** | 14B | ✅ `enable_thinking` flag | ✅ native | 128K | Apache-2.0 | strong | **PICK** |
| Qwen3-8B | 8B | ✅ same flag | ✅ native | 128K | Apache-2.0 | strong | fallback if H100 unavailable |
| Qwen3-30B-A3B (MoE) | 30B (3B active) | ✅ | ✅ | 128K | Apache-2.0 | strong | rejected: MoE serving cost |
| Qwen-3.5-Reasoning-32B | 32B | ❌ reasoning-only | ✅ | 128K | Apache-2.0 | medium (always thinks) | rejected: budget + dual-mode |
| DeepSeek-R1-Distill-Qwen-14B | 14B | ❌ reasoning-only | partial | 128K | Apache-2.0 | weak (distill artifacts) | rejected: conversational quality |
| Llama-3.3-8B-Instruct | 8B | ❌ no native think | ✅ | 128K | Llama custom | strong | rejected: license + no thinking |
| OLMo-3-Think 32B | 32B | ✅ partial | ✅ | 65K | Apache-2.0 | medium | rejected: shorter context, larger |
| GLM-5 Reasoning 355B | 355B (active ?) | ✅ | ✅ | 128K | open | strong | rejected: serving cost |

*Conversational quality is qualitative — based on side-by-side eval on Forge's `check-claims` task and 50 sampled MT-Bench prompts.

### The thing that decides it: dual-mode

Forge already exposes three UI modes (`lightning | reasoning | deep`). We can wire them straight to Qwen3-14B as:

| Forge mode | `enable_thinking` | `max_tokens` | Notes |
|---|---|---:|---|
| `lightning` | `false` | 512 | Snappy chat. <2s first token. |
| `reasoning` | `true` | 4096 | Standard ForgeBench-Reason path. |
| `deep` | `true` | 16384 | Long synthesis with full episode + claim recall. |

Every other 14B base would force us to ship two distinct fine-tunes (one chat, one reasoning) and route between them at request time. That's 2× the training cost, 2× the serving footprint, and a worse UX. The dual-mode template eliminates the choice.

---

## 2. Training pipeline — what we run, in order

### Stage 1 — SFT cold-start (Checkpoints 4-7)

**Goal:** teach the base model the Forge schemas — `ThoughtTrace`, claim citations, scope-aware abstention, contradiction tagging.

- **Framework:** **Unsloth** (~2× speedup, half-VRAM vs raw HF) + **TRL** `SFTTrainer`.
- **PEFT:** **QLoRA**, rank 64, alpha 128, 4-bit NF4 base. Targets all linear layers.
- **Liger Kernel** for fused cross-entropy — saves ~4 GB on 14B.
- **Sequence length:** train at 16K, serve at 128K via the model's native YaRN config (Qwen3 ships YaRN settings in `config.json` — no extra rope-scaling work needed).
- **Dataset size target:** 25-50K SFT examples — half synthesised from claim-graph fixtures, half cleaned from real Forge episode logs (production data with PII scrubbed).
- **Format:** Qwen3 chat template, `<think>…</think>` for the reasoning trace, claim citations rendered as `[clm-<hash>]` inline tokens. Round-tripped to `ThoughtTrace.steps` post-decoding.
- **Loss:** standard CE on assistant tokens only. `<think>` tokens are weighted 1.0 (we want fluent reasoning); `[clm-...]` citation tokens are weighted 1.5 (citation grounding is the product's value prop).

**Exit criterion:** ForgeBench-Reason average ≥ 0.55. Ungoverned base scores ~0.30; we expect SFT to land in 0.55-0.65 before any RL.

### Stage 2 — GRPO with verifiable rewards (Checkpoints 8-9)

**Goal:** teach the model to *prefer* citations that resolve, *prefer* abstention when evidence is thin, *prefer* flagging contradictions instead of papering over them. These are all programmatically verifiable, which is exactly what GRPO eats.

- **Algorithm:** **GRPO** (DeepSeek-R1's RL variant — group-relative advantage, no value model, no PPO clip rebuild). Cheap on memory; the LoRA adapter from Stage 1 is the policy; we keep a frozen reference policy for KL.
- **Reward functions** (each returns a scalar in [-1, 1]; final reward is a weighted sum):
  | Reward | Implementation | Weight |
  |---|---|---:|
  | `citation-resolves` | DOI verifier (already built in `retrieval/`) — does each cited DOI resolve to a real source? | 0.30 |
  | `citation-supports` | Embedder cosine between cited source's quote and the claim — does the cite actually support the assertion? | 0.30 |
  | `abstention-calibration` | Brier-style on `mustAbstain` tasks — penalise overconfidence when the answer isn't in context | 0.20 |
  | `contradiction-recall` | F1 on flagged pairs vs gold contradictions | 0.10 |
  | `format` | Strict JSON-shape pass/fail per ForgeBench suite | 0.10 |
- **Sampler:** 4 rollouts per prompt, temperature 0.7 for exploration, top_p 0.95.
- **KL coefficient:** 0.04 (low — we want exploration; the SFT-anchored prior is strong enough on format).

**Exit criterion:** ForgeBench-Reason average ≥ 0.70 with citation-resolves ≥ 0.95.

### Stage 3 — DPO on real preference data (Checkpoints 10-11)

**Goal:** align with how *researchers actually use Forge*. The previous stage uses programmatic rewards; this stage uses real human signals from Firestore.

- **Algorithm:** **DPO** (β=0.1). Could swap for KTO if pair-wise data is too sparse; the architecture supports both — `trl.DPOTrainer` and `trl.KTOTrainer` are interchangeable here.
- **Preference data — pulled from Firestore by the exporter in CP10:**
  | Source | Chosen | Rejected |
  |---|---|---|
  | Resolved contradictions (`status: resolved-a-wins / b-wins`) | the surviving claim | the retired claim |
  | Episode `accept` events | the accepted answer | a stochastically sampled alternative from the same episode's reasoning trace |
  | Episode `reject` events | a re-asked answer | the original rejected answer |
  | Citation challenges | answer where every cited DOI resolved | answer where ≥1 DOI failed verify |
- **Volume target:** 5-10K real preference pairs — augmented with 10K synthetic pairs from contradiction-fixture rollouts to bootstrap the early run.

**Exit criterion:** ForgeBench-Reason average ≥ 0.78 *and* `reject-rate-on-bad-citations` ≥ 95%.

### Stage 4 — (optional, post-beta) distillation → 3B for Lightning

- Teacher: full Veritas-R1-14B. Student: Qwen3-1.7B or Qwen3-4B.
- KL distillation on a 100K-prompt dataset of real Lightning-mode requests sampled in beta.
- Goal: <800ms first-token at 32K context for chat-mode-only requests.
- This stage does **not** block beta launch.

---

## 3. Compute, scheduling, & cost

| Stage | Hardware | Wall-clock | $/hr* | Stage cost |
|---|---|---:|---:|---:|
| Data prep + tokenise | CPU box | 20 h | $0.50 | $10 |
| SFT cold-start | 1× H100 80GB spot | 18 h | $2.50 | $45 |
| GRPO | 1× H100 80GB spot | 36 h | $2.50 | $90 |
| DPO | 1× H100 80GB spot | 12 h | $2.50 | $30 |
| Eval + ablation runs | 1× H100 spot | 30 h | $2.50 | $75 |
| Buffer / debugging | — | — | — | $250 |
| Distillation (post-beta) | 1× H100 spot | 24 h | $2.50 | $60 |
| Beta serving (vLLM AWQ-int4 on Modal) | T4 / L4 burst | ~50 h/mo | $0.40 | $20/mo |
| **Total to beta** | | | | **≈$500** |
| **Total program (incl. distill + 3 mo serving)** | | | | **≈$700** |

*Spot prices at Modal/RunPod/Vast.ai as of 2026-04. Even with 50% slippage we land well under the original $1,900 envelope.

---

## 4. What this plan deliberately does NOT include

These were in the larger `docs/FORGE_SAI_TRAINING_PLAN.md` and have been **explicitly de-scoped** for the founder-budget version of Forge SAI. Each is listed with the cheaper substitute we ship instead.

| De-scoped item | Substitute |
|---|---|
| Continued pre-training on a scientific corpus | Skipped — Qwen3-14B's pretraining is already strong on academic text. We'd need 200B+ tokens to move the needle and that's a $200K+ run. |
| 200M-paper hybrid retrieval index (BM25 + SPLADE + ColBERT) | The existing Crossref / OpenAlex / arXiv / PubMed adapters in `src/lib/veritas/retrieval/`. Live APIs, not a self-hosted index. |
| 32B Reasoning model and 671B MoE Deep model | Single Qwen3-14B with mode toggle. |
| Multiple eval harnesses | Just ForgeBench-Reason via `VeritasR1BenchRunner` (Phase 2). |
| Constrained decoding for hard-bound citations | Soft constraint via the `citation-supports` GRPO reward. We can layer hard constraints later if leakage shows up in eval. |

If/when Forge raises and we want to scale to the bigger plan, the path is **Qwen3-30B-A3B → CPT → SFT → DPO** — not "rebuild from scratch." Everything in this v2 plan is forward-compatible.

---

## 5. Plan v1 inconsistencies — resolved

These were called out in `src/lib/veritas/PHASE2_NOTES.md`. Resolutions:

| Issue | Resolution |
|---|---|
| Two base models (DeepSeek-R1-Distill-14B vs Qwen-3.5-32B) | **Qwen3-14B** — neither prior candidate. Justification above. |
| Two budgets ($1,900 vs $320K) | **~$700** to beta, **~$2K** including distillation and 3 months of serving. The $320K plan was for a 32B + retrieval-index version we've explicitly de-scoped. |
| `pgvector` references in a Firebase-only stack | Removed. Embeddings are inline on the claim doc (Phase 2 schema change). If we ever exceed inline-vector practicality the answer is **Vertex AI Vector Search**, not Postgres. |
| Three "Phase 3" definitions across docs | Adopted namespaced naming: **`veritas:phase-3`** = training (this plan), **`forge:phase-3`** = product launch, **`training:phase-3`** = SFT-vs-DPO-vs-RLVR if a third axis is ever needed. |
| `claude-sonnet-runner.ts` placeholder | Deleted in Phase 2. No third-party model in the user path. |

---

## 6. What ships this checkpoint (CP1)

- This document.
- `docs/PHASE3_CHECKPOINTS.md` — the 15-checkpoint roadmap.
- `veritas/training/` package skeleton (Python).
- Updated `veritas/README.md` and `src/lib/veritas/README.md` pointing at the v2 plan.
- TS still green (`tsc --noEmit` + integration test 10/10).

The next checkpoint (CP2) implements the Qwen3 chat-template adapter that round-trips `ThoughtTrace.steps` ↔ `<think>` blocks. After CP2, every checkpoint either ships a script that produces data, runs training, or runs eval — and each one is independently green-able.
