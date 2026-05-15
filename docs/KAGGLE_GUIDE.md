# Training Veritas-R1 on Kaggle — step-by-step

> Owner: Rakshit Khanna · 2026-04-26
> Plan: [`VERITAS_TRAINING_PLAN_V2.md`](./VERITAS_TRAINING_PLAN_V2.md)
> Datasets: [`CURATED_DATASETS.md`](./CURATED_DATASETS.md)

This is the operator's guide. If you've never touched Kaggle Notebooks before, follow the steps below in order. Total wall-clock to a calibrated Stage-3 checkpoint is **roughly 25-30 hours of GPU time** spread across **3-4 sessions**, all inside the Kaggle free tier (30 h/week).

---

## 0. One-time setup (5 min)

1. **Make a Kaggle account** at https://www.kaggle.com/account/login.
2. **Verify your phone number** in *Account → Profile → Phone Verification*. Without this, you cannot use the GPU runtime.
3. (Optional, recommended) **Add a HuggingFace token** at *Account → Add-ons → Secrets* with the key name `HF_TOKEN`. It's not strictly required — all the datasets we use are public — but it speeds up downloads and avoids occasional rate-limit failures. Get a token at https://huggingface.co/settings/tokens.

That's all the prep. You won't need a credit card.

---

## 1. Create a new notebook

1. Go to https://www.kaggle.com/code → **New Notebook**.
2. In the right-hand sidebar:
   - **Accelerator**: pick **GPU T4 x2** (free, 30 h/week) or **GPU P100** (free, 30 h/week). T4×2 is preferred for our workload (better aggregate VRAM via the second card).
   - **Internet**: **ON**. Without it, the notebook can't pull HuggingFace datasets or models.
   - **Persistence**: **Variables and Files**. Lets your `/kaggle/working` artefacts survive between sessions on the same notebook.
3. Leave everything else default.

---

## 2. Stage 1 — SFT cold-start (~5 hours per seed × 3 seeds)

This is the biggest job. It trains the LoRA adapter on the workspace curriculum. You can do all 3 seeds in one notebook session if you have a clean 15-hour stretch, or split them across 3 days using the persistence feature.

1. **Click File → Import Notebook** (top-left menu in your new notebook).
2. **Upload `kaggle/notebooks/veritas-stage1-train.ipynb`** from this repo.
3. Verify the notebook opened correctly. Read the top markdown cell to confirm:
   - Base model: `Qwen/Qwen3-1.7B-Instruct`
   - Curriculum: 8 datasets, ~246K train rows
   - Outputs: `/kaggle/working/adapters/seed_{17,23,29}/adapter`
4. **Run All** (the ▶▶ button at the top, or Ctrl+F9).
5. Wait. The first cells install pinned packages (~3 min), then dataset pull (~5 min), then training (~5 hours per seed). Each seed saves to its own folder; if Kaggle disconnects mid-run, the next session's `Run All` will skip already-trained seeds via the cached `summary.json` check.
6. When all seeds finish, you'll see `All seeds done.` and three folders under **Output → adapters/**.

**Tips during the run:**
- Don't close the browser tab in the first 30 seconds (Kaggle needs to attach the GPU).
- After 30s, you can close the tab — the notebook keeps running on the server. Come back any time to monitor progress.
- If you see `OOMError`, drop `batch_size` from 8 → 4 in the Stage-1 train cell.
- If `flash_attention_2` fails to import on a particular Kaggle image, change the `attn_implementation` line to `"eager"`. ~25% slower but works on every GPU.

---

## 3. (Optional) Stage 1.5 — Synthetic-paraphrase augmentation (~3 hours)

Skip this if Stage-1 metrics already meet your bar. Run if you want another ~25% training data for free.

1. **Open the same notebook** (Persistence keeps your Stage-1 adapters).
2. **File → Import Notebook → upload `veritas-stage1-augment.ipynb`**.
3. **Run All**.
4. The notebook reads `/kaggle/working/adapters/seed_17/adapter`, generates paraphrases for ~60K prompts, filters and saves to `/kaggle/working/augmented/sft_train_augmented.parquet`.
5. To use the augmented data, edit `veritas-stage1-train.ipynb` per the instructions in its last markdown cell, and re-run Stage 1 (only seed 17 is needed for the augmented round; the other two seeds remain valid).

---

## 4. Stage 3 — Iterative SimPO (~9 hours, 3 rounds)

