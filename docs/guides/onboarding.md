# First-run guide

Get from a clean checkout to a verified answer in about five minutes. No
account, API key, or network connection is required for local tools.

## 1. Prerequisites

Portable install (recommended): currently Linux x64, Windows x64, and macOS
arm64; network access for the one-time download. Git, Node.js, Python, pnpm,
and a compiler are bundled in the archive and are not required. Other
architectures use the source install.

Source checkout: Node.js 22.16+ (the memory store uses `node:sqlite` with
FTS5), pnpm 11.7.0, Python 3.11+ for the vendored verified-math backend, and
Git. Windows: `winget install OpenJS.NodeJS.LTS Python.Python.3.11 Git.Git`
then install pnpm. macOS: `brew install node@22 python@3.11 git`.

## 2. Install

Portable installer (review the script before piping it to a shell). It verifies
the published SHA-256 before extraction:

```bash
curl -fsSL https://raw.githubusercontent.com/blessandy9104-hue/zoveli-ai/main/install/install-zoveli-runtime.sh | bash
```

PowerShell:

```powershell
irm https://raw.githubusercontent.com/blessandy9104-hue/zoveli-ai/main/install/install-zoveli-runtime.ps1 | iex
```

Re-running the installer stages and preflights the new runtime, writes a
verified backup under `~/.zoveli/backups`, and rolls back automatically if the
new runtime fails after the swap. Manual downloads are checksummed and carry a
GitHub build-provenance attestation; the
[README](../../README.md#download--install) shows both checks.

Source install (developers), from a manual clone:

```bash
git clone https://github.com/blessandy9104-hue/zoveli-ai.git
cd zoveli-ai
python -m venv .venv
# Windows: .\.venv\Scripts\Activate.ps1
# macOS/Linux: source .venv/bin/activate
python -m pip install -e ./mathcore
pnpm install
pnpm run build
```

## 3. Confirm readiness

Portable install:

```bash
zoveli health          # Linux/macOS; on Windows use the printed zoveli.cmd path
zoveli config-check
zoveli recovery-check  # proves backup/restore in an isolated temp vault
```

`recovery-check` should print `PASS` and `Your real vault was not touched.`
It exercises the backup, checksum verification and restore path before you
trust the install with notes. If it fails, run `zoveli health` and include the
drill output when reporting the problem.

The POSIX installer creates `~/.local/bin` when needed and links `zoveli`
there. If that directory is not on `PATH`, it prints the exact export to run;
you can also run the full launcher path printed at the end of the install.
Windows prints the `zoveli.cmd` path to run.

Source checkout:

```bash
pnpm run doctor
```

`doctor` is read-only. It checks Node, pnpm, Git, Python, the mathcore package,
the resolved `mathcore-mcp` binary, and whether a local Ollama server answers.
The portable `health` command checks the same runtime path without requiring
the development toolchain. Blocking failures exit non-zero; optional pieces are
warnings with an exact fix.

```text
[ok  ] Node.js 22.x — meets >= 22 floor (node:sqlite, FTS5)
[ok  ] mathcore 0.x — importable from py (verified-math engine)
[ok  ] mathcore-mcp — resolved from project .venv: .../mathcore-mcp
[warn] Ollama — not answering — chat needs a key or Ollama
       fix: install from https://ollama.com, then: ollama pull qwen3:4b

doctor: ready (1 warning, 0 blocking)
```

`doctor: ready` means the assistant will start. A missing chat model is not
blocking: verified math and every local tool still work.

## 4. Start

```bash
pnpm start
```

The first-run banner names the detected chat model and prints a fix when the
verified-math backend is missing. On a TTY it also shows the first commands to
try:

```text
Try in 30 seconds (local tools need no network, math is verified or withheld):
  /math solve x^2 - 5x + 6 = 0   proven answer + certificate
  /sys                           this machine: OS/CPU/RAM/disk/GPU
  /tools                         every default tool (58), no API key needed
  /remember <fact> | /recall <q> local notes, no model needed
  /health                        re-check config, vault, mathcore and capabilities
```

Try `/math 2+2` and look for `VERIFIED`. If a result cannot be verified, it is
`WITHHELD` rather than guessed. `/remember My spare key is in the blue drawer`
then `/recall blue drawer` proves local memory without a model. `/health`
re-checks configuration, the vault, the mathcore pool, and capabilities at any
time.

These are the five workflows the product is built around:

| Goal | Command | What success looks like |
| --- | --- | --- |
| Solve math | `/math solve x^2 - 5x + 6 = 0` | `VERIFIED` plus a certificate |
| Remember a fact | `/remember My spare key is in the blue drawer` | `remembered: ...` |
| Search your vault | `/recall blue drawer` | a matching note title and preview |
| Run a local tool | `/sys` | OS/CPU/RAM/disk snapshot |
| Ask for local help | `/help` or `/health` | command list or `health: ok` |

None of these need an account, API key, or network connection.

## 5. Enable chat (optional)

Resolution order is: any API key, then a free local Ollama server, then
tools-only offline mode. Zoveli prefers `qwen3:4b` when it is installed and
otherwise uses another installed chat model; set `ZOVELI_MODEL` to pin one.
If the pinned model is not installed, or Ollama has no chat models, the banner
and desktop setup panel keep chat off and print the exact pull command instead
of failing on the first message.

**Free and local (recommended):**

1. Install Ollama from <https://ollama.com>.
2. Run `ollama pull qwen3:4b`.
3. Restart Zoveli (`pnpm start`). The banner should say
   `Local Ollama detected`.

**Any OpenAI-compatible key:**

```bash
OPENAI_API_KEY=sk-... pnpm start
# also: DEEPSEEK_API_KEY, OPENROUTER_API_KEY, GROQ_API_KEY,
#       TOGETHER_API_KEY, or ZOVELI_API_KEY for a custom endpoint
ZOVELI_MODEL=gpt-4o-mini pnpm start
ZOVELI_API_BASE=https://my-proxy/v1 ZOVELI_API_KEY=... pnpm start
```

Restart after installing a model or setting a key; the app detects chat at
startup.

## Desktop first run

```bash
pnpm run desktop
```

The desktop shell starts the same local server on `127.0.0.1:3080` and opens it
in a window. The page shows a readiness line and, when something is missing, a
**Finish setup** panel with the same commands, including the pull command for a
pinned model that is not installed. `GET /api/onboarding` exposes the same state
as JSON for scripts. Install missing pieces, then restart the app.

## What to expect locally

- First-run state is derived from this machine; nothing is uploaded.
- Chat history stays in the browser (desktop) or the current terminal session.
- The memory database and Markdown vault default to your Zoveli data directory;
  override them with `ZOVELI_MEMORY_DB` and `ZOVELI_VAULT_PATH`.
- The first math call may take a few seconds while Python imports its math
  stack. Interactive sessions pre-warm mathcore; disable that with
  `ZOVELI_MATHCORE_PREWARM=0`.
- Setup replies in the desktop UI are not added to local chat history.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `mathcore-mcp not found` | Activate the venv and run `python -m pip install -e ./mathcore`, or set `MATHCORE_MCP_COMMAND`; verify with `pnpm run doctor` |
| `No chat model found` | Install Ollama and `ollama pull qwen3:4b`, or set an API key; local tools still work |
| `Requested Ollama model ... is not available` | Run the printed `ollama pull <model>`, or unset `ZOVELI_MODEL` to use another installed model |
| Ollama answers but chat errors | Pull the model named in the banner (`ollama pull qwen3:4b`) |
| Chat hangs | Check the endpoint / run `ollama serve`; raise `ZOVELI_CHAT_TIMEOUT_MS` for slow first tokens |
| Config seems ignored | `pnpm config:check` flags typos, bad values, and vault drift |
| Vault or database error | `pnpm health:check`; see `docs/runbooks/vault-corruption.md` |
| Desktop window does not open | Run `pnpm run desktop` from a terminal and check the dialog; port 3080 must be free |

More: [CLI guide](cli.md) · [Desktop guide](desktop.md) · [Upgrading](upgrading.md).
