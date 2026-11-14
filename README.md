# Zoveli AI — local-first personal assistant

[![M8ven Score](https://m8ven.ai/badge/mcp/blessandy9104-hue-zoveli-ai-1m1d8z?v=a871bb4a46ab2bd9a64bf585d0dc5ffe)](https://m8ven.ai/mcp/blessandy9104-hue-zoveli-ai-1m1d8z?s=readme)

> The assistant that proves its math, runs on your hardware, and never trains on your data.

> **Product scope:** the **Desktop app** is the primary interface in the source
> tree. Packaged Electron installers are not shipped yet, so the currently
> shipped one-command install is the **portable CLI runtime**. The CLI remains
> supported for automation and headless use; the browser/web UI is experimental
> and other surfaces are community-supported. Every surface shares the same
> local runtime: verified math, local memory, and local tools. See
> [docs/interfaces.md](docs/interfaces.md) for the support tiers and
> [docs/core-plugins.md](docs/core-plugins.md) for what counts as core vs experimental.

Website: **https://blessandy9104-hue.github.io/zoveli-ai/** · Trust & Transparency: **[docs/TRUST.md](docs/TRUST.md)**

[![CI](https://github.com/blessandy9104-hue/zoveli-ai/actions/workflows/ci.yml/badge.svg)](https://github.com/blessandy9104-hue/zoveli-ai/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/blessandy9104-hue/zoveli-ai/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/Node-22%2B-green.svg)](https://nodejs.org/)

## Why local-first?

|           | Zoveli AI                                                                              |
| --------- | -------------------------------------------------------------------------------------- |
| Price     | **Free forever**, MIT                                                                  |
| Your data | **Stays on your machine**, never trained on                                            |
| Offline   | **Yes for local tools** — 59 default tools; web research needs network                 |
| Math      | **Verified or withheld** (+ hash-chained audit certificate)                            |
| Models    | Free local Ollama (0.8B → 70B) or your own cloud key                                   |
| Lock-in   | None — swap models or run fully offline                                                |
| Login     | Optional passwordless email code; off by default, enable with `ZOVELI_AUTH_REQUIRED=1` |

Details: [docs/why-zoveli.md](docs/why-zoveli.md).

## Professionally safe AI

Zoveli aims to make AI **professionally safe by making it provable** — the
power of a world-class brain without the anxiety of not knowing whether it is
lying to you or spying on you.

Most people have to choose between a "dumb" AI that runs locally and a "smart"
AI that lives in the cloud. Zoveli lets you mix and match: use a giant cloud
brain for the thinking while verification and sensitive data stay on your
device. You get the intelligence of the cloud with the security of your own
machine.

The trust experience is designed around three layers:

- **Confidence signal.** Every answer carries a quiet verdict: **Verified**
  (green check), **Partially verified** (yellow — the reasoning is sound, but a
  specific fact could not be cross-referenced), or **Unverified** (neutral gray,
  "AI-generated; not verified"). The user feels the safety without reading a
  technical log.
- **Proof on demand.** Clicking the badge or **Show proof** opens
  human-readable receipts such as "Calculated using local math engine
  (Integration)" or "Verified against Trusted KB: [Official Tax Code 2026]."
  Raw verifier records are translated, not dumped.
- **Audit mode.** A separate developer view exposes the raw JSON-style logs for
  reports, code reviews, or legal work. It keeps noise away from everyday use
  while preserving the full truth for the people who need it.

The current desktop build marks verified math with a **VERIFIED** badge and
writes a sealed certificate to the local audit chain; proof-on-demand and audit
mode extend that same trust model. See [Trust & Transparency](docs/TRUST.md).

## Sovereign Distribution

Zoveli is independently developed. To keep the project free, self-funded, and
independent of corporate gatekeepers, official macOS and Windows binaries are
**unsigned** — no Apple Developer Program membership, no Microsoft Authenticode
certificate, and no recurring platform fees passed on to users.

That means Gatekeeper and SmartScreen will warn you the first time you launch
Zoveli. This is expected, not a defect. Follow the
**[Sovereign Install Guide](docs/INSTALL_GUIDE.md)** for the exact Windows
SmartScreen and macOS Gatekeeper steps. Always download from the official
[GitHub Releases page](https://github.com/blessandy9104-hue/zoveli-ai/releases)
and verify the published checksums and build-provenance attestations.

We do not claim "enterprise-certified." We claim **sovereign and independent**:
open source, local-first, publicly built, and yours to inspect.

## Install

### Linux (one command)

```bash
curl -fsSL https://raw.githubusercontent.com/blessandy9104-hue/zoveli-ai/main/install/install.sh | sh
```

The installer resolves the latest published release, downloads the matching
`linux-x64` or `linux-arm64` runtime, verifies its SHA-256, backs up an existing
vault before an upgrade, links `~/.local/bin/zoveli`, and runs `zoveli doctor`.
It needs `curl`, `tar`, `bash`, and `sha256sum` (or `shasum`).

```bash
# Read-only status (installed vs. latest)
curl -fsSL https://raw.githubusercontent.com/blessandy9104-hue/zoveli-ai/main/install/install.sh | sh -s -- --check

# Non-interactive install
curl -fsSL https://raw.githubusercontent.com/blessandy9104-hue/zoveli-ai/main/install/install.sh | sh -s -- --yes

# Opt in to a PATH block in ~/.profile
curl -fsSL https://raw.githubusercontent.com/blessandy9104-hue/zoveli-ai/main/install/install.sh | sh -s -- --add-to-path

# Upgrade later by re-running the installer; uninstall keeps ~/.zoveli
curl -fsSL https://raw.githubusercontent.com/blessandy9104-hue/zoveli-ai/main/install/install.sh | sh -s -- --uninstall
curl -fsSL https://raw.githubusercontent.com/blessandy9104-hue/zoveli-ai/main/install/install.sh | sh -s -- --uninstall --purge
```

`zoveli doctor` checks the installed runtime, configuration drift, vault schema,
the mathcore command, and a live MCP handshake; `zoveli doctor --offline` skips
the spawn. The default install directory is `~/.local/share/zoveli`; the vault
and state stay in `~/.zoveli`. Re-running the installer is idempotent: the same
version is a no-op, an older install is upgraded, and a failed upgrade rolls
back to the previous runtime.

**Platform status:** the Linux one-command path is tested on the Ubuntu 22.04
x64 and arm64 GitHub runners (install, doctor, idempotent rerun, uninstall, and
vault preservation). A true fresh VM, non-CI arm64 hardware, and non-Ubuntu
distributions remain **untested**. Release `v0.1.3` does not include a
`linux-arm64` archive; arm64 installs work once a release containing the
CI-built archive is published. Release `v0.1.3` also predates `zoveli doctor`;
the installer reports that as a warning and continues, and the doctor check
activates with the next published runtime. macOS and Windows one-command
installers are Phase 3 and Phase 4.

### Docker fallback (browser UI)

If you cannot or do not want to install the native runtime, run the same
browser UI in a local container:

```bash
curl -fsSL https://raw.githubusercontent.com/blessandy9104-hue/zoveli-ai/main/install/install-docker.sh | sh
# then open http://127.0.0.1:8080
```

Requirements: Docker Engine or Docker Desktop 20.10+ on `linux/amd64` or
`linux/arm64`. No Node, Python, Git, or Compose is needed. The UI binds to
`127.0.0.1` only. The vault, sessions, and audit log live in the `zoveli-data`
Docker volume and survive upgrades and normal uninstalls; `--purge` deletes
them.

```bash
# Read-only status; upgrade by re-running the installer
curl -fsSL .../install-docker.sh | sh -s -- --check

# Uninstall: keeps the data volume unless --purge is added
curl -fsSL .../install-docker.sh | sh -s -- --uninstall --yes
curl -fsSL .../install-docker.sh | sh -s -- --uninstall --purge --yes
```

Provider keys are forwarded from the current environment (for example
`OPENAI_API_KEY`) and are never written to disk or printed. Local Ollama is
reached through `host.docker.internal`.

**Docker status:** the browser-UI image is
`ghcr.io/blessandy9104-hue/zoveli-ai-web`, built natively for amd64 and arm64 in
CI. Until the next release publishes it, build locally with
`docker build -t zoveli-web:local .` and run
`sh install/install-docker.sh --image zoveli-web:local`. Docker Desktop on
macOS/Windows, rootless Docker, and Podman are **untested**.

### Legacy source installer

The installer clones the repo, creates a Python venv, installs vendored
`mathcore`, ensures Node 22 + pnpm 11.7.0, builds, and prints exact run steps.
Review the script before piping it to a shell.

**Linux / macOS:**

```bash
curl -fsSL https://raw.githubusercontent.com/blessandy9104-hue/zoveli-ai/main/install/install-zoveli.sh \
  | bash -s -- --model qwen3:8b
```

**Windows PowerShell:**

```powershell
irm https://raw.githubusercontent.com/blessandy9104-hue/zoveli-ai/main/install/install-zoveli.ps1 | iex
```

From a checkout, the Windows installer accepts the model directly:

```powershell
.\install\install-zoveli.ps1 -Model qwen3:8b
```

Use `--model` / `-Model` to pick a local Ollama preset (default `qwen3:4b`).
The install finishes with run instructions for the source checkout. No telemetry
is sent; the scripts clone only from the official repository.

### Portable runtime (no toolchain)

If you do not want Git, Node, Python, or pnpm installed, use the self-contained
runtime. Linux users should normally use the one-command `install.sh` above;
this lower-level script is useful for direct control, macOS, and Windows. It
verifies SHA-256 before extracting and supports rollback:

```bash
# Linux / macOS
curl -fsSL https://raw.githubusercontent.com/blessandy9104-hue/zoveli-ai/main/install/install-zoveli-runtime.sh | bash
```

```powershell
# Windows PowerShell
irm https://raw.githubusercontent.com/blessandy9104-hue/zoveli-ai/main/install/install-zoveli-runtime.ps1 | iex
```

The Windows installer leaves `PATH` unchanged by default and prints the full
`zoveli.cmd` path. Pass `-AddToPath` to add its directory to your user `PATH`.
State defaults to `~/.zoveli` (`%USERPROFILE%\.zoveli` on Windows) and survives
upgrades. Later, `zoveli update --check` reports new releases and
`zoveli update` verifies the published SHA-256 before upgrading. Release builds
also publish unsigned macOS `.dmg` and Windows `.exe` installers; see the
[Sovereign Install Guide](docs/INSTALL_GUIDE.md) for first-launch steps.

### Docker Compose (local development)

```bash
docker compose up --build
# then open http://127.0.0.1:8080
```

The Compose path keeps the vault and audit log in the `zoveli-data` volume.
Cloud keys, `ZOVELI_PROVIDER`, and `ZOVELI_OLLAMA_MODEL` are passed through from
the environment; see [compose.yaml](compose.yaml). The Docker chat stack lives in
[docker/docker-compose.yml](docker/docker-compose.yml); its optional `postgres`
and `monitoring` profiles require `POSTGRES_PASSWORD` and
`GRAFANA_ADMIN_PASSWORD` respectively.

## Choose your model

Local chat is free and needs no account. Pull a model, then start Zoveli:

```bash
ollama pull qwen3:4b
pnpm start
```

| Preset             | Model          | Good for                            | Rough RAM |
| ------------------ | -------------- | ----------------------------------- | --------- |
| Tiny               | `qwen3.5:0.8b` | Old laptops, CPU-only               | ~1–2 GB   |
| Balanced (default) | `qwen3:4b`     | Everyday chat plus tool use         | ~4–6 GB   |
| Strong local       | `qwen3:8b`     | Better reasoning on a modern laptop | ~8–10 GB  |
| Large local        | `llama3.1:70b` | Workstations and GPUs               | ~48 GB+   |

`ZOVELI_OLLAMA_MODEL` selects the local model; `ZOVELI_MODEL` is the global
override and wins when both are set. Small models automatically get a reduced
tool list so they stay responsive. Full presets and hardware notes:
[docs/guides/models.md](docs/guides/models.md).

## Optional Cloud Brain

Any OpenAI-compatible key works, and Anthropic uses its native Messages API:

```bash
OPENAI_API_KEY=sk-... pnpm start
ANTHROPIC_API_KEY=sk-ant-... pnpm start
GROQ_API_KEY=gsk-... pnpm start
```

When several keys are present, pin one with `ZOVELI_PROVIDER`:

```bash
ZOVELI_PROVIDER=anthropic ANTHROPIC_API_KEY=sk-ant-... pnpm start
ZOVELI_PROVIDER=groq ZOVELI_MODEL=llama-3.3-70b-versatile pnpm start
```

Supported providers: `custom`, `ollama`, `openai`, `anthropic`, `deepseek`,
`openrouter`, `groq`, `together`. An unknown value fails at startup instead of
silently using another key.

**Cloud Brain changes the chat model, not the trust boundary.** Verified math still
runs in local `mathcore`; the audit log, memory database, and local tools stay on
your machine. A cloud provider sees only the chat text you send. See
[the model guide](docs/guides/models.md) and [Trust & Transparency](docs/TRUST.md).

## Interfaces

| Tier | Surface                                                | Status                                      |
| ---- | ------------------------------------------------------ | ------------------------------------------- |
| 1    | **Desktop (Electron)** — onboarding, chat, local tools | **Primary in source; installers not shipped** |
| 2    | **CLI** — scripts, servers, CI, headless machines      | **Supported; shipped portable runtime**     |
| 3    | Browser/web UI served over HTTP                        | Experimental                                |
| —    | TUI wrappers, editor/messaging integrations            | Community-supported                         |

```bash
pnpm run desktop   # primary app from a source checkout
pnpm start         # CLI automation surface
```

Interface tiering is about product focus, not capability: every tier uses the
same verified math engine and local memory. Details:
[docs/interfaces.md](docs/interfaces.md).

## Features

- **🔬 Verified Mathematics** — one AI math intelligence subsystem: mathcore MCP gives zero-hallucination math with hash-chained audit certificates, governed with 12 specialists (algebra, calculus, statistics, logic, units, discrete, arithmetic, geometry, trigonometry, probability, linear, number). Python specialists load lazily on first use.
- **🧠 Local-First Memory** — SQLite store with FTS5 ranked search, wiki-links and tags (Markdown vault kept as human-readable export mirror)
- **🤖 Full Agent Framework** — 22 packages: agent loop, tools, chat, verified math, memory, and system capabilities (`/tools` or `GET /api/tools` lists the 59 default tools; desktop adds 2 auth tools)
- **🛡️ Pluggable claim verification** — check non-math claims with a Python syntax verifier, a manifest-authenticated local knowledge base (SHA-256, fail-closed), or your own registered verifier; math remains the final fallback
- **📊 Public trust score** — `zoveli eval` runs GSM8K-mini, HumanEval-mini, and trusted-claim fixtures, publishes the score on the Trust page, and blocks a 5% relative regression in CI
- **🖥️ System & Hardware Awareness** — local OS/CPU/memory/disk/GPU/battery/network insight with budget checks (`@zoveli/sysinfo`)
- **💻 Programming Languages** — detection, analysis, formatting, linting, testing, tooling for 17+ languages (`@zoveli/languages`)
- **⚡ Capability Awareness** — runtime discovery, introspection, adaptation, and gap reports; math operations declare model-size tiers so an 0.8B model fails high-tier work instead of guessing
- **📈 Self-Efficiency** — `efficiency_review` measures bounded recent tool latency and failures, then offers advisory, user-approved improvements; it never edits code or settings and never enables persistent telemetry
- **🔄 Verifiable updates** — `zoveli update` resolves the latest GitHub release with host-restricted manual redirects, verifies SHA-256, and runs the unified installer; release installers are unsigned by design, with checksums and build-provenance attestations
- **🔍 Vault Search** — SQLite FTS5 ranked full-text search over the knowledge store
- **🕸️ Knowledge Graph** — wiki-link graph with orphans, hubs, DOT export
- **🧪 Code Review** — complexity hotspots, duplication, dead code, secret detection
- **📄 Doc Generator** — offline Markdown API docs from source exports
- **❤️ Project Health** — tests/CI/docs/deps/TODO-debt scoring
- **🗓️ Smart Scheduler** — energy-aware prioritization + time-blocking
- **🎭 Personas** — switchable friend, tutor, engineer, coach (`/persona`, remembered locally)
- **🌐 Web Research** — SSRF-guarded fetch and keyless search; validates redirects,
  blocks private/reserved IPv4 and non-public IPv6, and pins built-in requests
  to validated DNS addresses
- **🛡️ Security Scanner** — secrets + risky-pattern scanning
- **🔑 Passwordless login** — optional email OTP for any inbox incl. @proton.me, `GET /login`; enable the gate with `ZOVELI_AUTH_REQUIRED=1`
- **🔒 Privacy-First** — runs locally, no cloud required, MIT licensed

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

`doctor` checks the local toolchain, importable mathcore, resolved `mathcore-mcp`
binary, and Ollama. Ollama is optional for local tools and verified math.

From a source checkout, run the recovery drill directly with
`node apps/cli/dist/cli.js recovery-check`; the `zoveli recovery-check`
shorthand is available after installing the portable launcher.

## Documentation

- [Trust & Transparency](docs/TRUST.md) · [Security policy](SECURITY.md)
- [Models and Cloud Brain](docs/guides/models.md) · [Interfaces](docs/interfaces.md)
- [Architecture](docs/architecture.md)
- [Math intelligence subsystem](docs/math-subsystem.md) · [Memory store](docs/memory-store.md)
- [API Reference](docs/api/) · [Plugin SDK](docs/plugin-sdk/README.md)
- [Runbooks](docs/runbooks/) · [Release runbook](docs/runbooks/release.md) · [Clean-install acceptance](docs/runbooks/product-acceptance.md)
- [Upgrading](docs/guides/upgrading.md) · [Changelog](CHANGELOG.md)
- [ADRs](docs/adr/)
- [First-run guide](docs/guides/onboarding.md) · [Desktop guide](docs/guides/desktop.md) · [CLI guide](docs/guides/cli.md)
- [Remote MCP server and allowlist](docs/guides/remote-mcp.md)
- [Platform maturity strategy](docs/strategy-platform-upgrades.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). CI runs lint, typecheck, unit and integration tests, browser E2E, security scans, and Docker builds.

## License

MIT — see [LICENSE](LICENSE).

## Author

Founded by **Andy** — [@blessandy9104-hue](https://github.com/blessandy9104-hue) — blessandy9104@gmail.com
