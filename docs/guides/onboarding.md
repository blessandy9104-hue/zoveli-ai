# First-run guide

Get from a clean checkout to a verified answer in about five minutes. No
account, API key, or network connection is required for local tools.

## 1. Prerequisites

- Node.js 22.16+ (the memory store uses `node:sqlite` with FTS5)
- pnpm 11.7.0 (`npm install -g pnpm@11.7.0`)
- Python 3.11+ for the vendored verified-math backend
- Git

Windows: `winget install OpenJS.NodeJS.LTS Python.Python.3.11 Git.Git` then
install pnpm. macOS: `brew install node@22 python@3.11 git`.

## 2. Install

One-line installer (review the script before piping it to a shell):

```bash
curl -fsSL https://raw.githubusercontent.com/blessandy9104-hue/zoveli-ai/main/install/install-zoveli.sh | bash -s -- --yes
```

PowerShell:

```powershell
irm https://raw.githubusercontent.com/blessandy9104-hue/zoveli-ai/main/install/install-zoveli.ps1 | iex
```

Or from a manual clone:

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

```bash
pnpm run doctor
```

`doctor` is read-only. It checks Node, pnpm, Git, Python, the mathcore package,
the resolved `mathcore-mcp` binary, and whether a local Ollama server answers.
Blocking failures exit non-zero; optional pieces are warnings with an exact fix.

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
verified-math backend is missing. On a TTY it also shows four commands to try
first:

```text
Try in 30 seconds (all offline, math is verified or withheld):
  /math solve x^2 - 5x + 6 = 0   proven answer + certificate
  /sys                           this machine: OS/CPU/RAM/disk/GPU
  /tools                         every local tool (~63), no API key needed
  /health                        re-check config, vault, mathcore and capabilities
```

Try `/math 2+2` and look for `VERIFIED`. If a result cannot be verified, it is
`WITHHELD` rather than guessed. `/health` re-checks configuration, the vault,
the mathcore pool, and capabilities at any time.

## 5. Enable chat (optional)

Resolution order is: any API key, then a free local Ollama server, then
tools-only offline mode.

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
**Finish setup** panel with the same commands. `GET /api/onboarding` exposes the
same state as JSON for scripts. Install missing pieces, then restart the app.

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
| Ollama answers but chat errors | Pull the model named in the banner (`ollama pull qwen3:4b`) |
| Chat hangs | Check the endpoint / run `ollama serve`; raise `ZOVELI_CHAT_TIMEOUT_MS` for slow first tokens |
| Config seems ignored | `pnpm config:check` flags typos, bad values, and vault drift |
| Vault or database error | `pnpm health:check`; see `docs/runbooks/vault-corruption.md` |
| Desktop window does not open | Run `pnpm run desktop` from a terminal and check the dialog; port 3080 must be free |

More: [CLI guide](cli.md) · [Desktop guide](desktop.md) · [Upgrading](upgrading.md).
