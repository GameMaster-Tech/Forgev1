# Veritas-R1 — Curated Cold-Start Datasets (workspace curriculum)

> Owner: Rakshit Khanna · Locked: 2026-04-26 · Plan: [`VERITAS_TRAINING_PLAN_V2.md`](./VERITAS_TRAINING_PLAN_V2.md)

This is the canonical inventory of public datasets used to cold-start
Veritas-R1. It supersedes every prior draft.

**Reframe (locked).** Forge is an **AI-powered workspace** — the AI lives
inside writing, search, organising, planning, and reasoning across
projects. Verification is *one feature*, not the identity. The dataset
mix accordingly leans heavily on **general workspace assistance** with
reasoning, tool-use, and contradiction as supporting skills.

---

## 0. Hard requirements (every dataset on this list satisfies all)

1. **License compatible with commercial training** — Apache-2.0, MIT,
   ODC-BY, CC-BY-4.0, NVIDIA OSS, public domain. NC / NoDerivs disqualify.
2. **Released or refreshed 2024-2026** — fresh signal.
3. **Pure-function adapter** in `forge_veritas/data/curated_adapters.py`.
4. **Targets a specific Forge skill OR a known weakness of the base model.**

---

## 1. The list — 250K total, workspace-first

| # | Skill | Dataset | License | HF id | Train | Val | Test |
|---|---|---|---|---|---:|---:|---:|
| 1 | **General workspace assistance** (write / edit / summarise / chat) | SmolTalk-2 | Apache-2.0 | `HuggingFaceTB/smol-talk-2` | 60,000 | 1,000 | 1,000 |
| 2 | **Modern instruction tuning** (the AI2 mix that built Tulu 3) | Tulu-3-SFT | ODC-BY | `allenai/tulu-3-sft-mixture` | 30,000 | 500 | 500 |
| 3 | **Reasoning + `<think>` traces** (DeepSeek-R1 distilled) | OpenThoughts-114k | Apache-2.0 | `open-thoughts/OpenThoughts-114k` | 80,000 | 1,500 | 1,500 |
| 4 | **Persistent memory** (multi-hop QA — closest open proxy for `memory_recall`) | 2WikiMultiHopQA | Apache-2.0 | `bdsaglam/2wikimultihopqa` | 25,000 | 300 | 300 |
| 5 | **Logical reasoning** (the weakest Qwen3-1.7B benchmark) | LogiQA 2.0 + FOLIO | Apache-2.0 / MIT | `datatab/logiqa-2.0`, `yale-nlp/FOLIO` | 15,000 | 500 | 500 |
| 6 | **Tool use** (`memory_recall` / `retrieve` / `verify_citation`) | Hermes Function Calling v1 | Apache-2.0 | `NousResearch/hermes-function-calling-v1` | 11,000 | 100 | 100 |
| 7 | **Research grounding + citation** | PubMedQA labeled | MIT | `bigbio/pubmed_qa` (config `pubmed_qa_labeled_fold0_source`) | 10,000 | 200 | 200 |
| 8 | **Contradiction detection** (a feature, not the identity) | Vitamin-C | MIT | `tals/vitaminc` | 15,000 | 500 | 500 |
| **Total** | | | | | **246,000** | **4,600** | **4,600** |

≈ **250K examples** total — about 5× the previous "Vitamin-C only"
plan and aligned with the empirical scaling literature for 1.7B-class
SFT cold-start (HuggingFace Zephyr ≈ 200K, Tulu-3 ≈ 939K, OpenHermes
≈ 1M; we sit at the productive low-end of that range).

**Why these eight, not others.**
- *SmolTalk-2 + Tulu-3-SFT* together cover the **workspace generalist**
  surface (write, edit, summarise, follow instructions, hold a multi-turn
  conversation). This is the part previous drafts under-weighted.
- *OpenThoughts-114k* is the open analogue of DeepSeek-R1's SFT data —
  has the `<think>` markers Forge needs for `reasoning` + `deep` mode.
- *2WikiMultiHopQA* is the closest open proxy for `memory_recall`
  (multi-hop reasoning trains "remember-fact-A-then-use-it-with-fact-B").
- *LogiQA 2.0 + FOLIO* are the **direct fix** for Qwen3-1.7B's lowest
  benchmark — formal logical reasoning at ~30 zero-shot.
- *Hermes-FC* trains the actual tool surface Forge runtime exposes.
- *PubMedQA* + *Vitamin-C* keep the verification skills sharp without
  dominating the mix.

---

## 2. Base model — Qwen3-1.7B-Instruct

