"""Operation framework: methods, witness checks, certificates and the quorum rule.

An *operation* (for example ``solve`` or ``integrate``) is computed by several
independent *methods* (different algorithms or different libraries). A *check* is a
witness test of a candidate result (substitute a root back, multiply factors back,
evaluate a model). A candidate is released only when

    confirmations(methods that agree + checks that pass) >= min_confirmations
    and no check fails.

Anything else is rejected rather than guessed. Fail closed.
"""
from __future__ import annotations

import hashlib
import importlib
import json
import signal
import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple

from .safe_expr import NotApplicable, ParseError

VERIFIED = "VERIFIED"
PARTIAL = "VERIFIED_PARTIAL"
REJECTED = "REJECTED"
ERROR = "ERROR"


class Timeout(Exception):
    """A method exceeded its wall-clock budget."""


@contextmanager
def time_limit(seconds: float):
    """Wall-clock limit for the main thread on POSIX; a no-op elsewhere."""
    usable = (hasattr(signal, "setitimer")
              and threading.current_thread() is threading.main_thread() and seconds > 0)
    if not usable:
        yield
        return

    def handler(signum, frame):  # noqa: ARG001
        raise Timeout(f"exceeded {seconds:g}s")

    old = signal.signal(signal.SIGALRM, handler)
    signal.setitimer(signal.ITIMER_REAL, seconds)
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, old)


@dataclass
class Method:
    name: str
    engine: str
    fn: Callable[[Dict[str, Any]], Any]
    tier: int = 1  # tier 2 methods run only when tier 1 cannot reach quorum


@dataclass
class Check:
    name: str
    fn: Callable[[Dict[str, Any], Any], Tuple[bool, str]]


@dataclass
class Operation:
    name: str
    summary: str
    methods: List[Method]
    checks: List[Check] = field(default_factory=list)
    same: Callable[[Any, Any], bool] = lambda a, b: a == b
    show: Callable[[Any], str] = str
    caveats: Optional[Callable[[Dict[str, Any], Any], List[str]]] = None
    min_confirmations: int = 2


@dataclass
class Confirmation:
    kind: str  # "method" or "check"
    name: str
    ok: bool
    detail: str = ""


@dataclass
class Certificate:
    command: str
    op: str
    status: str
    value: Optional[str] = None
    raw: Any = None
    confirmations: List[Confirmation] = field(default_factory=list)
    rejected: List[str] = field(default_factory=list)
    caveats: List[str] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)
    seconds: float = 0.0
    digest: str = ""

    def body(self) -> Dict[str, Any]:
        return {
            "command": self.command, "op": self.op, "status": self.status, "value": self.value,
            "confirmations": [vars(c) for c in self.confirmations],
            "rejected": self.rejected, "caveats": self.caveats, "errors": self.errors,
        }

    def seal(self) -> "Certificate":
        blob = json.dumps(self.body(), sort_keys=True, ensure_ascii=True).encode()
        self.digest = hashlib.sha256(blob).hexdigest()
        return self

    @property
    def releasable(self) -> bool:
        return self.status in (VERIFIED, PARTIAL)


class Registry:
    """Operation registry with lazy module loading.

    Specialist modules pull in sympy/scipy/pint/z3, so importing all of them at
    startup made every CLI/MCP launch pay for the whole math surface. Modules
    are now *declared* by name and imported only when one of their operations
    is first requested. ``names()`` and ``describe()`` still expose the full
    catalog for discovery without touching a heavy module until needed.
    """

    def __init__(self) -> None:
        self._ops: Dict[str, Operation] = {}
        self._lazy: Dict[str, str] = {}
        self._loaded: set[str] = set()

    def add(self, op: Operation) -> Operation:
        if op.name in self._ops:
            raise ValueError(f"duplicate operation {op.name}")
        self._ops[op.name] = op
        self._lazy.pop(op.name, None)
        return op

    def declare(self, module: str, names: Tuple[str, ...]) -> None:
        """Publish operation names now; import ``module`` on first use."""
        for name in names:
            if name not in self._ops:
                self._lazy[name] = module

    def _load(self, module: str) -> None:
        if module in self._loaded:
            return
        importlib.import_module(f".{module}", package=__package__)
        self._loaded.add(module)

    def get(self, name: str) -> Operation:
        if name not in self._ops and name in self._lazy:
            self._load(self._lazy[name])
        if name not in self._ops:
            raise KeyError(name)
        return self._ops[name]

    def names(self) -> List[str]:
        return sorted(set(self._ops) | set(self._lazy))

    def describe(self) -> Dict[str, str]:
        for module in set(self._lazy.values()):
            self._load(module)
        return {n: self._ops[n].summary for n in sorted(self._ops)}


