# Zoveli CLI Guide

## Install

```bash
pip install -e ./mathcore   # vendored verified-math backend
pnpm install && pnpm run build
```

## Run

```bash
pnpm start
# or
node apps/cli/dist/cli.js
```

## Everyday flows

- **Verified math:** `/math solve x^2 - 5x + 6 = 0` → `VERIFIED` + certificate,
  or type a bare expression like `2+2`. Solved proofs are memorized; the governor routes
to algebra/calculus/statistics/logic/units/discrete specialists.
- **Audit an answer:** `/check integrate x^2 from 0 to 3 ;; the answer is 9`
  → `MATCH` (wrong answers get `MISMATCH`, never a silent guess)
- **Host facts:** `/sys` → OS/CPU/RAM/disk/GPU snapshot
- **Capabilities:** `/caps` → available/total count
- **Persona:** `/persona [friend|tutor|engineer|coach]` → show or switch the assistant's style (remembered locally; `ZOVELI_PERSONA` pins one)
- **Tool list:** `/tools` → all ~61 local tools
- **Chat:** any other text, once a chat model is available (see below —
  any API key or free local Ollama)

## Chat models (your preference, zero cost possible)

Resolution order: any API key → free local Ollama → tools-only offline.

```bash
# Option A — free and local, no keys, no cost:
# 1. Install from https://ollama.com, then:
ollama pull qwen3:4b
pnpm start   # auto-detects Ollama, chat just works

# Option B — any API key (OpenAI-compatible providers):
OPENAI_API_KEY=sk-... pnpm start        # or DEEPSEEK_API_KEY,
# OPENROUTER_API_KEY, GROQ_API_KEY, TOGETHER_API_KEY, ZOVELI_API_KEY
ZOVELI_MODEL=gpt-4o-mini pnpm start     # pick any model name
ZOVELI_API_BASE=https://my-proxy/v1 ZOVELI_API_KEY=... pnpm start  # custom endpoint

# Docker: ollama runs as a sibling service, already wired:
docker compose --profile local-llm up ollama
docker exec zoveli-ollama ollama pull qwen3:4b
docker compose --profile cli up --build
```

`ZOVELI_OLLAMA_URL` overrides the Ollama address (default
`http://localhost:11434`; Docker Compose sets it to `http://ollama:11434`).

## Env

`ZOVELI_VAULT_PATH`, `ZOVELI_MEMORY_DB`, `ZOVELI_MEMORY_EXPORT`, `ZOVELI_MATH_MEMORIZE`, `ZOVELI_EMBED_MODEL`, `MATHCORE_AUDIT`, `MATHCORE_MCP_COMMAND`, `MATHCORE_TIMEOUT_MS`,
`TELEMETRY_ENABLED`, `OTLP_ENDPOINT`, `PROM_PORT`, `ZOVELI_API_KEY`,
`OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, `OPENROUTER_API_KEY`, `GROQ_API_KEY`,
`TOGETHER_API_KEY`, `ZOVELI_API_BASE`, `ZOVELI_MODEL`, `ZOVELI_OLLAMA_URL`,
`ZOVELI_OLLAMA_MODEL`.
`ZOVELI_PERSONA` pins a persona (friend, tutor, engineer, coach);
`ZOVELI_TEMPERATURE` sets chat sampling (default 0.7, clamped 0–2);
`ZOVELI_MEMORY_BRIEF=0` disables the private memory brief in chat, and
`ZOVELI_MEMORY_TO_CLOUD=1` explicitly allows it for cloud providers
(local providers only by default).

## Troubleshooting

- mathcore missing → `pip install -e ./mathcore`; verify `mathcore "2+2"`.
- No capabilities → `capability_scan`; see `docs/runbooks/capability-scan-failures.md`.
- Slow search → search is SQLite FTS5 (instant); check `ZOVELI_MEMORY_DB` is writable.
