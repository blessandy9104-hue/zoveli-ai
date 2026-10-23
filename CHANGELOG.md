# Changelog

All notable changes to Zoveli are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions use
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Release tooling reads the heading for the current `package.json` version, so add
the new section **before** running `pnpm release:check --release`.

## [Unreleased]

### Added

- Offline `/remember <fact>` and `/recall <query>` REPL commands backed by the
  local SQLite memory store, so the core memory workflow needs no chat model.
- Prebuilt runtime archives for Linux, macOS and Windows: `app.cjs` plus a
  matching Node runtime and a PyInstaller mathcore sidecar, so target machines
  need no Git/Node/pnpm/Python/compiler toolchain.
- Portable installers (`install/install-zoveli-runtime.sh` and `.ps1`) that
  download the matching release archive, verify its SHA-256, and install
  without changing system packages. Upgrades stage and preflight the new
  runtime, create and verify a pre-upgrade backup, swap only after both pass,
  and automatically restore the previous runtime if the installed launcher
  check fails. The POSIX installer creates `~/.local/bin` when needed, links
  `zoveli` there, verifies the linked command runs, and prints the exact `PATH`
  export when that directory is not already on `PATH`. The Windows installer
  has an opt-in `-AddToPath` flag that idempotently adds the install directory
  to the user `PATH` while preserving existing `%VAR%` entries; the default
  install leaves `PATH` untouched.
- Clean-home product acceptance gate (`scripts/product-acceptance.mjs`,
  [runbook](docs/runbooks/product-acceptance.md)) installs the packaged archive
  with the real installer, runs the local workflows, checks the tools-only
  guidance, proves a first chat against a mock local Ollama endpoint, exercises
  rollback and upgrade paths, and writes a JSON report; CI runs it on Linux,
  Windows and macOS.
- `Runtime Artifacts` CI builds each platform archive, runs the packaged CLI
  and mathcore health probe, and exercises the portable installer. Push and
  release builds attach GitHub build-provenance attestations so downloads can
  be checked with `gh attestation verify`.
- Desktop Playwright e2e starts an isolated server with a loopback Ollama,
  proves the detected model appears in onboarding, and sends the first chat
  message end-to-end.
- Runtime health rollup: `health_report` tool, REPL `/health`, and
  `pnpm health:check` cover runtime, env drift, vault schema, MCP pool and
  capability availability (`--json`/`--offline` supported).
- Bounded tool-call trace with durations, failure counts and redacted errors:
  REPL `/trace`, `ZOVELI_TRACE=1`.
- Opt-in JSONL tool-call export (`ZOVELI_TRACE_LOG`) with size rotation,
  `tool/call` host events, and the same secret redaction as the in-memory trace.
- Interactive REPL warms the mathcore pool in the background when the binary
  resolves (`ZOVELI_MATHCORE_PREWARM=0` opts out); the health probe (`/health`)
  reuses a live pool instead of spawning a second interpreter.
- Performance budgets: `pnpm perf:check` reports CLI startup, host import,
  plugin mount and tool-dispatch cost, with `--version`/`--help` fast paths and
  lazy subcommand imports.
- Failure-mode hardening: unknown CLI commands/options exit 2 with a usage hint
  instead of booting; chat HTTP requests time out once (`ZOVELI_CHAT_TIMEOUT_MS`)
  with an actionable error; broken MCP stdin and oversized unterminated
  responses fail pending calls and restart the pool; the vault waits on SQLite
  locks (5s) and reports corrupt files with recovery steps; SIGTERM shuts down
  like SIGINT.
- Web/desktop accessibility: landmarks, labeled controls, live regions and skip
  links; WCAG AA text and 3:1 control borders across every theme; native
  `color-scheme` switching; reduced motion skips smooth scrolling and the
  animated Unicorn backdrop.
- Web/desktop UX: chat and login show announced loading/error states, transient
  network failures are not persisted, local history restores VERIFIED badges and
  reply metadata, tools render as a list, and the composer wraps on narrow
  screens.
- First-run onboarding: CLI startup reports missing mathcore/chat with exact
  fixes, the desktop UI shows a readiness line and Finish setup panel
  (`GET /api/onboarding`), and setup replies are not persisted. New
  [first-run guide](docs/guides/onboarding.md) covers install, verification,
  expected output and troubleshooting.
- Plugin ecosystem: `PLUGIN_API_VERSION` + contract validation at mount
  (sync setup, duplicate names, newer API versions rejected before any setup),
  opt-in `optionalPlugins` selected by `ZOVELI_PLUGINS`, `pnpm plugin:check`
  in CI, and a scaffolder that generates an `apiVersion`, typed tool schema,
  README and opt-in mount. Expanded [plugin SDK guide](docs/plugin-sdk/README.md)
  covers lifecycle, events, services, testing, security and versioning.
