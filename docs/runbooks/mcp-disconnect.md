# Runbook: MCP Disconnect (mathcore)

## Symptoms
- `mathcore_compute` fails / times out
- Capability `mathcore.verified-compute` shows `degraded`/`unavailable`

## Diagnosis
1. `pnpm run doctor` — resolves `mathcore-mcp` the same way the app does
   (MATHCORE_MCP_COMMAND → `.venv` → PATH) and reports the importable
   mathcore version.
2. `mathcore "2+2"` directly — if this fails, the server itself is down.
3. Check process: `ps aux | grep mathcore-mcp` (or Task Manager on Windows).
4. Check audit log writable: `ls -la ~/.mathcore/audit.jsonl`.
5. Check `capability_check {capability: "mathcore.verified-compute", details: true}`.

## Resolution
```bash
# activate the venv first (.\.venv\Scripts\Activate.ps1 / source .venv/bin/activate)
python -m pip install -e ./mathcore --force-reinstall
mkdir -p ~/.mathcore && touch ~/.mathcore/audit.jsonl
MATHCORE_AUDIT=~/.mathcore/audit.jsonl mathcore "2+2"
pnpm run doctor   # mathcore-mcp must resolve
# restart Zoveli afterwards
```
If the binary lives outside PATH, set `MATHCORE_MCP_COMMAND` to its full path
(args allowed, e.g. `python -m mathcore.mcp_server`).
Fallback: math tools return WITHHELD until MCP recovers — the model must not
guess (see `capability_adapt`).

## Prevention
- Startup probe runs `mathcore "2+2"` and marks capability accordingly.
- CI installs mathcore and runs `tests/integration/capability.integration.test.ts`.
