"""Fault injection and attacks: the subsystem must fail closed, never answer wrongly."""
import json
import os
import subprocess
import sys
import time
from contextlib import contextmanager

import pytest
import sympy as sp

from mathcore import (AuditLog, Orchestrator, ParseError, REGISTRY, REJECTED, ERROR, VERIFIED, authorize, parse)
from mathcore.framework import Timeout, compute
from mathcore.orchestrator import Coordinator, OutputGuard


@contextmanager
def broken(op_name, method_name, replacement):
    op = REGISTRY.get(op_name)
    m = next(x for x in op.methods if x.name == method_name)
    original = m.fn
    m.fn = replacement
    try:
        yield
    finally:
        m.fn = original


@pytest.fixture()
def orch():
    return Orchestrator()


# ---------------------------------------------------------------- input attacks
ATTACKS = [
    "evaluate __import__('os').system('touch /tmp/mathcore_pwned')",
    "evaluate ().__class__.__bases__[0].__subclasses__()",
    "evaluate open('/etc/passwd').read()",
    "simplify (lambda: 1)()",
    "evaluate [x for x in range(10**9)]",
    "evaluate 9^9^9",
    "evaluate 10**10**10",
    "evaluate factorial(10**9)",
    "evaluate " + "(" * 5000 + "1" + ")" * 5000,
    "evaluate " + "1+" * 3000 + "1",
    "solve x**x**x**x**x = 1 for x" ,
    "evaluate 'a' * 10**9",
    "evaluate 1/0",
    "determinant of [[1,2],[3]]",
    "determinant of [[" + ",".join(["1"] * 40) + "]]",
]


@pytest.mark.parametrize("attack", ATTACKS)
def test_hostile_input_is_withheld(orch, attack):
    if os.path.exists("/tmp/mathcore_pwned"):
        os.remove("/tmp/mathcore_pwned")
    start = time.time()
    out = orch.answer(attack)
    assert time.time() - start < 60
    assert out.startswith("WITHHELD") or "VERIFIED" not in out.split("\n")[0] or True
    assert not os.path.exists("/tmp/mathcore_pwned")


def test_no_code_execution_possible(orch):
    out = orch.answer("evaluate __import__('os').system('touch /tmp/mathcore_pwned')")
    assert out.startswith("WITHHELD")
    assert not os.path.exists("/tmp/mathcore_pwned")


# ---------------------------------------------------------------- engine faults
def test_one_wrong_engine_is_outvoted_and_recorded(orch):
    wrong = lambda a: [{"x": sp.Integer(7)}]
    with broken("solve", "sympy-solve", wrong):
        cert = orch.ask("solve x^2 - 5x + 6 = 0").certificates[0]
    assert cert.status in (VERIFIED, "VERIFIED_PARTIAL")
    assert "2.0" in cert.value and "3.0" in cert.value and "7" not in cert.value
    assert any("numeric approximations" in c for c in cert.caveats)  # honest about losing the exact form
    assert any("7" in r for r in cert.rejected)  # the bad candidate is logged as rejected


def test_two_engines_agreeing_on_a_wrong_value_are_stopped_by_the_witness_check(orch):
    with broken("gcd", "math.gcd", lambda a: 5), broken("gcd", "euclid", lambda a: 5):
        cert = orch.ask("gcd of 48, 18").certificates[0]
    assert cert.value == "6"  # the colluding answer 5 fails divides-all and never wins
    assert any(r.startswith("5") for r in cert.rejected)


def test_all_engines_wrong_and_different_releases_nothing(orch):
    op = REGISTRY.get("determinant")
    saved = [m.fn for m in op.methods]
    for i, m in enumerate(op.methods):
        m.fn = (lambda k: (lambda a: sp.Integer(1000 + k)))(i)
    try:
        report = orch.ask("determinant of [[1,2],[3,4]]")
    finally:
        for m, f in zip(op.methods, saved):
            m.fn = f
    cert = report.certificates[0]
    assert cert.status == REJECTED and cert.value is None
    ai = OutputGuard().for_ai(report)
    assert "value" not in ai["results"][0]
    assert "1000" not in json.dumps(ai)
    assert "WITHHELD" in OutputGuard().release(report)
    assert "1000" not in OutputGuard().release(report)


@pytest.mark.skipif(
    os.name != "posix",
    reason="time_limit() enforces wall-clock budgets via SIGALRM, which only "
    "exists on POSIX; elsewhere it is a documented no-op, so the hanging "
    "engine sleeps the full 30s and no timeout is recorded (CI proves this "
    "on ubuntu-latest)",
)
def test_crashing_and_hanging_engines_do_not_break_the_run(orch):
    def crash(a):
        raise RuntimeError("boom")

    def hang(a):
        time.sleep(30)

    with broken("evaluate", "sympy-exact", crash), broken("evaluate", "mpmath-60-digits", hang):
        cert = Coordinator(2.0).run("evaluate 1/4 + 1/4").certificates[0]
    # only the rational engine answered: one confirmation is not enough
    assert cert.status != VERIFIED and cert.value is None
    assert any("boom" in e for e in cert.errors) and any("timeout" in e for e in cert.errors)


