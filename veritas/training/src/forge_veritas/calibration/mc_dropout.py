"""MC Dropout — inference-time uncertainty via stochastic forward passes.

Why MC Dropout (Gal & Ghahramani 2016)
──────────────────────────────────────
Dropout normally only fires during training. Keeping it active at
inference and averaging predictions across N stochastic passes
approximates Bayesian model uncertainty:
    • mean(probs)     → calibrated prediction
    • std(probs)      → epistemic uncertainty estimate
    • complement to temperature scaling (which only addresses
      aleatoric overconfidence)

For a LoRA-tuned classifier, MC dropout fires through the base model's
existing dropout AND the LoRA adapter's dropout. Both contribute.

Cost
────
N forward passes per example → roughly Nx inference cost. We default
N=10, which empirically saturates the calibration improvement on
classification tasks (Lakshminarayanan 2017 §5).

References
──────────
    Gal & Ghahramani 2016 — "Dropout as a Bayesian Approximation"
    Lakshminarayanan et al. 2017 — Deep Ensembles ablation §5
"""

from __future__ import annotations

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F


def enable_mc_dropout(model: nn.Module) -> None:
    """Force every Dropout / DropPath module into train mode while
    keeping the rest of the model in eval mode (BatchNorm etc. stay
    deterministic — only stochasticity we want is dropout).
    """
    for module in model.modules():
        # `Dropout`, `Dropout1d/2d/3d`, `AlphaDropout`, `FeatureAlphaDropout`
        # all subclass `_DropoutNd`. PEFT's LoRA dropout uses plain `Dropout`.
        # `DropPath` (timm) inherits from nn.Module directly; check by name.
        cls_name = type(module).__name__
        if cls_name.startswith("Dropout") or cls_name == "DropPath":
            module.train()


@torch.no_grad()
def mc_dropout_predict(
    model: nn.Module,
    *,
    forward_fn,
    n_samples: int = 10,
) -> tuple[np.ndarray, np.ndarray]:
    """Run `forward_fn` N times under MC dropout; return (mean_probs, std_probs).

    Parameters
    ──────────
    model : the model to put into MC mode (rest stays in eval)
    forward_fn : callable returning logits (B, C) for one forward pass.
                 Caller wires whatever batching / inputs they want; this
                 function only handles the dropout discipline + averaging.
    n_samples : number of stochastic passes. 10 is the sweet spot per
                Lakshminarayanan 2017 §5 for classification.

    Returns
    ───────
    mean_probs : (B, C) numpy — averaged softmax across passes
    std_probs  : (B, C) numpy — per-class std across passes (uncertainty)

    Notes on usage
    ──────────────
    The caller must restore `model.eval()` afterwards if they want
    deterministic behaviour again. Doing it here would require us to
    track per-module original states; pushing that to the caller keeps
    this function pure.
    """
    model.eval()
    enable_mc_dropout(model)
    probs_per_sample: list[np.ndarray] = []
    for _ in range(n_samples):
        logits = forward_fn()
        if not isinstance(logits, torch.Tensor):
            raise TypeError(f"forward_fn must return torch.Tensor; got {type(logits)}")
        probs = F.softmax(logits, dim=-1).detach().cpu().numpy()
        probs_per_sample.append(probs)
    stacked = np.stack(probs_per_sample, axis=0)  # (N, B, C)
    mean_probs = stacked.mean(axis=0)
    std_probs = stacked.std(axis=0)
    return mean_probs, std_probs
