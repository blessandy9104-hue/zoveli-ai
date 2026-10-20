# Zoveli Architecture

> See ADRs 001–005 for decisions. This is the map; ADRs are the reasons.
> Math and memory subsystems have their own maps:
> [math-subsystem.md](math-subsystem.md), [memory-store.md](memory-store.md).

## Product scope (MVP)

The core product is the **offline computer assistant**: CLI (Windows/macOS/Linux terminals) + Electron desktop shell. Verified math, local
memory, and local tools. Everything is judged against it — the desktop
server is internal to the Electron shell, never a standalone web platform.
[core-plugins.md](core-plugins.md) declares exactly which packages
are core (stable, semver-minded) vs experimental (opt-in, may change).

## Runtime composition

```
User (CLI / Desktop)
  → dsh profile (config/*.cordis.yml)
    → Cordis context (ctx)
      → zoveli plugins (23 packages; 31 mounted by default)
        → capabilities (scanner → registry → adaptation)
        → tools (guarded pre/post pipeline, ~63 live)
        → sessions (JSONL + projections)
        → external systems (mathcore MCP, SQLite store, vault FS, LLM APIs)
```

## Plugin inventory

| Area | Plugins |
|------|---------|
| Core | `core`, `host`, `shim-dsh-core` (authoring shim, not a runtime) |
| Math | `math-intelligence` (governor: verified compute + proof memory + rules), `math-domains` (algebra/calculus/statistics/logic/units/discrete/arithmetic/geometry/trigonometry/probability/linear/number specialists) |
| Memory | `memory`, `memory-store` (SQLite FTS5 + vault export mirror) |
| Capabilities | `capability`, `skills`, `languages`, `search`, `docgen`, `code-analysis`, `health`, `graph`, `scheduler`, `sysinfo` |
| Safety | `guard`, `secscan`, `auth` |
| Interaction | `persona` (switchable friend/tutor/engineer/coach), `webresearch` (guarded fetch + search) |

The host's `defaultPlugins` (30) are the tool-bearing set: core,
math-intelligence, the 12 math specialists, memory-store, memory, skills,
languages, sysinfo, search, scheduler, secscan, health, graph, docgen,
code-analysis, capability, guard, persona, webresearch.

## Data flows

- **Chat turn (zoveli-host):** user text → optional math fast-path → OpenAI-compatible `chat/completions` with function tools → tool execution → follow-up turn, up to `maxSteps`. History is in-memory per session; durable session log is future work.
- **Verified math:** agent proposes → `math_route` (classify) → specialist solve (`math_algebra_solve`, …) or `mathcore_compute` → MCP stdio → sealed certificate → auto-memorized proof note → `OutputGuard` renders only releasable values → hash-chained audit log.
- **Memory:** agent tools → SQLite store (`~/.zoveli/memory.db`, FTS5-ranked) → Markdown export mirror (`knowledge-vault/`) → wiki-link graph (`graph`). Legacy `.md` files import once on first boot.
- **Languages:** `language_detect` → `language_analyze`/`lint` → `language_format` → `language_run_tests`; tooling guide via `language_get_tooling`.

## Profiles and runtime

Apps boot through `@zoveli/host` (`ZoveliHost.mount` + REPL/HTTP), not
through a Cordis launcher. `config/*.cordis.yml` declares the intended
full-profile plugin composition for future upstream-Cordis integration;
today they are documentation, not executed code. The desktop-internal server mounts
`defaultPlugins` + `zoveli-auth`; the CLI mounts `defaultPlugins`.

## Observability

Health and inventory: `GET /health` (tool count) and `GET /api/tools`
(full live tool list). Servers log to stdout; math audit certificates go
to `MATHCORE_AUDIT`. The old telemetry/event-logger plugins were removed
as dead code — check git history if observability needs to come back.
