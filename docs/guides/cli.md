# Zoveli CLI Guide

New to Zoveli? Start with the [first-run guide](onboarding.md), then use this
page as the command reference.

## Install

Portable install (no Node/Python/pnpm toolchain): see
[`install/install.sh`](../../install/install.sh) for the Linux one-command path,
or [`install/install-zoveli-runtime.sh`](../../install/install-zoveli-runtime.sh)
and [`install/install-zoveli-runtime.ps1`](../../install/install-zoveli-runtime.ps1)
for direct runtime installs. Run `zoveli` (Linux/macOS) or `zoveli.cmd`
(Windows) from the printed install directory.

```bash
zoveli doctor            # install/runtime/PATH, config, vault and mathcore
zoveli doctor --json     # machine-readable report
zoveli doctor --offline  # skip the live mathcore handshake
```

Source checkout:

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

`zoveli --version` prints the product version; `zoveli --help` lists the
one-shot commands (`assistant` remains an alias). See [Upgrading](upgrading.md) for the upgrade/rollback flow
and `pnpm release:check` (maintainers).

## Everyday flows

- **Verified math:** `/math solve x^2 - 5x + 6 = 0` → `VERIFIED` + certificate,
  or type a bare expression like `2+2`. Solved proofs are memorized; the governor routes
