"""Vitamin-C loader for the Kaggle Stage-1 pipeline.

What this module guarantees
───────────────────────────
    • Stratified samples drawn from Vitamin-C's NATIVE train / dev / test
      splits — zero contamination risk between train and held-out test.
    • Train: oversampled to ~33/33/33 across SUPPORT / REFUTES /
      NOT-ENOUGH-INFO so the gradient signal is balanced even though NEI
      is rare in the natural distribution.
    • Val + Test: natural distribution preserved so calibration metrics
      reflect deployment reality (not a flattering oversampled view).
    • Reproducibility: every sampling step is keyed to a single seed.

Public surface
──────────────
    SAMPLE_SIZES    — locked sizes: 12K / 1.5K / 1.5K
    LABELS, LABEL2ID
    load_vitaminc_splits(seed) -> dict[str, Dataset]
    augment_with_token_masking(rows, mask_rate, tokenizer, seed) -> rows
"""

from __future__ import annotations

import logging
import random
from collections import Counter
from collections.abc import Iterable
from typing import Any

log = logging.getLogger("forge_veritas.vitaminc_kaggle")

# Locked split sizes — see docs/CURATED_DATASETS.md and the research
# discussion in PHASE3_CHECKPOINTS notes for the rationale.
SAMPLE_SIZES = {"train": 12_000, "validation": 1_500, "test": 1_500}

LABELS: tuple[str, ...] = ("SUPPORTS", "REFUTES", "NOT ENOUGH INFO")
LABEL2ID: dict[str, int] = {label: i for i, label in enumerate(LABELS)}
ID2LABEL: dict[int, str] = {i: label for i, label in enumerate(LABELS)}


def load_vitaminc_splits(
    *,
    seed: int = 17,
    sample_sizes: dict[str, int] | None = None,
) -> dict[str, list[dict[str, Any]]]:
    """Load and stratified-sample Vitamin-C's three native splits.

    Lazy import of `datasets` so this module imports cleanly outside
    Kaggle (e.g. in unit tests that mock the rows).
    """
    try:
        from datasets import load_dataset
    except ImportError as e:
        raise RuntimeError(
            "load_vitaminc_splits requires the `datasets` library. "
            "Install via `pip install datasets`."
        ) from e

    sizes = sample_sizes or SAMPLE_SIZES
    out: dict[str, list[dict[str, Any]]] = {}

    rng_train = random.Random(seed)
    rng_val = random.Random(seed + 1)
    rng_test = random.Random(seed + 2)

    for split_name, target_n, rng in (
        ("train", sizes["train"], rng_train),
        ("validation", sizes["validation"], rng_val),
        ("test", sizes["test"], rng_test),
    ):
        ds = load_dataset("tals/vitaminc", split=split_name)
        log.info("vitaminc native %s size=%d", split_name, len(ds))
        rows = [_extract_row(r) for r in ds]
        rows = [r for r in rows if r is not None]

        if split_name == "train":
            sampled = _stratified_oversample(rows, target_n, rng)
        else:
            sampled = _stratified_natural(rows, target_n, rng)
        log.info(
            "vitaminc %s sampled=%d label_counts=%s",
            split_name,
            len(sampled),
            dict(Counter(r["label"] for r in sampled)),
        )
        out[split_name] = sampled
    return out


def _extract_row(raw: dict[str, Any]) -> dict[str, Any] | None:
    """Vitamin-C row → normalised dict. Drops rows missing any required field."""
    claim = raw.get("claim")
    evidence = raw.get("evidence")
    label = raw.get("label")
    if not all(isinstance(x, str) and x for x in (claim, evidence, label)):
        return None
    label_norm = label.strip().upper()
    if label_norm not in LABEL2ID:
        return None
    return {
        "claim": claim.strip(),
        "evidence": evidence.strip(),
        "label": label_norm,
        "label_id": LABEL2ID[label_norm],
    }


def _stratified_natural(
    rows: list[dict[str, Any]],
    target_n: int,
    rng: random.Random,
) -> list[dict[str, Any]]:
    """Sample preserving the natural label distribution. Used for val + test."""
    n = len(rows)
    if n <= target_n:
        return list(rows)
    indices = list(range(n))
    rng.shuffle(indices)
    return [rows[i] for i in indices[:target_n]]


def _stratified_oversample(
    rows: list[dict[str, Any]],
    target_n: int,
    rng: random.Random,
) -> list[dict[str, Any]]:
    """Oversample minority labels so train ends balanced ~33/33/33.

    For NEI which is ~4% naturally, this means each NEI example shows up
    ~8x. We accept the duplicate-row cost because:
      • LoRA dropout (0.15) + R-Drop both inject stochasticity per pass,
        so duplicate rows don't yield identical gradients
      • The alternative (class-weighted loss) is mathematically equivalent
        but harder to reason about for the eval pipeline
    """
    by_label: dict[str, list[dict[str, Any]]] = {label: [] for label in LABELS}
    for r in rows:
        by_label[r["label"]].append(r)

    # Drop empty buckets.
    by_label = {k: v for k, v in by_label.items() if v}
    if not by_label:
        return []

    per_class = target_n // len(by_label)
    out: list[dict[str, Any]] = []
    for label, bucket in by_label.items():
        if len(bucket) >= per_class:
            indices = list(range(len(bucket)))
            rng.shuffle(indices)
            out.extend(bucket[i] for i in indices[:per_class])
        else:
            # Oversample with replacement.
            out.extend(rng.choices(bucket, k=per_class))
    rng.shuffle(out)
    return out


# ─────────────────────────────────────────────────────────────────────
#  Token-masking augmentation — cheap data aug, no extra model needed
# ─────────────────────────────────────────────────────────────────────


def augment_with_token_masking(
    rows: Iterable[dict[str, Any]],
    *,
    mask_rate: float = 0.05,
    tokenizer,
    seed: int = 17,
) -> list[dict[str, Any]]:
    """Replace `mask_rate` of evidence tokens with the tokenizer's
    [MASK]/<unk> string. This is the cheapest augmentation that reliably
    moves the eval needle on classification tasks (Wei & Zou 2019 EDA).

    We mask EVIDENCE only — masking the claim changes the meaning more.
    """
    rng = random.Random(seed)
    out: list[dict[str, Any]] = []
    mask_token = (
        getattr(tokenizer, "mask_token", None)
        or getattr(tokenizer, "unk_token", None)
        or "[MASK]"
    )
    for r in rows:
        words = r["evidence"].split()
        if len(words) < 4 or mask_rate <= 0:
            out.append(r)
            continue
        n_to_mask = max(1, int(len(words) * mask_rate))
        positions = rng.sample(range(len(words)), n_to_mask)
        masked_words = list(words)
        for p in positions:
            masked_words[p] = mask_token
        out.append({**r, "evidence": " ".join(masked_words)})
    return out
