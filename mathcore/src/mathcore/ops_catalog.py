"""Declare the operation catalog without importing specialist modules.

Each entry maps a module under ``mathcore`` to the operations it registers.
``Registry.get`` imports the module only when one of those operations is
requested, so a CLI/MCP launch no longer pays for every domain's dependencies.
Keep this list in sync with the ``REGISTRY.add`` calls in each module.

``OPS_MIN_PARAMS`` is the model capability tier for each operation, in
billions of parameters. A small local model fails fast for high-tier
operations; a pinned cloud provider is allowed to fall back.
"""
from __future__ import annotations

from .capability import DEFAULT_MIN_PARAMS
from .framework import REGISTRY

OPS_MODULES = {
    "ops_algebra": ("evaluate", "simplify", "expand", "factor", "solve"),
    "ops_arithmetic": ("percent", "ratio"),
    "ops_calculus": ("derivative", "integrate", "limit", "dsolve"),
    "ops_data": ("stat", "convert", "shortest_path"),
    "ops_geometry": ("area", "volume", "pythagoras"),
    "ops_integer": ("is_prime", "factor_int", "gcd", "lcm", "modpow", "factorial", "choose"),
    "ops_linear": ("determinant", "rank", "inverse", "eigenvalues", "linsolve", "matmul"),
    "ops_logic": ("sat", "prove"),
    "ops_probability": ("probability",),
    "ops_trig": ("trig",),
}

# Integer billions of parameters. 0 means any model (including no model).
OPS_MIN_PARAMS = {
    "evaluate": 0,
    "simplify": 1,
    "expand": 1,
    "factor": 1,
    "solve": 2,
    "percent": 0,
    "ratio": 0,
    "derivative": 3,
    "integrate": 3,
    "limit": 3,
    "dsolve": 7,
    "stat": 1,
    "convert": 0,
    "shortest_path": 1,
    "area": 0,
    "volume": 0,
    "pythagoras": 0,
    "is_prime": 0,
    "factor_int": 0,
    "gcd": 0,
    "lcm": 0,
    "modpow": 0,
    "factorial": 0,
    "choose": 0,
    "determinant": 3,
    "rank": 3,
    "inverse": 3,
    "eigenvalues": 3,
    "linsolve": 3,
    "matmul": 3,
    "sat": 7,
    "prove": 7,
    "probability": 0,
    "trig": 0,
}

for _module, _names in OPS_MODULES.items():
    REGISTRY.declare(_module, _names, OPS_MIN_PARAMS)

DEFAULT_MIN_PARAMS.update(OPS_MIN_PARAMS)

__all__ = ["OPS_MIN_PARAMS", "OPS_MODULES"]
