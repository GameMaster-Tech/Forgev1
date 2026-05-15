"""Calibration metrics — ECE, Brier, accuracy, F1, reliability bins.

All functions take **numpy arrays** as inputs (the training notebooks
collect logits/labels into arrays before evaluation; tensors are detached
+ moved to CPU upstream). This keeps the metrics framework-agnostic and
makes them trivial to unit-test.

References
──────────
    Guo et al. 2017 — "On Calibration of Modern Neural Networks"
    Naeini et al. 2015 — Expected Calibration Error definition
    Brier 1950 — Brier score (mean squared probabilistic error)
"""

from __future__ import annotations

import numpy as np


def accuracy(probs: np.ndarray, labels: np.ndarray) -> float:
    """Top-1 accuracy. `probs` is (N, C); `labels` is (N,) integer class ids."""
    if probs.ndim != 2:
        raise ValueError(f"probs must be (N, C); got shape {probs.shape}")
    preds = probs.argmax(axis=1)
    return float((preds == labels).mean())


def macro_f1(probs: np.ndarray, labels: np.ndarray) -> float:
    """Macro-F1 across all classes — equally weights rare classes (NEI for us)."""
    if probs.ndim != 2:
        raise ValueError(f"probs must be (N, C); got shape {probs.shape}")
    preds = probs.argmax(axis=1)
    n_classes = probs.shape[1]
    f1s: list[float] = []
    for c in range(n_classes):
        tp = int(((preds == c) & (labels == c)).sum())
        fp = int(((preds == c) & (labels != c)).sum())
        fn = int(((preds != c) & (labels == c)).sum())
        if tp + fp == 0 or tp + fn == 0:
            f1s.append(0.0)
            continue
        precision = tp / (tp + fp)
        recall = tp / (tp + fn)
        if precision + recall == 0:
            f1s.append(0.0)
        else:
            f1s.append(2 * precision * recall / (precision + recall))
    return float(np.mean(f1s))


def brier_score(probs: np.ndarray, labels: np.ndarray) -> float:
    """Multiclass Brier score — mean squared error between predicted
    probabilities and the one-hot label encoding. Lower is better.

    Brier = (1/N) Σ_i Σ_c (p_ic - y_ic)²

    Properly scoring rule: optimal under truthful probabilities. Penalises
    both overconfidence AND underconfidence proportionally.
    """
    n_classes = probs.shape[1]
    one_hot = np.zeros_like(probs)
    one_hot[np.arange(len(labels)), labels] = 1.0
    return float(((probs - one_hot) ** 2).sum(axis=1).mean())


def expected_calibration_error(
    probs: np.ndarray,
    labels: np.ndarray,
    *,
    n_bins: int = 15,
) -> float:
    """Expected Calibration Error (ECE) — Naeini 2015 definition.

    Algorithm:
        1. Bucket predictions by their top-class confidence into `n_bins`
           equal-width bins on [0, 1].
        2. Per bin, compute |mean_confidence - empirical_accuracy|.
        3. Weight by bin size, sum.

    A perfectly calibrated classifier has ECE = 0: when it says "I'm 80%
    confident," it's right 80% of the time.

    15 bins is the canonical choice (Guo 2017). Smaller datasets need
    fewer bins for stable estimates — we keep 15 here because the
    pipeline targets ≥1500 test examples (∼100/bin).
    """
    if probs.ndim != 2:
        raise ValueError(f"probs must be (N, C); got shape {probs.shape}")
    confidences = probs.max(axis=1)
    predictions = probs.argmax(axis=1)
    correct = (predictions == labels).astype(np.float64)

    bin_edges = np.linspace(0.0, 1.0, n_bins + 1)
    ece = 0.0
    n = len(labels)
    for i in range(n_bins):
        lo, hi = bin_edges[i], bin_edges[i + 1]
        # Final bin includes the right edge to capture probs exactly == 1.0
        if i == n_bins - 1:
            mask = (confidences >= lo) & (confidences <= hi)
        else:
            mask = (confidences >= lo) & (confidences < hi)
        if not mask.any():
            continue
        bin_size = mask.sum()
        bin_conf = float(confidences[mask].mean())
        bin_acc = float(correct[mask].mean())
        ece += (bin_size / n) * abs(bin_conf - bin_acc)
    return float(ece)


def reliability_diagram_bins(
    probs: np.ndarray,
    labels: np.ndarray,
    *,
    n_bins: int = 15,
) -> dict[str, np.ndarray]:
    """Per-bin (mean confidence, accuracy, count) — used to plot reliability
    diagrams in the eval notebook. Returns a dict so the notebook can
    matplotlib straight onto it without further unpacking.
    """
    confidences = probs.max(axis=1)
    predictions = probs.argmax(axis=1)
    correct = (predictions == labels).astype(np.float64)
    bin_edges = np.linspace(0.0, 1.0, n_bins + 1)
    mean_conf = np.full(n_bins, np.nan)
    mean_acc = np.full(n_bins, np.nan)
    counts = np.zeros(n_bins, dtype=np.int64)
    for i in range(n_bins):
        lo, hi = bin_edges[i], bin_edges[i + 1]
        if i == n_bins - 1:
            mask = (confidences >= lo) & (confidences <= hi)
        else:
            mask = (confidences >= lo) & (confidences < hi)
        counts[i] = int(mask.sum())
        if counts[i] == 0:
            continue
        mean_conf[i] = float(confidences[mask].mean())
        mean_acc[i] = float(correct[mask].mean())
    return {
        "bin_edges": bin_edges,
        "mean_confidence": mean_conf,
        "mean_accuracy": mean_acc,
        "counts": counts,
    }


def selective_accuracy_curve(
    probs: np.ndarray,
    labels: np.ndarray,
    *,
    coverage_steps: int = 21,
) -> dict[str, np.ndarray]:
    """Selective-prediction (accuracy at coverage) curve.

    Sort predictions by confidence descending; at each coverage threshold
    `c` ∈ {0%, 5%, …, 100%}, return the accuracy on the top-c% most-
    confident predictions. A well-calibrated classifier's accuracy
    increases monotonically as coverage drops — we abstain on the
    uncertain ones.

    This is the data the abstention reward will be scored against in CP9.
    """
    confidences = probs.max(axis=1)
    predictions = probs.argmax(axis=1)
    correct = (predictions == labels).astype(np.float64)
    order = np.argsort(-confidences)  # descending
    correct_sorted = correct[order]
    n = len(labels)

    cov = np.linspace(0.0, 1.0, coverage_steps)
    acc = np.full(coverage_steps, np.nan)
    for i, c in enumerate(cov):
        k = max(1, int(round(c * n)))
        acc[i] = float(correct_sorted[:k].mean())
    return {"coverage": cov, "accuracy": acc}
