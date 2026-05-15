"""Temperature scaling — single-parameter post-hoc calibration.

Why this is the right post-hoc fix
──────────────────────────────────
Modern deep nets are systematically overconfident (Guo 2017). Temperature
scaling fits ONE scalar T > 0 on validation logits and divides logits by
T at inference. It:
    • preserves accuracy exactly (argmax is invariant to scaling)
    • monotonically lowers max-confidence when T > 1 (the typical case)
    • reduces ECE substantially in the literature (5-10× on CIFAR/ImageNet)
    • costs nothing at inference

We fit T by minimising NLL on validation logits via L-BFGS — convex,
single-pass, converges in <100 iterations on any dataset.

References
──────────
    Guo et al. 2017 — "On Calibration of Modern Neural Networks", §4.2
    Platt 1999 — original Platt scaling (T scaling is its multi-class form)
"""

from __future__ import annotations

import numpy as np
import torch
import torch.nn.functional as F


class TemperatureScaler:
    """Stateful wrapper holding the fitted temperature.

    Usage
    ─────
    >>> scaler = TemperatureScaler()
    >>> scaler.fit(val_logits, val_labels)   # learns T
    >>> probs = scaler.transform(test_logits) # calibrated probabilities
    """

    def __init__(self) -> None:
        self.temperature: float = 1.0
        self._fitted: bool = False

    def fit(
        self,
        logits: np.ndarray | torch.Tensor,
        labels: np.ndarray | torch.Tensor,
        *,
        max_iter: int = 200,
        lr: float = 0.01,
    ) -> "TemperatureScaler":
        self.temperature = fit_temperature(logits, labels, max_iter=max_iter, lr=lr)
        self._fitted = True
        return self

    def transform(self, logits: np.ndarray | torch.Tensor) -> np.ndarray:
        """Apply learned temperature; return softmaxed probabilities (N, C)."""
        if not self._fitted:
            # Identity transform when unfitted — lets callers swap a fresh
            # TemperatureScaler() into a pipeline as a no-op baseline.
            tensor = _to_tensor(logits)
        else:
            tensor = _to_tensor(logits) / float(self.temperature)
        return F.softmax(tensor, dim=-1).cpu().numpy()

    def state_dict(self) -> dict[str, float | bool]:
        return {"temperature": float(self.temperature), "fitted": self._fitted}

    def load_state_dict(self, state: dict) -> None:
        self.temperature = float(state["temperature"])
        self._fitted = bool(state["fitted"])


def fit_temperature(
    logits: np.ndarray | torch.Tensor,
    labels: np.ndarray | torch.Tensor,
    *,
    max_iter: int = 200,
    lr: float = 0.01,
) -> float:
    """Find T that minimises cross-entropy on (logits, labels) via L-BFGS.

    We parametrise log T (rather than T directly) so the optimiser stays
    in the unconstrained space and T > 0 is guaranteed.
    """
    logits_t = _to_tensor(logits).detach()
    labels_t = _to_tensor(labels, dtype=torch.long).detach()

    # log_T parameter; T = exp(log_T) is automatically positive.
    log_temperature = torch.zeros(1, requires_grad=True)
    optimizer = torch.optim.LBFGS(
        [log_temperature],
        lr=lr,
        max_iter=max_iter,
        line_search_fn="strong_wolfe",
    )

    def closure() -> torch.Tensor:
        optimizer.zero_grad()
        scaled = logits_t / torch.exp(log_temperature)
        loss = F.cross_entropy(scaled, labels_t)
        loss.backward()
        return loss

    optimizer.step(closure)
    temperature = float(torch.exp(log_temperature).item())
    # Sanity-clip — pathological data can push T to extremes that
    # collapse outputs to uniform; cap at [0.1, 100] to stay sane.
    return float(np.clip(temperature, 0.1, 100.0))


def _to_tensor(
    x: np.ndarray | torch.Tensor,
    *,
    dtype: torch.dtype = torch.float32,
) -> torch.Tensor:
    if isinstance(x, torch.Tensor):
        return x.to(dtype=dtype) if x.dtype != dtype else x
    return torch.as_tensor(x, dtype=dtype)
