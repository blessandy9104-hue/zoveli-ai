# Math intelligence subsystem (one subsystem)

Zoveli's math is a single AI subsystem with one engine, one transport, one
tool surface, one proof memory, and one rule text. Nothing computes in the
chat model — ever.

```
Python engine        mathcore/                  sympy/mpmath/numpy/scipy/
                     (pip install -e ./mathcore) networkx/z3/pint + quorum
                            |
stdio JSON-RPC       `mathcore-mcp` binary      tools/call compute|check_answer
                            |
TS transport         @zoveli/math-intelligence  MathcoreClient (persistent
                     src/transport.ts           child; transports, never computes)
                            |
TS tools             mathcore_compute           assistant-math-tools
                     mathcore_check_answer      (auto-memorize VERIFIED proofs)
                     mathcore_list_operations
                            |
AI layer             math_recall                proof memory in SQLite
                     math_memorize              (@zoveli/memory-store, tag math)
                     math_stats                 counters: verified/withheld/
                                                mismatches/recalls
                            |
Plugin + rules       zoveli-math-intelligence   registers mathcore-mcp-client +
                     (zoveliMath alias)         both toolsets; injects MATH_RULES
                                                + MATH_INTELLIGENCE_RULES
                            |
Shims (no logic)     @zoveli/math              re-exports canonical values
                     packages/core              re-exports transport + tools
                     @zoveli/mcp                references same server entry
                                                (same command/env, never a copy)
                            |
Callers              CLI /math, /check · web /api/chat fast path ·
                     agent tool loop (mathcore_compute / mathcore_check_answer
                     / math_recall)
```

## Single sources (do not duplicate)

All in `packages/math-intelligence/src/`:

- `constants.ts`: `MATHCORE_MCP_COMMAND` (`mathcore-mcp`), `MATHCORE_MCP_SERVER_ID`
  (`mathcore`), `defaultMathcoreAuditPath()` (`MATHCORE_AUDIT` overrides),
  `MATH_RULES` (verbatim 5-rule text), `MATH_INTELLIGENCE_RULES` (recall-first
  guidance), `mathcoreServerConfig()` (the one stdio spawn config).
- `domains.ts`: `DOMAIN_OPERATIONS` (algebra 5, calculus 4, statistics 1,
  logic 2, units 1, discrete 1, arithmetic 2, geometry 3, trigonometry 1,
  probability 1, linear 6, number 7 — all 34 ops owned), `routeDomain()` (explicit
  operation wins, else keyword hints calculus → statistics → probability →
  logic → units → discrete → geometry → trigonometry → arithmetic →
  linear → number → algebra, else `general`), `OP_INVOCATION` / `invocationHead()` /
  `buildCommand()` (op id → parser-compatible surface head; `stat`/`trig`/
  `probability` pass through), `domainMemoryTag()` / `domainTitlePrefix()` (proof-memory
  namespacing).
- `resolve.ts`: `resolveMathcoreCommand()` (MATHCORE_MCP_COMMAND → project
  `.venv` → PATH/PATHEXT → bare name) and `commandParts()` (path-with-spaces
  stays intact; command lines with args like `python -m mathcore.mcp_server`
  split for spawn). The transport, MCP config and `pnpm run doctor` all use it.
- `transport.ts`: `MathcoreClient` + `mathcore` singleton; spawn failures name
  the resolved command and print the fix.
- `tools.ts`: `mathcoreTools` (3, names frozen) + `mathIntelligenceTools`
  (`math_recall` with `domain` filter, `math_route`, `math_memorize`,
  `math_stats`, `math_recall_semantic`).
- `intelligence.ts`: `memorizeVerified` (upsert `math/<slug>` or
  `math/<domain>/<slug>`, tags `math,verified[, math/<domain>]`),
  `recallSimilar` (keyword over math-tagged notes, optional domain filter),
  `getMathStats`, `recordMismatch`, `recordWithheld`.

## Governed specialists (`packages/math-domains/`)