Replaces planned DPO with Meta's SimPO recipe. Each round samples fresh preference pairs from the previous round's checkpoint.

1. **Open the same notebook** (Stage-1 adapter must be present at `/kaggle/working/adapters/seed_17/adapter`).
2. **File → Import Notebook → upload `veritas-stage3-simpo.ipynb`**.
3. **Run All**.
4. Each round runs in two phases:
   - **Sampling** (~1 h): generates 4 completions per prompt, scores them, builds 5K (chosen, rejected) pairs.
   - **Training** (~2 h): SimPO trainer over those pairs.
5. After all 3 rounds, the final adapter lives at `/kaggle/working/simpo/round-3/adapter`.

**Tip**: rounds are checkpointed independently — if a round was interrupted, the next `Run All` skips already-completed rounds.

---

## 5. Eval + calibration (~30 min)

These notebooks were originally written for the Vitamin-C classification pipeline; they still work for inspecting saved logits, but for the workspace SFT model you'll want to add your own task-specific eval. The provided notebooks cover ECE / reliability / temperature scaling on saved logits — useful sanity checks if you adapt them.

1. **Open `veritas-stage1-eval.ipynb`** to compute metrics on saved logits (point `ADAPTER_ROOT` at any of the seed/round adapters).
2. **Open `veritas-stage1-temperature.ipynb`** for standalone post-hoc temperature scaling.

For the workspace model, the most useful smoke eval is qualitative: spin up `transformers.pipeline` with the adapter and try 5-10 prompts across the 8 dataset skills (write, reason, recall, logic, tool, research, contradict, chat). If outputs feel reasonable on each, the model is ready for your own benchmark.

---

## 6. Download the final adapter

1. In the right sidebar **Output** panel, navigate to `/kaggle/working/simpo/round-3/adapter`.
2. Right-click → **Download** to save the adapter (~10 MB).
3. The base model `Qwen/Qwen3-1.7B-Instruct` is on HuggingFace; you don't need to download it — at inference time, attach the adapter on top of the live base model.

---

## Total compute budget

| Stage | Compute | Wall-clock | Sessions |
|---|---|---:|---:|
| Stage 1 SFT — single seed | 1× T4×2 | ~5 h | 1 |
| Stage 1 SFT — 3-seed ensemble | 1× T4×2 | ~15 h | 2-3 |
| Stage 1.5 Augment (optional) | 1× T4×2 | ~3 h | 1 |
| Stage 3 SimPO — 3 rounds | 1× T4×2 | ~9 h | 1-2 |
| Eval + calibration | CPU OK | ~30 min | 1 |
| **Total** | | **~27-30 h** | **4-6 sessions** |

Free tier ceiling is 30 h/week. Comfortable.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `OOMError` during training | Drop `batch_size` from 8 to 4 in `train_one_seed`. Effective batch held by gradient_accumulation. |
| `bitsandbytes` import error | Use the `--upgrade` line in the install cell verbatim; some older Kaggle images pin a stale BNB. |
| `flash_attention_2` fails to load | Change `attn_implementation="flash_attention_2"` → `"eager"`. ~25% slower, otherwise identical. |
| `HF_TOKEN` rate-limit warnings | Add an HF token to your Kaggle Secrets (Step 0). |
| Notebook times out at 12h limit | Persistence is on; re-open the notebook, `Run All` again — completed seeds are skipped. |
| Kaggle says "GPU quota exhausted" | The 30 h/week resets weekly. Wait until the next reset OR switch to P100 (separate quota from T4). |
| Adapters > 4 GB and download fails | Adapters are LoRA-only; should be ≤ 50 MB. If you accidentally saved a full model, re-run with `model.save_pretrained` instead of `trainer.save_model`. |

---

## What gets you to a finished, deployable model?

1. ✅ Stage-1 SFT, 3-seed ensemble — `/kaggle/working/adapters/seed_*/adapter` (3 × ~10 MB)
2. ✅ Stage-3 SimPO 3-round adapter — `/kaggle/working/simpo/round-3/adapter` (~10 MB)
3. The base model `Qwen/Qwen3-1.7B-Instruct` (loaded at inference time from HF Hub)

That's the whole package. To serve, the production stack stacks adapter on base via `peft.PeftModel.from_pretrained(base, adapter_path)` and exposes it via vLLM or any OpenAI-compatible inference server.
