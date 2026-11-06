# Models and Cloud Brain

Zoveli works with a free local model, a paid cloud model, or no model at all.
The model never verifies mathematics — that always happens in local mathcore —
so switching models changes *how the assistant talks*, not whether a number is
trustworthy.

## What stays local

| Piece | Where it runs |
|---|---|
| Verified math (`mathcore`) | Your machine, always |
| Math audit certificates | Your machine (`MATHCORE_AUDIT`) |
| Memory, notes, vault mirror | Your machine |
| Local tools | Your machine |
| Chat model | Local Ollama, or a provider you choose |

A cloud model receives the conversation you send it (prompt, history, and tool
results). It never receives your audit log or the math engine. Local memory is
only included when the chat model is local; set `ZOVELI_MEMORY_TO_CLOUD=1` if you
explicitly want the memory brief sent to a cloud provider.

## Local models (Ollama)

Install [Ollama](https://ollama.com), pull a model, and start Zoveli:

```bash
ollama pull qwen3:4b
pnpm start
```

`ZOVELI_OLLAMA_MODEL` chooses the local model. `ZOVELI_MODEL` is the global
override and wins when both are set. `ZOVELI_OLLAMA_URL` points at a non-default
server (default `http://localhost:11434`).

| Preset | Pull command | Good for | Rough RAM |
|---|---|---|---|
| Tiny | `ollama pull qwen3.5:0.8b` | Old laptops, CPU-only, fastest first token | ~1–2 GB |
| Balanced (default) | `ollama pull qwen3:4b` | Everyday chat plus tool use | ~4–6 GB |
| Strong local | `ollama pull qwen3:8b` | Better reasoning on a modern laptop | ~8–10 GB |
| Large local | `ollama pull llama3.1:70b` | Workstations and GPUs; slower CPU fallback | ~48 GB+ |

```bash
# Swap the local model for this run
ZOVELI_OLLAMA_MODEL=qwen3:8b pnpm start

# Keep one setting for every launch (macOS/Linux)
export ZOVELI_OLLAMA_MODEL=qwen3:8b
```

The installer accepts the same choice up front:

```bash
# Linux / macOS
curl -fsSL https://raw.githubusercontent.com/blessandy9104-hue/zoveli-ai/main/install/install-zoveli.sh \
  | bash -s -- --model qwen3:8b

# Windows PowerShell, from a checkout
.\install\install-zoveli.ps1 -Model qwen3:8b
```

Small models get a reduced tool list automatically (verified math, memory, and a
few essentials) so they stay responsive. Larger models see the full tool set.

### Capability tiers

Math operations declare a minimum model size in billions of parameters. The
active size comes from `ZOVELI_MODEL_PARAMS` (for example `0.8` or `70`) or is
read from the model tag (`llama3.2:0.8b`, `qwen3:70b`); an unknown size is
allowed rather than guessed.

| Tier | Operations | Examples |
|---|---|---|
| Any model | Arithmetic, evaluation, conversion, geometry, integer math, probability, trig | `2+2`, `is 1000003 prime` |
| 1B+ | Simplification, factoring, statistics, shortest path | `factor x^2-1`, `stat mean [1,2,3]` |
| 2B+ | Solving equations | `solve x^2-5x+6=0` |
| 3B+ | Calculus and linear algebra | `derivative of x^3*sin(x)`, `determinant of [[1,2],[3,4]]` |
| 7B+ | Differential equations, SAT, proofs | `dsolve y'=y`, `prove x^2 >= 0` |

A smaller local model fails fast with a clear `CapabilityError` and an `ERROR`
certificate instead of producing a plausible-looking guess. If you pin a cloud
provider with `ZOVELI_PROVIDER` (`openai`, `anthropic`, `deepseek`,
`openrouter`, `groq`, or `together`), the operation falls back to that provider
instead of being denied.

## Cloud Brain (optional)

Any OpenAI-compatible key works, and Anthropic is supported through its native
Messages API:

```bash
OPENAI_API_KEY=sk-... pnpm start
ANTHROPIC_API_KEY=sk-ant-... pnpm start
GROQ_API_KEY=gsk-... pnpm start
DEEPSEEK_API_KEY=... pnpm start
OPENROUTER_API_KEY=... pnpm start
TOGETHER_API_KEY=... pnpm start
```

When several keys are present, `ZOVELI_PROVIDER` pins one instead of relying on
the first key found:

```bash
ZOVELI_PROVIDER=anthropic ANTHROPIC_API_KEY=sk-ant-... pnpm start
ZOVELI_PROVIDER=groq ZOVELI_MODEL=llama-3.3-70b-versatile pnpm start
```

Supported values: `custom`, `ollama`, `openai`, `anthropic`, `deepseek`,
`openrouter`, `groq`, `together`. An unknown value fails at startup instead of
silently using a different provider. `ZOVELI_PROVIDER=ollama` forces the local
server even when a cloud key is set.

The OpenAI-compatible transport retries transient failures (rate limits,
timeouts, and server errors) on the native path, opens a 30-second circuit
breaker after three retryable failures, and performs a pre-routing health ping
so an unreachable endpoint fails once instead of stalling every turn. Provider
errors are mapped to the same user-facing categories as Anthropic.

| Variable | Purpose |
|---|---|
| `ZOVELI_PROVIDER` | Pin one provider |
| `ZOVELI_MODEL` | Override the model name for any provider |
| `ZOVELI_API_KEY` + `ZOVELI_API_BASE` | Any OpenAI-compatible endpoint |
| `ZOVELI_MAX_TOKENS` | Anthropic reply budget, clamped to 256–8192 (default 4096) |
| `ZOVELI_CHAT_TIMEOUT_MS` | Per-request timeout |

`ZOVELI_PROVIDER=custom` is the generic route: it requires `ZOVELI_API_KEY` and
uses `ZOVELI_API_BASE` when set.

### What Cloud Brain does not change

- Math is still computed and verified by local `mathcore`; the model only relays
  the sealed result.
- `MATHCORE_AUDIT` stays local and hash-chained.
- Provider keys are read from the environment and never written to the vault.
- Zoveli sends no telemetry. Your provider's own retention policy still applies
  to the chat text you send it.

See [Trust & Transparency](../TRUST.md) for the full data-handling statement.
