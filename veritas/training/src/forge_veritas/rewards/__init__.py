"""Verifiable reward functions — pure functions for GRPO.

Each module exports a single `reward(prompt, completion, ground_truth) -> float`
with the result clipped to [-1, 1]. Reward weighting is in `config/grpo.yaml`
(see `docs/VERITAS_TRAINING_PLAN_V2.md` §2 Stage 2 for the locked weights).

Modules ship in CP8:
    citation_resolves.py        weight 0.30
    citation_supports.py        weight 0.30
    abstention_calibration.py   weight 0.20
    contradiction_recall.py     weight 0.10
    format_strict.py            weight 0.10
"""
