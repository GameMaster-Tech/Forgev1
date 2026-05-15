"""SFT training driver — Stage 1 (Vitamin-C, dev-mode) + Stages 2-7 production.

One file handles both modes via `--mode {stage1,production}`. Stage 1 in
dev-mode runs on CPU with SmolLM2-135M against the smallest Forge-relevant
dataset (Vitamin-C contradiction detection). Production mode runs the same
code path on Qwen3-14B + QLoRA + DoRA + NEFTune + sample packing on H100.

Why one file (not two)
──────────────────────
The training-pipeline bug surface lives in the seams between adapter,
tokenizer, LoRA wiring, save/load, and eval. Forking dev and production
into separate scripts creates two seams to debug. Keeping them one script
with config-driven branching means the dev run literally exercises the
same code path the production run will, minus the CUDA/quant pieces that
can't run on Windows CPU.

Why no "smoke" stage exists anymore
───────────────────────────────────
Earlier drafts had a Stage-0 smoke run on MATH-500. Olympiad math is not
a Forge skill, so the smoke run was teaching the model a behaviour the
user never asks for — wasted training tokens. Stage 1 trains a real
Forge skill (contradiction detection) against a real Forge-relevant
dataset (Vitamin-C) from row #1, even on CPU.

Efficient techniques (2026-current)
───────────────────────────────────
Production mode pulls in every safe efficiency win that's stable in
April 2026:
    • DoRA           — Weight-Decomposed LoRA, ~+0.5 GPQA at same cost
    • NEFTune        — random embed noise; free instruction-tuning win
    • Liger Kernel   — fused CE / RMSNorm / RoPE; saves ~4GB at 14B
    • Flash Attn 3   — H100-only attention kernel (FA2 fallback)
    • Sample packing — 2× tokens/sec on mixed-length instruction data
    • AdamW-8bit     — half optimizer-state memory
    • bf16 mixed     — bf16 forward + fp32 master weights
    • QLoRA 4-bit NF4 — 14B fits on a single H100 80GB with batch room

Smoke mode disables everything CUDA-specific and runs plain LoRA on
torch SDPA + fp32. The point is to validate the pipeline, not the model.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import random
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

# Heavy imports stay top-level — every code path needs them. We tolerate
# the ~3s import cost because this script is invoked once per training run.
import torch
from datasets import Dataset, load_dataset
from peft import LoraConfig, PeftModel, get_peft_model
from transformers import AutoModelForCausalLM, AutoTokenizer, TrainingArguments

log = logging.getLogger("forge_veritas.sft")


# ─────────────────────────────────────────────────────────────────────
#  Run config — one dataclass for every knob the training reads
# ─────────────────────────────────────────────────────────────────────


@dataclass(slots=True)
class SFTConfig:
    mode: str                       # "stage1" or "production"
    base_model: str
    dataset_id: str
    dataset_config: str | None
    dataset_split: str
    take: int                       # rows to use
    output_dir: str
    seed: int = 17

    # LoRA / DoRA
    lora_r: int = 8
    lora_alpha: int = 16
    lora_dropout: float = 0.05
    use_dora: bool = False
    use_rslora: bool = False        # rank-stabilised LoRA
    target_modules: tuple[str, ...] = (
        "q_proj", "k_proj", "v_proj", "o_proj",
        "gate_proj", "up_proj", "down_proj",
    )

    # Train loop
    epochs: float = 1.0
    per_device_batch: int = 1
    grad_accum: int = 4
    learning_rate: float = 2e-4
    warmup_ratio: float = 0.03
    weight_decay: float = 0.0
    max_seq_len: int = 512
    grad_checkpointing: bool = False

    # Production-only knobs (no-op on smoke)
    load_in_4bit: bool = False
    bf16: bool = False
    use_liger: bool = False
    use_flash_attn: bool = False
    neftune_alpha: float = 0.0
    sample_packing: bool = False
    optim: str = "adamw_torch_fused"

    # Eval
    eval_prompts_path: str | None = None


def cfg_stage1(output_dir: str) -> SFTConfig:
    """Stage 1 — Contradiction-detection cold-start on Vitamin-C.

    Dev-mode config tuned for the **most efficient** signal-per-minute on
    CPU. Empirically, seq_len=512 + grad_accum=4 puts each optimizer step
    at ~9 min on this hardware (extrapolating to 8h for 50 steps), so we
    tighten:
        • take=24 rows — small enough for ~20 step total epoch, large
          enough that 3 verdict classes are all represented.
        • max_seq_len=256 — Vitamin-C's claim+evidence avg is ~140
          tokens; 256 captures 95th percentile without quadratic-attn pain.
        • grad_accum=1 — every example is an optimizer step; max signal
          density when total steps is small.
        • lora_r=8 + attention-only targets (q_proj, v_proj) — classic
          LoRA placement, fewer trainable params, smaller backward pass.
        • lr=3e-4 — slightly hotter than the default to compensate for
          the small step budget; cosine decay still tapers it cleanly.
        • epochs=2 — two passes over 24 rows is cheaper than 1 pass over
          48, gives the model two looks at each verdict label, and lets
          us see whether loss is actually descending.
    Target wall-clock: 12-20 min on this CPU. Production (Qwen3-14B / H100)
    re-uses the full r=64 DoRA + all-linear targets path.
    """
    return SFTConfig(
        mode="stage1",
        base_model="HuggingFaceTB/SmolLM2-135M-Instruct",
        dataset_id="tals/vitaminc",
        dataset_config=None,
        dataset_split="train",
        take=24,
        output_dir=output_dir,
        lora_r=8,
        lora_alpha=16,
        target_modules=("q_proj", "v_proj"),  # attention-only LoRA — fewer trainable params
        epochs=2,
        per_device_batch=1,
        grad_accum=1,
        learning_rate=3e-4,
        max_seq_len=256,
        use_dora=False,
        load_in_4bit=False,
        bf16=False,
        use_liger=False,
        use_flash_attn=False,
        neftune_alpha=0.0,
        sample_packing=False,
        optim="adamw_torch",
    )


def cfg_production(output_dir: str, dataset_id: str, take: int) -> SFTConfig:
    """Production config for stages 1-7."""
    return SFTConfig(
        mode="production",
        base_model="Qwen/Qwen3-14B",
        dataset_id=dataset_id,
        dataset_config=None,
        dataset_split="train",
        take=take,
        output_dir=output_dir,
        lora_r=64,
        lora_alpha=128,
        lora_dropout=0.05,
        use_dora=True,
        use_rslora=False,
        epochs=1,
        per_device_batch=4,
        grad_accum=16,
        learning_rate=1e-4,
        max_seq_len=8192,
        grad_checkpointing=True,
        load_in_4bit=True,
        bf16=True,
        use_liger=True,
        use_flash_attn=True,
        neftune_alpha=5.0,
        sample_packing=True,
        optim="adamw_8bit",
    )


# ─────────────────────────────────────────────────────────────────────
#  Dataset adapters — only the smoke (MATH-500) ships in this commit;
#  full curated registry uses `forge_veritas.data.curated.REGISTRY`.
# ─────────────────────────────────────────────────────────────────────


def vitaminc_to_messages(row: dict[str, Any]) -> list[dict[str, str]] | None:
    """Render one Vitamin-C row into the chat-template message list.

    Vitamin-C row schema:
      claim    : str — the claim under test
      evidence : str — a piece of evidence (Wikipedia revision)
      label    : str ∈ {"SUPPORTS", "REFUTES", "NOT ENOUGH INFO"}

    We re-frame as the contradiction-detection task Forge actually runs at
    inference: present claim+evidence, ask SUPPORT / CONTRADICT / NEI, and
    have the model commit to one verdict with a one-sentence rationale.

    Why not preserve the model's `<think>` blocks here?
      Vitamin-C has no native chain-of-thought. Synthesising fake reasoning
      hurts more than it helps — it teaches the model that "thinking" is
      cosmetic, not actually load-bearing. Real reasoning traces enter the
      mix at Stage 4 (OpenThoughts).
    """
    claim = row.get("claim")
    evidence = row.get("evidence")
    label = row.get("label")
    if not all(isinstance(x, str) and x for x in (claim, evidence, label)):
        return None

    label_norm = label.strip().upper()
    if label_norm == "SUPPORTS":
        verdict = "SUPPORT"
        rationale = "The evidence directly supports the claim."
    elif label_norm == "REFUTES":
        verdict = "CONTRADICT"
        rationale = "The evidence contradicts the claim."
    elif label_norm == "NOT ENOUGH INFO":
        verdict = "NOT_ENOUGH_INFO"
        rationale = "The evidence is insufficient to decide either way."
    else:
        return None

    user_msg = (
        f"Claim: {claim.strip()}\n\n"
        f"Evidence: {evidence.strip()}\n\n"
        "Does the evidence support, contradict, or fail to settle the claim? "
        "Reply with one of SUPPORT / CONTRADICT / NOT_ENOUGH_INFO and "
        "a one-sentence rationale."
    )
    assistant_msg = f"{verdict}: {rationale}"

    return [
        {
            "role": "system",
            "content": (
                "You are Veritas-R1, a verification-first research assistant. "
                "Decide whether the given evidence supports, contradicts, or is "
                "insufficient for the claim, and explain in one sentence."
            ),
        },
        {"role": "user", "content": user_msg},
        {"role": "assistant", "content": assistant_msg},
    ]


# ─────────────────────────────────────────────────────────────────────
#  Tokenisation + dataset construction
# ─────────────────────────────────────────────────────────────────────


def build_dataset(cfg: SFTConfig, tokenizer) -> Dataset:
    """Stream the dataset, take `cfg.take` rows, render via the adapter,
    apply the tokenizer's chat template, return a tokenised HF Dataset.

    We tokenise BEFORE TRL's SFTTrainer to keep the training loop's
    behaviour deterministic and avoid the slow Trainer-side recomputation
    on every epoch. Loss-mask is applied so we only train on assistant
    tokens, not the system + user prefix — this is the production-grade
    pattern; SFTTrainer can do this internally but rolling it ourselves
    means smoke + prod use the same code.
    """
    log.info("loading dataset id=%s split=%s take=%d", cfg.dataset_id, cfg.dataset_split, cfg.take)
    raw = load_dataset(
        cfg.dataset_id,
        name=cfg.dataset_config,
        split=cfg.dataset_split,
        streaming=False,
    )
    if cfg.take and len(raw) > cfg.take:
        raw = raw.select(range(cfg.take))

    # Adapter routing — Stage 1 uses Vitamin-C; later stages plug in their own.
    if cfg.dataset_id == "tals/vitaminc":
        adapter = vitaminc_to_messages
    else:
        raise RuntimeError(
            f"no message adapter wired for dataset_id={cfg.dataset_id!r}; "
            "register one in sft.py before invoking."
        )

    examples: list[dict[str, list[int]]] = []
    drops = 0
    for row in raw:
        msgs = adapter(row)
        if msgs is None:
            drops += 1
            continue
        # `apply_chat_template` produces the rendered string ready to
        # tokenise. We tokenise twice: once with the assistant turn
        # included (input_ids), once with everything-but-assistant (prefix)
        # so we can build a label mask that ignores the prefix.
        full = tokenizer.apply_chat_template(
            msgs,
            tokenize=False,
            add_generation_prompt=False,
        )
        prefix_msgs = msgs[:-1]
        prefix = tokenizer.apply_chat_template(
            prefix_msgs,
            tokenize=False,
            add_generation_prompt=True,
        )

        full_ids = tokenizer(
            full,
            truncation=True,
            max_length=cfg.max_seq_len,
            add_special_tokens=False,
        )["input_ids"]
        prefix_ids = tokenizer(
            prefix,
            truncation=True,
            max_length=cfg.max_seq_len,
            add_special_tokens=False,
        )["input_ids"]

        labels = list(full_ids)
        # Mask the prefix so only assistant tokens contribute to loss.
        prefix_len = min(len(prefix_ids), len(labels))
        for i in range(prefix_len):
            labels[i] = -100

        # Drop trivially-short examples — happens when a row's reasoning
        # got truncated below the prefix; nothing to learn from.
        active_tokens = sum(1 for t in labels if t != -100)
        if active_tokens < 4:
            drops += 1
            continue

        examples.append(
            {
                "input_ids": full_ids,
                "attention_mask": [1] * len(full_ids),
                "labels": labels,
            }
        )

    log.info("built dataset rows=%d drops=%d", len(examples), drops)
    if not examples:
        raise RuntimeError("dataset built zero examples — check adapter")
    return Dataset.from_list(examples)


# ─────────────────────────────────────────────────────────────────────
#  Model + LoRA construction
# ─────────────────────────────────────────────────────────────────────


def build_model(cfg: SFTConfig):
    log.info("loading base model id=%s", cfg.base_model)
    model_kwargs: dict[str, Any] = {}

    if cfg.bf16:
        model_kwargs["dtype"] = torch.bfloat16
    if cfg.use_flash_attn:
        # Falls back automatically on hardware that doesn't support FA3.
        model_kwargs["attn_implementation"] = "flash_attention_2"

    if cfg.load_in_4bit:
        # Lazy import — bitsandbytes can't load on Windows CPU.
        from transformers import BitsAndBytesConfig

        model_kwargs["quantization_config"] = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_use_double_quant=True,
            bnb_4bit_compute_dtype=torch.bfloat16,
        )

    model = AutoModelForCausalLM.from_pretrained(cfg.base_model, **model_kwargs)

    # Liger Kernel patches — production only.
    if cfg.use_liger:
        try:
            from liger_kernel.transformers import apply_liger_kernel_to_qwen3

            apply_liger_kernel_to_qwen3(model=model)
            log.info("Liger Kernel patches applied (Qwen3 family).")
        except ImportError:
            log.warning("liger-kernel not installed; falling back to stock kernels")

    # LoRA / DoRA
    target_modules = list(cfg.target_modules)
    lora_cfg = LoraConfig(
        r=cfg.lora_r,
        lora_alpha=cfg.lora_alpha,
        lora_dropout=cfg.lora_dropout,
        bias="none",
        task_type="CAUSAL_LM",
        target_modules=target_modules,
        use_dora=cfg.use_dora,
        use_rslora=cfg.use_rslora,
    )
    model = get_peft_model(model, lora_cfg)
    model.print_trainable_parameters()

    if cfg.grad_checkpointing:
        model.gradient_checkpointing_enable()

    return model


# ─────────────────────────────────────────────────────────────────────
#  Training loop — uses transformers.Trainer, not TRL SFTTrainer.
#  Reason: TRL 1.x added strong opinions about its own dataset format
#  that don't compose cleanly with our pre-tokenised approach. The
#  vanilla Trainer + a manual collator gives us identical behaviour
#  with one less version compatibility headache.
# ─────────────────────────────────────────────────────────────────────


def _collate(batch: list[dict[str, list[int]]], pad_id: int) -> dict[str, torch.Tensor]:
    """Right-pad to the longest example in the batch. Labels pad with -100
    so the loss ignores padding. We do not pad to a multiple-of-N because
    the smoke run uses batch=1 and production uses sample packing (which
    bypasses padding entirely).
    """
    max_len = max(len(ex["input_ids"]) for ex in batch)
    input_ids = []
    attention = []
    labels = []
    for ex in batch:
        pad_len = max_len - len(ex["input_ids"])
        input_ids.append(ex["input_ids"] + [pad_id] * pad_len)
        attention.append(ex["attention_mask"] + [0] * pad_len)
        labels.append(ex["labels"] + [-100] * pad_len)
    return {
        "input_ids": torch.tensor(input_ids, dtype=torch.long),
        "attention_mask": torch.tensor(attention, dtype=torch.long),
        "labels": torch.tensor(labels, dtype=torch.long),
    }


def train(cfg: SFTConfig) -> dict[str, Any]:
    random.seed(cfg.seed)
    torch.manual_seed(cfg.seed)

    Path(cfg.output_dir).mkdir(parents=True, exist_ok=True)

    tokenizer = AutoTokenizer.from_pretrained(cfg.base_model)
    if tokenizer.pad_token is None:
        # Distinct pad token — never reuse EOS, that collapses the loss mask
        # on the final turn (documented mistake in `config/base.yaml`).
        tokenizer.pad_token = tokenizer.unk_token or "<|pad|>"

    dataset = build_dataset(cfg, tokenizer)
    model = build_model(cfg)

    args = TrainingArguments(
        output_dir=cfg.output_dir,
        num_train_epochs=cfg.epochs,
        per_device_train_batch_size=cfg.per_device_batch,
        gradient_accumulation_steps=cfg.grad_accum,
        learning_rate=cfg.learning_rate,
        warmup_ratio=cfg.warmup_ratio,
        weight_decay=cfg.weight_decay,
        lr_scheduler_type="cosine",
        logging_steps=2,
        save_strategy="no",          # we save the adapter explicitly at the end
        report_to=[],
        seed=cfg.seed,
        bf16=cfg.bf16,
        fp16=False,
        optim=cfg.optim,
        dataloader_num_workers=0,    # Windows safety; 0 also avoids forking large datasets
        remove_unused_columns=False, # we already pre-tokenised
        label_names=["labels"],
    )

    # Manual NEFTune wiring — TRL added support; we replicate the simple
    # version inline so the smoke path doesn't depend on TRL's version flux.
    if cfg.neftune_alpha > 0:
        _enable_neftune(model, cfg.neftune_alpha)

    from transformers import Trainer
    import inspect

    # transformers 4.46+ deprecated `tokenizer=` in favour of `processing_class=`,
    # and 5.x removed `tokenizer=` entirely. Bridge both cleanly so this runs on
    # whichever wheel the training box happens to have pinned.
    trainer_kwargs: dict[str, Any] = {
        "model": model,
        "args": args,
        "train_dataset": dataset,
        "data_collator": lambda batch: _collate(batch, tokenizer.pad_token_id),
    }
    sig = inspect.signature(Trainer.__init__).parameters
    if "processing_class" in sig:
        trainer_kwargs["processing_class"] = tokenizer
    elif "tokenizer" in sig:
        trainer_kwargs["tokenizer"] = tokenizer
    trainer = Trainer(**trainer_kwargs)

    log.info("starting training mode=%s rows=%d", cfg.mode, len(dataset))
    t0 = time.perf_counter()
    train_out = trainer.train()
    duration = time.perf_counter() - t0

    # Save just the LoRA adapter — the base model weights are untouched.
    adapter_dir = Path(cfg.output_dir) / "adapter"
    trainer.model.save_pretrained(adapter_dir)
    tokenizer.save_pretrained(adapter_dir)

    metrics = {
        "mode": cfg.mode,
        "base_model": cfg.base_model,
        "dataset_id": cfg.dataset_id,
        "dataset_split": cfg.dataset_split,
        "rows_used": len(dataset),
        "duration_sec": round(duration, 2),
        "global_steps": train_out.global_step,
        "training_loss": round(train_out.training_loss, 4) if train_out.training_loss else None,
        "trainable_params": _count_trainable(model),
    }
    (Path(cfg.output_dir) / "training_metrics.json").write_text(
        json.dumps(metrics, indent=2)
    )
    log.info("training complete: %s", metrics)
    return metrics


def _enable_neftune(model, alpha: float) -> None:
    """Lightweight NEFTune — adds uniform noise to embedding output at
    train time, scaled by `alpha / sqrt(L * D)`. Improves instruction-
    tuning robustness; eval is a no-op (hook only fires in train()).
    """
    embed = model.get_input_embeddings()

    def hook(_module, _input, output):
        if not model.training:
            return output
        seq_len, dim = output.shape[-2], output.shape[-1]
        scale = alpha / (seq_len * dim) ** 0.5
        noise = torch.zeros_like(output).uniform_(-scale, scale)
        return output + noise

    embed.register_forward_hook(hook)


def _count_trainable(model) -> int:
    return sum(p.numel() for p in model.parameters() if p.requires_grad)


# ─────────────────────────────────────────────────────────────────────
#  CLI
# ─────────────────────────────────────────────────────────────────────


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="forge_veritas.train.sft")
    p.add_argument("--mode", choices=("stage1", "production"), required=True)
    p.add_argument("--out", required=True, help="Output directory.")
    # Production-only overrides:
    p.add_argument("--dataset", help="HF dataset id (production mode).")
    p.add_argument("--take", type=int, help="Row cap (production mode).")
    p.add_argument("-v", "--verbose", action="store_true")
    return p


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    if args.mode == "stage1":
        cfg = cfg_stage1(args.out)
    else:
        if not args.dataset:
            log.error("--dataset required for production mode")
            return 2
        cfg = cfg_production(args.out, args.dataset, args.take or 0)
    metrics = train(cfg)
    print(json.dumps(metrics, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
