# Kaggle training pipeline — Veritas-R1 Stage 1

> **Why this directory exists:** the Stage-1 CPU run on a Windows box hit two
> walls — wall-clock (8h+ extrapolated) and miscalibration (confidence rose
> while accuracy held flat on a 24-row training set). Both are fixed by
> moving training to **Kaggle** with a real GPU and a properly sized
> regularised dataset.

## What's here

```
kaggle/
├── README.md                                   ← this file
└── notebooks/
    ├── veritas-stage1-train.ipynb              ← 3-seed ensemble training
    ├── veritas-stage1-eval.ipynb               ← ECE + reliability + confusion + selective curve
    └── veritas-stage1-temperature.ipynb        ← standalone temperature scaling
```

## How to run on Kaggle

### 1. Create a new Kaggle Notebook
- Go to https://www.kaggle.com/code → "New Notebook"
- Settings → **Accelerator: GPU T4 x2** (free) or **GPU P100** (free)
- Settings → **Internet: ON** (needed to pull `tals/vitaminc` + Qwen2.5-1.5B from HF Hub)
- Persistence: **Variables and Files** if you want adapters to persist between sessions

### 2. Upload notebooks one at a time
Either:
- **File → Import Notebook** (upload the `.ipynb` directly), OR
- **Add Notebook** → paste raw URL if these are committed to a public repo

### 3. Run order
1. **`veritas-stage1-train.ipynb`** — installs deps, pulls data, trains 3 LoRA adapters (seeds 17/23/29). Outputs to `/kaggle/working/adapters/seed_*/`. Wall-clock ~45-60 min on T4×2.
2. **`veritas-stage1-eval.ipynb`** — loads each seed's saved logits, fits temperature, computes ECE/Brier/F1, deep-ensembles (probability-space average), produces reliability + confusion + selective-prediction PNGs. ~5-10 min, no GPU needed.
3. **`veritas-stage1-temperature.ipynb`** — standalone temperature scaling if you want to re-fit T later without re-running eval. ~2 min.

### 4. Download artefacts
After the run, download from `/kaggle/working/`:
- `adapters/seed_*/` — three LoRA adapters (each ≈10 MB)
- `eval_results/` — reliability.png, selective.png, confusion_matrix.png, scoreboard.json
- `stage1_eval_summary.json` — top-line scoreboard
- `run_metrics.json` — per-seed training summaries

## What the run delivers (vs the Stage-1 24-row failure)

| Concern | 24-row run | Kaggle run |
|---|---|---|
| Dataset | 24 rows, no val/test | 12K train (oversampled) / 1.5K val / 1.5K test, all stratified, drawn from native Vitamin-C splits |
| Base model | SmolLM2-135M | Qwen2.5-1.5B-Instruct (10× capacity, fits T4 16GB at QLoRA-r16) |
| LoRA dropout | 0.05 | **0.15** |
| Weight decay | 0.0 | **0.05** (linear layers only) |
| R-Drop | none | **on**, KL=1.0 |
| LLRD | none | **0.9** decay per layer |
| Early stopping | none | patience=2 on val NLL |
| Token-mask augmentation | none | 5% on training evidence |
| Calibration | none | **temperature scaling + 3-seed deep ensemble** |
| Metrics tracked | accuracy + NLL | + **ECE-15, Brier, macro-F1, reliability bins, selective accuracy curve** |
| Hardware | Windows CPU | GPU (T4×2 or P100) |
| Reproducibility | partial | **fully seeded**, pinned wheels, deterministic data-split |

## Post-run integration

The downloaded adapters live in:
```
veritas/training/out/kaggle/seed_{17,23,29}/
```
The `forge_veritas.calibration` package (in this repo) loads them, applies
the saved temperatures, runs MC dropout if needed, and prob-averages.
This is the runtime path that Stage 2 / Stage 3 will build on top of.

## Troubleshooting

- **OOM on T4×2** — drop batch size from 8 → 4. Effective batch held via accumulation.
- **`bitsandbytes` import error** — use the `--upgrade` line in the install cell verbatim; older Kaggle base images sometimes pin a stale BNB.
- **`flash_attention_2` not available** — fall back to eager attention by setting `attn_implementation="eager"` in `build_model`. Throughput drops ~30%, calibration is unaffected.
- **All seeds give identical results** — verify torch's manual_seed is being called BEFORE `build_model`. If reproducibility is too tight (zero ensemble variance), bump dropout or use deeper seeds.
