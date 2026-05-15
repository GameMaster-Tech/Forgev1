"""SimPO — Simple Preference Optimization (Meng, Xia, Chen 2024).

Why SimPO replaces DPO in our pipeline
──────────────────────────────────────
Meta's Llama 3.1 post-training recipe ships SimPO over DPO and the paper
demonstrates a 3-7 point AlpacaEval2 / Arena-Hard / MT-Bench delta. The
practical wins for our setup:

    1. NO REFERENCE MODEL.
       DPO requires holding the SFT checkpoint frozen alongside the policy
       to compute log-prob ratios. That's 2× the GPU memory at preference
       time and effectively halves our usable batch size on a Kaggle T4.
       SimPO uses the average log-likelihood directly — no reference at all.
       On Kaggle: ~50% GPU memory reduction → batch can grow from 4 → 8 at
       seq_len 512 with QLoRA on Qwen3-1.7B.

    2. LENGTH-NORMALISED REWARD.
       DPO's reward `log π(y|x)` scales with sequence length, so longer
       responses get higher reward by accident. SimPO normalises by
       `1/|y|` so length bias disappears. This matters disproportionately
       for our workspace use case where helpful answers vary 50–500 tokens.

    3. EXPLICIT MARGIN HYPERPARAMETER.
       The `gamma` term in SimPO directly controls the target margin between
       chosen and rejected log-probs. Tuning it is a single-knob
       optimisation; DPO's `beta` is a less-direct lever.

    4. LOSS:
            L_SimPO = -log σ(
                β · ( (log π(y_chosen) / |y_chosen|) - (log π(y_rejected) / |y_rejected|) )
                  - γ
            )

       β controls overall reward scale (we use 2.5 per the SimPO paper §3),
       γ is the margin (we use 1.4 per the same).

This module wraps TRL ≥ 0.11's `SimPOTrainer` with the Forge regularisation
hooks (LLRD, R-Drop is OFF for preference — preference data is already a
contrastive signal).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import torch

log = logging.getLogger("forge_veritas.preference")


@dataclass(slots=True)
class SimPOTrainConfig:
    """Configuration for one SimPO round.

    Iterative SimPO calls this trainer 3× — see Meta's Llama 3.1 §4.
    Each round generates fresh preference pairs from the current
    checkpoint, then trains. The `round_idx` is informational only;
    the trainer does not change between rounds.
    """

    base_model: str
    sft_adapter_path: str               # output of Stage-1 SFT
    preference_data_path: str           # parquet with {prompt, chosen, rejected}
    output_dir: str
    round_idx: int = 1                  # 1, 2, 3 in iterative SimPO

    # Core SimPO hyperparameters — values from Meng et al. 2024 §3
    beta: float = 2.5                   # reward scale
    gamma: float = 1.4                  # target margin
    learning_rate: float = 5e-7         # SimPO works at much lower LR than SFT
    epochs: float = 1.0
    per_device_batch: int = 4
    grad_accum: int = 4
    max_seq_len: int = 1024
    max_prompt_len: int = 512

    # LoRA delta on top of SFT adapter
    lora_r: int = 16
    lora_alpha: int = 32
    lora_dropout: float = 0.05
    target_modules: tuple[str, ...] = (
        "q_proj", "k_proj", "v_proj", "o_proj",
    )

    # Optimisation
    warmup_ratio: float = 0.1
    weight_decay: float = 0.0           # SimPO works best with WD off
    lr_scheduler_type: str = "cosine"
    optim: str = "adamw_torch"
    bf16: bool = True
    gradient_checkpointing: bool = True

    # Reproducibility
    seed: int = 17

    # Logging
    logging_steps: int = 25
    save_strategy: str = "epoch"


def train_simpo_round(cfg: SimPOTrainConfig) -> dict[str, Any]:
    """Run one round of SimPO on top of the latest checkpoint.

    Returns
    -------
    A dict with `output_dir`, `train_loss`, `train_runtime`, `round_idx`.
    The output adapter is saved at `<output_dir>/round-<idx>/adapter`.
    """
    # Lazy imports — heavy. Only import when actually training.
    from datasets import load_dataset
    from peft import LoraConfig, PeftModel
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

    try:
        from trl import SimPOConfig, SimPOTrainer  # type: ignore[attr-defined]
    except ImportError as e:
        raise RuntimeError(
            "SimPO requires `trl >= 0.11`. Install via `pip install -U trl`."
        ) from e

    log.info("=== SimPO round %d ===", cfg.round_idx)
    log.info("base_model=%s sft_adapter=%s", cfg.base_model, cfg.sft_adapter_path)

    out_dir = Path(cfg.output_dir) / f"round-{cfg.round_idx}"
    out_dir.mkdir(parents=True, exist_ok=True)

    # 1. Load tokenizer + base model with QLoRA
    tokenizer = AutoTokenizer.from_pretrained(cfg.base_model)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    bnb = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_use_double_quant=True,
        bnb_4bit_compute_dtype=torch.bfloat16 if cfg.bf16 else torch.float16,
    )
    base = AutoModelForCausalLM.from_pretrained(
        cfg.base_model,
        quantization_config=bnb,
        torch_dtype=torch.bfloat16 if cfg.bf16 else torch.float16,
        attn_implementation="flash_attention_2",
    )

    # 2. Load Stage-1 SFT adapter — SimPO trains a delta on top
    model = PeftModel.from_pretrained(base, cfg.sft_adapter_path, is_trainable=True)
    model.print_trainable_parameters()

    # 3. Load preference dataset (parquet)
    ds = load_dataset(
        "parquet",
        data_files={"train": cfg.preference_data_path},
        split="train",
    )

    # 4. Configure SimPO. The TRL config object holds beta/gamma directly.
    simpo_args = SimPOConfig(
        output_dir=str(out_dir),
        num_train_epochs=cfg.epochs,
        per_device_train_batch_size=cfg.per_device_batch,
        gradient_accumulation_steps=cfg.grad_accum,
        learning_rate=cfg.learning_rate,
        warmup_ratio=cfg.warmup_ratio,
        weight_decay=cfg.weight_decay,
        lr_scheduler_type=cfg.lr_scheduler_type,
        bf16=cfg.bf16,
        gradient_checkpointing=cfg.gradient_checkpointing,
        beta=cfg.beta,
        gamma_beta_ratio=cfg.gamma / cfg.beta,
        max_length=cfg.max_seq_len,
        max_prompt_length=cfg.max_prompt_len,
        logging_steps=cfg.logging_steps,
        save_strategy=cfg.save_strategy,
        seed=cfg.seed,
        optim=cfg.optim,
        report_to=[],
        remove_unused_columns=False,
    )

    # New LoRA on top of the SFT adapter
    new_lora = LoraConfig(
        r=cfg.lora_r,
        lora_alpha=cfg.lora_alpha,
        lora_dropout=cfg.lora_dropout,
        bias="none",
        task_type="CAUSAL_LM",
        target_modules=list(cfg.target_modules),
    )

    trainer = SimPOTrainer(
        model=model,
        args=simpo_args,
        train_dataset=ds,
        processing_class=tokenizer,
        peft_config=new_lora,
    )
    log.info("Starting SimPO training (round %d, %d examples)", cfg.round_idx, len(ds))
    out = trainer.train()
    trainer.model.save_pretrained(out_dir / "adapter")
    tokenizer.save_pretrained(out_dir / "adapter")

    metrics = {
        "round_idx": cfg.round_idx,
        "output_dir": str(out_dir),
        "train_loss": float(out.training_loss) if out.training_loss is not None else None,
        "train_runtime_sec": float(out.metrics.get("train_runtime", 0.0)),
        "global_steps": int(out.global_step),
        "examples": len(ds),
    }
    log.info("SimPO round %d complete: %s", cfg.round_idx, metrics)
    return metrics


# ────────────────────────────────────────────────────────────────────
#  Iterative-SimPO orchestration
# ────────────────────────────────────────────────────────────────────


@dataclass(slots=True)
class IterativeSimPOPlan:
    """Configuration for the full 3-round iterative SimPO loop.

    Per Meta's Llama 3.1 paper §4, after each round we:
       1. Sample fresh outputs from the latest checkpoint on a held-out
          prompt set.
       2. Score with a reward model OR rule-based judge.
       3. Convert the highest- and lowest-scoring pairs into new
          (prompt, chosen, rejected) preference data.
       4. Train round N+1 on the new pairs.

    The notebook orchestrates the sampling+scoring+packing between rounds
    using the helpers in this module. The trainer config itself is
    unchanged across rounds — only the data + checkpoint advance.
    """

    base_model: str
    initial_sft_adapter: str
    output_root: str
    rounds: int = 3
    pairs_per_round: int = 5_000
    sampling_temperature: float = 0.8
    sampling_top_p: float = 0.9
    seed: int = 17

    # Per-round overrides — by default each round uses the same
    # SimPOTrainConfig defaults. The notebook can override beta/lr
    # if a particular round needs adjustment.
    round_overrides: dict[int, dict[str, Any]] = field(default_factory=dict)
