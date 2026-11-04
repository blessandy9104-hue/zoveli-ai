"""The specialist modules must load on demand, not at import time."""
from __future__ import annotations

import os
import subprocess
import sys


def run_python(code: str) -> subprocess.CompletedProcess[str]:
    env = dict(os.environ)
    # Keep the child deterministic even if the developer exported an audit path.
    env.pop("MATHCORE_AUDIT", None)
    return subprocess.run(
        [sys.executable, "-c", code],
        capture_output=True,
        text=True,
        env=env,
        timeout=120,
    )


def test_import_mathcore_does_not_import_specialists():
    result = run_python(
        "import sys, mathcore; "
        "print(','.join(sorted(m for m in sys.modules "
        "if m.startswith('mathcore.ops_') and m != 'mathcore.ops_catalog')))"
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == ""


def test_first_operation_loads_only_its_module():
    result = run_python(
        "import sys\n"
        "from mathcore import Orchestrator\n"
        "report = Orchestrator().ask('evaluate 6*7')\n"
        "print(report.certificates[0].status)\n"
        "print(','.join(sorted(m for m in sys.modules "
        "if m.startswith('mathcore.ops_') and m != 'mathcore.ops_catalog')))\n"
    )
    assert result.returncode == 0, result.stderr
    lines = result.stdout.strip().splitlines()
    assert lines[0] == "VERIFIED"
    loaded = set(lines[1].split(",")) if len(lines) > 1 and lines[1] else set()
    assert "mathcore.ops_algebra" in loaded
    assert "mathcore.ops_data" not in loaded
    assert "mathcore.ops_linear" not in loaded


def test_catalog_lists_every_operation_without_importing_them_first():
    result = run_python(
        "import sys\n"
        "from mathcore.framework import REGISTRY\n"
        "names = REGISTRY.names()\n"
        "print(len(names))\n"
        "print('integrate' in names and 'probability' in names)\n"
        "print(','.join(sorted(m for m in sys.modules "
        "if m.startswith('mathcore.ops_') and m != 'mathcore.ops_catalog')) or 'none')\n"
    )
    assert result.returncode == 0, result.stderr
    lines = result.stdout.strip().splitlines()
    assert int(lines[0]) >= 34
    assert lines[1] == "True"
    assert lines[2] == "none"


def test_describe_loads_the_full_catalog():
    result = run_python(
        "from mathcore.framework import REGISTRY\n"
        "d = REGISTRY.describe()\n"
        "print('integrate' in d and 'probability' in d)\n"
        "print(d['solve'][:10])\n"
    )
    assert result.returncode == 0, result.stderr
    lines = result.stdout.strip().splitlines()
    assert lines[0] == "True"
    assert lines[1]
