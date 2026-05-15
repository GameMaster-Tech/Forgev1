"""forge_veritas — Python training package for Veritas-R1.

This package is intentionally thin at CP1 — it only exposes a version
constant and a `load_base_config()` helper. The actual training, data, and
reward modules land in CP2-CP15 per `docs/PHASE3_CHECKPOINTS.md`.

Why ship a near-empty package at CP1?
    The training pipeline runs on rented GPU. A working `pip install -e .`
    that resolves all heavy dependencies (transformers / unsloth / trl /
    bitsandbytes) is the *real* gate before any compute checkpoint can fire.
    CP1 establishes the package structure so subsequent checkpoints only add
    modules — they never have to fight the Python packaging side.
"""

from __future__ import annotations

__version__ = "0.1.0"

# Subpackage stubs — each gets fleshed out in its own checkpoint:
#   data/      — CP3 (Firestore export), CP4 (synthetic), CP5 (pack), CP10 (preferences)
#   train/     — CP6 (SFT), CP9 (GRPO), CP11 (DPO), CP15 (distill)
#   eval/      — CP7, CP12 (ForgeBench-Reason runners)
#   rewards/   — CP8 (verifiable reward functions)
#   serving/   — CP13, CP14 (vLLM + Modal)


def package_root() -> str:
    """Return the absolute path to the installed package root.

    Lets tests + scripts locate the bundled `config/` directory regardless of
    where the package is installed (dev `pip install -e .` vs production
    Modal image). Returns a string so callers can pass it straight to
    pathlib / os.path without a second import.
    """
    import os

    return os.path.dirname(os.path.abspath(__file__))