REGISTRY = Registry()


def _short(exc: BaseException) -> str:
    return f"{type(exc).__name__}: {str(exc)[:160]}"


def compute(op: Operation, args: Dict[str, Any], command: str, seconds: float = 20.0) -> Certificate:
    """Run every method, group agreeing values, run witness checks, apply the quorum rule."""
    started = time.monotonic()
    cert = Certificate(command=command, op=op.name, status=REJECTED)
    outcomes: List[Tuple[Method, Any]] = []

    def run_tier(tier: int) -> None:
        for m in [m for m in op.methods if m.tier == tier]:
            try:
                with time_limit(seconds):
                    outcomes.append((m, m.fn(dict(args))))
            except ParseError:
                raise
            except NotApplicable as exc:
                cert.errors.append(f"{m.name}: not applicable ({str(exc)[:100]})")
            except Timeout as exc:
                cert.errors.append(f"{m.name}: timeout ({exc})")
            except Exception as exc:  # a failing engine must never take the run down
                cert.errors.append(f"{m.name}: {_short(exc)}")

    def evaluate() -> Optional[Tuple[Any, List[Confirmation]]]:
        groups: List[Tuple[Any, List[Method]]] = []
        for m, v in outcomes:
            for g in groups:
                try:
                    agree = bool(op.same(g[0], v))
                except Exception:
                    agree = False
                if agree:
                    g[1].append(m)
                    break
            else:
                groups.append((v, [m]))
        scored: List[Tuple[int, Any, List[Confirmation]]] = []
        for value, methods in groups:
            confs = [Confirmation("method", m.name, True, m.engine) for m in methods]
            failed = False
            for chk in op.checks:
                try:
                    with time_limit(seconds):
                        ok, detail = chk.fn(dict(args), value)
                except Exception as exc:
                    ok, detail = False, _short(exc)
                confs.append(Confirmation("check", chk.name, bool(ok), detail))
                failed = failed or not ok
            if failed:
                cert.rejected.append(f"{_show_safe(op, value)} (failed: "
                                     + ", ".join(c.name for c in confs if not c.ok) + ")")
                continue
            scored.append((sum(c.ok for c in confs), value, confs))
        if not scored:
            return None
        scored.sort(key=lambda t: -t[0])
        best = scored[0]
        if best[0] < op.min_confirmations:
            cert.rejected.append(f"{_show_safe(op, best[1])} (only {best[0]} confirmation(s))")
            return None
        if len(scored) > 1 and scored[1][0] == best[0]:
            cert.rejected.append("two different results have equal support; refusing to choose")
            return None
        return best[1], best[2]

    try:
        run_tier(1)
        verdict = evaluate()
        if verdict is None and any(m.tier == 2 for m in op.methods):
            run_tier(2)  # escalate: disagreement or too little support
            cert.rejected.clear()
            verdict = evaluate()
    except ParseError as exc:
        cert.status, cert.errors = ERROR, [f"input: {exc}"]
        cert.seconds = time.monotonic() - started
        return cert.seal()

    if verdict is None:
        cert.status = REJECTED if (outcomes or cert.rejected) else ERROR
    else:
        value, confs = verdict
        cert.raw = value
        cert.value = op.show(value)
        cert.confirmations = confs
        cert.caveats = op.caveats(args, value) if op.caveats else []
        cert.status = PARTIAL if cert.caveats else VERIFIED
    cert.seconds = time.monotonic() - started
    return cert.seal()


def _show_safe(op: Operation, value: Any) -> str:
    try:
        return op.show(value)
    except Exception:
        return repr(value)[:80]
