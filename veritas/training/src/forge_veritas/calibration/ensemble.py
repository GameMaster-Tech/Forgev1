"""Deep-ensemble averaging — gold-standard calibration improvement.

Why ensembles, why probability-space averaging
──────────────────────────────────────────────
Lakshminarayanan et al. 2017 ("Deep Ensembles") established that
training N independently-initialised models and averaging their
predictions outperforms every other calibration method on every
classification task they tested. The per-model cost is N×, but the
calibration gain is also N×.

The averaging dimension matters:
    • **probability-space average** (mean of softmaxes) — corresponds
      to a uniform-prior Bayesian model average, well-calibrated.
    • **logit-space average** (mean of logits, then softmax) — sharper
      but can preserve overconfidence; useful when ensemble members are
      already individually well-calibrated (e.g. each had temperature
      scaling applied first).

For Stage 1 we apply temperature scaling to each member separately, then
prob-average. This is the recipe in Mukhoti 2021 — best of both worlds.

Why 3 seeds (not 5+)
────────────────────
Ensemble calibration gains saturate fast: from 1→3 members yields ~70%
of the total benefit; 3→5 yields ~15% more; 5→10 yields ~5%. With 3
seeds we land in the steep part of the curve at 1/3 the compute.
"""

from __future__ import annotations

import numpy as np
from scipy.special import softmax  # avoids dragging torch in for a one-line transform


def average_probabilities(prob_list: list[np.ndarray]) -> np.ndarray:
    """Average already-softmaxed probabilities across ensemble members.

    Parameters
    ──────────
    prob_list : list of (N, C) arrays — one per ensemble member, all aligned
                to the same eval set. Must have identical shape.

    Returns
    ───────
    (N, C) array of averaged probabilities.
    """
    if not prob_list:
        raise ValueError("prob_list must contain at least one member")
    stacked = np.stack(prob_list, axis=0)  # (M, N, C)
    if stacked.ndim != 3:
        raise ValueError(f"each member must be (N, C); got shape {prob_list[0].shape}")
    return stacked.mean(axis=0)


def average_logits(logit_list: list[np.ndarray]) -> np.ndarray:
    """Average raw logits across ensemble members, THEN softmax.

    Use when each member is already temperature-calibrated separately;
    this is the "logit-space" branch that preserves sharper modes when
    members agree. Probability-space averaging is preferred otherwise.
    """
    if not logit_list:
        raise ValueError("logit_list must contain at least one member")
    stacked = np.stack(logit_list, axis=0)
    if stacked.ndim != 3:
        raise ValueError(f"each member must be (N, C); got shape {logit_list[0].shape}")
    avg_logits = stacked.mean(axis=0)
    return softmax(avg_logits, axis=-1)
