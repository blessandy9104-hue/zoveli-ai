"""Model capability tiers for math operations.

Every operation declares a minimum model size (billions of parameters). When a
local model is smaller than the operation requires, the operation fails fast
with :class:`CapabilityError` instead of producing a plausible-looking guess.
If ``ZOVELI_PROVIDER`` is pinned to a known cloud provider, the request is
allowed to fall back to that cloud model.

The model size comes from ``ZOVELI_MODEL_PARAMS`` (explicit, in billions) or
from the active Ollama model tag (``ZOVELI_OLLAMA_MODEL``), for example
``llama3.2:0.8b`` or ``qwen3:70b``. An unknown size is not guessed: the check
allows the operation and callers can surface the unknown tier in diagnostics.
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass
from typing import Dict, Mapping, Optional

CLOUD_PROVIDERS = frozenset({"openai", "anthropic", "deepseek", "openrouter", "groq", "together"})

# Kept in sync with OPS_SPECS in ops_catalog. Coordinator imports this module
# lazily-safe (no operation modules are imported here).
DEFAULT_MIN_PARAMS: Dict[str, int] = {}

_MOE_PARAMS = re.compile(r"(\d+)\s*[x\u00d7]\s*(\d+(?:\.\d+)?)\s*[bB]\b")
_BILLIONS = re.compile(r"(\d+(?:\.\d+)?)\s*[bB]\b")
_MILLIONS = re.compile(r"(\d+(?:\.\d+)?)\s*[mM]\b")


class CapabilityError(RuntimeError):
    """The active model is too small for the requested operation."""

    def __init__(self, operation: str, required: int, actual: float, model: str) -> None:
        self.operation = operation
        self.required = required
        self.actual = actual
        self.model = model
        super().__init__(
            f"operation '{operation}' needs a model with at least {required}B parameters; "
            f"active local model '{model}' has {actual:g}B. Use a larger local model, or pin "
            f"ZOVELI_PROVIDER to a cloud provider to fall back."
        )


@dataclass(frozen=True)
class CapabilityDecision:
    operation: str
    required: int
    actual: Optional[float]
    model: str
    provider: str
    allowed: bool
    fallback: str = ""

    @property
    def denied(self) -> bool:
        return not self.allowed


def parse_model_params(value: Optional[str]) -> Optional[float]:
    """Parse a model name or explicit size into billions of parameters."""
    if not value:
        return None
    text = value.strip()
    if not text:
        return None
    # Explicit metadata wins: a bare number means billions.
    try:
        numeric = float(text)
    except ValueError:
        numeric = 0.0
    if numeric > 0:
        return numeric
    moe = _MOE_PARAMS.search(text)
    if moe:
        return int(moe.group(1)) * float(moe.group(2))
    billions = _BILLIONS.search(text)
    if billions:
        return float(billions.group(1))
    millions = _MILLIONS.search(text)
    if millions:
        return float(millions.group(1)) / 1000.0
    return None


def active_model(env: Optional[Mapping[str, str]] = None) -> tuple[str, str]:
    values = os.environ if env is None else env
    params = (values.get("ZOVELI_MODEL_PARAMS", "") or "").strip()
    model = (
        (values.get("ZOVELI_OLLAMA_MODEL", "") or "").strip()
        or (values.get("ZOVELI_MODEL", "") or "").strip()
        or params
    )
    provider = (values.get("ZOVELI_PROVIDER", "") or "").strip().lower()
    return model, provider


def cloud_pinned(provider: str) -> bool:
    return provider in CLOUD_PROVIDERS


def capability_decision(
    operation: str,
    env: Optional[Mapping[str, str]] = None,
    min_params: Optional[Mapping[str, int]] = None,
) -> CapabilityDecision:
    values = os.environ if env is None else env
    limits = DEFAULT_MIN_PARAMS if min_params is None else min_params
    required = int(limits.get(operation, 0) or 0)
    model, provider = active_model(values)
    explicit = (values.get("ZOVELI_MODEL_PARAMS", "") or "").strip()
    actual = parse_model_params(explicit) if explicit else parse_model_params(model)
    if required <= 0 or actual is None:
        return CapabilityDecision(operation, required, actual, model, provider, True)
    if actual + 1e-9 >= required:
        return CapabilityDecision(operation, required, actual, model, provider, True)
    if cloud_pinned(provider):
        return CapabilityDecision(
            operation,
            required,
            actual,
            model,
            provider,
            True,
            fallback=f"local model {actual:g}B is below {required}B; using pinned cloud provider {provider}",
        )
    return CapabilityDecision(operation, required, actual, model, provider, False)


def require_capability(
    operation: str,
    env: Optional[Mapping[str, str]] = None,
    min_params: Optional[Mapping[str, int]] = None,
) -> CapabilityDecision:
    decision = capability_decision(operation, env, min_params)
    if decision.denied:
        raise CapabilityError(decision.operation, decision.required, decision.actual or 0.0, decision.model)
    return decision


__all__ = [
    "CLOUD_PROVIDERS",
    "CapabilityDecision",
    "CapabilityError",
    "DEFAULT_MIN_PARAMS",
    "active_model",
    "capability_decision",
    "cloud_pinned",
    "parse_model_params",
    "require_capability",
]