to algebra/calculus/statistics/logic/units/discrete specialists.
- **Audit an answer:** `/check integrate x^2 from 0 to 3 ;; the answer is 9`
  → `MATCH` (wrong answers get `MISMATCH`, never a silent guess). The auditor
  runs configured non-math verifiers first (`code` syntax, trusted `knowledge`
  lookup), then verified math. See [math-subsystem](../math-subsystem.md#claim-verifiers-verifierspy).
- **Remember and recall:** `/remember <fact>` saves a local note; `/recall <query>` searches it back. Both work offline with no model configured.
- **Host facts:** `/sys` → OS/CPU/RAM/disk/GPU snapshot
- **MCP pool:** `/mcp` → mathcore pid, spawns, restarts, pending calls, last error (`mathcore_status` does the same from chat)
- **Health:** `/health` → config, vault, MCP pool and capability rollup; `/trace` → recent tool calls, failures, timings and JSONL log status
- **Capabilities:** `/caps` → available/total count
- **Persona:** `/persona [friend|tutor|engineer|coach]` → show or switch the assistant's style (remembered locally; `ZOVELI_PERSONA` pins one)
- **Tool list:** `/tools` → all 59 default tools (desktop adds 2 auth tools)
- **Chat:** any other text, once a chat model is available (see below —
  any API key or free local Ollama)

## Chat models (your preference, zero cost possible)

Resolution order: `ZOVELI_PROVIDER` if pinned → `ZOVELI_API_KEY` (custom
OpenAI-compatible endpoint) → the first provider key present → free local
Ollama → tools-only offline.

```bash
# Option A — free and local, no keys, no cost:
# 1. Install from https://ollama.com, then:
ollama pull qwen3:4b
pnpm start   # auto-detects Ollama, chat just works

# Pick a larger local model:
ZOVELI_OLLAMA_MODEL=qwen3:8b pnpm start

# Option B — a provider key (OpenAI-compatible, plus native Anthropic):
OPENAI_API_KEY=sk-... pnpm start        # or DEEPSEEK_API_KEY,
# OPENROUTER_API_KEY, GROQ_API_KEY, TOGETHER_API_KEY, ZOVELI_API_KEY
ANTHROPIC_API_KEY=sk-ant-... pnpm start # native Messages API
ZOVELI_MODEL=gpt-4o-mini pnpm start     # pick any model name
ZOVELI_API_BASE=https://my-proxy/v1 ZOVELI_API_KEY=... pnpm start  # custom endpoint

# Several keys installed? Pin one explicitly:
ZOVELI_PROVIDER=anthropic ANTHROPIC_API_KEY=sk-ant-... pnpm start
ZOVELI_PROVIDER=groq ZOVELI_MODEL=llama-3.3-70b-versatile pnpm start
```

Accepted `ZOVELI_PROVIDER` values are `custom`, `ollama`, `openai`,
`anthropic`, `deepseek`, `openrouter`, `groq`, and `together`. Unknown values
fail at startup instead of silently choosing another key;
`ZOVELI_PROVIDER=ollama` forces the local server. `ZOVELI_MODEL` overrides the
model for any provider and wins over `ZOVELI_OLLAMA_MODEL`.
`ZOVELI_MAX_TOKENS` sets the Anthropic reply budget (256–8192, default 4096).
The OpenAI-compatible transport retries transient failures, opens a short
circuit breaker after repeated failures, and checks provider health before
routing, so an unreachable endpoint fails with one clear error instead of a
stack of retries.

Local presets from 0.8B to 70B, Cloud Brain details, capability tiers, and what
still stays local: [models.md](models.md). Trust boundary and audit records:
[../TRUST.md](../TRUST.md).

```bash
# Docker: ollama runs as a sibling service, already wired:
docker compose -f docker/docker-compose.yml --profile local-llm up -d ollama
docker exec zoveli-ollama ollama pull qwen3:4b
docker compose -f docker/docker-compose.yml --profile cli up --build
```

`ZOVELI_OLLAMA_URL` overrides the Ollama address (default
`http://localhost:11434`; Docker Compose sets it to `http://ollama:11434`).
Ollama uses CPU by default; uncomment the `deploy` block in
`docker/docker-compose.yml` for NVIDIA GPU acceleration. Vault, sessions and
audit data live in the `zoveli-data` volume; `docker compose down` keeps it and
`docker compose down -v` deletes it.

The optional `postgres` and `monitoring` profiles read passwords from the host
environment and mount them as Compose secrets. Set the corresponding variable
before starting each profile; the services do not fall back to default
passwords:

```bash
POSTGRES_PASSWORD='choose-a-strong-password' \
GRAFANA_ADMIN_PASSWORD='choose-a-strong-password' \
docker compose -f docker/docker-compose.yml \
  --profile postgres --profile monitoring up -d
```

Published ports for Ollama, PostgreSQL, Redis, Prometheus, and Grafana bind to
`127.0.0.1` only. The optional images are pinned to exact tags
(`ollama/ollama:0.40.15`, `prom/prometheus:v3.16.0`,
`grafana/grafana:13.2.5`); update them deliberately after reviewing upstream
release notes and advisories.

## Trust evaluation

```bash
zoveli eval                  # run the suites, write the report, update the website
zoveli eval --json           # print the full report instead of the summary
zoveli eval --no-site        # leave website/trust.html untouched
zoveli eval --no-gate        # report only; do not compare with the baseline
zoveli eval --max-drop 2     # fail on a smaller relative drop
```

`zoveli eval` runs the checked-in `gsm8k-mini`, `humaneval-mini`, and
`simple_claims` fixtures through mathcore's real claim verifier. Each result
records the verdict and the verifier that decided it (`math`, `code`, or
`knowledge`), so a score cannot hide which component was exercised. The score
is matched cases divided by total cases.

The JSON report is written to `eval/report.json` (gitignored), and the score
block in `website/trust.html` is regenerated between its `EVAL:START` /
`EVAL:END` markers. The run compares the score with `eval/baseline.json`; a
relative drop of **5% or more** exits non-zero, which is what the CI
`Trust Eval Gate` job enforces. Point `MATHCORE_BIN` at a specific executable to
pin the backend. Evaluation uses a temporary audit log, so it never appends
entries to your own trust history.

## Updates

Portable runtime installs can update themselves:

```bash
zoveli update --check        # report the latest release without installing
zoveli update                # prompt, verify, and install
zoveli update --yes          # non-interactive
zoveli update --dir <path>   # install directory passed to the installer
```

The updater queries the latest GitHub release, downloads the archive for this
platform, verifies its published SHA-256, and runs the same runtime installer
used for a manual install. Redirects are followed manually and restricted to
HTTPS GitHub hosts on port 443; localhost, private addresses, and credentials
are rejected, so an update cannot be redirected to another machine on your
network. Release builds also publish unsigned macOS `.dmg` and Windows `.exe`
installers; first-launch Gatekeeper and SmartScreen steps are in the
[Sovereign Install Guide](../INSTALL_GUIDE.md).

Installer scripts support the same version check without changing anything:

```bash
install/install-zoveli-runtime.sh --check
install/install-zoveli-runtime.ps1 -Check
```

## Data maintenance

```bash
# Prove backup/restore works without touching real data
zoveli recovery-check

# WAL-safe backup with a SHA-256 manifest (safe while Zoveli runs)
pnpm vault:backup -- --out ./backups/2026-10-19

# Verify checksums, SQLite integrity/foreign keys, note count, schema
pnpm vault:verify -- ./backups/2026-10-19

# Stop Zoveli first; --force is required to overwrite existing data
pnpm vault:restore -- ./backups/2026-10-19 --force

# Import legacy Markdown; existing titles are skipped, never overwritten
pnpm migrate:vault -- --db ./memory.db --vault ./knowledge-vault
```

Portable runtimes expose the same operations without pnpm, for example
`zoveli backup`, `zoveli verify <dir>`, `zoveli restore <dir> --force`, and
`zoveli migrate`. `--db`, `--vault`, `--auth-dir` and `--audit` override the
default paths. `node apps/cli/dist/cli.js backup --help` prints the full usage.
See `docs/runbooks/backup-restore.md` and `docs/runbooks/vault-corruption.md`.

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

## Plugin inventory

```bash
zoveli plugins          # tier, mount status and description for every plugin
zoveli plugins --json   # machine-readable inventory
```

`ZOVELI_PLUGINS=zoveli-guard` adds an optional plugin;
`ZOVELI_DISABLE_PLUGINS=zoveli-webresearch` removes any default or optional
plugin. Unknown names and request/disable conflicts fail startup instead of
being ignored. Restart Zoveli after changing either variable.

## Health check

```bash
pnpm health:check             # human rollup; exit 1 only on blocking problems
pnpm health:check -- --json   # machine-readable report for scripts
pnpm health:check -- --offline  # skip the live mathcore spawn
```

Aggregates runtime facts, environment drift, vault schema, the mathcore MCP
pool and (unless `--offline`) a live `tools/list` handshake that proves the
whole MCP path (the first spawn can take a few seconds while Python imports
its math stack). Missing mathcore degrades verified math but the app still runs,
so it is reported as `degraded` (not blocking); config/vault integrity failures
exit 1. Inside the REPL, `/health` includes capability status and `/trace`
shows recent tool calls with durations and redacted errors
(`ZOVELI_TRACE=1` mirrors the trace to stderr). The tool is also available to
chat as `health_report`.

## Structured trace log

`/trace` keeps the last 200 tool calls in memory. To keep a durable audit
trail, opt in to the JSONL sink:

```bash
ZOVELI_TRACE_LOG="$HOME/.zoveli/tool-calls.jsonl" pnpm start
```

Each line is one event: `schema` (`zoveli.tool_call.v1`), `seq`, `at`, `tool`,
`registration`, `durationMs`, `ok` and (on failure) the redacted `error`. The
same event is emitted as `tool/call` on the host event bus for in-process
listeners.

Rotation defaults to 5 MB with three backups. Tune it with
`ZOVELI_TRACE_LOG_MAX_BYTES` and `ZOVELI_TRACE_LOG_KEEP` (`0` truncates
instead of rotating). Missing parent directories are created on first write;
the config check warns when the parent is missing so typos surface early. If a
write fails, the sink disables itself with one stderr note and tool calls keep
working.

## Startup and warm math

`zoveli --version`, `--help` and the subcommands load only what they need;
the full plugin host is imported when the interactive assistant starts. In a
TTY, the REPL starts mathcore in the background at launch when the resolved
binary exists, so the first `/math` call does not pay the Python startup
(batch/scripted stdin never warms). Opt out with `ZOVELI_MATHCORE_PREWARM=0`.
The REPL health probe (`/health`) reuses a live mathcore pool instead of
spawning a second interpreter; `zoveli health` runs a one-shot probe in its
own process. Add `--offline` to skip the MCP probe entirely. `pnpm run perf:check`
prints CLI/mount/tool-call metrics and enforces regression budgets.

## Env

`ZOVELI_VAULT_PATH`, `ZOVELI_MEMORY_DB`, `ZOVELI_MEMORY_EXPORT`, `ZOVELI_MATH_MEMORIZE`, `ZOVELI_EMBED_MODEL`, `MATHCORE_AUDIT`, `MATHCORE_MCP_COMMAND`, `MATHCORE_TIMEOUT_MS`, `MATHCORE_TRUSTED_KB`, `MATHCORE_VERIFIERS`, `ZOVELI_MATHCORE_PREWARM`,
`ZOVELI_PLUGINS`, `ZOVELI_DISABLE_PLUGINS`,
`ZOVELI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, `OPENROUTER_API_KEY`,
`GROQ_API_KEY`, `TOGETHER_API_KEY`, `ZOVELI_API_BASE`, `ZOVELI_PROVIDER`, `ZOVELI_MODEL`, `ZOVELI_MODEL_PARAMS`, `ZOVELI_MAX_TOKENS`,
`ZOVELI_OLLAMA_URL`, `ZOVELI_OLLAMA_MODEL`, `ZOVELI_TRACE`, `ZOVELI_TRACE_LOG`,
`ZOVELI_TRACE_LOG_MAX_BYTES`, `ZOVELI_TRACE_LOG_KEEP`, `ZOVELI_CHAT_TIMEOUT_MS`.
`ZOVELI_PERSONA` pins a persona (friend, tutor, engineer, coach);
`ZOVELI_TEMPERATURE` sets chat sampling (default 0.7, clamped 0–2);
`ZOVELI_CHAT_TIMEOUT_MS` bounds each chat HTTP request (default 120000,
clamped 1000–600000); timeouts fail once, without a second wait.
`ZOVELI_MEMORY_BRIEF=0` disables the private memory brief in chat, and
`ZOVELI_MEMORY_TO_CLOUD=1` explicitly allows it for cloud providers
(local providers only by default).

`pnpm config:check` validates this whole list and flags unknown or obsolete
variables — the old telemetry vars (`TELEMETRY_ENABLED`, `OTLP_ENDPOINT`,
`PROM_PORT`) were removed and have no effect.

## Troubleshooting

- Run `zoveli doctor` (portable) or `pnpm run doctor` (source checkout) first:
  it reports Node/pnpm, Python, the importable mathcore version, the resolved
  `mathcore-mcp` path, and Ollama. Then `zoveli config-check` or
  `pnpm config:check` for env/vault drift with actionable fixes.
- `mathcore-mcp not found` → activate your `.venv` (or `python -m pip install
  -e ./mathcore`), then re-run doctor; alternatively set
  `MATHCORE_MCP_COMMAND` to the full path. Verify with `mathcore "2+2"`.
- Chat hangs or "chat request timed out" → check the endpoint/Ollama is running;
  raise `ZOVELI_CHAT_TIMEOUT_MS` for slow first tokens. Timeouts are not retried.
- A typo such as `zoveli healt` now exits with code 2 and a usage hint instead
  of silently opening the REPL.
- `cannot open memory database ... corrupt` → restore from a verified backup
  (`zoveli restore --help`) or move the file aside; concurrent processes wait up
  to 5s on the SQLite busy timeout instead of failing at once.
- No capabilities → `capability_scan`; see `docs/runbooks/capability-scan-failures.md`.
- Slow search → search is SQLite FTS5 (instant); check `ZOVELI_MEMORY_DB` is writable.
- MCP disconnect symptoms → `docs/runbooks/mcp-disconnect.md`.