`zoveli-math-algebra` (core: evaluate/simplify/expand/factor/solve),
`zoveli-math-calculus`, `zoveli-math-statistics`
(`stat`), `zoveli-math-logic` (`sat`, `prove`), `zoveli-math-units`
(`convert`), `zoveli-math-discrete` (`shortest_path`),
`zoveli-math-arithmetic` (`percent`, `ratio`),
`zoveli-math-geometry` (`area`, `volume`, `pythagoras`),
`zoveli-math-trigonometry` (`trig`), `zoveli-math-probability`
(`probability`), `zoveli-math-linear` (`determinant`, `rank`,
`inverse`, `linsolve`, `matmul`, `eigenvalues`), `zoveli-math-number`
(`is_prime`, `factor_int`, `gcd`, `lcm`, `modpow`, `factorial`,
`choose`) under the governor:

- Specialists never spawn mathcore: they call the governor's shared transport
  and memorize into their own namespace. Out-of-domain operations are rejected
  before any spawn (`math_algebra_solve` + `math_calculus_solve`).
- Each declares `capabilities: [math.<domain>]` for Cordis-class hosts and
  injects a one-line domain hint. The local host mounts all twelve after the
  governor.
- Every mathcore op is owned by exactly one specialist; `general` takes only
  unrecognized input. To add a future op: extend `DOMAIN_OPERATIONS` plus a
  plugin entry, nothing else changes.

## Semantic recall (`semantic.ts`)

`math_recall_semantic`: keyword prefilter over the domain namespace, then
cosine ranking when an embedding model answers
(`ollama pull nomic-embed-text`, `ZOVELI_EMBED_MODEL` overrides), else
deterministic keyword overlap (`mode: 'keyword'`). Never throws, never hangs
(15s embed timeout; chat models stall it — embedding models only).

## Environment

`MATHCORE_MCP_COMMAND` (full path, or a command line with args; checked
before `.venv`/PATH), `MATHCORE_AUDIT` (audit path),
`MATHCORE_TIMEOUT_MS` (per-request timeout, default 120000),
`ZOVELI_MATH_MEMORIZE=0` disables proof auto-memorize,
`ZOVELI_OLLAMA_URL` is unrelated (chat models, see `docs/guides/cli.md`).

## Guarantees

- **Verified or withheld:** independent methods must agree or the answer is
  WITHHELD/MISMATCH — the model never guesses numbers.
- **Transport never computes:** the TS client only carries JSON-RPC.
- **Supervised pool:** one persistent child reused across calls; a crash or
  failed spawn restarts it with exponential backoff (0.5s → 30s cap) instead of
  spawning per request, and late exit events from old children are ignored.
  `mathcore_status` (or `/mcp`) reports pid, spawns, restarts, pending calls,
  last error and `retryInMs`.
- **Proofs accumulate:** VERIFIED results are upserted to the memory store;
  WITHHELD/MISMATCH only bump counters (no DB spam).
- **Install once:** `python -m pip install -e ./mathcore` inside `.venv`
  (vendored). `pnpm run doctor` verifies the interpreter import and the
  resolved `mathcore-mcp` path; Docker images build the z3 wheel with
  ephemeral `build-base` + `cmake`, then remove them.

## Tests

- Python: `python -m pytest mathcore/tests/test_known_answers.py mathcore/tests/test_cli.py -q`
- Resolver: `tests/unit/mathcore-resolve.test.ts` (override > venv > PATH >
  fallback; existing paths with spaces vs command lines with args)
- TS unity: `tests/unit/math-intelligence.test.ts` → "one AI math intelligence
  subsystem" (constants, shim drift, transport default, tool names, memorize/
  recall, withheld opt-out, plugin contract); `tests/unit/math-domains.test.ts`
  → routing table (explicit + keyword incl. arithmetic/geometry/trigonometry/
  probability/linear/number, single
  ownership of all 34 ops), namespaced memory, specialist contracts, out-of-domain
  rejection; `tests/unit/math-semantic.test.ts` → cosine/keywordScore,
  keyword degradation, stubbed vector ranking, empty-memory safety; `tests/unit/core.test.ts` →
  "one math subsystem" (legacy contract still green via shims).
- E2E: `/math 2+2` → `VERIFIED`; web `2+2` → verification badge.
- Smoke: `math_memorize` → `math_recall` → `math_stats` over host tools.
