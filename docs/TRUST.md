# Trust & Transparency

Zoveli is built so you can check the machine's work instead of trusting a
vendor's summary. This page describes exactly what stays local, what can leave
your machine, and how to inspect the records.

## The short version

- **Verified math is local.** `mathcore` runs on your machine. A result is
  released only when independent methods agree; otherwise it is withheld.
- **Audit records are local.** Math certificates are written to a hash-chained
  JSONL file you control.
- **Memory is local.** Notes live in a SQLite database with a Markdown mirror.
- **No telemetry.** Zoveli does not send usage analytics.
- **Cloud chat is opt-in.** If you set a provider key, the chat text you send
  goes to that provider. Verified math, the audit log, and local tools do not.

## What leaves your machine

| Action | Data | Destination |
|---|---|---|
| Chat with a cloud provider | Prompt, conversation history, tool results needed for the turn | The provider you configured |
| Web research tool | The URL/query you ask it to fetch | The target site (SSRF-guarded) |
| Local Ollama chat | Nothing | Stays on your machine |
| Verified math | Nothing | Local `mathcore` process |
| Local tools | Nothing | Your machine |

Zoveli never sends the math audit log, the SQLite memory database, or the
Markdown vault to a model provider. The memory brief is added to chat only for a
local model by default; cloud providers get it only when you set
`ZOVELI_MEMORY_TO_CLOUD=1`.

Provider keys are read from the environment and are not written into the vault.
Your provider's retention and training policies apply to the chat text you send
it; Zoveli cannot override them.

## Audit logs

### Math audit chain

Every verified, withheld, or mismatched computation can append a record to
`MATHCORE_AUDIT` (default `~/.mathcore/audit.jsonl`). Each record links to the
previous one with a hash, so editing history is detectable.

```bash
# Show recent certificate entries
mathcore verify-log --audit ~/.mathcore/audit.jsonl

# Check a specific claim; the verdict is appended to the same log
mathcore check "evaluate 6*7" "41"

# JSON for scripts and dashboards
mathcore --json "evaluate 6*7"
```

Useful environment variables:

| Variable | Meaning |
|---|---|
| `MATHCORE_AUDIT` | Audit log path |
| `MATHCORE_TRUSTED_KB` | Local JSONL knowledge used by the `knowledge` claim verifier |
| `MATHCORE_VERIFIERS` | Comma-separated verifier chain; `off` disables plugins |
| `ZOVELI_TRACE_LOG` | Structured tool-call trace log |

`pnpm health:check` and `zoveli health` summarize config, vault, and MCP state;
`/trace` in the CLI and the desktop status panel show recent tool calls.

### Claim verification

`audit_claim()` checks a proposed answer before Zoveli repeats it. Built-in
verifiers run in order, then verified math is the fallback:

- **code** — parses fenced Python with `ast.parse`; it never executes the code.
- **knowledge** — exact-question lookup in a local JSONL file with `question`,
  `answer`, and optional `source` fields.
- **math** — independent recomputation with a sealed certificate.

Third parties can register a verifier with `mathcore.register_verifier()`.
Verifier failures are reported as `UNVERIFIABLE`; they are never silently
skipped. Every claim verdict records which verifier decided it.

## Vault and memory handling

Default locations:

| Data | Path |
|---|---|
| Memory database | `~/.zoveli/memory.db` (`ZOVELI_MEMORY_DB`) |
| Markdown vault | `./knowledge-vault` (`ZOVELI_VAULT_PATH`) |
| Audit log | `~/.mathcore/audit.jsonl` (`MATHCORE_AUDIT`) |
| Sessions | `~/.zoveli/sessions` (`ZOVELI_SESSION_PATH`) |

The SQLite database is authoritative; the Markdown mirror is for reading,
grepping, and exporting. Notes are never uploaded by Zoveli.

```bash
# WAL-safe backup with a SHA-256 manifest
pnpm vault:backup -- --out ./backups/2026-11-03

# Verify checksums, SQLite integrity, foreign keys, and note count
pnpm vault:verify -- ./backups/2026-11-03

# Restore only while Zoveli is stopped; --force overwrites current data
pnpm vault:restore -- ./backups/2026-11-03 --force
```

Deleting your data is local and immediate: stop Zoveli, then remove the paths
above. Backups you created elsewhere are not touched. See
[backup/restore](runbooks/backup-restore.md) and
[vault corruption](runbooks/vault-corruption.md) for recovery drills.

## Reproducible trust checks

```bash
pnpm run doctor          # toolchain, mathcore import, resolved MCP binary, Ollama
pnpm config:check        # unknown/obsolete env vars and ignored values
pnpm health:check        # config, vault, MCP pool, capabilities
pnpm run release:check   # release metadata and artifact validation
pnpm test                # unit and integration suites
```

## Limits and honest caveats

- A cloud provider sees the chat content you send. Use local Ollama if that is
  not acceptable.
- Web research makes network requests to the sites you name.
- The audit chain detects edits; it is not a remote notarization service.
- The `code` verifier checks syntax only — not behavior, security, or intent.
- The `knowledge` verifier trusts the JSONL file you give it. Curate it.

Security issues: see [SECURITY.md](../SECURITY.md) for responsible disclosure.
