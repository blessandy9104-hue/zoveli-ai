# Zoveli CLI Guide

## Install

```bash
# 1. Verified-math backend (vendored). A venv avoids PATH surprises:
python -m venv .venv
# Windows: .\.venv\Scripts\Activate.ps1
# macOS/Linux: source .venv/bin/activate
python -m pip install -e ./mathcore

# 2. App
pnpm install && pnpm run build

# 3. Confirm Node/pnpm/python/mathcore/Ollama (add --json for scripting)
pnpm run doctor
```

`mathcore-mcp` is resolved from `MATHCORE_MCP_COMMAND`, then `.venv`, then
`PATH` (PATHEXT-aware on Windows). `MATHCORE_MCP_COMMAND` may include args,
e.g. `MATHCORE_MCP_COMMAND="python -m mathcore.mcp_server"`.

## Run

```bash
pnpm start
# or
node apps/cli/dist/cli.js
```

## Everyday flows

- **Verified math:** `/math solve x^2 - 5x + 6 = 0` → `VERIFIED` + certificate,
  or type a bare expression like `2+2`. Solved proofs are memorized; the governor routes
to algebra/calculus/statistics/logic/units/discrete specialists.
- **Audit an answer:** `/check integrate x^2 from 0 to 3 ;; the answer is 9`
  → `MATCH` (wrong answers get `MISMATCH`, never a silent guess)
- **Host facts:** `/sys` → OS/CPU/RAM/disk/GPU snapshot
- **MCP pool:** `/mcp` → mathcore pid, spawns, restarts, pending calls, last error (`mathcore_status` does the same from chat)
- **Capabilities:** `/caps` → available/total count
- **Persona:** `/persona [friend|tutor|engineer|coach]` → show or switch the assistant's style (remembered locally; `ZOVELI_PERSONA` pins one)
- **Tool list:** `/tools` → all ~62 local tools
- **Chat:** any other text, once a chat model is available (see below —
  any API key or free local Ollama)

## Chat models (your preference, zero cost possible)

Resolution order: any API key → free local Ollama → tools-only offline.

```bash
# Option A — free and local, no keys, no cost:
# 1. Install from https://ollama.com, then:
ollama pull qwen3:4b
pnpm start   # auto-detects Ollama, chat just works

# Option B — any API key (OpenAI-compatible providers):
OPENAI_API_KEY=sk-... pnpm start        # or DEEPSEEK_API_KEY,
# OPENROUTER_API_KEY, GROQ_API_KEY, TOGETHER_API_KEY, ZOVELI_API_KEY
ZOVELI_MODEL=gpt-4o-mini pnpm start     # pick any model name
ZOVELI_API_BASE=https://my-proxy/v1 ZOVELI_API_KEY=... pnpm start  # custom endpoint

# Docker: ollama runs as a sibling service, already wired:
docker compose --profile local-llm up ollama
docker exec zoveli-ollama ollama pull qwen3:4b
docker compose --profile cli up --build
```

`ZOVELI_OLLAMA_URL` overrides the Ollama address (default
`http://localhost:11434`; Docker Compose sets it to `http://ollama:11434`).

## Data maintenance

```bash
# WAL-safe backup with a SHA-256 manifest (safe while Zoveli runs)
pnpm vault:backup -- --out ./backups/2026-10-19

# Verify checksums, SQLite integrity/foreign keys, note count, schema
pnpm vault:verify -- ./backups/2026-10-19

# Stop Zoveli first; --force is required to overwrite existing data
pnpm vault:restore -- ./backups/2026-10-19 --force

# Import legacy Markdown; existing titles are skipped, never overwritten
pnpm migrate:vault -- --db ./memory.db --vault ./knowledge-vault
```

`--db`, `--vault`, `--auth-dir` and `--audit` override the default paths.
`node apps/cli/dist/cli.js backup --help` prints the full usage. See
`docs/runbooks/backup-restore.md` and `docs/runbooks/vault-corruption.md`.

## Config drift check

```bash
pnpm config:check            # human output, exit 1 when blocking drift is found
pnpm config:check -- --json  # machine-readable report for scripts
```

Catches configuration that silently does nothing: typo-ed or unknown
`ZOVELI_*`/`MATHCORE_*` variables (with suggestions), obsolete variables
(`TELEMETRY_ENABLED` and friends were removed), values that are ignored or
clamped (bad numbers, non-`0`/`1` toggles such as `ZOVELI_MEMORY_BRIEF=false`,
secrets shorter than 16 characters, an unresolvable `MATHCORE_MCP_COMMAND`)
and vault drift (schema older or newer than this build supports). Secrets are
never printed. The same report is available programmatically from
`@zoveli/config-audit` (`configAuditReport()`).

## Env

`ZOVELI_VAULT_PATH`, `ZOVELI_MEMORY_DB`, `ZOVELI_MEMORY_EXPORT`, `ZOVELI_MATH_MEMORIZE`, `ZOVELI_EMBED_MODEL`, `MATHCORE_AUDIT`, `MATHCORE_MCP_COMMAND`, `MATHCORE_TIMEOUT_MS`,
`ZOVELI_API_KEY`, `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, `OPENROUTER_API_KEY`,
`GROQ_API_KEY`, `TOGETHER_API_KEY`, `ZOVELI_API_BASE`, `ZOVELI_MODEL`,
`ZOVELI_OLLAMA_URL`, `ZOVELI_OLLAMA_MODEL`.
`ZOVELI_PERSONA` pins a persona (friend, tutor, engineer, coach);
`ZOVELI_TEMPERATURE` sets chat sampling (default 0.7, clamped 0–2);
`ZOVELI_MEMORY_BRIEF=0` disables the private memory brief in chat, and
`ZOVELI_MEMORY_TO_CLOUD=1` explicitly allows it for cloud providers
(local providers only by default).

`pnpm config:check` validates this whole list and flags unknown or obsolete
variables — the old telemetry vars (`TELEMETRY_ENABLED`, `OTLP_ENDPOINT`,
`PROM_PORT`) were removed and have no effect.

## Troubleshooting

- Run `pnpm run doctor` first: it reports Node/pnpm, Python, the importable
  mathcore version, the resolved `mathcore-mcp` path and Ollama. Then
  `pnpm config:check` for env/vault drift with actionable fixes.
- `mathcore-mcp not found` → activate your `.venv` (or `python -m pip install
  -e ./mathcore`), then re-run doctor; alternatively set
  `MATHCORE_MCP_COMMAND` to the full path. Verify with `mathcore "2+2"`.
- No capabilities → `capability_scan`; see `docs/runbooks/capability-scan-failures.md`.
- Slow search → search is SQLite FTS5 (instant); check `ZOVELI_MEMORY_DB` is writable.
- MCP disconnect symptoms → `docs/runbooks/mcp-disconnect.md`.
