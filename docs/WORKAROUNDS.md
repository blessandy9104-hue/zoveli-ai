# Workarounds for Known Negative Consequences

Practical status of the known negative consequences in the Zoveli architecture.

> **Status key:** `[done]` implemented in this repo, `[partial]` works with
> documented limits, `[planned]` not implemented, `[removed]` obsolete or
> intentionally deleted. The [implementation checklist](#implementation-checklist)
> is authoritative. Prose bullets without a status are design guidance, not
> shipped features.
>
> Last reconciled: 2026-10-21.

---

## Packaging and Distribution

### Negative: Source-Only Install

**Workaround:**
- **Prebuilt runtime**: `[done]` `scripts/build-runtime.mjs` bundles the CLI into `app.cjs`, copies a matching Node runtime, and packages the PyInstaller mathcore sidecar into one per-platform archive.
- **No target toolchain**: `[done]` the portable installer needs only `curl`/`tar` (POSIX) or PowerShell + `tar.exe` (Windows); no Git, Node, pnpm, Python, venv, compiler, or workspace build.
- **Verified download**: `[done]` installers verify the published SHA-256 before extraction and refuse to replace a non-Zoveli directory.
- **Clean-machine smoke**: `[done]` `.github/workflows/runtime-artifacts.yml` builds and smoke-tests Linux, macOS, and Windows archives, including the portable installer.
- **Signed installers**: `[planned]` archives are checksummed but not code-signed/notarized yet.
- **Updater / rollback**: `[planned]` no in-app update channel or automatic previous-version rollback.
- **Source install**: `[partial]` `install/install-zoveli.sh` and `install/install-zoveli.ps1` remain for contributors and still require the development toolchain.

---

## ADR 001: Cordis Plugin Architecture

### Negative: Cordis Learning Curve
**Workaround:**
- **Interactive Tutorial**: `[planned]` `docs/tutorials/cordis-basics.md`
- **Plugin Generator**: `[done]` `pnpm create:plugin <name> [--description "..." ] [--mount]` (`scripts/create-plugin.mjs`) generates a package, README, contract fields, and test; `--mount` wires host/package.json/tsconfig.
- **VS Code Extension**: `[planned]` snippets, hover docs, go-to-definition for ctx keys
- **Mentor Program**: `[planned]`
- **Mental model**: document plugins as lifecycle-scoped service hooks, not a separate runtime.

### Negative: Event-Driven Debugging Difficulty
**Workaround:**
- **Event Logger Plugin**: `[removed]` no `packages/event-logger/`
- **Visual Trace Viewer**: `[planned]` no `/debug/events`
- **Correlation IDs**: `[planned]` no `x-correlation-id` propagation
- **Replay Tool**: `[planned]`
- **Structured Logging**: `[done]` bounded in-memory tool-call trace (`ZOVELI_TRACE=1`, `/trace`) and opt-in JSONL export with rotation (`ZOVELI_TRACE_LOG`); errors are redacted.

### Negative: Service Lookup Overhead
**Workaround:**
- **Service Cache**: `[partial]` memoize `ctx.get('service')` in hot plugin paths.
- **Direct Injection**: `[done]` critical paths can use `ctx.provide('api', implementation)`.
- **Benchmark**: `[partial]` `pnpm perf:check` covers CLI import/mount/tool-call budgets; plugin-specific service lookup is not microbenchmarked.
- **Tree Shaking**: `[planned]` no build-time removal of unused registrations.

### Negative: Bundle Size
**Workaround:**
- **Single-file CLI**: `[done]` esbuild produces a self-contained `app.cjs` (~390 KB) for the prebuilt runtime.
- **Profile-Specific Bundles**: `[planned]` all workspace packages still build together.
- **Dynamic Imports**: `[partial]` CLI subcommands are dynamically imported; heavy plugins are not split on demand.
- **Plugin Manifest**: `[planned]`
- **Size Gate**: `[planned]` no artifact-size CI budget.

---

## ADR 002: Capability Awareness System

### Negative: Scanning Overhead
**Workaround:**
- **Incremental Scanning**: `[done]` `incrementalScan()` reuses the cache for 60 seconds; turn starts force a fresh scan.
- **Cache**: `[done]` `CapabilityScanner` keeps a `Map` cache and clears it on rescan.
- **Background Worker**: `[planned]` scans run in-process; no worker thread.
- **Priority Scanning**: `[planned]` one pass over the mounted tool inventory.

### Negative: System Complexity
**Workaround:**
- **Unified API**: `[done]` `CapabilityScanner.scanAll()/scanSync()`, the provided `capability` service and `capability_report`; adapters remain per-capability.
- **Auto-Configuration**: `[done]` sensible defaults; built-ins need no config.
- **Documentation**: `[done]` `docs/capabilities/` + `capability:report`.
- **Migration Path**: `[planned]` no legacy `tool_*` auto-mapping.

### Negative: False Positives
**Workaround:**
- **Health Verification**: `[done]` capabilities are reported only when their backing tools are in the live inventory; runtime tool failures surface through diagnostics and the tool trace.
- **Degraded State**: `[planned]` no 3-failure auto-recovery state machine.
- **User Override**: `[planned]` `capability_check` has no `force` flag.
- **Telemetry**: `[planned]` no false-positive tracking.

---

## ADR 003: mathcore Integration

### Negative: Python Dependency
**Workaround:**
- **Bundled runtime**: `[done]` prebuilt archives include a PyInstaller mathcore sidecar; the target machine does not need Python.
- **Developer install**: `[done]` `python -m pip install -e ./mathcore` (or `pnpm install:mathcore`) for source checkouts.
- **Fallback**: `[partial]` tools-only mode continues when mathcore is absent, but arbitrary math is withheld rather than approximated.
- **Reproducible sidecar**: `[partial]` built from the vendored source in CI; Python dependency ranges are not locked yet and there is no binary cache.

### Negative: MCP Latency
**Workaround:**
- **Connection Pooling**: `[done]` one supervised persistent stdio process per server, reused across calls; crash restart with exponential backoff; `mathcore_status` and `/mcp` expose state.
- **Warm Start**: `[done]` the REPL prewarms mathcore when resolvable (`ZOVELI_MATHCORE_PREWARM=0` opts out).
- **MCP protocol guards**: `[done]` broken stdin fails pending calls; unterminated stdout lines over 16 MB are rejected.
- **Batch Operations**: `[planned]` no `mathcore_compute_batch`.
- **Async / timeout**: `[done]` calls are async and bounded by `MATHCORE_TIMEOUT_MS`.
- **Cache Results**: `[done]` verified results are memorized and recalled (`math_recall`; `ZOVELI_MATH_MEMORIZE=0` disables).
- **Multi-server pool**: `[planned]`

### Negative: Limited Coverage
**Workaround:**
- **Domain Extensions**: `[planned]` no plugin system for custom math domains.
- **Hybrid Mode**: `[partial]` the LLM may reason, but only mathcore results are labeled VERIFIED.
- **Community Registry**: `[planned]` `mathcore-contrib` does not exist.

### Negative: Maintenance Burden
**Workaround:**
- **Automated Testing**: `[done]` TypeScript CI plus vendored mathcore source and tests.
- **Version Pinning**: `[done]` vendored package and lockfile.
- **Compatibility Layer**: `[partial]` the MCP adapter is the only boundary.
- **Fallback Mode**: `[done]` explicit WITHHELD instead of fabricated answers.

---

## ADR 004: Local-First Memory

> Superseded in substance by [memory-store.md](memory-store.md). The flat-file
> negatives below applied to the old vault-as-truth design.

### Negative: Search Performance
**Workaround:**
- **SQLite FTS5**: `[done]` ranked full-text index maintained transactionally.
- **Query Optimization**: `[done]` tag-first filtering before full-text.
- **Legacy note (vault era)**: Tantivy background index / incremental fs.watch indexing.

### Negative: Concurrency Issues
**Workaround:**
- **ACID**: `[done]` single-writer SQLite with WAL; no file races.
- **Busy timeout**: `[done]` connections wait up to 5 s for a writer; corrupt/locked files fail with a restore hint.
- **Multi-User**: Not supported (single-user design).

### Negative: Schema Evolution
**Workaround:**
- **Schema in code**: `[done]` `PRAGMA user_version` + transactional `MIGRATIONS`; newer databases are refused.
- **Migration Scripts**: `[done]` `pnpm migrate:vault` imports legacy Markdown and skips existing titles.
- **Backward Compatibility**: `[done]` readers tolerate missing/extra frontmatter fields.
- **Schema Registry**: `[planned]` no central `vault-schema.json`.

### Negative: Binary Files
**Workaround:**
- **Attachment Store**: `[planned]`
- **References in Notes**: `[planned]` no `attachment:sha256:` scheme.
- **Preview Generation**: `[planned]`
- **Git LFS**: optional; the vault mirror is plain Markdown.

---

## General Architecture Workarounds

### Local Model Performance Gap
**Workaround:**
- **Hybrid Mode**: `[planned]` no automatic local/cloud routing; provider choice is explicit.
- **Model Router**: `[planned]`
- **Quantization**: user-managed via Ollama model choice.
- **Speculative Decoding**: `[planned]`

### Vault Corruption Risk
**Workaround:**
- **SQLite backup**: `[done]` `pnpm vault:backup` uses WAL-safe `VACUUM INTO`; scheduling/encryption is operator-managed.
- **Markdown mirror in git**: `[done]` `knowledge-vault/` export mirror can be committed.
- **Integrity Checks**: `[done]` SHA-256 manifest + SQLite integrity/foreign-key checks via `pnpm vault:verify`.
- **Recovery Tool**: `[done]` `pnpm vault:restore` is verified and refuses overwrite without `--force`.
- **Automatic pre-upgrade backup**: `[partial]` portable installers create and verify a backup before replacing an existing runtime, and schema migrations snapshot an existing database first; source runtime upgrades are still manual and there is no scheduled backup/restore drill.

### Plugin Supply Chain
**Workaround:**
- **Signed Plugins**: `[planned]` no signature/cosign verification.
- **Trusted Registry**: `[planned]` no `registry.zoveli.dev`.
- **Sandbox Execution**: `[planned]` plugins run in-process.
- **Permission Model**: `[planned]` no install-time consent flow.

### Configuration Drift
**Workaround:**
- **Config as Code**: `[planned]` profiles are local config, not Git-managed.
- **Drift Detection**: `[done]` `pnpm config:check` reports unknown/obsolete env vars, ignored values, short secrets, unresolvable `MATHCORE_MCP_COMMAND`, and vault schema drift.
- **Immutable Profiles**: `[planned]` profiles are read at startup but not frozen.
- **Schema Validation**: `[partial]` env values are registry-validated; no JSON Schema for config files.

---

## Implementation Checklist

| Workaround | Status | Location |
|------------|--------|----------|
| Event Logger Plugin | Removed | no `packages/event-logger/` |
| Visual Trace Viewer | Removed | no `/debug/events` routes |
| In-Memory Search Index | Done | `packages/memory-store/` (SQLite FTS5) |
| Prebuilt Runtime Archive | Done | `scripts/build-runtime.mjs`; `release/*.tar.gz` |
| mathcore Standalone Runtime | Done | `scripts/build-mathcore-runtime.mjs` (PyInstaller) |
| Portable Installer | Done | `install/install-zoveli-runtime.sh`, `install/install-zoveli-runtime.ps1` |
| Clean-Machine Runtime CI | Done | `.github/workflows/runtime-artifacts.yml` |
| Signed / Notarized Installers | Planned | no signing/notarization pipeline |
| Updater / Rollback | Planned | no update channel |
| Automatic Pre-Upgrade Backup | Partial | portable installers run `backup` + `verify`; source upgrades stay manual |
| Connection Pooling | Done | `packages/math-intelligence/src/transport.ts`; multi-server pool planned |
| Plugin Generator | Done | `scripts/create-plugin.mjs` |
| Capability Inventory Mapping | Done | `packages/capability/src/scanner.ts` |
| Vault Migration System | Done | `PRAGMA user_version` + `MIGRATIONS`; `pnpm migrate:vault` |
| Vault Backup / Verify / Restore | Done | `packages/memory-store/src/maintenance.ts` |
| Git Auto-Commit Hooks | Planned | no `.husky/` |
| Config Drift Detection | Done | `packages/config-audit/`; `pnpm config:check` |
| Runtime Health Rollup | Done | `packages/diagnostics/`; `pnpm health:check` |
| Programming Languages Fallbacks | Done | `packages/languages/` |
| Knowledge Graph Export | Done | `packages/graph/` |
| Security Secret Patterns | Done | `packages/secscan/` |
| Telemetry Fallback Meters | Removed | no `packages/otel/` |

---

## Contributing Workarounds

If you discover a new negative consequence:

1. Document it in the relevant ADR.
2. Add the workaround here with an honest status.
3. Create a tracking issue with the `workaround` label.
4. Assign the relevant package owner.

All workarounds should follow the principle: **explicit over implicit, configurable over hardcoded, graceful over failing**.
