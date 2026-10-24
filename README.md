# Zoveli AI — local-first personal assistant
[![M8ven Score](https://m8ven.ai/badge/mcp/blessandy9104-hue-zoveli-ai-1m1d8z?v=a871bb4a46ab2bd9a64bf585d0dc5ffe)](https://m8ven.ai/mcp/blessandy9104-hue-zoveli-ai-1m1d8z?s=readme)
> The assistant that proves its math, runs on your hardware, and never trains on your data.

> **Product scope:** Zoveli's core is the offline CLI assistant — verified math, local memory, and local tools.
> Web, desktop, and the wider plugin set are valuable but secondary: they must never break the core.
> See [docs/core-plugins.md](docs/core-plugins.md) for what counts as core vs experimental.

Website: **https://blessandy9104-hue.github.io/zoveli-ai/**

[![CI](https://github.com/blessandy9104-hue/zoveli-ai/actions/workflows/ci.yml/badge.svg)](https://github.com/blessandy9104-hue/zoveli-ai/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
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

```bash
git clone https://github.com/blessandy9104-hue/zoveli-ai.git
cd zoveli-ai
pip install -e ./mathcore   # verified-math backend
pnpm install && pnpm run build
pnpm start                  # then type: /math solve x^2 - 5x + 6 = 0
```

No account, no API key needed — local tools (math, memory, sysinfo, …) work fully offline.
The stable first path is five commands: `/math 2+2`, `/remember <fact>`,
`/recall <query>`, `/sys`, and `/tools`. New here? Follow the
[first-run guide](docs/guides/onboarding.md) for the install check, expected
output, and exact fixes for a missing chat or math backend.

## Download & install

Portable install (no Git, Node, Python, compiler, or pnpm required):

```bash
curl -fsSL https://raw.githubusercontent.com/blessandy9104-hue/zoveli-ai/main/install/install-zoveli-runtime.sh | bash
```

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/blessandy9104-hue/zoveli-ai/main/install/install-zoveli-runtime.ps1 | iex
```

The Windows installer leaves your `PATH` unchanged by default and prints the
full `zoveli.cmd` path. To add the install directory to your user `PATH`,
download and run it with `-AddToPath`:

```powershell
Invoke-WebRequest https://raw.githubusercontent.com/blessandy9104-hue/zoveli-ai/main/install/install-zoveli-runtime.ps1 -OutFile install-zoveli-runtime.ps1
powershell -ExecutionPolicy Bypass -File .\install-zoveli-runtime.ps1 -AddToPath
```

Then open a new terminal and run `zoveli`.

The installer downloads the matching prebuilt archive, verifies its SHA-256,
and installs to `~/.local/share/zoveli` (Linux/macOS) or
`%LOCALAPPDATA%\Zoveli` (Windows). State defaults to `~/.zoveli`
(`%USERPROFILE%\.zoveli` on Windows: vault mirror and memory database) and
survives upgrades. Re-running the installer stages and preflights the new
runtime, creates and verifies a pre-upgrade backup under `~/.zoveli/backups`,
and automatically restores the previous runtime if the swap or installed
launcher check fails. CI currently publishes Linux x64,
Windows x64, and macOS arm64 archives; other targets use the source install
below. Review
[`install/install-zoveli-runtime.sh`](install/install-zoveli-runtime.sh) and
[`install/install-zoveli-runtime.ps1`](install/install-zoveli-runtime.ps1)
before running; both are source-visible and telemetry-free. No release archive
yet? Use the developer source install below.

Every archive ships with a SHA-256 sidecar and a GitHub build-provenance
attestation. The installer checks the checksum itself; to audit a manual
download, compare the sidecar (on Windows use
`Get-FileHash <archive> -Algorithm SHA256`) and, with the GitHub CLI installed,
confirm where it was built:

```bash
sha256sum --check zoveli-<version>-<platform>-<arch>.tar.gz.sha256
gh attestation verify zoveli-<version>-<platform>-<arch>.tar.gz \
  --repo blessandy9104-hue/zoveli-ai \
  --signer-workflow blessandy9104-hue/zoveli-ai/.github/workflows/runtime-artifacts.yml
```

Pinning `--signer-workflow` proves the archive came from this repository's
release pipeline, not merely from some workflow in the repository.

Developers installing from a source checkout need Node.js 22.16+, Python 3.11+,
pnpm 11.7.0+, and Git.

**Windows (source checkout, PowerShell):**

```powershell
# 1. Toolchain
winget install OpenJS.NodeJS.LTS Python.Python.3.11 Git.Git
npm install -g pnpm@11.7.0

# 2. Download
git clone https://github.com/blessandy9104-hue/zoveli-ai.git
cd zoveli-ai

# 3. Verified-math backend (vendored in ./mathcore, optional but recommended)
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e .\mathcore

# 4. Install + build + verify
pnpm install
pnpm run build
pnpm test
pnpm run doctor        # Node/pnpm/python/mathcore/Ollama report
pnpm config:check      # env + vault drift (typos, ignored values, schema)
pnpm health:check      # runtime/config/vault/MCP health rollup
pnpm release:check     # version/tsconfig/changelog consistency
pnpm plugin:check      # plugin contract, naming and tool collisions
pnpm perf:check        # startup/mount/tool-call budgets
```

**macOS / Linux (source checkout):**

```bash
# 1. Toolchain (macOS shown; apt/dnf equivalents on Linux)
brew install node@22 python@3.11 git
npm install -g pnpm@11.7.0

# 2. Download
git clone https://github.com/blessandy9104-hue/zoveli-ai.git
cd zoveli-ai

# 3. Verified-math backend (vendored in ./mathcore, optional but recommended)
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e ./mathcore

# 4. Install + build + verify
pnpm install
pnpm run build
pnpm test
pnpm run doctor        # Node/pnpm/python/mathcore/Ollama report
pnpm config:check      # env + vault drift (typos, ignored values, schema)
pnpm health:check      # runtime/config/vault/MCP health rollup
pnpm release:check     # version/tsconfig/changelog consistency
pnpm plugin:check      # plugin contract, naming and tool collisions
pnpm perf:check        # startup/mount/tool-call budgets
```

## Launch it

Portable install: `zoveli` (Linux/macOS) or `zoveli.cmd` (Windows). The POSIX
installer creates `~/.local/bin` when needed and links `zoveli` there, printing
the exact `PATH` export if that directory is not already on `PATH`. Windows
prints the full `zoveli.cmd` path; pass `-AddToPath` to add the install
directory to your user `PATH`, then open a new terminal and run `zoveli`.

Source checkout:

```bash
pnpm start            # CLI assistant (local tools work offline, Windows/macOS/Linux terminals)
pnpm run desktop      # Electron desktop shell (dev mode, spawns local server internally)
```

Container (source checkout; state lives in the `zoveli-data` volume):

```bash
docker compose -f docker/docker-compose.yml --profile local-llm up -d ollama
docker exec zoveli-ollama ollama pull qwen3:4b
docker compose -f docker/docker-compose.yml --profile cli up --build
```

Before trusting the install with notes, run `zoveli recovery-check` (or
`node apps/cli/dist/cli.js recovery-check` from a source checkout). It proves
backup, checksum verification and restore in an isolated temporary vault
without touching real data.

The CLI works fully offline for all local tools (verified math via
mathcore, memory vault, sysinfo, languages, search, scheduler, ...).
For free offline chat with no keys: install Ollama and pull a model
(`qwen3:4b` is recommended). Zoveli uses `qwen3:4b` when it is installed and
otherwise picks another installed chat model; a pinned model that is not
pulled is reported with its exact `ollama pull` command, not advertised as
ready. Or set any API
key (`OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, `OPENROUTER_API_KEY`,
`GROQ_API_KEY`, `TOGETHER_API_KEY` or `ZOVELI_API_KEY`) with optional
`ZOVELI_MODEL` / `ZOVELI_API_BASE` to use any OpenAI-compatible model.
Try: `/math solve x^2 - 5x + 6 = 0` · `/remember My spare key is in the blue drawer` · `/recall blue drawer` · `/sys` · `/tools`.

Extend it with the [plugin SDK](docs/plugin-sdk/README.md):
`pnpm create:plugin <name> --mount`, then enable the opt-in plugin with
`ZOVELI_PLUGINS=zoveli-<name>`. Inspect the surface with `zoveli plugins`, and
remove any default or optional plugin with
`ZOVELI_DISABLE_PLUGINS=zoveli-<name>`.

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

See [CONTRIBUTING.md](CONTRIBUTING.md). Every PR runs lint, strict
typecheck, unit + integration tests, Playwright e2e (Chromium, Firefox,
WebKit), Trivy + secret scans, and Docker builds.

## License

MIT — see [LICENSE](LICENSE).

## Author

Founded by **Andy** — [@blessandy9104-hue](https://github.com/blessandy9104-hue) — blessandy9104@gmail.com
