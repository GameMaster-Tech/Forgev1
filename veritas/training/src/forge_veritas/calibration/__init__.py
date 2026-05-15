"""Calibration utilities for Veritas-R1.

Why this package exists
───────────────────────
Stage 1 (24-row CPU run) demonstrated the textbook miscalibration failure
mode: post-training confidence rose while accuracy didn't. This is what
happens when a high-capacity adapter sees too few examples — it memorises
the training set as sharp logits without the underlying decision rule.

The fix is a calibration discipline applied at every stage going forward:
    • Track ECE and Brier alongside accuracy as first-class metrics.
    • Apply temperature scaling as a cheap post-hoc fix on every checkpoint.
    • Use MC Dropout for inference-time uncertainty when the head needs
      a softer, more honest distribution.
    • Use deep ensembles (3 seeds, prob-averaged) when calibration matters
      more than throughput — the gold standard per Lakshminarayanan 2017.

All utilities here are pure functions over numpy / torch tensors. No
training-loop state, no model dependencies — drop-in for any classifier.
"""

from forge_veritas.calibration.metrics import (
    accuracy,
    brier_score,
    expected_calibration_error,
    macro_f1,
    reliability_diagram_bins,
    selective_accuracy_curve,
)
from forge_veritas.calibration.temperature import (
    TemperatureScaler,
    fit_temperature,
)
from forge_veritas.calibration.mc_dropout import (
    enable_mc_dropout,
    mc_dropout_predict,
)
from forge_veritas.calibration.ensemble import (
    average_logits,
    average_probabilities,
)

__all__ = [
    "accuracy",
    "brier_score",
    "expected_calibration_error",
    "macro_f1",
    "reliability_diagram_bins",
    "selective_accuracy_curve",
    "TemperatureScaler",
    "fit_temperature",
    "enable_mc_dropout",
    "mc_dropout_predict",
    "average_logits",
    "average_probabilities",
]
