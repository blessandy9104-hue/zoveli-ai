# Changelog

All notable changes to Zoveli are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions use
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Release tooling reads the heading for the current `package.json` version, so add
the new section **before** running `pnpm release:check --release`.

## [Unreleased]

### Added

- Runtime health rollup: `health_report` tool, REPL `/health`, and
  `pnpm health:check` cover runtime, env drift, vault schema, MCP pool and
  capability availability (`--json`/`--offline` supported).
- Bounded tool-call trace with durations, failure counts and redacted errors:
  REPL `/trace`, `ZOVELI_TRACE=1`.
- Supervised mathcore MCP pool: one child process, request multiplexing,
  identity-guarded restart backoff, graceful shutdown, `mathcore_status` tool
  and REPL `/mcp`.
- Config drift detection: `@zoveli/config-audit`, `pnpm config:check`.
- Vault maintenance: schema versioning with forward migrations, refusal of
  newer databases, checksum-verified backup/verify/restore and
  `pnpm migrate:vault`.
- Plugin scaffolder: `pnpm create:plugin <name> --mount`.
- `assistant --version` / `--help`; release metadata guard
  (`pnpm release:check`) verifies workspace versions, the runtime version
  constant and tsconfig references; upgrade and release runbooks.

### Changed

- Capability scans now populate the capability registry, so
  `capability_check`/`capability_list` and the health summary see actual results.
- `ctx.get` resolves provided services before registrations.
- Version is defined once in `packages/core/src/version.ts` and enforced
  against `package.json`.

### Fixed

- Mathcore command lines with quoted paths containing spaces (for example
  `"C:\Program Files\...\python.exe" -m mathcore.mcp_server`).
- Crash storms after a failed mathcore spawn: calls share backoff instead of
  restarting per request.
- Plugin scaffolding no longer emits a shebang that breaks Windows checkouts
  under CRLF.

## [0.1.0] - 2026-10-12

### Added

- Local-first assistant: REPL, web UI, desktop shell, one-line installer.
- Verified math through the vendored mathcore MCP server (certificates,
  `WITHHELD` on unverified results, proof memory).
- SQLite-backed persistent memory with Markdown export, full-text search,
  graph view and skills.
- Capability awareness, persona switching, SSRF-guarded web research,
  scheduler, code analysis, doc generation, security scanning and system info.
- Docker/Compose packaging, GHCR image, SBOMs, Playwright e2e and CI across
  Linux and Windows.