Same family as the production Qwen3-14B target, native dual-mode chat
template (`enable_thinking` flag), fits Kaggle T4 16 GB with QLoRA-r=16
+ batch 8 at seq 512. Recipe transfers 1:1 to the H100 production run.

---

## 3. Stage-by-stage training pipeline (Meta-aligned)

Updated to use **Meta's 2024-2026 best practices** in place of the older
DPO recipe.

### Stage 1 — SFT cold-start (Kaggle, ~5 hours per seed)

`kaggle/notebooks/veritas-stage1-train.ipynb` runs:
- Multi-task curriculum (8 datasets above) packed via the per-source
  adapters in `forge_veritas/data/curated_adapters.py`.
- QLoRA r=16, dropout 0.15, weight decay 0.05 on linear layers.
- **R-Drop** (Liang 2021) — two stochastic forwards + symmetric KL.
- **Layer-wise LR decay** (LLRD, Howard 2018) — 0.9 per layer.
- **NEFTune α=5** (Jain 2023, used in Llama 3.1 post-training).
- Cosine LR with 5% warmup, early-stop on val NLL (patience 2).
- 3-seed ensemble (17, 23, 29) for downstream calibration.

### Stage 1.5 — Synthetic-paraphrase augmentation (optional, Meta-style)

`kaggle/notebooks/veritas-stage1-augment.ipynb` — uses the Stage-1
SFT'd checkpoint as a paraphraser to generate ~25% extra training
examples (rephrasing prompts only; targets are kept intact). Mirrors
Llama 3.1's "synthesise-then-filter" approach at small scale.

### Stage 2 — Verifiable-reward RL (GRPO)

`kaggle/notebooks/veritas-stage2-grpo.ipynb` (later phase) — DeepSeek-R1
style RL with five verifiable rewards: citation-resolves, citation-
supports, abstention-calibration, contradiction-recall, format-strict.

### Stage 3 — **Iterative SimPO** (replaces planned DPO; this is the Meta upgrade)

`kaggle/notebooks/veritas-stage3-simpo.ipynb` runs **3 iterative rounds**
of **SimPO** (Meng et al. 2024, used in Llama 3.1 post-training).

Why SimPO over DPO:
| Concern | DPO | **SimPO** |
|---|---|---|
| Reference model | required | **none** — saves ~50% GPU memory |
| Length normalisation | none (length bias) | **built-in** |
| Margin term | implicit | **explicit `γ` hyperparameter** |
| Compute per step | 4× forward (policy + ref, ×2) | **2× forward** (policy only, ×2) |
| AlpacaEval2 / Arena-Hard / MT-Bench | baseline | **+3-7 pts over DPO** |

Why iterative (3 rounds):
- Llama 3.1 paper §4: 3 rounds of preference optimisation on freshly-
  sampled outputs from each previous checkpoint beat single-pass DPO by
  4-7 points on Arena-Hard.
- Each round generates fresh `(prompt, chosen, rejected)` pairs from
  the current best checkpoint, then trains. Costs ~3× single-pass but
  matches the recipe that produced Llama 3.1 Instruct.

### Stage 4 — Eval + calibration

`kaggle/notebooks/veritas-stage1-eval.ipynb` + `veritas-stage1-temperature.ipynb`
do per-seed temperature scaling, ECE-15, Brier, reliability diagram,
selective-prediction curve, and prob-space ensemble averaging.

---

## 4. Compute budget (Kaggle T4×2 free tier)

| Phase | Wall-clock | Sessions |
|---|---:|---:|
| Stage 1 SFT (single seed, 200K rows × 2 epochs, batch 8 @ seq 512) | ~5 h | 1 |
| Stage 1 ensemble (3 seeds) | ~15 h | 2-3 sessions |
| Stage 1.5 augmentation (optional) | ~3 h | 1 |
| Stage 3 iterative SimPO (3 rounds × ~3 h each) | ~9 h | 1-2 |
| **Total — to a calibrated Stage-3 checkpoint** | **~27 h** | within Kaggle's 30 h/week |

---

## 5. What this list deliberately excludes

| Excluded | Why |
|---|---|
| MATH-500 | Not a Forge skill; replaced 2026-04-26 |
| ScholarQABench, SciFact, ANLI, ReClor | NC license — disqualified |
| Code datasets (BigCode, the-stack) | Forge is not a coding tool |
| arXiv full-text dumps | CPT data, not SFT |
| Direct GPT/Claude API distillations | ToS-conflicting; lab-cured datasets above already pass that filter |
| Multilingual data | English-only at v1 |

---

## 6. Where the Firestore exporter sits

`firestore_export.py` is for **Phase 4 continual learning** (post-beta,
when real episodes start landing). Currently dormant. Cold-start data
flows entirely through this curated list.
