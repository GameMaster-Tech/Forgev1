"""Config loader — reads `config/base.yaml` and any per-stage overrides.

Light wrapper so that CP6/CP9/CP11/CP15 can do:

    from forge_veritas.config import load_config
    cfg = load_config("sft")     # merges base.yaml + sft.yaml

The resolution order is intentionally simple:
    1. Load `<repo>/veritas/training/config/base.yaml`.
    2. If `stage` is given, deep-merge `config/<stage>.yaml` on top.
    3. Apply any `overrides` dict the caller passes (last writer wins).

We deliberately do NOT use Hydra / OmegaConf — the config surface is small
enough that a hand-rolled merge is easier to debug than a framework, and
training boxes (rented spot) shouldn't have to install one extra dep.
"""

from __future__ import annotations

import os
from copy import deepcopy
from pathlib import Path
from typing import Any

import yaml


def _config_dir() -> Path:
    """Locate the `config/` dir relative to this file."""
    # __file__ is .../veritas/training/src/forge_veritas/config.py
    # config dir is  .../veritas/training/config/
    return Path(__file__).resolve().parents[2] / "config"


def _deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    """Recursive merge — override scalars replace base, dicts merge, lists replace."""
    out = deepcopy(base)
    for k, v in override.items():
        if k in out and isinstance(out[k], dict) and isinstance(v, dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = deepcopy(v)
    return out


def load_config(
    stage: str | None = None,
    *,
    overrides: dict[str, Any] | None = None,
    config_dir: str | os.PathLike[str] | None = None,
) -> dict[str, Any]:
    """Load `base.yaml` and optionally merge a stage-specific override file.

    Parameters
    ----------
    stage:
        Either ``None`` (return base only) or one of ``"sft"``, ``"grpo"``,
        ``"dpo"``, ``"distill"``. If the stage file does not exist yet, this
        function returns the base config — that's the CP1 state.
    overrides:
        Caller-provided dict deep-merged on top of everything else. Used by
        scripts that want to flip a single field (e.g. ``learning_rate``)
        without writing a new YAML file.
    config_dir:
        Override the config search path (used in tests).
    """
    cfg_dir = Path(config_dir) if config_dir else _config_dir()
    base_path = cfg_dir / "base.yaml"
    if not base_path.is_file():
        raise FileNotFoundError(f"base config not found: {base_path}")

    with base_path.open("r", encoding="utf-8") as fh:
        cfg: dict[str, Any] = yaml.safe_load(fh) or {}

    if stage:
        stage_path = cfg_dir / f"{stage}.yaml"
        if stage_path.is_file():
            with stage_path.open("r", encoding="utf-8") as fh:
                stage_cfg = yaml.safe_load(fh) or {}
            cfg = _deep_merge(cfg, stage_cfg)

    if overrides:
        cfg = _deep_merge(cfg, overrides)

    return cfg
