"""Pluggable claim verifiers for non-math answers.

``OutputGuard.audit_claim`` runs these before falling back to verified math.
A verifier returns ``None`` when the claim is outside its scope, or a
:class:`ClaimVerdict` when it can decide. Integrators can register a linter,
a trusted-knowledge lookup, or any other local check without editing the
guard:

    from mathcore import ClaimVerifier, register_verifier

Built-ins:

* ``code`` - parses fenced Python blocks (``ast.parse``; never executes them).
* ``knowledge`` - exact-question lookup in ``MATHCORE_TRUSTED_KB``. Content is
  only trusted when every manifest authenticates it (see
  :mod:`mathcore.trusted_kb`).

Order is alphabetical by name; math is the final fallback. Set
``MATHCORE_VERIFIERS=code,knowledge`` to restrict the chain, or ``off`` to
disable plugins entirely.
"""
from __future__ import annotations

import ast
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Sequence

from .claims import ClaimVerdict
from .trusted_kb import TrustedKbError, load_trusted_kb


@dataclass(frozen=True)
class ClaimVerifier:
    """A local verifier that may handle a proposed answer."""

    name: str
    description: str
    verify: Callable[..., Optional[ClaimVerdict]]


_VERIFIERS: Dict[str, ClaimVerifier] = {}

DEFAULT_KB = Path.home() / ".mathcore" / "trusted-knowledge.jsonl"
MAX_CODE_CHARS = 100_000
_FENCE = re.compile(r"```(?P<lang>[A-Za-z0-9_+.#-]*)[ \t]*\r?\n(?P<code>.*?)```", re.S)
_NEGATIVE_CLAIM = re.compile(
    r"\b(invalid|broken|syntax error|does not parse|doesn't parse|will not parse|"
    r"does not compile|doesn't compile|won'?t compile|fails?)\b",
    re.I,
)
_POSITIVE_CLAIM = re.compile(r"\b(valid|parses|compiles|correct|ok|good)\b", re.I)


def register_verifier(verifier: ClaimVerifier, *, replace: bool = False) -> ClaimVerifier:
    """Add a verifier to the process-wide chain.

    Duplicate names raise unless ``replace=True`` so two integrations cannot
    silently shadow each other.
    """
    if not verifier.name or not verifier.name.isidentifier():
        raise ValueError("verifier name must be a valid identifier")
    if verifier.name in _VERIFIERS and not replace:
        raise ValueError(f"verifier {verifier.name!r} is already registered")
    _VERIFIERS[verifier.name] = verifier
    return verifier


def unregister_verifier(name: str) -> None:
    _VERIFIERS.pop(name, None)


def get_verifier(name: str) -> ClaimVerifier:
    try:
        return _VERIFIERS[name]
    except KeyError as exc:
        raise ValueError(
            f"unknown verifier {name!r} (available: {', '.join(sorted(_VERIFIERS)) or 'none'})"
        ) from exc


def list_verifiers() -> List[Dict[str, str]]:
    return [
        {"name": v.name, "description": v.description}
        for v in sorted(_VERIFIERS.values(), key=lambda item: item.name)
    ]


def enabled_verifiers(raw: Optional[str] = None) -> List[ClaimVerifier]:
    """Resolve ``MATHCORE_VERIFIERS`` (all by default, ``off`` for none)."""
    setting = os.environ.get("MATHCORE_VERIFIERS") if raw is None else raw
    if setting is None or not setting.strip():
        return sorted(_VERIFIERS.values(), key=lambda item: item.name)
    if setting.strip().lower() in {"off", "none", "0", "false"}:
        return []
    names = [name.strip() for name in setting.split(",") if name.strip()]
    return [get_verifier(name) for name in names]


def trusted_kb_path() -> Path:
    return Path(os.environ.get("MATHCORE_TRUSTED_KB", str(DEFAULT_KB))).expanduser()


def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip().rstrip(".!?").lower())


