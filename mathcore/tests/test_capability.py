"""Model capability tiers: small local models fail fast, cloud pins fall back."""
from __future__ import annotations

import pytest

from mathcore import (
    ERROR,
    REGISTRY,
    VERIFIED,
    CapabilityError,
    Orchestrator,
    capability_decision,
    parse_model_params,
    require_capability,
)
from mathcore.ops_catalog import OPS_MIN_PARAMS, OPS_MODULES


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("llama3.2:0.8b", 0.8),
        ("qwen3:4b", 4.0),
        ("llama3.3:70b-instruct", 70.0),
        ("mixtral:8x7b", 56.0),
        ("tiny:800m", 0.8),
        ("not-a-size", None),
        ("", None),
        (None, None),
    ],
)
def test_parse_model_params(value, expected):
    assert parse_model_params(value) == expected


def test_every_operation_declares_an_integer_tier():
    assert set(OPS_MIN_PARAMS) == {name for names in OPS_MODULES.values() for name in names}
    assert all(isinstance(value, int) and value >= 0 for value in OPS_MIN_PARAMS.values())
    assert REGISTRY.get("prove").min_params == OPS_MIN_PARAMS["prove"]


def test_small_model_fails_fast_with_a_warning(monkeypatch):
    monkeypatch.setenv("ZOVELI_OLLAMA_MODEL", "llama3.2:0.8b")
    monkeypatch.delenv("ZOVELI_PROVIDER", raising=False)
    with pytest.warns(RuntimeWarning, match="needs a model with at least"):
        report = Orchestrator().ask("derivative of x^3")
    cert = report.certificates[0]
    assert cert.status == ERROR
    assert any("needs a model" in error for error in cert.errors)
    assert not report.all_released


def test_large_model_proceeds(monkeypatch):
    monkeypatch.setenv("ZOVELI_OLLAMA_MODEL", "llama3.3:70b")
    monkeypatch.delenv("ZOVELI_PROVIDER", raising=False)
    report = Orchestrator().ask("derivative of x^3")
    assert report.certificates[0].status == VERIFIED
    assert report.all_released


def test_cloud_pin_falls_back_instead_of_failing(monkeypatch):
    monkeypatch.setenv("ZOVELI_OLLAMA_MODEL", "llama3.2:0.8b")
    monkeypatch.setenv("ZOVELI_PROVIDER", "openai")
    decision = capability_decision("prove")
    assert decision.allowed
    assert decision.fallback
    assert "openai" in decision.fallback
    report = Orchestrator().ask("derivative of x^3")
    assert report.certificates[0].status == VERIFIED


def test_explicit_model_params_override_the_tag(monkeypatch):
    monkeypatch.setenv("ZOVELI_MODEL_PARAMS", "70")
    monkeypatch.setenv("ZOVELI_PROVIDER", "ollama")
    decision = capability_decision("prove")
    assert decision.allowed
    assert decision.actual == 70.0


def test_require_capability_raises_for_a_small_local_model(monkeypatch):
    monkeypatch.setenv("ZOVELI_OLLAMA_MODEL", "qwen3:0.8b")
    monkeypatch.delenv("ZOVELI_PROVIDER", raising=False)
    with pytest.raises(CapabilityError) as excinfo:
        require_capability("prove")
    assert excinfo.value.required == OPS_MIN_PARAMS["prove"]
    assert excinfo.value.actual == 0.8