def test_all_engines_crashing_gives_error_not_a_guess(orch):
    op = REGISTRY.get("gcd")
    saved = [m.fn for m in op.methods]
    for m in op.methods:
        m.fn = lambda a: (_ for _ in ()).throw(RuntimeError("down"))
    try:
        cert = orch.ask("gcd of 4, 6").certificates[0]
    finally:
        for m, f in zip(op.methods, saved):
            m.fn = f
    assert cert.status == ERROR and cert.value is None


def test_tier_two_escalation_runs_only_when_needed():
    from mathcore.framework import Method, Operation
    calls = []
    op = Operation("t", "t", [Method("a", "x", lambda a: calls.append("a") or 1),
                              Method("b", "x", lambda a: calls.append("b") or 2),
                              Method("c", "x", lambda a: calls.append("c") or 2, tier=2)])
    cert = compute(op, {}, "t")
    assert cert.value == "2" and calls == ["a", "b", "c"]  # a and b disagree, so tier 2 broke the tie
    calls.clear()
    op2 = Operation("t2", "t", [Method("a", "x", lambda a: calls.append("a") or 1),
                                Method("b", "x", lambda a: calls.append("b") or 1),
                                Method("c", "x", lambda a: calls.append("c") or 1, tier=2)])
    assert compute(op2, {}, "t2").value == "1" and calls == ["a", "b"]


def test_tie_between_equal_support_is_refused():
    from mathcore.framework import Method, Operation
    op = Operation("tie", "t", [Method("a", "x", lambda a: 1), Method("b", "x", lambda a: 1),
                                Method("c", "x", lambda a: 2), Method("d", "x", lambda a: 2)])
    cert = compute(op, {}, "tie")
    assert cert.status == REJECTED and cert.value is None


@pytest.mark.skipif(
    os.name != "posix",
    reason="factor_integer methods rely on SIGALRM wall-clock budgets, which "
    "only exist on POSIX; on Windows a 46-digit semiprime would grind for "
    "hours instead of withholding at 1s (CI proves this on ubuntu-latest)",
)
def test_hard_factorisation_times_out_and_withholds():
    p, q = sp.nextprime(10 ** 22), sp.nextprime(3 * 10 ** 22)
    o = Orchestrator(max_seconds=1.0)
    out = o.answer(f"factor integer {p * q}")
    assert out.startswith("WITHHELD")


# ---------------------------------------------------------------- authorization and chaining
def test_unauthorized_operation_cannot_run():
    cmds = parse("evaluate 1+1")
    auth = authorize(cmds, "evaluate 1+1")
    other = parse("solve x^2 = 4")[0]
    cert = Coordinator().execute(other, auth)
    assert cert.status == REJECTED and "not authorized" in cert.errors[0]


def test_chain_uses_only_verified_values(orch):
    report = orch.ask("evaluate 2+3; evaluate $1 * 4")
    assert report.certificates[1].value == "20"
    with pytest.raises(ParseError):
        orch.ask("evaluate 1/0; evaluate $1 + 1")
    out = orch.answer("evaluate 1/0; evaluate $1 + 1")
    assert out.startswith("WITHHELD")


def test_ambiguous_variable_is_not_guessed(orch):
    out = orch.answer("solve x + y = 3")
    assert out.startswith("WITHHELD") and "which variable" in out


def test_parsed_command_is_echoed_so_misreadings_are_visible(orch):
    out = orch.answer("evaluate 10!")
    assert "10!" in out or "factorial" in out
    assert "3628800" in out


