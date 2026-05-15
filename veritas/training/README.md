# `veritas/training/` — Veritas-R1 training package

> **Plan:** [`docs/VERITAS_TRAINING_PLAN_V2.md`](../../docs/VERITAS_TRAINING_PLAN_V2.md)
> **Roadmap:** [`docs/PHASE3_CHECKPOINTS.md`](../../docs/PHASE3_CHECKPOINTS.md)

This Python package is the training pipeline for **Veritas-R1**, Forge's in-house conversational + reasoning model. It is intentionally **separate** from the TypeScript app code (`src/lib/veritas/`) — training runs on rented GPU; the TS code never imports anything from here.

## Status

| Checkpoint | Status |
|---|---|
| **CP1** — Decide model + technique, scaffold package | ✅ done (this commit) |
| CP2 — Qwen3 chat-template adapter (TS) | next |
| CP3-CP15 | not started — see roadmap |

## Decisions locked in CP1

| Concern | Decision |
|---|---|
| Base model | **Qwen3-14B** (Apache-2.0, native dual-mode chat template) |
| PEFT | QLoRA r=64 α=128, 4-bit NF4 base |
| Frameworks | Unsloth (~2× speedup) + TRL (SFT/GRPO/DPO) + Liger Kernel (fused CE) |
| Stages | SFT cold-start → GRPO with verifiable rewards → DPO on real Firestore preferences → optional 3B distillation post-beta |
| Compute | 1× H100 80GB spot (Modal / RunPod / Vast.ai) |
| Total cost to beta | ~$500–$700 in compute, well under the $1,900 envelope |
| Tracking | Weights & Biases (free tier) |
| Serving | vLLM AWQ-int4 → Modal asgi_app, OpenAI-compat HTTP |

Justification for each is in `docs/VERITAS_TRAINING_PLAN_V2.md` §1-§2.

## Layout

```
veritas/training/
├── pyproject.toml                  Python deps & build
├── README.md                       this file
├── .gitignore                      ignores out/, data/, wandb/
├── config/
│   └── base.yaml                   inherited by every stage config
├── data/                           regenerable training shards (gitignored)
├── out/                            adapter checkpoints (gitignored)
├── results/                        eval scoreboards (summary csvs committed)
├── serving/                        vLLM Dockerfile + Modal app (CP13/14)
└── src/forge_veritas/
    ├── __init__.py
    ├── config.py                   YAML loader (base + stage merge)
    ├── data/                       CP3, CP4, CP5, CP10
    ├── train/                      CP6, CP9, CP11, CP15
    ├── eval/                       CP7, CP12
    ├── rewards/                    CP8
    └── serving/                    CP13, CP14
```

## Setup (run before any compute checkpoint)

```bash
cd veritas/training
python3.11 -m venv .venv
source .venv/bin/activate
pip install -U pip
pip install -e ".[dev]"
# At a compute checkpoint that needs vLLM:
pip install -e ".[serving]"
```

## Running a checkpoint

Each compute checkpoint has its own driver script under `src/forge_veritas/train/`. Configs are merged from `config/base.yaml` + `config/<stage>.yaml`. Example (CP6, lands later):

```bash
python -m forge_veritas.train.sft \
    --config config/sft.yaml \
    --data data/sft/train.parquet \
    --output out/sft-r64
```

## Why this is *not* under `src/`

The Next.js app's `tsconfig.json` covers `src/**`. Putting Python under `src/` would force `.tsbuildignore` rules that drift over time. Keeping training code at the repo root in its own directory makes the boundary obvious to both compilers and humans.

## Why no model files / data files in git

Adapter weights, dataset shards, and wandb run state are all derived artefacts. Anything reproducible from a checkpointed config + a tagged commit + a public dataset id stays out of git. `out/`, `data/`, and `results/raw/` are explicitly ignored.

The single exception is `results/<run-id>.csv` — small summary scoreboards that are useful in PR diffs.
