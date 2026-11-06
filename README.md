# Zoveli AI — local-first personal assistant

[![M8ven Score](https://m8ven.ai/badge/mcp/blessandy9104-hue-zoveli-ai-1m1d8z?v=a871bb4a46ab2bd9a64bf585d0dc5ffe)](https://m8ven.ai/mcp/blessandy9104-hue-zoveli-ai-1m1d8z?s=readme)

> The assistant that proves its math, runs on your hardware, and never trains on your data.

> **Product scope:** the **Desktop app** is the primary interface. The CLI remains
> supported for automation and headless use; the browser/web UI is experimental and
> other surfaces are community-supported. Every surface shares the same local
> runtime: verified math, local memory, and local tools. See
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

## Install

### One command (source installer)

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
The install finishes with the Desktop-first run instructions. No telemetry is
sent; the scripts clone only from the official repository.

### Portable runtime (no toolchain)

If you do not want Git, Node, Python, or pnpm installed, use the self-contained
runtime. It verifies SHA-256 before extracting and supports rollback:

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
also publish a signed and notarized macOS `.dmg` and a signed Windows `.exe`.

### Docker Compose

```bash
docker compose up --build
# then open http://127.0.0.1:8080
```

The Compose path keeps the vault and audit log in the `zoveli-data` volume.
Cloud keys, `ZOVELI_PROVIDER`, and `ZOVELI_OLLAMA_MODEL` are passed through from
the environment; see [compose.yaml](compose.yaml). The Docker chat stack lives in
[docker/docker-compose.yml](docker/docker-compose.yml).

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

| Tier | Surface                                                | Status              |
| ---- | ------------------------------------------------------ | ------------------- |
| 1    | **Desktop (Electron)** — onboarding, chat, local tools | **Primary, stable** |
| 2    | **CLI** — scripts, servers, CI, headless machines      | **Supported**       |
| 3    | Browser/web UI served over HTTP                        | Experimental        |
| —    | TUI wrappers, editor/messaging integrations            | Community-supported |

```bash
pnpm run desktop   # primary app
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
- **🔄 Verifiable updates** — `zoveli update` resolves the latest GitHub release with host-restricted manual redirects, verifies SHA-256, and runs the unified installer; release installers are signed/notarized
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
- [Platform maturity strategy](docs/strategy-platform-upgrades.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). CI runs lint, typecheck, unit and integration tests, browser E2E, security scans, and Docker builds.

## License

MIT — see [LICENSE](LICENSE).

## Author

Founded by **Andy** — [@blessandy9104-hue](https://github.com/blessandy9104-hue) — blessandy9104@gmail.com
