# Workarounds for Known Negative Consequences

This document provides practical workarounds for all identified negative consequences in the Zoveli architecture.

> **Status key:** ✅ implemented in this repo · 📋 proposed/planned · ❌ removed
> or obsolete. The [implementation checklist](#implementation-checklist) is
> authoritative; prose bullets without a status are design guidance, not
> shipped features.

---

## ADR 001: Cordis Plugin Architecture

### Negative: Cordis Learning Curve
**Workaround:**
- **Interactive Tutorial**: 📋 `docs/tutorials/cordis-basics.md` (not created yet)
- **Plugin Generator**: ✅ `pnpm create:plugin <name> [--description "…"] [--mount]` (`scripts/create-plugin.mjs`) generates a workspace package + unit test, and mounts host/package.json/tsconfig with `--mount`
- **VS Code Extension**: 📋 Cordis snippets, hover docs, go-to-definition for ctx keys
- **Mentor Program**: 📋 pair new contributors with experienced plugin authors
- **Decision**: Document "Cordis Mental Model" - think of it as React hooks for backend services

### Negative: Event-Driven Debugging Difficulty
**Workaround (mostly 📋):**
- **Event Logger Plugin**: ❌ removed — there is no `packages/event-logger/` in this repo
- **Visual Trace Viewer**: 📋 proposed `/debug/events`; not implemented
- **Correlation IDs**: 📋 proposed; no `x-correlation-id` propagation today
- **Replay Tool**: 📋 proposed; no `replay:event` script
- **Structured Logging**: ✅ bounded in-memory tool-call trace (`/trace`, `ZOVELI_TRACE=1`) plus opt-in JSONL event export with size rotation (`ZOVELI_TRACE_LOG`), `tool/call` events on the host bus; errors are redacted before they reach either sink

### Negative: Service Lookup Overhead
**Workaround (guidance):**
- **Service Cache**: memoize `ctx.get('service')` in a plugin when a hot path needs it
- **Direct Injection**: critical paths can use `ctx.provide('api', implementation)` (supported)
- **Benchmark**: 📋 no committed benchmark; treat sub-millisecond targets as unverified
- **Tree Shaking**: 📋 build-time removal of unused registrations is not implemented

### Negative: Bundle Size
**Workaround (📋):**
- **Profile-Specific Bundles**: 📋 no `build:cli` script yet; `pnpm run build` compiles all workspaces
- **Dynamic Imports**: 📋 heavy plugins are not yet split on demand
- **Plugin Manifest**: 📋 no tree-shaking manifest exists
- **Size Budget**: 📋 no CI size gate exists

---

## ADR 002: Capability Awareness System

### Negative: Scanning Overhead
**Workaround (partial):**
- **Incremental Scanning**: 📋 not implemented; scans rebuild the in-memory cache
- **Cache**: ✅ `CapabilityScanner` keeps a `Map` cache and clears it on rescan (`packages/capability/src/scanner.ts`); no TTL yet
- **Background Worker**: 📋 proposed; scanning is synchronous today
- **Priority Scanning**: 📋 proposed

### Negative: System Complexity
**Workaround:**
- **Unified API**: partial — `CapabilityScanner.scan()/report()` plus `verifyCapabilities`; adapters are per-capability
- **Auto-Configuration**: ✅ sensible defaults; no config needed for the built-ins
- **Documentation**: ✅ `docs/capabilities/` + `capability:report`
- **Migration Path**: 📋 legacy `tool_*` auto-mapping is not implemented

### Negative: False Positives
**Workaround:**
- **Health Verification**: ✅ `verifyCapabilities` probes registered MCP tools (`packages/capability/src/scanner.ts`)
- **Degraded State**: 📋 no 3-failure/auto-recovery state machine yet
- **User Override**: 📋 `capability_check` has no `force` flag yet
- **Telemetry**: 📋 no false-positive tracking

---

## ADR 003: mathcore Integration

### Negative: Python Dependency
**Workaround (partial):**
- **Bundled Python**: ✅ Docker images install Python + the vendored mathcore package
- **Standalone Binary**: 📋 `scripts/build-mathcore-binary.sh` is not created yet; `mathcore-mcp` requires Python today
- **Fallback Calculator**: partial — tools-only mode continues to work when mathcore is absent, but arbitrary math is withheld rather than silently approximated
- **Install**: ✅ `python -m pip install -e ./mathcore` inside `.venv` (or `pnpm install:mathcore`); `pnpm run doctor` reports the importable mathcore version and the resolved `mathcore-mcp` path (MATHCORE_MCP_COMMAND → `.venv` → PATH)

### Negative: MCP Latency
**Workaround (partial):**
- **Connection Pooling**: ✅ one supervised persistent stdio MCP process per server (reused across calls; crash restart with exponential backoff; `mathcore_status` / `/mcp` expose pid, spawns, restarts and last error); a multi-server pool is 📋 planned
- **Warm Start**: ✅ interactive REPL warms mathcore in the background when the binary resolves (`ZOVELI_MATHCORE_PREWARM=0` opts out); the health probe reuses a live pool instead of spawning a second interpreter
- **Batch Operations**: 📋 no `mathcore_compute_batch` tool yet
- **Async Pipeline**: ✅ calls are async and time-bounded by `MATHCORE_TIMEOUT_MS`
- **Cache Results**: ✅ verified results are memorized and recalled (`math_recall`; disable with `ZOVELI_MATH_MEMORIZE=0`)

### Negative: Limited Coverage
**Workaround (📋):**
- **Domain Extensions**: 📋 plugin system for custom math domains
- **Hybrid Mode**: partial — LLM can reason, but only mathcore results are labeled VERIFIED
- **Community Registry**: 📋 `mathcore-contrib` does not exist
- **Feature Requests**: GitHub Issues template for new operation requests

### Negative: Maintenance Burden
**Workaround:**
- **Automated Testing**: ✅ repo CI runs the TypeScript test suite; mathcore is vendored in-tree
- **Version Pinning**: ✅ vendored editable install (`mathcore/pyproject.toml`), not a floating PyPI range
- **Compatibility Layer**: partial — the MCP adapter is the only boundary
- **Fallback Mode**: ✅ tools-only mode with an explicit warning instead of fabricated answers

---

## ADR 004: Local-First Memory (SQLite store; vault as export mirror)

> Superseded in substance by [memory-store.md](memory-store.md). The
> flat-file negatives below applied to the old vault-as-truth design.

### Negative: Search Performance
**Workaround:**
- **SQLite FTS5**: ranked full-text index maintained transactionally (implemented in `packages/memory-store/`)
- **Query Optimization**: Tag-first filtering before full-text
- **Legacy note (vault era)**: Tantivy background index / incremental fs.watch indexing

### Negative: Concurrency Issues
**Workaround (store era):**
- **ACID**: single-writer SQLite with WAL mode; no file races
- **Multi-User**: Not supported (single-user design), document clearly
- **Legacy note (vault era)**: `flock()` on note files, write-to-temp + atomic rename, last-write-wins with `.bak`

### Negative: Schema Evolution
**Workaround:**
- **Schema in code**: ✅ `PRAGMA user_version` + transactional `MIGRATIONS` in `packages/memory-store/src/store.ts`; newer databases are refused
- **Migration Scripts**: ✅ `pnpm run migrate:vault` imports legacy Markdown (timestamps, tags, links) and skips existing titles
- **Backward Compatibility**: ✅ readers tolerate missing/extra frontmatter fields
- **Schema Registry**: 📋 no central `vault-schema.json` yet

### Negative: Binary Files
**Workaround (📋):**
- **Attachment Store**: 📋 no `attachments/` content-addressable store yet
- **References in Notes**: 📋 `attachment:sha256:` references are not supported
- **Preview Generation**: 📋 thumbnails/text extraction not implemented
- **Git LFS**: optional; the vault mirror is plain Markdown today

---

## General Architecture Workarounds

### Local Model Performance Gap
**Workaround (📋):**
- **Hybrid Mode**: 📋 no automatic local/cloud routing; provider choice is explicit
- **Model Router**: 📋 planned
- **Quantization**: user-managed via Ollama model choice
- **Speculative Decoding**: 📋 planned

### Vault Corruption Risk
**Workaround:**
- **SQLite backup**: ✅ `pnpm vault:backup` uses WAL-safe `VACUUM INTO`; scheduling/encryption is left to the operator
- **Markdown mirror in git**: ✅ `knowledge-vault/` export mirror can be committed; legacy notes re-import on demand
- **Integrity Checks**: ✅ SHA-256 manifest + SQLite integrity/foreign-key checks via `pnpm vault:verify`
- **Recovery Tool**: ✅ `pnpm vault:restore` (verified, refuses overwrite without `--force`), or `pnpm migrate:vault` into a fresh DB

### Plugin Supply Chain
**Workaround (📋):**
- **Signed Plugins**: 📋 no Cosign verification yet
- **Trusted Registry**: 📋 no `registry.zoveli.dev`
- **Sandbox Execution**: 📋 plugins run in-process today
- **Permission Model**: 📋 no install-time consent flow

### Configuration Drift
**Workaround (partial):**
- **Config as Code**: 📋 profiles are local config, not yet Git-managed
- **Drift Detection**: ✅ `pnpm config:check` (`packages/config-audit/`) reports typo-ed/unknown/obsolete env vars, values that are silently ignored (bad numbers, non-`0`/`1` toggles, short secrets, unresolvable `MATHCORE_MCP_COMMAND`) and vault schema drift (`user_version` older/newer than supported); `--json` for scripting
- **Immutable Profiles**: 📋 profiles are read at startup but not frozen/enforced
- **Schema Validation**: partial — env vars are validated against the registry in `packages/config-audit/src/registry.ts`; no JSON Schema for config files yet

---

## Implementation Checklist

| Workaround | Status | Location |
|------------|--------|----------|
| Event Logger Plugin | ❌ Removed | no `packages/event-logger/` in this repo |
| Visual Trace Viewer | ❌ Removed | no `/debug/events` routes; removed with `event-logger` |
| In-Memory Search Index | ✅ Implemented | `packages/memory-store/` (SQLite FTS5, transactional; replaced the TF index in `packages/search/`, now a delegate) |
| mathcore Binary Build | 📋 Planned | `scripts/build-mathcore-binary.sh` (not created yet) |
| Connection Pooling | ✅ Supervised persistent stdio MCP process (restart backoff + status) | `packages/math-intelligence/src/transport.ts`; multi-server pool 📋 |
| Plugin Generator | ✅ Implemented | `scripts/create-plugin.mjs` (`pnpm create:plugin`, `--mount` wires host + tsconfig) |
| Capability Health Probes | ✅ Implemented | `packages/capability/src/scanner.ts` (`verifyCapabilities`) |
| Vault Migration System | ✅ Implemented | `PRAGMA user_version` + `MIGRATIONS`; `pnpm migrate:vault` (Markdown import) |
| Vault Backup / Verify / Restore | ✅ Implemented | `packages/memory-store/src/maintenance.ts`; `pnpm vault:backup/verify/restore` |
| Git Auto-Commit Hooks | 📋 Planned | no `.husky/` yet |
| Config Drift Detection | ✅ Implemented | `packages/config-audit/` (env registry + vault schema audit); `pnpm config:check` |
| Runtime Health Rollup | ✅ Implemented | `packages/diagnostics/` (`health_report`, `/health`, `/trace`); `pnpm health:check` |
| Programming Languages Fallbacks | ✅ Implemented | `packages/languages/` (native → deterministic fallback) |
| Knowledge Graph Export | ✅ Implemented | `packages/graph/` (JSON + DOT) |
| Security Secret Patterns | ✅ Implemented | `packages/secscan/` (7 pattern families) |
| Telemetry Fallback Meters | ❌ Removed | no `packages/otel/` in this repo |

---

## Contributing Workarounds

If you discover a new negative consequence:

1. Document it in the relevant ADR
2. Add workaround here with implementation plan
3. Create tracking issue with `workaround` label
4. Assign to relevant package owner

All workarounds should follow the principle: **explicit over implicit, configurable over hardcoded, graceful over failing**.