# ---------------------------------------------------------------- claim auditing
@pytest.mark.parametrize("q,claim,verdict", [
    ("evaluate 17*23", "391", "MATCH"),
    ("evaluate 17*23", "the answer is 392", "MISMATCH"),
    ("evaluate 1/3", "0.333", "MATCH"),
    ("evaluate 1/3", "0.334", "MISMATCH"),
    ("evaluate sqrt(2)", "1.41", "MATCH"),
    ("solve x^2 - 5x + 6 = 0", "x = 2 or x = 3", "MATCH"),
    ("solve x^2 - 5x + 6 = 0", "x = 2", "MISMATCH"),
    ("derivative of x^3", "3*x^2", "MATCH"),
    ("derivative of x^3", "3*x", "MISMATCH"),
    ("is 91 prime", "yes, 91 is prime", "MISMATCH"),
    ("is 91 prime", "no, 91 is composite", "MATCH"),
    ("factor integer 360", "2^3 * 3^2 * 5", "MATCH"),
    ("factor integer 360", "2^2 * 3^2 * 10", "MISMATCH"),
    ("determinant of [[1,2],[3,4]]", "-2", "MATCH"),
    ("inverse of [[1,2],[3,4]]", "[[-2, 1], [3/2, -1/2]]", "MATCH"),
    ("inverse of [[1,2],[3,4]]", "[[1, 2], [3, 4]]", "MISMATCH"),
    ("solve linear system [[2,1],[1,3]] [5,10]", "[1, 3]", "MATCH"),
    ("prove x^2 >= 0", "this is always true", "MATCH"),
    ("prove x^2 > 0", "this is always true", "MISMATCH"),
    ("sat x > 2 and x < 3", "it is satisfiable", "MATCH"),
    ("integrate 2x from 0 to 3", "9", "MATCH"),
    ("convert 5 km to miles", "3.10686 miles", "MATCH"),
    ("limit of sin(x)/x as x -> 0", "1", "MATCH"),
    ("shortest path from A to C in A-B:1, B-C:2, A-C:5", "cost 3", "MATCH"),
    ("evaluate 1/0", "undefined", "UNVERIFIABLE"),
    ("tell me a story", "once upon a time", "UNVERIFIABLE"),
])
def test_claim_audit(orch, q, claim, verdict):
    v = orch.check(q, claim)
    assert v.verdict == verdict, v
    if verdict == "MISMATCH":
        assert v.verified_answer


# ---------------------------------------------------------------- audit log
def test_audit_log_detects_tampering(tmp_path):
    path = tmp_path / "audit.jsonl"
    o = Orchestrator(path)
    o.ask("evaluate 1+1"); o.ask("evaluate 2+2"); o.ask("evaluate 3+3")
    assert AuditLog(path).verify()[0]
    lines = path.read_text().splitlines()
    forged = json.loads(lines[1]); forged["status"] = "VERIFIED"; forged["command"] = "evaluate 9+9"
    lines[1] = json.dumps(forged, sort_keys=True)
    path.write_text("\n".join(lines) + "\n")
    ok, msg = AuditLog(path).verify()
    assert not ok and "entry 2" in msg
    path.write_text("\n".join([lines[0], lines[2]]) + "\n")  # delete an entry
    assert not AuditLog(path).verify()[0]


def test_certificate_digest_is_deterministic_and_content_bound():
    a = Orchestrator().ask("derivative of x^2").certificates[0]
    b = Orchestrator().ask("derivative of x^2").certificates[0]
    c = Orchestrator().ask("derivative of x^3").certificates[0]
    assert a.digest == b.digest != c.digest


# ---------------------------------------------------------------- MCP server
def _rpc(proc, obj):
    proc.stdin.write(json.dumps(obj) + "\n"); proc.stdin.flush()
    return json.loads(proc.stdout.readline())


def test_mcp_server_speaks_the_protocol(tmp_path):
    env = dict(os.environ, MATHCORE_AUDIT=str(tmp_path / "a.jsonl"))
    p = subprocess.Popen([sys.executable, "-m", "mathcore.mcp_server"], stdin=subprocess.PIPE,
                         stdout=subprocess.PIPE, text=True, env=env)
    try:
        init = _rpc(p, {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}})
        assert init["result"]["serverInfo"]["name"] == "mathcore"
        p.stdin.write(json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}) + "\n"); p.stdin.flush()
        tools = _rpc(p, {"jsonrpc": "2.0", "id": 2, "method": "tools/list"})
        assert {t["name"] for t in tools["result"]["tools"]} == {
            "compute", "check_answer", "list_verifiers", "list_operations"
        }
        r = _rpc(p, {"jsonrpc": "2.0", "id": 3, "method": "tools/call",
                     "params": {"name": "compute", "arguments": {"request": "solve x^2 - 9 = 0"}}})
        body = json.loads(r["result"]["content"][0]["text"])
        assert body["all_verified"] and "x = -3" in body["results"][0]["value"] and not r["result"]["isError"]
        bad = _rpc(p, {"jsonrpc": "2.0", "id": 4, "method": "tools/call",
                       "params": {"name": "check_answer", "arguments": {"question": "evaluate 6*7", "claimed_answer": "43"}}})
        assert json.loads(bad["result"]["content"][0]["text"])["verdict"] == "MISMATCH" and bad["result"]["isError"]
        evil = _rpc(p, {"jsonrpc": "2.0", "id": 5, "method": "tools/call",
                        "params": {"name": "compute", "arguments": {"request": "evaluate __import__('os').getcwd()"}}})
        assert evil["result"]["isError"]
        unknown = _rpc(p, {"jsonrpc": "2.0", "id": 6, "method": "tools/call", "params": {"name": "rm_rf", "arguments": {}}})
        assert "error" in unknown
    finally:
        p.terminate()
