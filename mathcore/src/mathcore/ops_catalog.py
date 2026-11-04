"""Declare the operation catalog without importing specialist modules.

Each entry maps a module under ``mathcore`` to the operations it registers.
``Registry.get`` imports the module only when one of those operations is
requested, so a CLI/MCP launch no longer pays for every domain's dependencies.
Keep this list in sync with the ``REGISTRY.add`` calls in each module.
"""
from __future__ import annotations

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

for _module, _names in OPS_MODULES.items():
    REGISTRY.declare(_module, _names)

__all__ = ["OPS_MODULES"]
