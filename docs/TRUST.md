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

## Web research network protections

`web_fetch` and `web_search` follow redirects manually, validate each destination
before fetching it, and stop after five redirects. The guard checks every DNS
answer, blocks private/reserved IPv4 and non-public IPv6 addresses, and pins
built-in HTTP(S) requests to the validated addresses to reduce DNS-rebinding
risk. These application controls do not replace network egress restrictions or
sandboxing.
## What leaves your machine
| Action | Data | Destination |
|---|---|---|
| Chat with a cloud provider | Prompt, conversation history, tool results needed for the turn | The provider you configured |
| Web research tool | Requested URL/query and redirect-validated page requests | Target websites; unsafe private/reserved destinations are blocked |
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
| `MATHCORE_TRUSTED_KB` | Manifest-authenticated knowledge directory, or a legacy JSONL file, used by the `knowledge` verifier |
| `MATHCORE_VERIFIERS` | Comma-separated verifier chain; `off` disables plugins |
| `ZOVELI_TRACE_LOG` | Structured tool-call trace log |

`pnpm health:check` and `zoveli health` summarize config, vault, and MCP state;
`/trace` in the CLI and the desktop status panel show recent tool calls.

### Claim verification

`audit_claim()` checks a proposed answer before Zoveli repeats it. Built-in
verifiers run in order, then verified math is the fallback:

- **code** — parses fenced Python with `ast.parse`; it never executes the code.
- **knowledge** — exact-question lookup in a local knowledge base with
  `question`, `answer`, and optional `source` fields. The base can be one
  legacy JSONL file or a directory of domains authenticated by manifests.
- **math** — independent recomputation with a sealed certificate.

Third parties can register a verifier with `mathcore.register_verifier()`.
Verifier failures are reported as `UNVERIFIABLE`; they are never silently
skipped. Every claim verdict records which verifier decided it.

### Trusted knowledge manifests

The checked-in `trusted_kb/` tree is a set of curated domains. Each domain has
one JSONL content file and one `.manifest` file:

```text
trusted_kb/
  general/
    general.jsonl
    general.manifest
  software/
    software.jsonl
    software.manifest
```

A manifest names the domain, the content file, and its SHA-256. Content is
hashed after canonicalising CRLF to LF, so a Windows checkout with
`core.autocrlf` still verifies. A missing, malformed, or mismatched manifest is
a hard verification failure: the `knowledge` verifier never certifies content
it cannot authenticate, and the audit entry shows `verifier=knowledge`.

```bash
# Check every manifest before trusting a KB directory
python -m mathcore.trusted_kb verify trusted_kb

# Regenerate manifests after editing curated content
python -m mathcore.trusted_kb update trusted_kb
```

Set `MATHCORE_TRUSTED_KB` to the directory to load all domains, or to one
legacy JSONL file. Manifests protect the content against accidental edits and
supply-chain tampering; they do not protect against someone who can rewrite
both the content and its manifest.

## Public trust score

```bash
zoveli eval              # run suites, write eval/report.json, update website/trust.html
zoveli eval --json       # full report for scripts
zoveli eval --no-gate    # report only, skip the baseline comparison
```

The evaluation harness runs three checked-in suites — GSM8K-mini,
HumanEval-mini, and `simple_claims` — through the real mathcore claim verifier
and publishes the result in [website/trust.html](../website/trust.html). The
score is matched cases divided by total cases. Every case records the verifier
that decided it (`math`, `code`, or `knowledge`), so a regression cannot hide
behind a passing aggregate.

`eval/baseline.json` stores the expected score. CI's `Trust Eval Gate` job fails
when the current score drops by **5% or more relative to the baseline**; the
same check runs locally unless `--no-gate` is passed. Evaluation writes to a
temporary audit log and never appends to your own certificate history.

## Update integrity

```bash
zoveli update --check    # latest release vs. this runtime
zoveli update --yes      # download, verify, and install
```

The updater follows GitHub release redirects manually and only accepts HTTPS
GitHub hosts on port 443. Localhost, private network addresses, credentials in
URLs, and more than five redirects are rejected, so a release lookup cannot be
redirected to another machine on your network. The downloaded archive is
checked against its published SHA-256 before the installer runs.

Release builds publish a signed and notarized macOS `.dmg` and a
signed Windows `.exe` in addition to the checksummed `.tar.gz` archives. The
portable installers can also report the installed and target versions without
changing anything (`--check` / `-Check`).

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
zoveli eval              # GSM8K-mini, HumanEval-mini, and trusted claims
zoveli update --check    # verify the update path without changing the install
pnpm run release:check   # release metadata and artifact validation
pnpm test                # unit and integration suites
```

## Limits and honest caveats

- A cloud provider sees the chat content you send. Use local Ollama if that is
  not acceptable.
- Web research makes network requests to the sites you name.
- The audit chain detects edits; it is not a remote notarization service.
- The `code` verifier checks syntax only — not behavior, security, or intent.
- The `knowledge` verifier authenticates checked-in content against manifests,
  but anyone who can rewrite both the content and its manifest can change what
  it certifies. Treat the KB as code you review.
- The public trust score measures the checked-in fixtures, not your own data or
  every possible question.

Security issues: see [SECURITY.md](../SECURITY.md) for responsible disclosure.