- Plugin control: `zoveli plugins [--json]` lists tier, mount status and
  description for every plugin. `ZOVELI_DISABLE_PLUGINS` removes any default or
  optional plugin without editing source; unknown names and request/disable
  conflicts fail startup instead of being ignored.
- `zoveli recovery-check [--json] [--keep]`: a safe backup/restore drill that
  creates synthetic data in an isolated temporary directory, verifies
  checksums and SQLite integrity, restores it, reads the note back, and cleans
  up without touching the real vault. Product acceptance now runs the drill
  from the installed runtime.
- Supervised mathcore MCP pool: one child process, request multiplexing,
  identity-guarded restart backoff, graceful shutdown, `mathcore_status` tool
  and REPL `/mcp`.
- Config drift detection: `@zoveli/config-audit`, `pnpm config:check`.
- Vault maintenance: schema versioning with forward migrations, refusal of
  newer databases, an automatic `VACUUM INTO` snapshot before migrating an
  existing database, checksum-verified backup/verify/restore and
  `pnpm migrate:vault`.
- Plugin scaffolder: `pnpm create:plugin <name> --mount`.
- Opt-in `@zoveli/daily-brief` plugin with a local `daily_brief_get` tool
  (date, weekday, time, time zone, greeting; no network). It stays out of
  `defaultPlugins` until an ADR and maintainer sign-off promote it.
- `zoveli --version` / `--help`; release metadata guard
  (`pnpm release:check`) verifies workspace versions, the runtime version
  constant and tsconfig references; upgrade and release runbooks.

### Changed

- Ollama detection reads `/api/tags` and uses `qwen3:4b` when present, otherwise
  the first installed chat model (embedding-only models are skipped). If Ollama
  runs without a chat model, chat stays off and the first-run banner keeps the
  exact pull command instead of failing on the first message. A pinned model
  that is not installed is treated as unavailable and named with its own pull
  command in the banner, desktop setup panel and chat fallback rather than
  advertised as ready.
- Capability discovery now reads the live host tool inventory. Existing tools
  are reported; nonexistent filesystem, shell, browser, terminal and LSP
  capabilities are no longer invented, and scans populate the registry so
  `capability_check`/`capability_list` see actual results.
- Default surface is 26 plugins / 58 tools: legacy `core`, `memory`, `search`
  and `skills` packages are no longer mounted, duplicate tool registrations
  fail `pnpm plugin:check`, and `guard` is opt-in for custom shell tools.
- The system prompt now describes the tools that are actually mounted and no
  longer claims skills, filesystem/shell/browser tools or a shell guard.
- CLI is branded `zoveli` (the `assistant` bin remains as an alias); docs and
  website counts now describe the 58-tool default surface.
- Desktop login is optional and off by default. `ZOVELI_AUTH_REQUIRED=1` gates
  the app and API on a valid session; TLS requests set the Secure cookie flag.
- Security documentation now reflects shipped controls: no OS keychain,
  certification, signed-artifact or append-only audit claims.
- `ctx.get` resolves provided services before registrations.
- Version is defined once in `packages/core/src/version.ts` and enforced
  against `package.json`.

### Fixed

- Docker Compose keeps vault, session and audit data in a writable
  `zoveli-data` volume, documents the correct `-f docker/docker-compose.yml`
  commands, and runs Ollama on CPU unless the GPU reservation is uncommented.
- Release builds publish the `latest` Docker tag.
- The Docker image ships the CLI's pnpm workspace links, so `zoveli` starts
  instead of failing with `MODULE_NOT_FOUND: @zoveli/core/version`; CI boots
  the image and checks `zoveli --version`, the plugin inventory, and
  `mathcore ops`.
- The POSIX runtime launcher follows symlinks, so `~/.local/bin/zoveli` finds
  the bundled Node runtime instead of looking for `node` next to the link.
- Mathcore command lines with quoted paths containing spaces (for example
  `"C:\Program Files\...\python.exe" -m mathcore.mcp_server`).
- `config-check` now accepts an existing unquoted mathcore path containing
  spaces, matching how the runtime resolves `MATHCORE_MCP_COMMAND`.
- Crash storms after a failed mathcore spawn: calls share backoff instead of
  restarting per request.
- Capabilities are scanned, registered and injected synchronously when a
  session is created, so capability tools are populated before the first turn.
- Plugin scaffolding no longer emits a shebang that breaks Windows checkouts
  under CRLF.
- `pnpm create:plugin --mount` now recognizes the host's typed
  `optionalPlugins` declaration instead of silently leaving the plugin out of
  `packages/host/src/index.ts`.
- Product acceptance exercises home and install paths containing spaces.
- `security_scan` now scans `.env` files instead of skipping every dotfile.
- Formatter/test helpers use `npx --no-install`, so they never fetch packages
  from the network.

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
