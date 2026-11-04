"""Minimal MCP server (JSON-RPC over stdio) exposing the verified math tools.

Tools: ``compute`` (run an authorized request), ``check_answer`` (audit a proposed answer),
``list_operations``. Needs no network and no API key.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, Optional

from .framework import REGISTRY
from .orchestrator import Orchestrator
from .verifiers import list_verifiers

PROTOCOL = "2024-11-05"
TOOLS = [
    {"name": "compute", "description": "Compute a mathematical request exactly and verify it with independent methods. "
     "Returns a value only if verification succeeded; otherwise the request is withheld. Examples: 'solve x^2-5x+6=0', "
     "'derivative of x^3*sin(x)', 'integrate x^2 from 0 to 3', 'determinant of [[1,2],[3,4]]', 'is 1000003 prime', 'prove x^2 >= 0'.",
     "inputSchema": {"type": "object", "properties": {"request": {"type": "string"}}, "required": ["request"]}},
    {"name": "check_answer", "description": "Recompute a question independently and say whether a proposed answer is correct. "
     "Math uses verified computation; code and trusted-knowledge verifiers can also be configured. "
     "Use this before stating any numeric or symbolic result.",
     "inputSchema": {"type": "object", "properties": {"question": {"type": "string"}, "claimed_answer": {"type": "string"}},
                     "required": ["question", "claimed_answer"]}},
    {"name": "list_verifiers", "description": "List the claim verifiers available to check_answer (math is always the fallback).",
     "inputSchema": {"type": "object", "properties": {}}},
    {"name": "list_operations", "description": "List supported operations.", "inputSchema": {"type": "object", "properties": {}}},
]


def handle(orch: Orchestrator, msg: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    method, mid = msg.get("method"), msg.get("id")
    if mid is None:  # notification
        return None

    def ok(result: Any) -> Dict[str, Any]:
        return {"jsonrpc": "2.0", "id": mid, "result": result}

    def text(t: str, error: bool = False) -> Dict[str, Any]:
        return ok({"content": [{"type": "text", "text": t}], "isError": error})

    if method == "initialize":
        return ok({"protocolVersion": PROTOCOL, "capabilities": {"tools": {}},
                   "serverInfo": {"name": "mathcore", "version": "0.1.0"}})
    if method == "ping":
        return ok({})
    if method == "tools/list":
        return ok({"tools": TOOLS})
    if method == "tools/call":
        p = msg.get("params", {})
        name, a = p.get("name"), p.get("arguments", {}) or {}
        try:
            if name == "compute":
                r = orch.for_ai(str(a["request"]))
                return text(json.dumps(r, indent=2), error=not r["all_verified"])
            if name == "check_answer":
                v = orch.check(str(a["question"]), str(a["claimed_answer"]))
                return text(json.dumps(vars(v), indent=2), error=v.verdict == "MISMATCH")
            if name == "list_verifiers":
                return text(json.dumps(list_verifiers(), indent=2))
            if name == "list_operations":
                return text(json.dumps(REGISTRY.describe(), indent=2))
        except KeyError as exc:
            return text(f"missing argument {exc}", True)
        return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": f"unknown tool {name}"}}
    return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": f"unknown method {method}"}}


def main() -> int:
    audit = os.environ.get("MATHCORE_AUDIT", str(Path.home() / ".mathcore" / "audit.jsonl"))
    orch = Orchestrator(audit)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            reply = handle(orch, json.loads(line))
        except json.JSONDecodeError:
            reply = {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "parse error"}}
        if reply is not None:
            sys.stdout.write(json.dumps(reply) + "\n")
            sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
