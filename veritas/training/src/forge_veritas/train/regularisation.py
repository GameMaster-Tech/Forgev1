"""Regularisation utilities — R-Drop loss, layer-wise LR decay, samplers.

Why R-Drop (Liang 2021)
───────────────────────
R-Drop runs each batch through the model TWICE with independent dropout
masks, then adds a symmetric KL term between the two output distributions
to the cross-entropy loss. Effect:
    • Forces the model to be consistent under dropout — a calibration win.
    • Stronger regulariser than dropout alone or label smoothing alone.
    • Doubles forward-pass cost; backwards is shared.

Why layer-wise LR decay (LLRD; Howard 2018, refined in ELECTRA paper)
─────────────────────────────────────────────────────────────────────
Lower transformer layers carry general-purpose features the pretrained
weights already got right; they should move LESS during fine-tuning.
Higher layers specialise to the downstream task; they need to move
freely. We multiply the base LR by `decay**layer_index` from top to
bottom — typical decay 0.85-0.95.

Why a balanced sampler (instead of class-weighted loss)
───────────────────────────────────────────────────────
With per-step gradient signal coming from a balanced batch, optimisation
dynamics stay clean (loss curves comparable across runs, gradient norm
stable). Class-weighted loss gives the same expectation but noisier
batches. We oversample at dataset level (`vitaminc_kaggle._stratified_oversample`)
which is the cheapest version of this.
"""

from __future__ import annotations

import logging
from typing import Iterable

import torch
import torch.nn as nn
import torch.nn.functional as F

log = logging.getLogger("forge_veritas.regularisation")


# ─────────────────────────────────────────────────────────────────────
#  R-Drop
# ─────────────────────────────────────────────────────────────────────


def rdrop_kl_loss(
    logits_a: torch.Tensor,
    logits_b: torch.Tensor,
    labels: torch.Tensor,
    *,
    ce_weight: float = 1.0,
    kl_weight: float = 1.0,
    ignore_index: int = -100,
) -> torch.Tensor:
    """R-Drop loss: 0.5*(CE(a) + CE(b)) + kl_weight * (KL(a‖b) + KL(b‖a))/2.

    Both `logits_a` and `logits_b` are the outputs of TWO forward passes
    over the SAME batch with INDEPENDENT dropout masks. The caller is
    responsible for running the two passes — this is just the loss math.

    Shape contract:
        logits_*: (B, T, C) for token classification, or (B, C) for
                  sequence classification. `F.cross_entropy` handles both.
        labels:   matching shape, integer class ids; pad positions can use
                  `ignore_index`.
    """
    ce = 0.5 * (
        F.cross_entropy(logits_a.view(-1, logits_a.size(-1)), labels.view(-1), ignore_index=ignore_index)
        + F.cross_entropy(logits_b.view(-1, logits_b.size(-1)), labels.view(-1), ignore_index=ignore_index)
    )
    # Symmetric KL — average of (a‖b) and (b‖a).
    log_p_a = F.log_softmax(logits_a, dim=-1)
    log_p_b = F.log_softmax(logits_b, dim=-1)
    p_a = log_p_a.exp()
    p_b = log_p_b.exp()
    kl_ab = F.kl_div(log_p_b, p_a, reduction="batchmean", log_target=False)
    kl_ba = F.kl_div(log_p_a, p_b, reduction="batchmean", log_target=False)
    kl = 0.5 * (kl_ab + kl_ba)
    return ce_weight * ce + kl_weight * kl


# ─────────────────────────────────────────────────────────────────────
#  Layer-wise LR decay (LLRD)
# ─────────────────────────────────────────────────────────────────────


def build_llrd_param_groups(
    model: nn.Module,
    *,
    base_lr: float,
    decay: float = 0.9,
    weight_decay: float = 0.05,
    no_decay_keywords: tuple[str, ...] = ("bias", "LayerNorm", "layernorm", "norm"),
) -> list[dict]:
    """Build optimiser param groups with layer-wise LR decay.

    Convention for naming layers:
        Most HuggingFace transformer models expose `model.layers.{i}` (Llama,
        Qwen, Mistral, SmolLM2). We extract the layer index from the
        parameter name with a defensive regex; params we can't classify
        get the base LR (safe default).

    Weight decay is applied to linear layers ONLY — bias / norm params get
    weight_decay=0. This is the modern best practice (TIMM, RoBERTa codebase).
    """
    import re

    layer_re = re.compile(r"\.layers?\.(\d+)\.")
    n_layers = _count_layers(model)
    log.info("LLRD detected n_layers=%d base_lr=%g decay=%g", n_layers, base_lr, decay)

    groups: list[dict] = []
    for name, param in model.named_parameters():
        if not param.requires_grad:
            continue
        match = layer_re.search(name)
        if match:
            layer_idx = int(match.group(1))
            depth_from_top = max(0, n_layers - 1 - layer_idx)
            lr = base_lr * (decay ** depth_from_top)
        else:
            # Embeddings, LM head, anything outside transformer stack — base LR.
            lr = base_lr
        wd = 0.0 if any(k in name for k in no_decay_keywords) else weight_decay
        groups.append({"params": [param], "lr": lr, "weight_decay": wd, "name": name})
    return groups


def _count_layers(model: nn.Module) -> int:
    """Best-effort layer count for the LLRD multiplier ladder."""
    # Try common transformer access paths.
    for path in ("model.layers", "transformer.h", "encoder.layer", "decoder.block"):
        obj = model
        ok = True
        for part in path.split("."):
            if not hasattr(obj, part):
                ok = False
                break
            obj = getattr(obj, part)
        if ok and hasattr(obj, "__len__"):
            return len(obj)
    # Fallback — scan for max layer index in parameter names.
    import re

    layer_re = re.compile(r"\.layers?\.(\d+)\.")
    max_idx = -1
    for name, _ in model.named_parameters():
        m = layer_re.search(name)
        if m:
            max_idx = max(max_idx, int(m.group(1)))
    return max_idx + 1 if max_idx >= 0 else 1


# ─────────────────────────────────────────────────────────────────────
#  Iterator helper for double-forward (R-Drop)
# ─────────────────────────────────────────────────────────────────────


def double_forward(
    model: nn.Module,
    forward_fn,
    *,
    n_passes: int = 2,
) -> list[torch.Tensor]:
    """Convenience: call `forward_fn()` `n_passes` times under independent
    dropout masks. Each call must use the same inputs; dropout in PyTorch
    automatically resamples the mask per call.

    Returns a list of logit tensors. The caller composes the loss.
    """
    if not model.training:
        raise RuntimeError(
            "double_forward only makes sense during training (dropout active)"
        )
    return [forward_fn() for _ in range(n_passes)]