def _claim_value(text: str) -> str:
    stripped = re.sub(
        r"^(?:the\s+)?(?:final\s+)?(?:answer|result|value)\s*(?:is|are|=|:)?\s*",
        "",
        text.strip(),
        flags=re.I,
    )
    return _normalize(stripped)


def _knowledge_verify(
    question: str, claimed: str, *, coordinator: Any = None
) -> Optional[ClaimVerdict]:
    del coordinator
    path = trusted_kb_path()
    if not path.exists():
        # No KB configured: this verifier does not apply. An existing but
        # unauthenticated KB is different; that fails closed below.
        return None
    try:
        kb = load_trusted_kb(path)
    except TrustedKbError as exc:
        return ClaimVerdict(
            "UNVERIFIABLE",
            None,
            f"trusted knowledge base failed authentication: {exc}",
            verifier="knowledge",
        )
    entry, ambiguity = kb.find(_normalize(question), _normalize)
    if ambiguity:
        return ClaimVerdict("UNVERIFIABLE", None, ambiguity, verifier="knowledge")
    if entry is None:
        return None
    where = f" (source: {entry.source})" if entry.source else ""
    matched = _claim_value(claimed) == _normalize(entry.answer)
    return ClaimVerdict(
        "MATCH" if matched else "MISMATCH",
        entry.answer,
        f"{'agrees with' if matched else 'differs from'} the trusted knowledge base "
        f"[{entry.domain}]{where}",
        verifier="knowledge",
    )


def _code_verify(
    question: str, claimed: str, *, coordinator: Any = None
) -> Optional[ClaimVerdict]:
    del coordinator
    blocks = list(_FENCE.finditer(question))
    if not blocks:
        return None

    supported = 0
    problems: List[str] = []
    skipped: List[str] = []
    for index, block in enumerate(blocks, 1):
        language = (block.group("lang") or "text").strip().lower()
        code = block.group("code")
        if len(code) > MAX_CODE_CHARS:
            return ClaimVerdict(
                "UNVERIFIABLE",
                None,
                f"code block {index} is larger than {MAX_CODE_CHARS} characters",
                verifier="code",
            )
        if language not in {"py", "python", "python3"}:
            skipped.append(language or "text")
            continue
        supported += 1
        try:
            ast.parse(code)
        except SyntaxError as exc:
            problems.append(f"block {index} line {exc.lineno}: {exc.msg}")

    if supported == 0:
        detail = f"no supported code block (saw: {', '.join(skipped) or 'none'}); Python is supported"
        return ClaimVerdict("UNVERIFIABLE", None, detail, verifier="code")

    truth = not problems
    negative = bool(_NEGATIVE_CLAIM.search(claimed))
    positive = bool(_POSITIVE_CLAIM.search(claimed)) and not negative
    if not negative and not positive:
        return ClaimVerdict(
            "UNVERIFIABLE",
            None,
            "state whether the code is valid or invalid so the syntax check can be compared",
            verifier="code",
        )
    matched = (not truth) if negative else truth
    if truth:
        detail = f"all {supported} Python block(s) parse"
    else:
        detail = "; ".join(problems)
    if skipped:
        detail += f" (skipped unsupported: {', '.join(skipped)})"
    return ClaimVerdict(
        "MATCH" if matched else "MISMATCH",
        "valid" if truth else "invalid",
        detail,
        verifier="code",
    )


CODE_VERIFIER = register_verifier(
    ClaimVerifier(
        "code",
        "Parse fenced Python code without executing it and compare the claim.",
        _code_verify,
    )
)

KNOWLEDGE_VERIFIER = register_verifier(
    ClaimVerifier(
        "knowledge",
        "Look up an exact question in a local trusted-knowledge JSONL file.",
        _knowledge_verify,
    )
)

__all__ = [
    "ClaimVerifier",
    "CODE_VERIFIER",
    "KNOWLEDGE_VERIFIER",
    "enabled_verifiers",
    "get_verifier",
    "list_verifiers",
    "register_verifier",
    "trusted_kb_path",
    "unregister_verifier",
]
