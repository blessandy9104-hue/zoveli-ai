"""Orchestration layer: parse -> authorize -> coordinate -> guard -> audit.

* :class:`Coordinator` is the agent that plans a request's steps, runs them through the
  verification framework, adapts when a step fails (longer time budget, chained values),
  and refuses to feed an unverified value into a later step.
* :class:`OutputGuard` is the last gate. Text for people or for an AI is rendered only from
  a sealed certificate, never from free text, and only if the certificate is releasable.
  It can also audit an answer that an AI proposes by recomputing the question.
* :class:`AuditLog` is an append-only hash chain, so edits to history are detectable.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import time
import warnings
from dataclasses import dataclass, field
from fractions import Fraction
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import mpmath as mp
import sympy as sp

from . import ops_catalog  # noqa: F401  (declares lazy specialist modules)
from .capability import CapabilityError, require_capability
from .claims import ClaimVerdict
from .command import Authorization, Command, authorize, parse
from .framework import ERROR, PARTIAL, REGISTRY, REJECTED, VERIFIED, Certificate, compute
from .numeric import close, to_mp
from .safe_expr import ParseError, to_sympy
from .verifiers import enabled_verifiers, get_verifier


# --------------------------------------------------------------------------- audit log
class AuditLog:
    """Append-only JSON-lines file; each entry hashes the previous one."""

    def __init__(self, path: Optional[os.PathLike] = None) -> None:
        self.path = Path(path) if path else None
        self._last = "0" * 64
        if self.path and self.path.exists():
            lines = self.path.read_text().strip().splitlines()
            if lines:
                self._last = json.loads(lines[-1])["hash"]

    def append(self, entry: Dict[str, Any]) -> str:
        entry = dict(entry, ts=round(time.time(), 3), prev=self._last)
        body = json.dumps(entry, sort_keys=True, ensure_ascii=True)
        entry["hash"] = hashlib.sha256(body.encode()).hexdigest()
        self._last = entry["hash"]
        if self.path:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with open(self.path, "a", encoding="utf-8") as fh:
                fh.write(json.dumps(entry, sort_keys=True, ensure_ascii=True) + "\n")
        return entry["hash"]

    def verify(self) -> Tuple[bool, str]:
        if not self.path or not self.path.exists():
            return True, "empty log"
        prev = "0" * 64
        for i, line in enumerate(self.path.read_text().strip().splitlines(), 1):
            e = json.loads(line)
            claimed = e.pop("hash")
            if e.get("prev") != prev:
                return False, f"entry {i}: chain broken"
            if hashlib.sha256(json.dumps(e, sort_keys=True, ensure_ascii=True).encode()).hexdigest() != claimed:
                return False, f"entry {i}: content was altered"
            prev = claimed
        return True, f"{i} entries intact"


# --------------------------------------------------------------------------- coordinator
@dataclass
class Report:
    source: str
    commands: List[Command]
    certificates: List[Certificate]
    authorization: Authorization

    @property
    def all_released(self) -> bool:
        return all(c.releasable for c in self.certificates) and len(self.certificates) == len(self.commands)


_PLAIN_OPS = {"evaluate", "simplify", "expand", "factor", "derivative", "integrate", "limit", "determinant",
              "gcd", "lcm", "modpow", "factorial", "choose", "rank", "stat"}


def chain_text(cert: Certificate) -> Optional[str]:
    """A re-parseable form of a verified result, for use as $n in a later statement."""
    if cert.op not in _PLAIN_OPS or not cert.releasable:
        return None
    v = cert.raw
    if isinstance(v, Fraction):
        return f"({v.numerator}/{v.denominator})"
    if isinstance(v, (int, sp.Basic)) and not isinstance(v, (sp.MatrixBase,)):
        return f"({v})".replace("**", "^")
    return None


class Coordinator:
    """Plans and runs steps; unverified values never flow into later steps."""

    def __init__(self, default_seconds: float = 20.0) -> None:
        self.default_seconds = default_seconds

    def execute(self, cmd: Command, auth: Authorization) -> Certificate:
        if not auth.allows(cmd.op):
            c = Certificate(cmd.canonical, cmd.op, REJECTED, errors=[f"operation '{cmd.op}' was not authorized by the request"])
            return c.seal()
        try:
            require_capability(cmd.op)
        except CapabilityError as exc:
            # Fast fail before loading a heavy specialist module or running a
            # model that cannot represent the operation. The audit certificate
            # records ERROR; the warning makes the cause visible to a person.
            warnings.warn(str(exc), RuntimeWarning, stacklevel=2)
            return Certificate(cmd.canonical, cmd.op, ERROR, errors=[str(exc)]).seal()
        try:
            op = REGISTRY.get(cmd.op)
        except KeyError:
            return Certificate(cmd.canonical, cmd.op, ERROR, errors=[f"unknown operation {cmd.op}"]).seal()
        cert = compute(op, cmd.args, cmd.canonical, auth.max_seconds)
        if not cert.releasable and any("timeout" in e for e in cert.errors):
            cert = compute(op, cmd.args, cmd.canonical, min(auth.max_seconds * 3, 60.0))  # adapt: more time, once
            cert.caveats = cert.caveats + (["needed an extended time budget"] if cert.releasable else [])
            cert.seal()
        return cert

    def run(self, text: str, max_seconds: Optional[float] = None) -> Report:
        commands = parse(text)
        auth = authorize(commands, text, max_seconds or self.default_seconds)
        certs: List[Certificate] = []
        chain: Dict[int, Optional[str]] = {}
        for i, cmd in enumerate(commands, 1):
            cmd = self._substitute(cmd, chain, certs)
            certs.append(self.execute(cmd, auth))
            chain[i] = chain_text(certs[-1])
            commands[i - 1] = cmd
        return Report(text, commands, certs, auth)

    @staticmethod
    def _substitute(cmd: Command, chain: Dict[int, Optional[str]], certs: List[Certificate]) -> Command:
        refs = set()
        for v in cmd.args.values():
            if isinstance(v, str):
                refs.update(int(n) for n in re.findall(r"\$(\d+)", v))
        if not refs:
            return cmd

        def sub(s: str) -> str:
            def rep(m: re.Match) -> str:
                n = int(m.group(1))
                if n not in chain or chain[n] is None:
                    raise ParseError(f"${n} has no verified value to use")
                return chain[n]  # type: ignore[return-value]
            return re.sub(r"\$(\d+)", rep, s)

        args = {k: (sub(v) if isinstance(v, str) else v) for k, v in cmd.args.items()}
        return Command(cmd.op, args, sub(cmd.canonical), cmd.raw)


# --------------------------------------------------------------------------- output guard
class Blocked(Exception):
    """Raised when something unverified would reach a consumer."""


class OutputGuard:
    """The only component allowed to produce text for a person or an AI."""

    MAX_TEXT = 20_000

    def render(self, cert: Certificate) -> str:
        if not cert.releasable:
            return f"WITHHELD  {cert.command}\n    no answer was released: {self._reason(cert)}"
        tag = "VERIFIED" if cert.status == VERIFIED else "VERIFIED (with caveats)"
        methods = [c.name for c in cert.confirmations if c.kind == "method" and c.ok]
        checks = [c.name for c in cert.confirmations if c.kind == "check" and c.ok]
        lines = [f"{tag}  {cert.command}", f"    {self._clean(cert.value or '')}"]
        lines.append("    confirmed by: " + ", ".join(methods + [f"check:{c}" for c in checks]))
        for cav in cert.caveats:
            lines.append(f"    caveat: {self._clean(cav)}")
        lines.append(f"    certificate {cert.digest[:16]}")
        return "\n".join(lines)

    def release(self, report: Report) -> str:
        text = "\n\n".join(self.render(c) for c in report.certificates)
        return text[: self.MAX_TEXT]

    def for_ai(self, report: Report) -> Dict[str, Any]:
        """Structured output for a model: values appear only for releasable certificates."""
        items = []
        for cmd, c in zip(report.commands, report.certificates):
            item: Dict[str, Any] = {"command": cmd.canonical, "status": c.status, "certificate": c.digest}
            if c.releasable:
                item.update(value=c.value, caveats=c.caveats,
                            confirmations=[f"{x.kind}:{x.name}" for x in c.confirmations if x.ok])
            else:
                item["reason"] = self._reason(c)
            items.append(item)
        return {"all_verified": report.all_released, "results": items}

    @classmethod
    def _reason(cls, cert: Certificate) -> str:
        """Why nothing was released, without repeating any computed (possibly wrong) value."""
        parts: List[str] = []
        if cert.rejected:
            parts.append(f"{len(cert.rejected)} candidate result(s) failed verification and were discarded")
        for e in cert.errors:
            head = e.split(":")[0]
            if e.startswith("input:") or "not authorized" in e:
                parts.append(e)
            elif "timeout" in e:
                parts.append(f"{head}: timed out")
            elif "not applicable" in e:
                parts.append(f"{head}: not applicable")
            else:
                parts.append(f"{head}: engine failed")
        return cls._clean("; ".join(parts[:6]) or "no verified result")

    @staticmethod
    def _clean(s: str) -> str:
        return re.sub(r"[\x00-\x08\x0b-\x1f\x7f]", "", s)[:2000]

    # ---- auditing an answer that someone else (for example an AI) proposed
    def audit_claim(
        self,
        coordinator: Coordinator,
        question: str,
        claimed: str,
        verifiers: Optional[Sequence[Any]] = None,
    ) -> ClaimVerdict:
        """Run configured non-math verifiers, then fall back to verified math.

        A verifier returns ``None`` when it does not apply. A verifier that
        raises fails the audit as ``UNVERIFIABLE`` instead of being skipped,
        so a broken plugin cannot silently change the trust decision.
        """
        try:
            selected = (
                enabled_verifiers()
                if verifiers is None
                else [get_verifier(v) if isinstance(v, str) else v for v in verifiers]
            )
        except ValueError as exc:
            return ClaimVerdict("UNVERIFIABLE", None, str(exc), verifier="config")
        for verifier in selected:
            try:
                result = verifier.verify(question, claimed, coordinator=coordinator)
            except Exception as exc:  # a plugin must never take the audit down
                return ClaimVerdict(
                    "UNVERIFIABLE",
                    None,
                    f"verifier {verifier.name} failed: {type(exc).__name__}: {exc}",
                    verifier=verifier.name,
                )
            if result is not None:
                return result
        return self._audit_math(coordinator, question, claimed)

    def _audit_math(self, coordinator: Coordinator, question: str, claimed: str) -> ClaimVerdict:
        try:
            report = coordinator.run(question)
        except ParseError as exc:
            return ClaimVerdict("UNVERIFIABLE", None, f"could not understand the question: {exc}")
        if len(report.certificates) != 1:
            return ClaimVerdict("UNVERIFIABLE", None, "audit one question at a time")
        cert = report.certificates[0]
        if not cert.releasable:
            return ClaimVerdict("UNVERIFIABLE", None, "no verified answer exists to compare against",
                                cert.digest)
        try:
            verdict = _compare_claim(report.commands[0], cert, claimed)
        except Exception as exc:
            return ClaimVerdict("UNCOMPARABLE", cert.value, f"could not parse the claimed answer ({exc})", cert.digest)
        if verdict is None:
            return ClaimVerdict("UNCOMPARABLE", cert.value, "this kind of answer cannot be compared automatically",
                                cert.digest)
        return ClaimVerdict("MATCH" if verdict else "MISMATCH", cert.value,
                            "the claim agrees with the verified result" if verdict
                            else "the claim differs from the verified result", cert.digest)


def _strip_lead(s: str) -> str:
    s = s.strip().rstrip(".")
    s = re.sub(r"^(?:the\s+)?(?:final\s+)?(?:answer|result|value|solution)s?\s*(?:is|are|=|:)?\s*", "", s, flags=re.I)
    s = re.sub(r"^[A-Za-z]\w*\s*=\s*", "", s) if s.count("=") == 1 else s
    return s.strip()


def _digits_after_point(text: str) -> Optional[int]:
    m = re.fullmatch(r"\s*[-+]?\d*\.(\d+)\s*", text)
    return len(m.group(1)) if m else None


def _num_match(true: Any, claim_text: str) -> bool:
    claim_text = _strip_lead(claim_text)
    digits = _digits_after_point(claim_text)
    claim = to_sympy(claim_text)
    if digits is not None:  # a rounded decimal: accept if it is the correct rounding
        t = to_mp(true)
        return abs(t - to_mp(claim)) <= mp.mpf(5) * mp.mpf(10) ** -(digits + 1) * (1 + mp.mpf(10) ** -20)
    if getattr(claim, "free_symbols", None):
        return False
    return bool(sp.simplify(sp.sympify(true) - claim) == 0) if not isinstance(true, (mp.mpf, mp.mpc)) \
        else close(true, claim, mp.mpf(10) ** -12)


def _compare_claim(cmd: Command, cert: Certificate, claimed: str) -> Optional[bool]:
    op, v = cmd.op, cert.raw
    text = claimed.strip()
    low = text.lower()
    if op in ("evaluate", "determinant", "gcd", "lcm", "modpow", "factorial", "choose", "rank", "stat", "convert",
              "limit"):
        if isinstance(v, Fraction):
            v = sp.Rational(v.numerator, v.denominator)
        if op == "convert":
            text = re.sub(r"[A-Za-z\u00b0]+\s*$", "", text).strip()  # drop a trailing unit
        return _num_match(v, text)
    if op in ("simplify", "expand", "factor", "derivative", "integrate"):
        claim = to_sympy(_strip_lead(text))
        if isinstance(v, (int, float)):
            v = sp.sympify(v)
        return bool(sp.simplify(v - claim) == 0) if op != "integrate" or not getattr(v, "free_symbols", None) else \
            bool(sp.simplify(sp.diff(v - claim, *sorted(v.free_symbols, key=str)[:1])) == 0)
    if op == "is_prime":
        says_not = bool(re.search(r"\b(not prime|composite|isn'?t|is not|no)\b", low))
        says_yes = bool(re.search(r"\bprime\b|\byes\b|\btrue\b", low)) and not says_not
        return (v is True and says_yes) or (v is False and says_not) if (says_yes or says_not) else None
    if op == "factor_int":
        got: Dict[int, int] = {}
        for part in re.split(r"\s*[*x\u00d7]\s*", text):
            m = re.fullmatch(r"\s*(\d+)\s*(?:\^|\*\*)?\s*(\d+)?\s*", part)
            if not m:
                raise ValueError("write the factorisation like 2^3 * 3 * 5")
            got[int(m.group(1))] = got.get(int(m.group(1)), 0) + int(m.group(2) or 1)
        return got == v
    if op == "solve":
        sols = v
        if len(cmd.args["vars"]) == 1:
            var = cmd.args["vars"][0]
            if re.search(r"no (real |complex )?solutions?|empty", low):
                return not sols
            parts = [p for p in re.split(r"\s*(?:,|;|\band\b|\bor\b)\s*", re.sub(rf"^\s*{var}\s*=\s*", "", text)) if p]
            claimed_vals = [to_sympy(_strip_lead(re.sub(rf"^\s*{var}\s*=\s*", "", p))) for p in parts]
            if len(claimed_vals) != len(sols):
                return False
            left = list(claimed_vals)
            for s in sols:
                for c in left:
                    if close(to_mp(s[var]), to_mp(c), mp.mpf(10) ** -12):
                        left.remove(c)
                        break
                else:
                    return False
            return True
        pairs = dict((k.strip(), to_sympy(x)) for k, x in re.findall(r"([A-Za-z]\w*)\s*=\s*([^,;]+)", text))
        return any(set(s) == set(pairs) and all(close(to_mp(s[k]), to_mp(pairs[k]), mp.mpf(10) ** -12) for k in s)
                   for s in sols) and len(sols) == 1
    if op in ("inverse", "matmul"):
        from .ops_linear import parse_matrix
        c = parse_matrix(text)
        t = [[sp.sympify(x) if not isinstance(x, Fraction) else sp.Rational(x.numerator, x.denominator) for x in r]
             for r in (v.tolist() if isinstance(v, sp.MatrixBase) else v)]
        return len(c) == len(t) and len(c[0]) == len(t[0]) and all(sp.simplify(a - b) == 0 for r, s in zip(c, t) for a, b in zip(r, s))
    if op == "linsolve":
        from .ops_linear import parse_vector
        c = parse_vector(text)
        t = [sp.Rational(x.numerator, x.denominator) if isinstance(x, Fraction) else sp.sympify(x) for x in v]
        return len(c) == len(t) and all(close(to_mp(a), to_mp(b), mp.mpf(10) ** -10) for a, b in zip(c, t))
    if op == "prove":
        yes = bool(re.search(r"\b(valid|always|true|holds|proved|proven)\b", low)) and not re.search(r"\b(not|isn'?t|false|invalid)\b", low)
        no = bool(re.search(r"\b(not valid|invalid|false|counterexample|not always|fails|isn'?t)\b", low))
        return (v[0] == "valid") == yes if (yes or no) else None
    if op == "sat":
        no = bool(re.search(r"\b(unsat|unsatisfiable|not satisfiable|impossible|no solution|cannot)\b", low))
        yes = bool(re.search(r"\b(sat|satisfiable|possible|yes|true)\b", low)) and not no
        return (v[0] == "sat") == yes if (yes or no) else None
    if op == "shortest_path":
        if re.search(r"unreachable|no path", low):
            return v[0] is None
        found = re.search(r"[-+]?(?:\d+/\d+|\d+(?:\.\d+)?)", text)
        if v[0] is None or not found:
            return None
        return _num_match(sp.Rational(v[0].numerator, v[0].denominator), found.group(0))
    return None


# --------------------------------------------------------------------------- facade
class Orchestrator:
    """parse -> authorize -> coordinate -> guard -> audit, with no network and no model."""

    def __init__(self, audit_path: Optional[os.PathLike] = None, max_seconds: float = 20.0) -> None:
        self.coordinator = Coordinator(max_seconds)
        self.guard = OutputGuard()
        self.audit = AuditLog(audit_path)

    def ask(self, text: str) -> Report:
        report = self.coordinator.run(text)
        for cmd, cert in zip(report.commands, report.certificates):
            self.audit.append({"kind": "compute", "command": cmd.canonical, "op": cmd.op,
                               "status": cert.status, "certificate": cert.digest})
        return report

    def answer(self, text: str) -> str:
        try:
            return self.guard.release(self.ask(text))
        except ParseError as exc:
            return f"WITHHELD  {text.strip()[:200]}\n    I could not understand this as a mathematical request: {exc}"

    def check(
        self, question: str, claimed: str, verifiers: Optional[Sequence[Any]] = None
    ) -> ClaimVerdict:
        verdict = self.guard.audit_claim(self.coordinator, question, claimed, verifiers)
        self.audit.append({"kind": "claim", "question": question[:500], "claimed": claimed[:500],
                           "verdict": verdict.verdict, "verifier": verdict.verifier,
                           "certificate": verdict.certificate_digest})
        return verdict

    def for_ai(self, text: str) -> Dict[str, Any]:
        try:
            return self.guard.for_ai(self.ask(text))
        except ParseError as exc:
            return {"all_verified": False, "results": [{"command": text[:200], "status": ERROR,
                                                        "reason": f"not understood: {exc}"}]}
