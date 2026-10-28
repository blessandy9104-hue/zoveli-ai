# Zoveli AI — local-first personal assistant
[![M8ven Score](https://m8ven.ai/badge/mcp/blessandy9104-hue-zoveli-ai-1m1d8z?v=a871bb4a46ab2bd9a64bf585d0dc5ffe)](https://m8ven.ai/mcp/blessandy9104-hue-zoveli-ai-1m1d8z?s=readme)
> The assistant that proves its math, runs on your hardware, and never trains on your data.

> **Product scope:** Zoveli's core is the offline CLI assistant — verified math, local memory, and local tools.
> Web, desktop, and the wider plugin set are valuable but secondary: they must never break the core.
> See [docs/core-plugins.md](docs/core-plugins.md) for what counts as core vs experimental.

Website: **https://blessandy9104-hue.github.io/zoveli-ai/**

[![CI](https://github.com/blessandy9104-hue/zoveli-ai/actions/workflows/ci.yml/badge.svg)](https://github.com/blessandy9104-hue/zoveli-ai/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/blessandy9104-hue/zoveli-ai/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/Node-22%2B-green.svg)](https://nodejs.org/)

## Why local-first?

| | Zoveli AI |
|---|---|
| Price | **Free forever**, MIT |
| Your data | **Stays on your machine**, never trained on |
| Offline | **Yes for local tools** — 58 default tools; web research needs network |
| Math | **Verified or withheld** (+ audit certificate) |
| Lock-in | None — BYO key or local Ollama |
| Login | Optional passwordless email code; off by default, enable with `ZOVELI_AUTH_REQUIRED=1` |

Details: [docs/why-zoveli.md](docs/why-zoveli.md).

## Strategic platform upgrades we are adopting

Zoveli is already differentiated by a stronger trust model: verified math, explicit auditability, local execution, and privacy-first personal assistant behavior. To make that trust easier to ship and easier to use, we are adopting the strongest productization patterns from modern local assistant platforms without losing the core identity.

### 1. Installer and onboarding maturity

- Add first-run setup flows that guide users from install to working assistant in a few steps.
- Support smooth Windows/macOS/Linux installation paths with clear verification and troubleshooting guidance.
- Prefer guided onboarding over raw technical setup so the product feels approachable to non-expert users.

### 2. Multi-surface product architecture

- Keep the core CLI as the primary user surface, but add TUI, desktop, and web/dashboard surfaces as secondary layers.
- Use a clear gateway/control-plane or runtime orchestration model so local tools, sessions, and device-aware capabilities remain connected without making the core fragile.
- Treat every app surface as a portal to the same local runtime, not a separate product identity.

### 3. Device-aware assistant capabilities

- Support local app/node patterns for device-aware actions, permissions, and OS-level capabilities.
- Keep device access explicit, permission-gated, and user-controllable.
- Build the foundation for phone, desktop, and local node integrations without weakening the privacy-first contract.

### 4. Product polish and supportability

- Improve documentation navigation, startup guides, and troubleshooting flows.
- Make release packaging, signing, versioning, and validation easier to follow and harder to break.
- Add operational guardrails around build provenance, checksums, and reproducible releases.

### 5. Distribution and release discipline

- Borrow the maturity of modern release pipelines: versioning, artifact validation, provenance, and clean local/CI release checks.
- Keep release flows deterministic and auditable, so users can trust packaged builds.
- Use automation to verify the runtime, config, and installation path before shipping.

### 6. Channel and platform reach

- Extend the product to meet the user where they already are, while preserving the local-first core.
- Explore messaging and app integrations as optional reach expansions rather than defining the product around them.
- Keep the core identity intact: verified local reasoning first, wider distribution second.

### Why this is a better path for Zoveli

OpenClaw shows how to productize a local assistant into a polished multi-surface platform. Zoveli retains the stronger differentiator: explicit trust, verified math, private local memory, and auditability. The goal is not to become a generic chatbot platform; it is to become the trusted local assistant that users can rely on while also gaining the operational maturity needed to ship well.

The strategic direction is simple:

- Zoveli brings the trust and reasoning guarantee.
- Platform maturity brings the usability and distribution gains.
- Together they produce a product that is both dependable and usable.

## Try it in 30 seconds

**Windows PowerShell:**

```powershell
git clone https://github.com/blessandy9104-hue/zoveli-ai.git
cd zoveli-ai
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e .\mathcore
pnpm install --frozen-lockfile
pnpm run build
pnpm start                  # then type: /math solve x^2 - 5x + 6 = 0
```

**macOS / Linux:**

```bash
git clone https://github.com/blessandy9104-hue/zoveli-ai.git
cd zoveli-ai
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e ./mathcore
pnpm install --frozen-lockfile
pnpm run build
pnpm start
```

No account, API key, or network is needed for local tools. Start with `/math 2+2`, `/remember <fact>`, `/recall <query>`, `/sys`, or `/tools`. See the [first-run guide](docs/guides/onboarding.md) for expected output and fixes.

## Download & install

Portable installers are available for Linux, Windows, and macOS. Review the script before running it.

**Linux / macOS:**

```bash
curl -fsSL https://raw.githubusercontent.com/blessandy9104-hue/zoveli-ai/main/install/install-zoveli-runtime.sh | bash
```

**Windows PowerShell:**

```powershell
irm https://raw.githubusercontent.com/blessandy9104-hue/zoveli-ai/main/install/install-zoveli-runtime.ps1 | iex
```

The Windows installer leaves `PATH` unchanged by default and prints the full `zoveli.cmd` path. Pass `-AddToPath` to add its directory to your user `PATH`; then open a new terminal.

The installer verifies the downloaded archive and installs to `~/.local/share/zoveli` (Linux/macOS) or `%LOCALAPPDATA%\Zoveli` (Windows). State defaults to `~/.zoveli` (`%USERPROFILE%\.zoveli` on Windows) and survives upgrades. Re-running stages and preflights the new runtime, creates a backup, and restores the previous runtime if the swap fails.

## Developer verification

```powershell
pnpm install --frozen-lockfile
pnpm run build
pnpm test
pnpm run doctor
pnpm config:check
pnpm health:check -- --offline
pnpm run release:check
pnpm run plugin:check
pnpm perf:check
```

`doctor` checks the local toolchain, importable mathcore, resolved `mathcore-mcp` binary, and Ollama. Ollama is optional for local tools and verified math.

From a source checkout, run the recovery drill directly with `node apps/cli/dist/cli.js recovery-check`; the `zoveli recovery-check` shorthand is available after installing the portable launcher.

## Launch it

From a source checkout:

```powershell
pnpm start
pnpm run desktop
```

The CLI is the core product. Local tools include verified math, private SQLite memory with a Markdown vault mirror, system information, programming-language tools, search, and scheduling. Run `/help` in the terminal to see commands.

The Playwright web server runs with `NODE_ENV=test`, which deliberately disables live Ollama probing. E2E tests cover the web app and mock/provider-resolution paths without loading the local model into RAM.

Optional local-model chat uses Ollama. The Windows source installer already configured by this project pins `qwen3.5:0.8b` for this low-memory, CPU-only machine. First start may be slow while the model loads; keep the request timeout configured and avoid concurrent model requests. On a faster machine, choose another installed Ollama model via `ZOVELI_OLLAMA_MODEL`.

For Docker, see [docker/docker-compose.yml](docker/docker-compose.yml) and [Dockerfile](docker/Dockerfile). Keep secrets out of images and source control.

## Features

## Features (all runnable today)

- **🔬 Verified Mathematics** — one AI math intelligence subsystem: mathcore MCP gives zero-hallucination math with hash-chained audit certificates, governed with 12 specialists (algebra, cal[...]
- **🧠 Local-First Memory** — SQLite store with FTS5 ranked search, wiki-links and tags (Markdown vault kept as human-readable export mirror)
- **🤖 Full Agent Framework** — 25 packages: agent loop, tools, chat, verified math, memory, and system capabilities (`/tools` or `GET /api/tools` lists the 58 default tools; desktop adds 2 a[...]
- **🖥️ System & Hardware Awareness** — local OS/CPU/memory/disk/GPU/battery/network insight with budget checks (`@zoveli/sysinfo`)
- **💻 Programming Languages** — detection, analysis, formatting, linting, testing, tooling for 17+ languages (`@zoveli/languages`)
- **⚡ Capability Awareness** — runtime discovery, introspection, adaptation, and gap reports
- **🔍 Vault Search** — SQLite FTS5 ranked full-text search over the knowledge store
- **🕸️ Knowledge Graph** — wiki-link graph with orphans, hubs, DOT export
- **🧪 Code Review** — complexity hotspots, duplication, dead code, secret detection
- **📄 Doc Generator** — offline Markdown API docs from source exports
- **❤️ Project Health** — tests/CI/docs/deps/TODO-debt scoring
- **🗓️ Smart Scheduler** — energy-aware prioritization + time-blocking
- **🎭 Personas** — switchable friend, tutor, engineer, coach (`/persona`, remembered locally)
- **🌐 Web Research** — SSRF-guarded fetch + keyless search, trusted-source flags
- **🛡️ Security Scanner** — secrets + risky-pattern scanning
- **🔑 Passwordless login** — optional email OTP for any inbox incl. @proton.me, `GET /login`; enable the gate with `ZOVELI_AUTH_REQUIRED=1`
- **🔒 Privacy-First** — runs locally, no cloud required, MIT licensed


## Documentation

- [Architecture](docs/architecture.md)
- [Math intelligence subsystem](docs/math-subsystem.md) · [Memory store](docs/memory-store.md)
- [API Reference](docs/api/) · [Plugin SDK](docs/plugin-sdk/README.md)
- [Runbooks](docs/runbooks/) · [Release runbook](docs/runbooks/release.md) · [Clean-install acceptance](docs/runbooks/product-acceptance.md)
- [Upgrading](docs/guides/upgrading.md) · [Changelog](CHANGELOG.md)
- [ADRs](docs/adr/)
- [Security policy](SECURITY.md)
- [First-run guide](docs/guides/onboarding.md) · [Desktop guide](docs/guides/desktop.md) · [CLI guide](docs/guides/cli.md)
- [Platform maturity strategy](docs/strategy-platform-upgrades.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). CI runs lint, typecheck, unit and integration tests, browser E2E, security scans, and Docker builds.

## License

MIT — see [LICENSE](LICENSE).

## Author

Founded by **Andy** — [@blessandy9104-hue](https://github.com/blessandy9104-hue) — blessandy9104@gmail.com
