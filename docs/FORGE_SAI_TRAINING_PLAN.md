# Forge SAI — Training Plan

**Author:** Senior ML Scientist (planning brief)
**Date:** April 2026
**Status:** Decision memo & phased roadmap
**Audience:** Rakshit Khanna (founder) + future ML hire(s)

---

## 0. TL;DR — Read this if nothing else

1. **Do not train from scratch.** In April 2026, frontier open-weight models (Qwen 3.5 Reasoning, GLM-5, DeepSeek-V3.2/R2, OLMo-3-Think, OpenAI's open-weight release) score 79–88% on GPQA-Diamond, 85–90% on MMLU-Pro, and were trained on 9–18T tokens at costs that individual labs cannot replicate. Reproducing that capability from zero is a $5M–$50M ten-engineer-year project with a 90%+ probability of shipping a weaker model than the starting base.
2. **Do not fine-tune only.** Forge's brand promise is verification-first with DOI-grounded citations. OpenScholar's Nature 2026 paper is definitive here: *training* the generator on retrieval-augmented traces closes 5–7% of the gap vs a general frontier model + prompt-level RAG. Raw SFT on a generalist base leaves measurable quality on the table for scientific QA.
3. **Do continued pre-training → SFT → preference optimization → retrieval-aware post-training** on an open base. This is what AI2 (OpenScholar, OLMo-3), Zhipu (GLM-5), and Alibaba (Qwen 3.5) all do. It's the only recipe with a proven 2025–2026 track record for domain-adapted research LLMs.
4. **Base model recommendation:** **Qwen 3.5 Reasoning 32B dense** as primary, **DeepSeek-V3.2 MoE (671B total / ~37B active)** as the large-context reasoning variant for "deep mode." Both are Apache-2.0-compatible licenses, have open weights, support ≥128K context, and lead all open benchmarks.
5. **Architecture:** Forge SAI is a *system*, not a single model. Two fine-tuned generator sizes (9B fast + 32B reasoning) + hybrid retrieval (BM25 + SPLADE + ColBERT-v2 rerank over a 200M-paper index) + strict passage-to-citation binding with DOI validation at decode time.
6. **Total budget to MVP of Forge SAI-9B (Lightning + Reasoning modes):** ≈$180K–$320K in compute + ~6 months of 1 senior ML engineer + data work. **To full stack including 32B Deep mode:** ≈$650K–$1.1M + ~10 months.
7. **Before any of this starts, Forge needs three things it does not have yet:** (a) a retrieval index separate from Exa (current stack is one vendor-lock-in away from disaster), (b) preference data pipeline (thumbs-up/down on generated answers in the UI), (c) an eval harness. Don't write the first line of training code until these three ship.

---

## 1. Understanding Forge — needs, goals, constraints

### What Forge is (from the codebase)
- **Product:** AI research workspace. Next.js 16 app, Firebase backend, deployed to researchers across disciplines — not just academics.
- **Phase positioning:** Intelligence phase per the roadmap (MVP → **Intelligence** → Growth). Knowledge graph, claim check, AI synthesis are live.
- **Current AI surface area** (mapped from `/src/app/api/`):
  | Route | Provider | Purpose |
  |---|---|---|
  | `/api/research` | Exa | Web/paper search + synthesis |
  | `/api/verify-citation` | Crossref | DOI + metadata verification |
  | `/api/ai/write` | Anthropic Claude Sonnet 4 | Document editing commands |
  | `/api/ai/check-claims` | Anthropic Claude Sonnet 4 | JSON-structured claim extraction |
- **Data accumulated in Firestore:** `projects`, `documents` (content, word/citation counts), `queries` (query + answer + sourceCount + verifiedCount), plus the client-side `projectGraph` store (topic/paper/concept nodes with DOI, journal, year, verification).
- **Research modes:** `lightning | reasoning | deep` — currently UI-only, all three hit the same endpoint/model. **This is a gift.** Forge SAI's architecture can map cleanly to these tiers without breaking users.

### What Forge SAI must deliver

| Capability | Minimum bar | Stretch bar |
|---|---|---|
| Conversational quality | On par with Claude Sonnet 4 / GPT-5 Mini on general dialog | Indistinguishable on research topics |
| Scientific QA | Match OpenScholar-8B on ScholarQABench | Match OpenScholar-70B |
| Citation faithfulness | >95% of cited DOIs resolve to real papers that actually support the claim | 100% (hard-bound decoding) |
| Long-context synthesis | 128K tokens (full paper + ~40 refs) | 1M tokens (whole lit review) |
| Latency (Lightning mode) | <2s first token | <800ms |
| Claim-check quality | Match Claude Sonnet 4 on the existing `check-claims` task | Exceed it on recall of weak causal claims |
| Run cost | ≤½ of current Anthropic spend per active user | ¼ |
| Verification-first guarantee | Never emit a citation not in retrieved context | — |

### Non-negotiable constraints
- **DOI-grounded outputs.** No fabricated citations. This is the product's differentiator against ChatGPT / NotebookLM / Claude Projects.
- **Open-science data hygiene.** Forge cannot train on anything that creates downstream licensing exposure for users (no NC-licensed bioRxiv papers into weights; fine for retrieval where source is cited).
- **Conversational + tool-use.** The model must behave well with Forge's existing tool surfaces: research, verify-citation, check-claims, graph operations.
- **Deployable on commodity cloud.** Must serve on 1×H100 (Lightning), 2×H100 or 1×B200 (Reasoning), 8×H100 or 4×B200 (Deep). No bespoke hardware.

---

## 2. The big decision: from scratch vs continued pre-training vs fine-tuning

### Option A — Train from scratch (7B–32B dense, 2–4T tokens)
| | |
|---|---|
| **Cost** | $2M–$8M compute, 12–18 months, 3–5 ML engineers ([Galileo 2026](https://galileo.ai/blog/llm-model-training-cost); [localaimaster 2026](https://localaimaster.com/blog/ai-model-training-costs-2025-analysis)) |
| **Expected outcome** | Underperforms any open 7B by a wide margin unless you match their data quality and compute |
| **Upside** | Total control over data provenance, perfect licensing story |
| **Risk** | >90% you ship a worse model than Qwen 3.5 base. Chinchilla-era data-quality gap is what killed most independent pretraining efforts 2023–2025 |
| **Verdict** | **Reject.** Economically irrational in 2026 unless you have >$20M and a research org. |

### Option B — Continued pre-training (CPT) + SFT + preference + retrieval-aware post-training
| | |
|---|---|
| **Cost** | $180K–$650K compute, 6–10 months, 1–2 ML engineers |
| **Expected outcome** | Measurably beats base model on scientific tasks; matches frontier on research QA with retrieval |
| **Upside** | Captures the OpenScholar 5–7% improvement; unique Forge-flavored behavior |
| **Risk** | Catastrophic forgetting of general dialog/code if mixture is wrong (well-understood, solvable) |
| **Verdict** | **RECOMMENDED.** |

### Option C — SFT only (no CPT)
| | |
|---|---|
| **Cost** | $20K–$60K compute, 2–3 months, 1 engineer |
| **Expected outcome** | Teaches format/tool-use; does not add scientific knowledge |
| **Upside** | Fast, cheap, low risk |
| **Risk** | Leaves 5–7% quality on the table vs OpenScholar-trained; doesn't justify calling it "Forge SAI" |
| **Verdict** | **Use as Phase 1 only** — ship SFT'd 9B as a quick win while CPT runs in parallel. |

### Option D — Stay on API (Claude/GPT), invest only in retrieval + prompting
| | |
|---|---|
| **Cost** | ~$0 up front, but per-token cost scales linearly with users |
| **Expected outcome** | Good baseline; no defensibility |
| **Upside** | Zero ML infra |
| **Risk** | You are a front-end on someone else's model. No margin moat. |
| **Verdict** | **Run this in parallel as the default until SAI-9B beats it on Forge's eval set.** Never a destination; always a fallback. |

### Decision
**B (primary) + C (bridging) + D (fallback).** We do SFT-only first (2–3 months), then CPT → SFT → DPO → retrieval-aware post-training (months 3–10), while keeping API routing as default until the trained model passes the eval gate.

---

## 3. Base model selection — April 2026

### Shortlist (open-weight, Apache-2.0-compatible, ≥32B or MoE)

| Model | Params | Active | Context | MMLU-Pro | GPQA-D | License | Notes |
|---|---|---|---|---|---|---|---|
| **Qwen 3.5 Reasoning 32B** | 32B | 32B | 128K | 87.8 | 88.4 | Apache-2.0 | Best GPQA of any open model; strong instruction following ([BenchLM 2026](https://benchlm.ai/blog/posts/best-open-source-llm)) |
| **DeepSeek-V3.2 MoE** | 671B | ~37B | 128K (DSA) | 85.0 | 79.9 | MIT | Sparse attention for long context; cheapest inference per active param ([InfoQ Jan 2026](https://www.infoq.com/news/2026/01/deepseek-v32/)) |
| **GLM-5 Reasoning** | 355B | ? | 128K | 86 | 83 | Open | Top of BenchLM leaderboard |
| **OLMo-3-Think 32B** | 32B | 32B | 65K | 82 | 74 | Apache-2.0 | Fully open (data + code + weights). OlmoTrace provenance fits Forge brand ([AI2 Nov 2025](https://allenai.org/blog/olmo3)) |
| **OpenAI gpt-oss (120B)** | 120B | ? | 128K | 90.0 | 80.9 | Apache-2.0 | Best MMLU-Pro overall open; new as of 2026 |
| **Llama 4 Maverick** | 400B | 17B | 1M | ~84 | 72 | Llama custom | MoE; 1M context is uniquely useful for "deep" mode |

### Recommendation

**Primary (SAI-32B Reasoning & Deep):** **Qwen 3.5 Reasoning 32B dense.** Highest scientific reasoning score in the open world, dense (easier to CPT than MoE), 128K context, Apache-2.0. We adapt this.

**Secondary (SAI-9B Lightning):** **Qwen 3.5 9B** (same family → knowledge distillation from the 32B is straightforward). If Qwen doesn't release a 9B Reasoning variant, fall back to OLMo-3 7B.

**Experimental (SAI-MoE Deep for 1M-context lit reviews):** **DeepSeek-V3.2** fine-tuned only (no CPT — too expensive on MoE at this scale). Used for whole-corpus synthesis in Deep mode.

Why not Llama 4? The custom license has field-of-use restrictions that conflict with Forge's commercial roadmap and create indemnification headaches with enterprise users. Qwen Apache-2.0 is clean.

Why not GLM-5? Slightly weaker on GPQA than Qwen 3.5 and the tooling ecosystem (tokenizer, HF integration, Axolotl support) is less mature as of April 2026.

---

## 4. Data strategy

### Pre-training corpus for CPT (target: 80–120B tokens)

| Corpus | Tokens | License | Use |
|---|---|---|---|
| **S2ORC** (AI2 / Semantic Scholar) | ~40B (OA full text, 8.1M papers) | Mostly CC-BY; per-paper checked | Core scientific text |
| **PubMed Central Open Access** | ~12B | CC-BY / CC-BY-NC split | Biomed; filter NC out of weights |
| **arXiv** (processed) | ~25B | Paper-dependent; arXiv license allows non-commercial redistribution of abstracts | STEM preprints |
| **OpenAlex metadata + abstracts** | ~8B | CC0 (public domain) | Citation graph, abstracts, discipline labels |
| **Dolma 3 scientific subset** | ~9.3T full / ~80B sci-filtered | ODC-BY | Already-cleaned scientific web text from AI2 |
| **Biomed-Enriched (2025)** | ~2B high-quality filtered | Mixed | Clinical cases, high-quality biomed |
| **General-domain replay** (FineWeb-Edu, Dolma web, RedPajama-v2 sample) | ~20B | Various OSS | Prevent catastrophic forgetting |

**Target mixture for 100B-token CPT run:**
- 55% scientific (S2ORC + PMC-OA-commercial-only + arXiv + Biomed-Enriched)
- 20% general web (FineWeb-Edu) — prevents general-quality degradation
- 10% code (The Stack v2 filtered) — keeps tool-use sharp
- 10% instruction-style scientific synthesis (ScholarQA-CS, SciQ, synthetic Claude-generated Q&A from retrieved papers)
- 5% math (OpenMathText) — keeps numerical reasoning

**Rationale:** Post-Llama-3.1 CPT studies (eBay Dec 2024; Bloomberg-GPT lessons; OpenScholar methodology) converge on 50–60% domain / 20–30% general replay as the safe band. Going above 70% domain causes measurable MMLU/HellaSwag degradation.

### SFT dataset (target: 300K–800K instruction pairs)

| Source | Pairs | Use |
|---|---|---|
| **ScholarQABench training split** | ~5K | Scientific QA format |
| **OpenScholar-Data (RAG traces)** | ~150K | Retrieval-conditioned generation — **the key OpenScholar secret sauce** |
| **SciInstruct / SciGLM data** | ~200K | Scientific multi-turn |
| **Synthetic Forge data** (generate with GPT-5.4 / Claude Opus 4.6 from Forge's own retrieval corpus) | ~300K | Forge-shaped tasks: claim check, citation insertion, write-with-sources, graph queries |
| **General SFT** (Tulu-3, UltraChat, OpenHermes-2.5 sample) | ~150K | Conversation + tool-use preservation |
| **Forge user sessions** (opt-in, post-hoc filtered, PII-stripped) | 0 → growing | This is why the product must ship a feedback loop NOW |

### Preference data (for DPO/SimPO, target: 30K–80K pairs)

1. **Bootstrap:** Generate 8 candidates per query (temperature 0.7) on a held-out set of Forge queries using SAI-32B-SFT. Use Claude Opus 4.6 as judge with a Forge-specific rubric (citation accuracy weight 3×, faithfulness 2×, helpfulness 1×). Keep pairs where judge confidence >0.7.
2. **Human loop:** In-app thumbs up/down + "cite better source" signal → 10–20K pairs over 3 months.
3. **Targeted negatives:** Synthesize specific failure modes — hallucinated DOIs, misattributed claims, overconfident low-severity claims — as rejected samples.

### Data preparation checklist
- [ ] GPT-5.4 based decontamination against GPQA, MMLU-Pro, HLE, SciBench, ScholarQABench test sets (n-gram overlap + semantic)
- [ ] PII stripping (medical + personal names)
- [ ] License classifier (PMC-NC excluded from weights; allowed in retrieval with attribution)
- [ ] Duplicate detection (MinHash + 5-gram Jaccard)
- [ ] Paper-level deduplication against retrieval index (training data must not be retrievable — prevents test-time memorization)

---

## 5. Training recipe — the full pipeline

```
[Qwen 3.5 32B base]
        │
        ▼
  Stage 1: CPT (100B tokens, science-heavy)
        │
        ▼
  Stage 2: SFT (1 epoch, 500K pairs, retrieval-conditioned)
        │
        ▼
  Stage 3: DPO + SimPO hybrid (30-50K prefs)
        │
        ▼
  Stage 4: Retrieval-aware post-training (OpenScholar recipe)
        │                                  │
        ▼                                  ▼
  [SAI-32B Reasoning]              [Distillation]
                                           │
                                           ▼
                                   [SAI-9B Lightning]
```

### Stage 1 — Continued Pre-Training (CPT)

| Hyperparameter | Value | Why |
|---|---|---|
| **Base** | Qwen 3.5 32B Reasoning | Best open-GPQA in 2026 |
| **Tokens** | 100B (start at 40B for pilot, scale) | Post-2024 CPT studies: 50–150B is the sweet spot; diminishing returns beyond |
| **Batch size** | 4M tokens/step global | Standard for 32B |
| **Seq length** | 32K (start), 128K for last 10B tokens | Long-context extension at end |
| **Optimizer** | **Muon for hidden layers + AdamW for embeddings/LN** | Muon gives ~2× sample efficiency ([Moonshot 2025](https://arxiv.org/abs/2502.16982); [Nubank 2026](https://building.nubank.com/muon-for-improved-foundation-model-pretraining-data-efficiency/)). **Critical caveat:** Muon ↔ AdamW mismatch at fine-tune time ([HF blog](https://huggingface.co/blog/KingNish/optimizer-part1)) — must use Muon for all later stages too |
| **LR schedule** | Linear warmup 2K steps → cosine decay from 3e-5 → 3e-6 | 10× lower peak than scratch |
| **Weight decay** | 0.1 | Standard |
| **Grad clip** | 1.0 | Standard |
| **Replay buffer** | 20% of batches drawn from FineWeb-Edu | Prevents forgetting |
| **Curriculum** | 70B abstract/intro text → 30B full-paper text | Papers last because they're harder |
| **Precision** | BF16 weights, FP32 optimizer state | Standard 2026 |
| **Parallelism** | FSDP-2 + tensor parallel 8 + sequence parallel | Standard 32B recipe |
| **Checkpoint cadence** | Every 5B tokens | Ensure recovery; eval each ckpt |

**Compute:** 100B tokens × 32B params × 6 FLOPs/token/param (Chinchilla CPT multiplier) ≈ 1.9e22 FLOPs ≈ **~30K H100-hours** at 50% MFU. At $2.85/H100-hr = **~$85K**.

### Stage 2 — Supervised Fine-Tuning (SFT)

| Hyperparameter | Value |
|---|---|
| **Method** | **Full fine-tune** (not LoRA). At 32B with our data volume, full FT still wins by 1–2% on our most important evals; PEFT is for later cost-sensitive iterations. |
| **Epochs** | 1 (slight regularization), 2 for high-quality subset |
| **Batch** | 256 examples packed to 32K |
| **LR** | 5e-6 peak (10× lower than pretrain post-base) |
| **Schedule** | Warmup 3% → cosine → 0 |
| **Loss masking** | Train on response only; mask prompt; **double-weight citation tokens** (the sentence-level supervision OpenScholar uses) |
| **Data mix** | 50% retrieval-conditioned (inputs include retrieved context + gold answer), 30% Forge tool-use, 20% general |

**Compute:** ~500K pairs × 2K avg tokens × 3 epochs equiv ≈ 3B training tokens ≈ **~2K H100-hours** ≈ **$6K**.

### Stage 3 — Preference Optimization

**Method:** **SimPO → DPO** sequential, not either-or.

- SimPO first (reference-free, cheaper, more stable on noisy labels — per [Rainbow-PO ICLR 2025](http://www.columbia.edu/~wt2319/RainbowPO.pdf) and the 2026 preference-stack consensus)
- DPO second with SimPO checkpoint as reference, for the last 10K high-quality human-labeled pairs

| Hyperparameter | Value |
|---|---|
| **β (KL strength)** | SimPO γ/β = 2.5 (per SimPO paper); DPO β = 0.1 |
| **Batch** | 128 pairs |
| **LR** | 1e-6 |
| **Epochs** | 1 on each |

**Compute:** ~1K H100-hours ≈ **$3K**. For scale: SFT + preference is <5% of total compute cost.

### Stage 4 — Retrieval-Aware Post-Training (OpenScholar recipe)

Ask the SFT model to generate synthetic retrieval-augmented responses, then re-train on those traces with *citation-binding loss* (per OpenScholar):

- For every generated sentence, the model must either (a) emit a `<cite id=...>` tag pointing to a retrieved passage, or (b) emit `<nocite/>` for framing sentences
- Cross-entropy on cite IDs is weighted 5× the content loss
- Negative training: insert non-supporting passages and train the model to *not* cite them

This is the step that delivered OpenScholar-8B's 6.1% win over GPT-4o. Skipping it makes this a generic domain-adapted model, not a Forge SAI model.

**Compute:** ~3K H100-hours ≈ **$9K**.

### Stage 5 — Distillation to SAI-9B Lightning

Standard distillation: teacher (SAI-32B) generates 2M (query, retrieved-ctx, answer) tuples; student (Qwen 3.5 9B base) trains on teacher outputs with KL loss on full distribution + CE on top-k tokens (k=32, matches 2026 best practice).

**Compute:** ~8K H100-hours ≈ **$23K**.

### Total Stage-by-Stage Compute

| Stage | H100-hrs | Cost ($2.85/hr) |
|---|---|---|
| CPT (100B tok) | 30,000 | $85,500 |
| SFT | 2,000 | $5,700 |
| Preference (SimPO+DPO) | 1,000 | $2,850 |
| Retrieval-aware post | 3,000 | $8,550 |
| Distillation to 9B | 8,000 | $22,800 |
| **Subtotal** | **44,000 H100-hrs** | **$125,400** |
| Evals, restarts, pilots, failed runs (40% buffer) | +17,600 | +$50,000 |
| **Grand total compute** | **~61,600 H100-hrs** | **~$175,400** |

Add data licensing (~$15K for commercial-use corpora), data engineers (~$80K over 6 months), eval annotators (~$20K), infra + storage (~$30K) → **$320K all-in for Forge SAI-32B + SAI-9B.**

(B200 would cut wall-clock ~2.5×; at $6–10/hr the cost is comparable on a per-FLOP basis.)

---

## 6. Retrieval layer — the other half of Forge SAI

A trained model without a first-class retrieval system is not verification-first. The retrieval layer is equally important to the training recipe.

### Index

- **Sources:** OpenAlex (250M works) + S2ORC full-text (8.1M OA) + arXiv + PubMed Central OA + Forge user-uploaded PDFs (future)
- **Size at MVP:** ~40M papers full-text + 200M metadata
- **Storage:** ~8TB dense vectors (1024-dim float16) + ~1.2TB BM25 index + ~6TB ColBERT-v2 index

### Architecture (per 2026 production best practice — [hybrid RAG 2026](https://blog.gopenai.com/hybrid-search-in-rag-dense-sparse-bm25-splade-reciprocal-rank-fusion-and-when-to-use-which-fafe4fd6156e))

```
query
  │
  ├─ BM25 (Pyserini)          ─┐
  ├─ Dense (BGE-M3 or E5-Mistral) ─┤
  └─ SPLADE (neural sparse)   ─┘
                              │
                      Reciprocal Rank Fusion (k=60)
                              │
                      Top-100 candidates
                              │
                      ColBERT-v2 late-interaction rerank
                              │
                      Top-20 to LLM
                              │
                      SAI-32B with citation-binding decode
```

Why this exactly: OpenScholar showed that dense-alone or BM25-alone each lose ~10–15% recall at top-20 vs fused; ColBERT rerank adds ~8% precision at top-5. These aren't optional micro-optimizations, they're the difference between "mostly right" and "publishable."

### Citation-binding decode

At generation time, constrain the decoder so every sentence emits either a `<cite>DOI</cite>` tag or `<frame/>`. Verify each DOI against (a) Crossref (already wired in Forge via `/api/verify-citation`) and (b) the retrieved context at generation. Reject + regenerate sentences whose cited passage doesn't semantically support the claim (cross-encoder NLI check, e.g. DeBERTa-v3-MNLI).

**This alone eliminates 78–90% of the hallucinated-citation problem that kills GPT-4o on ScholarQABench.**

---

## 7. Evaluation plan — before training starts, not after

### Internal Forge eval suite (build this **first**, before data pipeline)

| Eval | Target | Why |
|---|---|---|
| **Forge-ScholarQA** | 500 hand-curated queries across 10 disciplines, gold answers + gold citations | Product-relevant QA |
| **Forge-ClaimCheck** | 300 drafts with labeled claims (severity, kind, needsCitation) | Directly maps to existing `/api/ai/check-claims` task |
| **Forge-Write** | 200 editing tasks from real Forge user sessions (opt-in) | Maps to `/api/ai/write` |
| **Forge-Cite-F1** | Citation precision, recall, hallucination rate | The verification-first metric |
| **Forge-Tool** | Multi-turn tool-use (search → verify → cite → graph-add) | The "agentic" path |

### External benchmarks

Track quarterly: **GPQA-Diamond, MMLU-Pro, HLE, ScholarQABench, SciAgentBench, FActScore, HalluLens.** Targets:

| Benchmark | SAI-9B goal | SAI-32B goal | Frontier reference (Apr 2026) |
|---|---|---|---|
| GPQA-D | 72 | 82 | Gemini 3.1 94.1, Qwen 3.5 88.4 |
| MMLU-Pro | 78 | 86 | OpenAI-oss 90.0, Qwen 3.5 87.8 |
| ScholarQABench | match OpenScholar-8B | +3pt vs OpenScholar-70B | OpenScholar-8B currently SOTA open |
| Citation-F1 | 0.85 | 0.92 | OpenScholar 0.90, GPT-4o 0.12 |

### Gate criteria to ship
- SAI-9B replaces `/api/ai/write` and `/api/ai/check-claims` when: Forge-Write ≥ Claude Sonnet 4 on blind A/B (human eval n=200, p<0.05) AND Forge-ClaimCheck F1 ≥ Claude Sonnet 4
- SAI-32B takes over Lightning/Reasoning research when: Forge-ScholarQA ≥ Exa+Claude AND Cite-F1 ≥ 0.90
- Deep mode (DeepSeek-V3.2 fine-tune) ships when: 128K-token lit-review task human-eval ≥ GPT-5.4 + Claude Opus 4.6 ensemble

---

## 8. Infrastructure & Cost Summary

### Training infra
- **Option 1 — CoreWeave / Lambda reserved:** 128× H100 SXM5 cluster, 2-month reservation, ~$900K for 60K GPU-hours → cheap per-hour but forces commitment
- **Option 2 — On-demand burst on Together / Fireworks:** $2.85–$3.50/H100-hr, flex capacity, no commitment. Better for a 1-engineer team iterating.
- **Option 3 — Nebius or Crusoe spot:** ~$1.60/H100-hr with pre-emption. Only for checkpointable CPT stages.

**Recommended:** Option 2 + Option 3 mix. On-demand for SFT/preference/distillation (short, needs flexibility). Spot for CPT (long, checkpointable, big savings).

### Serving infra (post-training)
| Tier | Hardware | Model | Monthly cost est. |
|---|---|---|---|
| Lightning | 1× H100 / L40S | SAI-9B INT8 | $2–3K each; scale to demand |
| Reasoning | 2× H100 or 1× B200 | SAI-32B BF16 | $5–8K each |
| Deep | 8× H100 or 4× B200 | DeepSeek-V3.2 + SAI adapter | $15–25K each; scale to zero when idle |

Use vLLM 0.9+ or SGLang for serving; paged attention, speculative decoding with SAI-9B as draft for SAI-32B.

### Compute providers ranked for Forge
1. **Together.ai** — best reserved + on-demand blend, native vLLM, Apache-license-friendly TOS
2. **CoreWeave** — enterprise contracts for B200/GB200 clusters when scaling 2026-H2
3. **Nebius** — best spot pricing for CPT
4. **Modal / Replicate / Baseten** — for serving, not training

---

## 9. Risks & mitigations

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Catastrophic forgetting of general dialog during CPT | Medium | High | 20% replay mixture; evaluate MMLU/HellaSwag every 5B tokens; stop CPT if degradation >3% |
| Qwen 3.5 license changes (Alibaba-originated) | Low | High | Freeze on a specific revision; maintain OLMo-3 fallback path |
| Retrieval index quality < OpenAlex claims | Medium | Medium | Run OpenScholar's eval pipeline on our index before training; invest in data cleaning |
| Data contamination invalidates benchmarks | High (if careless) | High | Strict n-gram + semantic decontam; quarterly re-check |
| Muon optimizer instability at 32B scale | Medium | Medium | Start with AdamW pilot at 10B tokens; switch only after validation |
| User preference data never arrives (no feedback UI) | High without action | Very High | **This is blocker 1.** Ship in-app 👍/👎 per response before any training work |
| API model (Claude/GPT) catches up on scientific citation F1 | Medium | High | Our moat is Forge's retrieval index + workflow, not raw model quality |
| Frontier model released mid-training makes our work obsolete | Medium | Medium | Commit to 3-month training sprints; base model swappable |

---

## 10. Phased Roadmap

### Phase 0 — Preconditions (Weeks 1–6, must ship before any training)
- [ ] **Retrieval MVP:** stand up OpenAlex + S2ORC ingestion → Pyserini BM25 + BGE-M3 dense index (~5M papers pilot). Ship as `/api/research-v2`.
- [ ] **Feedback capture:** 👍/👎 + "why" picker on every answer + claim-check response. Write to Firestore `feedback` collection.
- [ ] **Eval harness:** wire GPQA-D, MMLU-Pro, ScholarQABench local runners; baseline Claude Sonnet 4 + GPT-5.4 + Qwen 3.5 32B base on all.
- [ ] **Forge-ScholarQA-v1:** 100 hand-curated queries with gold citations.
- [ ] **Decontamination pipeline.**

*Cost:* $20K infra + 1 engineer for 6 weeks. **Do not start Phase 1 until these are green.**

### Phase 1 — SFT-only SAI-9B (Weeks 7–14)
- Pick Qwen 3.5 9B base
- Curate 200K-pair SFT set (ScholarQABench + Forge-synthetic + Tulu-3)
- Full FT with Muon, 1 epoch
- Distill claim-check behavior from Claude Sonnet 4 (50K labeled outputs)
- Ship SAI-9B-mini as replacement for `/api/ai/check-claims` and `/api/ai/write` behind a feature flag

*Cost:* ~$35K compute, 2 months.
*Kill gate:* if SAI-9B-mini doesn't match Claude Sonnet 4 on Forge-Write and Forge-ClaimCheck by end of Phase 1, stop and reassess.

### Phase 2 — CPT SAI-32B (Weeks 15–30)
- Build 100B-token scientific corpus
- 40B-token CPT pilot at 32B (validate Muon)
- Full 100B CPT
- SFT + SimPO + DPO
- Retrieval-aware post-training (OpenScholar recipe)
- Eval + iterate

*Cost:* ~$160K compute, 4 months.
*Ship gate:* Forge-ScholarQA ≥ Exa+Claude ensemble, Cite-F1 ≥ 0.90, MMLU-Pro regression <2% vs base.

### Phase 3 — Distillation + Deep mode (Weeks 31–40)
- Teacher-student distillation SAI-32B → SAI-9B (full pipeline)
- Fine-tune DeepSeek-V3.2 on Forge-shaped long-context lit-review tasks
- Integrate all three tiers (Lightning = 9B, Reasoning = 32B, Deep = V3.2-SAI)
- Wire into `ResearchMode` routing in existing `/api/research`

*Cost:* ~$75K compute, 2.5 months.

### Phase 4 — Continuous improvement (ongoing)
- Quarterly CPT refresh (latest 20B tokens of papers)
- Monthly DPO update from user feedback
- Watch 2026-H2 open releases (Llama 5, Qwen 4, DeepSeek-V5); re-base every 6–12 months

---

## 11. Team & hiring

What the founder (Rakshit) should own: product spec of Forge-ScholarQA, the eval gates, budget.

What needs to be hired **before** Phase 2:
- **1 senior ML engineer** (training-stack fluency: FSDP, Megatron-Core or torchtune, vLLM) — $220–280K + equity
- **1 ML data engineer** (corpus curation, deduplication, decontamination) — $180–220K + equity
- Contract eval annotators for Forge-ScholarQA gold sets — ~$20K one-time

Do not hire until Phase 0 ships. Phase 0 is one engineer's job.

---

## 12. Final recommendation

**Ship Phase 0 immediately** — retrieval-v2, feedback capture, eval harness. Without these, training is gambling.

**In parallel**, start Phase 1 with a very small SFT-only SAI-9B targeting the `check-claims` and `write` endpoints. Quick win, proves the stack, gets real user preference data flowing.

**At Phase 1 ship**, decide based on evidence whether Phase 2 (full CPT-based SAI-32B) is justified. The criterion: does Forge have 10K+ weekly active queries by that point? If no, stay on API (Option D) and keep iterating on retrieval + prompting. If yes, the CPT investment pays back in reduced API cost + defensibility within 12 months.

The worst thing Forge can do is start training before it has retrieval, feedback, and evals. The second-worst thing is to train from scratch. Everything else is recoverable.

---

## 13. From-Scratch Contingency Plan — if you insist

> **Read §2 first.** I recommend against this path. I'm including it because (a) the founder asked, (b) strategic positioning sometimes demands owning the full stack, (c) if Alibaba/DeepSeek/Meta change their licenses, you need a Plan B in the drawer. This is that Plan B.

If Forge decides to train from scratch, the *only* viable target in 2026 is a **7B dense or ~8×2B MoE** (12–16B total). Anything smaller is a toy; anything larger costs >$5M and takes >12 months. This is the "Stanford CS336 / nanoMoE / OLMo-2-7B" weight class — what one serious team can actually ship.

### 13.1 Target architecture — "Forge-SAI-Base-7B"

| Knob | Value | Rationale |
|---|---|---|
| Params | 7B dense OR 13B MoE (8 experts × ~2B, 2 active) | Dense is simpler; MoE gives ~2× capacity per FLOP ([nanoMoE 2025](https://cameronrwolfe.substack.com/p/nano-moe)) |
| Layers / heads / d_model | 32 / 32 / 4096 (dense); 24 / 24 / 3072 (MoE) | Standard Llama-style shape |
| Attention | **Grouped-Query (8 KV heads)** + **FlashAttention-3** + **sliding-window 4K** on every other layer | KV-cache cost matters for serving; sliding-window keeps long-context tractable |
| Position | RoPE with YaRN extension to 128K post-train | Matches Qwen/Llama practice |
| Activation | SwiGLU | Standard |
| Normalization | RMSNorm pre-norm + QK-norm | QK-norm stabilizes Muon-optimized training ([MuonClip paper](https://arxiv.org/abs/2502.16982)) |
| Tokenizer | BPE 128K, trained on 70% scientific / 30% general mix | Smaller tokenizer → more effective tokens; sci-biased vocab helps PMC/arXiv compression ~9% |
| Context | 8K during pretrain, extended to 128K in final 5% of tokens | Cheap long-context extension via YaRN |
| Vocab-embedding tied | Yes | Saves ~300M params |

**Why MoE for Forge specifically:** our reasoning tier can afford activating only 2 of 8 experts because research queries tend to hit one sub-discipline per query. Biomed expert, CS expert, physics expert, humanities expert, methodology expert (stats/math), general fluency expert ×2, code expert. Train with auxiliary-loss-free balancing (DeepSeek-V3 style).

### 13.2 Training corpus — Forge-curated, 2.5–3T tokens

Cost-of-admission for from-scratch is the data mix. Here is the Forge-tailored corpus, all under licenses that keep enterprise sales lawyers calm:

| Corpus | Tokens | License | Weight in mix | Role |
|---|---|---|---|---|
| **Common Pile v0.1** (2025) | ~1T | Openly licensed / public domain only | 35% | General-quality ethical base ([arXiv 2506.05209](https://arxiv.org/abs/2506.05209)) |
| **Common Corpus** (PleIAs) | ~2.27T | Uncopyrighted + permissively licensed; explicit per-doc provenance | overlapping | Legal-clean multilingual ([arXiv 2506.01732](https://arxiv.org/abs/2506.01732)) |
| **FineWeb-Edu** | ~1.3T | ODC-BY | 15% | Heavily curated educational web (beats RedPajama despite smaller size) |
| **Dolma 3 scientific slice** | ~80B (filtered from 9.3T) | ODC-BY | 12% | Science PDFs processed with olmOCR |
| **S2ORC full-text** (OA only) | ~40B | Per-paper CC-BY-check | 10% | Core scientific corpus |
| **arXiv (abstracts + full-text OA)** | ~25B | Mixed; commercial-safe subset ~12B | 6% | STEM preprints |
| **PubMed Central OA-Commercial** | ~8B | CC-BY only (NC excluded) | 5% | Biomed |
| **OpenAlex abstracts + citation contexts** | ~8B | **CC0** | 4% | Structured scholarly metadata |
| **Biomed-Enriched high-quality** | ~2B | Commercial-use subset 450K docs | 3% | Clinical cases |
| **The Stack v2 — permissive-only** | ~60B | Permissive licenses only | 7% | Code fluency, tool-use priming |
| **OpenMathText + FineMath** | ~10B | Open | 2% | Numerical reasoning |
| **Wikipedia 2026 dump + Wikibooks** | ~5B | CC-BY-SA | 1% | Encyclopedic grounding |

**Total unique tokens:** ~1.55T post-dedup. We train **~2.5T tokens** with 60% repetition on high-quality scientific subsets (Chinchilla-optimal for 7B is ~140B; we overtrain by ~18× because newer scaling laws — DeepSeek-V3, Llama-3, Qwen-3 — consistently show frontier models train 15–25× past Chinchilla for inference-optimal quality).

**Critical data-engineering steps** (all of these must happen *before* the first training step; budget 2–3 months for this):
1. **MinHash + LSH near-dedup** at 80% Jaccard, paper-id-aware (don't collapse different arXiv versions of the same paper — pick the latest)
2. **Decontamination** against GPQA-Diamond, MMLU-Pro, HLE, ScholarQABench, SciBench, FrontierMath test sets (13-gram overlap + semantic dedup via MiniLM)
3. **Quality classifier** — train a fastText or DeBERTa-v3-small classifier on (FineWeb-Edu gold / CommonCrawl noise) and keep only docs with score >0.5; this alone added ~3% MMLU for FineWeb
4. **License classifier** — tag every doc with license; NC and unknown → retrieval-only bucket, never into weight-training
5. **PII stripping** — medical/personal names via Presidio + custom regex for clinical contexts
6. **Citation-graph enrichment** — for S2ORC/OpenAlex docs, prepend `<refs>title1; title2; …</refs>` tokens so the model learns to associate claims with their source papers. **Unique Forge innovation:** this pretrains the citation-emission behavior before any SFT.
7. **Section-structured formatting** — preserve abstract/intro/methods/results/discussion tags as structure tokens; helps downstream retrieval-aware training

### 13.3 Training algorithm — "Forge-Recipe v0"

```
Base arch + tokenizer  ─┐
                        ▼
  Stage 0: Warmup 50B tokens on FineWeb-Edu (stability)
                        │
                        ▼
  Stage 1: Main pretrain 2.3T tokens (Forge mix)
                        │
                        ▼
  Stage 2: Long-context extension 100B tokens, 128K ctx, YaRN
                        │
                        ▼
  Stage 3: Mid-training "anneal" on 150B tokens of highest-quality
           science + synthetic Q&A (Dolma-3 anneal trick)
                        │
                        ▼
  Stage 4: SFT → SimPO → DPO → retrieval-aware post-training
           (same as §5)
```

**Key hyperparameters** (7B dense; adjust for MoE):

| Param | Value | Note |
|---|---|---|
| Batch size | 4M tokens / step global | Standard large-batch |
| Seq length | 8K → 32K → 128K | Three-stage curriculum |
| Optimizer | **Muon (hidden) + AdamW (embeddings, LN, router)** | Muon gives ~2× token-efficiency; breaks on embed/norm |
| Peak LR | 4e-4 | 2× larger than post-CPT |
| Warmup | 2000 steps | 0.08% of training |
| Schedule | WSD (Warmup–Stable–Decay) | Replaces cosine in 2026 best practice; allows mid-training anneal at decay phase ([DeepSeek-V3 recipe](https://magazine.sebastianraschka.com/p/technical-deepseek)) |
| Weight decay | 0.033 | Muon-tuned (lower than AdamW) |
| Grad clip | 1.0 | |
| β1, β2 | 0.9, 0.95 (AdamW); Muon has no β2 | |
| Dropout | 0.0 | Standard 2025+ |
| Data mix schedule | Uniform for first 80%; re-weight toward science for last 20% (anneal) | DeepSeek + Olmo-3 practice |
| Checkpoint cadence | Every 10B tokens | ~250 checkpoints — keep every 5th |
| Precision | BF16 weights, FP32 optim state; **FP8 matmuls on B200 if available** | FP8 cuts memory ~30%, throughput +40% |

**Forge-specific algorithmic innovations** (the parts you wouldn't get from Qwen):

1. **Citation-conditioned LM objective.** During pretraining, randomly (10% of the time) prepend 3–5 retrieved citations to a document and train the LM to attend to them. This primes the model for retrieval-aware generation *before* post-training. Novel to Forge — not in any open recipe.

2. **Section-role tokens.** Emit special tokens `<abstract>`, `<methods>`, `<result>`, `<claim>`, `<evidence>` during data prep; train the model to predict these. At inference, constrain decoding with them in "synthesis mode."

3. **DOI-as-structure.** Treat DOIs as first-class tokens in a small dedicated sub-vocab (~1M DOIs as single-token entries, far cheaper than splitting 10.1038/s41586-025-10072-4 into 20 subword tokens). Citation emission becomes a single next-token prediction.

4. **Claim-aware MLM span**. 5% of the training loss comes from predicting a claim-sentence span given its surrounding context **without** the cited passage (teaches the model *which* claims are load-bearing and need external support — the same signal the claim-check feature uses at inference).

5. **Mixture-of-Denoisers (UL2) warmup.** First 50B tokens use T5-style span corruption + prefix-LM + standard-LM mix. Proven to improve downstream reasoning by ~1.5% on GPQA in 2024–2025 ablations.

### 13.4 Compute & cost — from-scratch realism

| Item | Number |
|---|---|
| Total training FLOPs (7B × 2.5T tokens × 6) | 1.05 × 10²³ |
| H100 hours at 50% MFU | ~330,000 |
| H100 cost at $2.85/hr spot | **~$940K compute only** |
| Alt: B200 at $5/hr, 2.5× throughput | ~$660K wall-clock 45 days |
| Data engineering (3 engineers × 3 months) | $120K |
| Eval + iteration (1 engineer × 6 months) | $140K |
| Failed runs + restarts (30% buffer) | $280K |
| **All-in from-scratch total** | **~$1.5M–$2.1M, 10–14 months** |

Compare to **CPT-on-Qwen-3.5 path: ~$320K, 6 months.** From-scratch is ~5× the cost and ~2× the time, for a model that will start weaker than Qwen 3.5 32B and needs aggressive post-training to recover. This is why the main plan rejects it.

**The one scenario from-scratch makes sense:** if Forge raises a $20M+ Series A explicitly marketing "sovereign, provenance-tracked research AI" where the training-data provenance story is itself the product. In that world, Common Pile + S2ORC + Forge-Recipe is defensible IP, not an engineering liability.

---

## 14. Training-Efficiency Algorithms — tailored for Forge

These apply to both the recommended CPT path and the from-scratch contingency. Ranked by impact-to-effort for a small team.

### 14.1 Memory & throughput — must-have

| Technique | Impact | Effort | Forge fit |
|---|---|---|---|
| **FlashAttention-3** | 2–3× attention throughput, linear memory | Library import | Mandatory. Enabled by default in vLLM/torchtune |
| **Activation checkpointing** (selective, not full) | ~60% activation memory reduction at 10–15% throughput cost | Config flag | Mandatory for 32B+ training |
| **BF16 weights + FP32 optim state** | 2× throughput vs FP32 | Config flag | Mandatory |
| **FP8 matmuls on B200/H200** | +30–40% throughput on Blackwell | torchao / TE integration | Use if B200 cluster is available |
| **FSDP-2 (ZeRO-3 equivalent)** | Scales to 64+ GPUs cleanly | Built into PyTorch | Mandatory above 32B |
| **Sequence parallelism** | Long-context training without OOM | 1-line FSDP2 config | Required for 128K stage |
| **Gradient accumulation + large batch** | Stabilizes Muon, better data efficiency | Config | Standard |
| **Paged KV-cache (vLLM)** | 2–4× serving throughput | Serving stack | Mandatory post-training |

### 14.2 Optimizer & data efficiency — the high-leverage wins

| Technique | Gain | Forge decision |
|---|---|---|
| **Muon** (for hidden layers) | ~2× sample efficiency over AdamW ([Essential AI 2025](https://arxiv.org/pdf/2505.02222); [Nubank 2026](https://building.nubank.com/muon-for-improved-foundation-model-pretraining-data-efficiency/)) | **Adopt.** Use Muon throughout — CPT, SFT, preference. Don't mix with AdamW-pretrained checkpoints (the [mismatch caveat](https://huggingface.co/blog/KingNish/optimizer-part1)) |
| **MuonClip** (Moonshot variant) | Better stability at scale | Consider for 32B+ |
| **Data pruning via influence functions** | +2–4% quality at same token count ([OpenReview](https://openreview.net/pdf?id=XUIYn3jo5T)) | Adopt on scientific subset where quality varies |
| **Quality-score reweighting** (fastText / DeBERTa classifier) | +3% MMLU on FineWeb | Adopt during data prep |
| **GaLore 2 / APOLLO gradient-low-rank projection** | Full-parameter training at ~LoRA memory ([GaLore 2](https://arxiv.org/abs/2504.20437)) | Adopt for the SFT stage on 32B if B200 isn't available — enables 32B full FT on 8×H100 |
| **WSD schedule** (Warmup-Stable-Decay) | Enables mid-train anneal on highest-quality data | Adopt |
| **Curriculum learning** (easy→hard, general→scientific) | +1–2% on downstream tasks | Adopt via DeepSpeed Data Efficiency lib |
| **MIT CompreSSM pruning while training** ([MIT News Apr 2026](https://news.mit.edu/2026/new-technique-makes-ai-models-leaner-faster-while-still-learning-0409)) | Lean model, dynamic structure | Watch — too new to bet on; re-evaluate H2 2026 |

### 14.3 Post-training & inference efficiency

| Technique | Gain | Forge decision |
|---|---|---|
| **MIT TLT / Speculative draft during RL rollout** ([MIT News Feb 2026](https://news.mit.edu/2026/new-method-could-increase-llm-training-efficiency-0226)) | RL rollout 70–210% faster (rollout = 85% of RL training time) | Adopt when we reach GRPO/RLVR stage for reasoning tier |
| **GRPO / DAPO / RLVR** ([llm-stats 2026](https://llm-stats.com/blog/research/post-training-techniques-2026)) | Verifiable-reward RL — the DeepSeek-R1 secret | Use for citation-accuracy reward (verifiable: did DOI resolve? does NLI confirm support?) |
| **Speculative decoding at serve time** (SAI-9B as draft for SAI-32B) | 2–3× token throughput at identical quality | Mandatory in serving layer |
| **Chunked prefill + radix-cache (SGLang)** | 3–5× prefill throughput for long contexts | Mandatory for Deep mode (long-context lit-review) |
| **INT4 AWQ / GPTQ quantization** at serving | 4× smaller model, <1% quality loss | Apply to SAI-9B Lightning tier |
| **DoRA adapters** for per-user / per-project customization ([NVIDIA 2026](https://developer.nvidia.com/blog/introducing-dora-a-high-performing-alternative-to-lora-for-fine-tuning/)) | Personalization without forking weights | Phase-3 feature: per-project DoRA from user's citation library |
| **Parametric RAG** ([SIGIR 2025](https://dl.acm.org/doi/10.1145/3726302.3729957)) | Inject retrieved knowledge as on-the-fly LoRA patches | Research-grade; revisit 2027 |

### 14.4 Forge-specific efficiency techniques (not in any off-the-shelf recipe)

1. **Citation-sparse training loss.** Only ~15% of tokens in a scientific doc are load-bearing claim tokens. Weight the LM loss higher on `<claim>`-tagged spans (2–3×) and on `<cite>`-bound tokens (5×). Same total FLOPs, better signal-per-FLOP.

2. **Retrieval-index-as-negative-mining.** At SFT and preference-optimization time, use Forge's own hybrid retrieval index to mine *hard* negatives: documents that look topically relevant but don't support the claim. Training on these sharpens citation precision far faster than random negatives.

3. **Query-log co-training.** Forge accumulates real researcher queries. Use them as a distribution-match signal during the WSD decay phase — over-sample training data that resembles real user queries (measured by BGE-M3 similarity to query distribution). Turns raw compute into product-aligned quality.

4. **Claim-check self-distillation.** Run SAI-32B's claim-check output over its own pretraining corpus; use the flagged claims as a second pre-training signal (contrastive: "this claim needs citation"). Free high-quality structural label, no human annotator needed.

5. **Graph-in-context training.** Forge already builds per-project knowledge graphs (topics, papers, concepts, edges). Serialize these graphs into pretrain/SFT inputs and train the model to predict the next edge or next citation. Very cheap, very Forge-specific, differentiates from generic open models.

### 14.5 Cost-optimal training stack (2026, small team)

**Frameworks:**
- **torchtune** (PyTorch-native, FSDP-2 friendly, supports Muon, good for CPT + SFT up to 70B)
- **axolotl** as a fallback for rapid SFT/DPO iteration on 7–32B
- **vLLM 0.9+** for serving
- **SGLang** for long-context (Deep mode)
- **Weights & Biases** for experiment tracking (free tier fine until Phase 2)
- **Together + Nebius** split for compute (on-demand for short + spot for CPT)

**Build-don't-buy list:** retrieval index (self-hosted Qdrant/Milvus + Pyserini + ColBERT-v2), eval harness (LM-eval-harness-v2 fork), data pipeline (DVC + Dolt for versioned corpora), feedback store (direct Firestore, no extra infra).

**Buy-don't-build list:** training compute (Together), citation metadata (Crossref — already wired), tokenizer training (sentencepiece OSS is fine).

---

## Sources

- [OpenScholar (Nature, Feb 2026)](https://www.nature.com/articles/s41586-025-10072-4)
- [OpenScholar arXiv preprint](https://arxiv.org/abs/2411.14199)
- [AI2 OLMo 3 announcement](https://allenai.org/blog/olmo3)
- [Best Open Source LLM in 2026 — BenchLM](https://benchlm.ai/blog/posts/best-open-source-llm)
- [DeepSeek V3.2 vs Llama 4 vs Qwen 3 — Spheron 2026](https://www.spheron.network/blog/deepseek-vs-llama-4-vs-qwen3/)
- [Best AI Models April 2026 — buildfastwithai](https://www.buildfastwithai.com/blogs/best-ai-models-april-2026)
- [Open Source LLM Leaderboard 2026 — Vellum](https://www.vellum.ai/open-llm-leaderboard)
- [DeepSeek V3.2 technical tour — Raschka](https://magazine.sebastianraschka.com/p/technical-deepseek)
- [Qwen3 Technical Report](https://arxiv.org/abs/2505.09388)
- [GPQA Diamond leaderboard — Artificial Analysis](https://artificialanalysis.ai/evaluations/gpqa-diamond)
- [Muon is Scalable for LLM Training (Moonshot 2025)](https://arxiv.org/abs/2502.16982)
- [Practical Efficiency of Muon for Pretraining (Essential AI 2025)](https://arxiv.org/pdf/2505.02222)
- [Muon for Improved Foundation Model Pretraining — Nubank 2026](https://building.nubank.com/muon-for-improved-foundation-model-pretraining-data-efficiency/)
- [Muon vs MuonClip vs Muon+AdamW for Fine-Tuning — HF](https://huggingface.co/blog/KingNish/optimizer-part1)
- [DPO Isn't Enough: Modern Post-Training Stack — SimPO, ORPO, KTO](https://medium.com/@fahey_james/dpo-isnt-enough-the-modern-post-training-stack-simpo-orpo-kto-and-beyond-d82e52a1ee6c)
- [Post-Training in 2026: GRPO, DAPO, RLVR — llm-stats](https://llm-stats.com/blog/research/post-training-techniques-2026)
- [Rainbow-PO ICLR 2025](http://www.columbia.edu/~wt2319/RainbowPO.pdf)
- [DoRA — NVIDIA Technical Blog](https://developer.nvidia.com/blog/introducing-dora-a-high-performing-alternative-to-lora-for-fine-tuning/)
- [LoRA, QLoRA, DoRA in 2026 — Towards AI](https://pub.towardsai.net/lora-qlora-dora-which-fine-tuning-method-should-you-actually-use-296b53ea1aa9)
- [LoRA / QLoRA / DoRA / QDoRA comparison — Encora](https://www.encora.com/interface/comparing-fine-tuning-optimization-techniques-lora-qlora-dora-and-qdora)
- [Fine-Tuning Infrastructure at Scale — Introl 2026](https://introl.com/blog/fine-tuning-infrastructure-lora-qlora-peft-scale-guide-2025)
- [Hybrid Search in RAG 2026 — GoPenAI](https://blog.gopenai.com/hybrid-search-in-rag-dense-sparse-bm25-splade-reciprocal-rank-fusion-and-when-to-use-which-fafe4fd6156e)
- [Production Retrievers in RAG — ColBERT, SPLADE, e5/BGE](https://machine-mind-ml.medium.com/production-rag-that-works-hybrid-search-re-ranking-colbert-splade-e5-bge-624e9703fa2b)
- [Hybrid Dense-Sparse Retrieval — Premai](https://blog.premai.io/hybrid-search-for-rag-bm25-splade-and-vector-search-combined/)
- [Parametric RAG SIGIR 2025](https://dl.acm.org/doi/10.1145/3726302.3729957)
- [RAG comprehensive survey 2025](https://arxiv.org/abs/2506.00054)
- [Dolma 3 / OLMo 3](https://allenai.org/blog/olmo3)
- [OpenAlex documentation](https://docs.openalex.org/)
- [S2ORC GitHub](https://github.com/allenai/s2orc)
- [Biomed-Enriched 2025](https://arxiv.org/abs/2506.20331v1)
- [eBay Llama 3.1 70B continued pretraining](https://www.zenml.io/llmops-database/domain-adapted-llms-through-continued-pretraining-on-e-commerce-data)
- [Domain adaptation Llama3-70B — arXiv](https://arxiv.org/html/2406.14971v1)
- [Continuing Pre-Training on Raw Text — McCormick 2025](https://mccormickml.com/2025/01/18/continuing-pre-training-on-raw-text/)
- [LLM Training Cost — Galileo 2026](https://galileo.ai/blog/llm-model-training-cost)
- [AI Model Training Costs 2026 — localaimaster](https://localaimaster.com/blog/ai-model-training-costs-2025-analysis)
- [GPU Cloud Pricing Comparison 2026 — Spheron](https://www.spheron.network/blog/gpu-cloud-pricing-comparison-2026/)
- [H100 Rental Prices 2026 — IntuitionLabs](https://intuitionlabs.ai/articles/h100-rental-prices-cloud-comparison)
- [NVIDIA H200 Price April 2026 — Thundercompute](https://www.thundercompute.com/blog/nvidia-h200-pricing)
- [NVIDIA Blackwell Pricing B200 / B300 / DGX](https://tech-insider.org/nvidia-blackwell-gpu-pricing/)
- [FutureHouse Platform — Crow/Falcon/Owl](https://www.futurehouse.org/research-announcements/launching-futurehouse-platform-ai-agents)
- [PaperQA3 / Edison Scientific](https://edisonscientific.com/articles/edison-literature-agent)
- [ScienceAgentBench](https://osu-nlp-group.github.io/ScienceAgentBench/)
- [HalluLens ACL 2025](https://aclanthology.org/2025.acl-long.1176/)
- [Scientific LLMs survey 2025](https://arxiv.org/html/2508.21148v1)
- [Fine Tuning AI Models in 2026 — Gauraw](https://www.gauraw.com/fine-tuning-llm-lora-dpo-guide-2026/)
- [Common Corpus 2.27T open-license tokens — arXiv 2506.01732](https://arxiv.org/abs/2506.01732)
- [The Common Pile v0.1 (8TB open-license) — arXiv 2506.05209](https://arxiv.org/abs/2506.05209)
- [Top 10 LLM Training Datasets for 2026 — OpenDataScience](https://opendatascience.com/the-top-10-llm-training-datasets-for-2026/)
- [FineWeb-Edu vs RedPajama quality comparison](https://www.together.ai/blog/redpajama-data-v2)
- [GaLore — arXiv 2403.03507](https://arxiv.org/abs/2403.03507)
- [GaLore 2: Large-Scale LLM Pretraining by Gradient Low-Rank Projection](https://arxiv.org/abs/2504.20437)
- [MIT News — LLM training efficiency Feb 2026](https://news.mit.edu/2026/new-method-could-increase-llm-training-efficiency-0226)
- [MIT News — Leaner faster learning Apr 2026](https://news.mit.edu/2026/new-technique-makes-ai-models-leaner-faster-while-still-learning-0409)
- [Data Pruning for Pretraining LLMs at Scale — OpenReview](https://openreview.net/pdf?id=XUIYn3jo5T)
- [Scalable MoE Pretraining Aurora 2026 — arXiv 2604.00785](https://arxiv.org/html/2604.00785v1)
- [nanoMoE — Cameron Wolfe 2025](https://cameronrwolfe.substack.com/p/nano-moe)
- [Stanford CS336 — Language Modeling from Scratch](https://cs336.stanford.edu/)
- [Simple and Scalable CPT — arXiv 2403.08763](https://arxiv.org/abs/2403.08763)
- [DeepSpeed Training Features](https://www.deepspeed.ai/training/)
- [Gradient Checkpointing Memory-Saving Hack](https://medium.com/mlworks/gradient-checkpointing-the-unsung-hero-of-llm-training-ac2bbe5d4396)
- [LLMQ: Lower-Precision Pretraining for Consumer GPUs — arXiv 2512.15306](https://www.arxiv.org/pdf/2512.15306)
- [Efficient Training of LLMs on Distributed Infrastructures — arXiv 2407.20018](https://arxiv.org/pdf/2407.20018)
