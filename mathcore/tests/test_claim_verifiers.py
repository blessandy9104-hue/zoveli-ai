"""Claim verifier plugins: code syntax and trusted knowledge."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from mathcore import ClaimVerdict, ClaimVerifier, Orchestrator, list_verifiers, register_verifier, unregister_verifier


def write_domain(
    root: Path,
    name: str,
    entries: list[dict],
    *,
    domain: str | None = None,
    manifest: bool = True,
) -> Path:
    """Create a manifest-authenticated KB domain fixture."""
    directory = root / name
    directory.mkdir(parents=True)
    content = directory / f"{name}.jsonl"
    content.write_text("".join(json.dumps(entry) + "\n" for entry in entries), encoding="utf-8")
    if manifest:
        digest = hashlib.sha256(content.read_bytes().replace(b"\r\n", b"\n")).hexdigest()
        (directory / f"{name}.manifest").write_text(
            json.dumps(
                {
                    "format": "zoveli-trusted-kb-v1",
                    "domain": domain or f"urn:zoveli:kb:{name}",
                    "content": content.name,
                    "sha256": digest,
                }
            ),
            encoding="utf-8",
        )
    return content


def test_math_is_still_the_fallback(monkeypatch):
    monkeypatch.setenv("MATHCORE_VERIFIERS", "off")
    verdict = Orchestrator().check("evaluate 6*7", "42")
    assert verdict.verdict == "MATCH"
    assert verdict.verifier == "math"
    assert verdict.certificate_digest


def test_code_verifier_accepts_valid_python(monkeypatch):
    monkeypatch.setenv("MATHCORE_VERIFIERS", "code")
    question = "Does this parse?\n```python\ndef add(a, b):\n    return a + b\n```"
    verdict = Orchestrator().check(question, "valid")
    assert verdict.verdict == "MATCH"
    assert verdict.verifier == "code"
    assert verdict.verified_answer == "valid"


def test_code_verifier_detects_syntax_errors(monkeypatch):
    monkeypatch.setenv("MATHCORE_VERIFIERS", "code")
    question = "```python\ndef broken(:\n    pass\n```"
    verdict = Orchestrator().check(question, "invalid")
    assert verdict.verdict == "MATCH"
    assert verdict.verifier == "code"
    assert "line" in verdict.detail.lower()
    wrong = Orchestrator().check(question, "valid")
    assert wrong.verdict == "MISMATCH"
    assert wrong.verified_answer == "invalid"


def test_code_verifier_does_not_execute_code(monkeypatch):
    monkeypatch.setenv("MATHCORE_VERIFIERS", "code")
    question = "```python\nraise SystemExit('must not run')\n```"
    verdict = Orchestrator().check(question, "valid")
    assert verdict.verdict == "MATCH"
    assert verdict.verifier == "code"


def test_unknown_code_language_is_unverifiable(monkeypatch):
    monkeypatch.setenv("MATHCORE_VERIFIERS", "code")
    verdict = Orchestrator().check("```javascript\nconst x = 1\n```", "valid")
    assert verdict.verdict == "UNVERIFIABLE"
    assert verdict.verifier == "code"


def test_trusted_knowledge_match_and_mismatch(monkeypatch, tmp_path):
    write_domain(
        tmp_path,
        "general",
        [
            {
                "question": "What is the capital of France?",
                "answer": "Paris",
                "source": "test fixture",
            }
        ],
    )
    monkeypatch.setenv("MATHCORE_VERIFIERS", "knowledge")
    monkeypatch.setenv("MATHCORE_TRUSTED_KB", str(tmp_path))
    orch = Orchestrator()
    good = orch.check("What is the capital of France?", "Paris")
    assert good.verdict == "MATCH"
    assert good.verifier == "knowledge"
    assert good.verified_answer == "Paris"
    assert "test fixture" in good.detail
    assert "urn:zoveli:kb:general" in good.detail
    bad = orch.check("What is the capital of France?", "Berlin")
    assert bad.verdict == "MISMATCH"
    assert bad.verifier == "knowledge"
    assert bad.verified_answer == "Paris"


def test_trusted_knowledge_accepts_a_manifested_file(monkeypatch, tmp_path):
    content = write_domain(
        tmp_path,
        "general",
        [{"question": "Q?", "answer": "A"}],
    )
    monkeypatch.setenv("MATHCORE_VERIFIERS", "knowledge")
    monkeypatch.setenv("MATHCORE_TRUSTED_KB", str(content))
    verdict = Orchestrator().check("Q?", "A")
    assert verdict.verdict == "MATCH"
    assert verdict.verifier == "knowledge"


def test_modified_trusted_content_fails_closed(monkeypatch, tmp_path):
    content = write_domain(
        tmp_path,
        "general",
        [{"question": "What is the capital of France?", "answer": "Paris"}],
    )
    content.write_text(
        json.dumps({"question": "What is the capital of France?", "answer": "Berlin"}) + "\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("MATHCORE_VERIFIERS", "knowledge")
    monkeypatch.setenv("MATHCORE_TRUSTED_KB", str(tmp_path))
    verdict = Orchestrator().check("What is the capital of France?", "Berlin")
    assert verdict.verdict == "UNVERIFIABLE"
    assert verdict.verifier == "knowledge"
    assert "hash mismatch" in verdict.detail
    assert verdict.verified_answer is None


def test_missing_manifest_fails_closed(monkeypatch, tmp_path):
    write_domain(
        tmp_path,
        "general",
        [{"question": "Q?", "answer": "A"}],
        manifest=False,
    )
    monkeypatch.setenv("MATHCORE_VERIFIERS", "knowledge")
    monkeypatch.setenv("MATHCORE_TRUSTED_KB", str(tmp_path))
    verdict = Orchestrator().check("Q?", "A")
    assert verdict.verdict == "UNVERIFIABLE"
    assert verdict.verifier == "knowledge"
    assert "manifest" in verdict.detail.lower()


def test_trusted_knowledge_missing_or_unknown_falls_through(monkeypatch, tmp_path):
    monkeypatch.setenv("MATHCORE_VERIFIERS", "knowledge")
    monkeypatch.setenv("MATHCORE_TRUSTED_KB", str(tmp_path / "missing.jsonl"))
    verdict = Orchestrator().check("What is the capital of France?", "Paris")
    assert verdict.verdict == "UNVERIFIABLE"
    assert verdict.verifier == "math"

    write_domain(
        tmp_path,
        "general",
        [{"question": "Q?", "answer": "A"}],
    )
    monkeypatch.setenv("MATHCORE_TRUSTED_KB", str(tmp_path))
    unknown = Orchestrator().check("Not in the KB?", "A")
    assert unknown.verdict == "UNVERIFIABLE"
    assert unknown.verifier == "math"


def test_duplicate_questions_across_domains_are_ambiguous(monkeypatch, tmp_path):
    write_domain(tmp_path, "general", [{"question": "Q?", "answer": "A"}])
    write_domain(tmp_path, "software", [{"question": "Q?", "answer": "B"}])
    monkeypatch.setenv("MATHCORE_VERIFIERS", "knowledge")
    monkeypatch.setenv("MATHCORE_TRUSTED_KB", str(tmp_path))
    verdict = Orchestrator().check("Q?", "A")
    assert verdict.verdict == "UNVERIFIABLE"
    assert verdict.verifier == "knowledge"
    assert "more than one" in verdict.detail


def test_custom_verifier_can_be_registered_and_selected(monkeypatch, tmp_path):
    monkeypatch.setenv("MATHCORE_VERIFIERS", "off")

    def always(question, claimed, *, coordinator=None):
        del question, claimed, coordinator
        return None  # not applicable

    register_verifier(ClaimVerifier("always", "test plugin", always))
    try:
        assert any(v["name"] == "always" for v in list_verifiers())
        verdict = Orchestrator(audit_path=tmp_path / "audit.jsonl").check(
            "What is the capital of France?", "Paris", verifiers=["always"]
        )
        assert verdict.verdict == "UNVERIFIABLE"
        # A custom verifier can decide instead of math.
        register_verifier(
            ClaimVerifier(
                "say_yes",
                "test plugin",
                lambda question, claimed, *, coordinator=None: ClaimVerdict(
                    "MATCH", claimed, "test", verifier="say_yes"
                ),
            )
        )
        yes = Orchestrator().check("anything", "yes", verifiers=["say_yes"])
        assert yes.verdict == "MATCH"
        assert yes.verifier == "say_yes"
    finally:
        unregister_verifier("always")
        unregister_verifier("say_yes")


def test_unknown_verifier_is_a_configuration_error(monkeypatch):
    monkeypatch.setenv("MATHCORE_VERIFIERS", "off")
    verdict = Orchestrator().check("2+2", "4", verifiers=["does-not-exist"])
    assert verdict.verdict == "UNVERIFIABLE"
    assert verdict.verifier == "config"
    assert "unknown verifier" in verdict.detail


def test_audit_log_records_the_verifier(monkeypatch, tmp_path):
    write_domain(tmp_path, "general", [{"question": "Q?", "answer": "A"}])
    monkeypatch.setenv("MATHCORE_VERIFIERS", "knowledge")
    monkeypatch.setenv("MATHCORE_TRUSTED_KB", str(tmp_path))
    audit = tmp_path / "audit.jsonl"
    Orchestrator(audit_path=audit).check("Q?", "A")
    entry = json.loads(audit.read_text(encoding="utf-8").strip().splitlines()[-1])
    assert entry["verdict"] == "MATCH"
    assert entry["verifier"] == "knowledge"


def test_audit_log_records_a_manifest_failure(monkeypatch, tmp_path):
    write_domain(tmp_path, "general", [{"question": "Q?", "answer": "A"}], manifest=False)
    monkeypatch.setenv("MATHCORE_VERIFIERS", "knowledge")
    monkeypatch.setenv("MATHCORE_TRUSTED_KB", str(tmp_path))
    audit = tmp_path / "audit.jsonl"
    Orchestrator(audit_path=audit).check("Q?", "A")
    entry = json.loads(audit.read_text(encoding="utf-8").strip().splitlines()[-1])
    assert entry["verdict"] == "UNVERIFIABLE"
    assert entry["verifier"] == "knowledge"
