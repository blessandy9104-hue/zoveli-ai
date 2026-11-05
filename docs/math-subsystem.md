# Math intelligence subsystem (one subsystem)

Zoveli's math is a single AI subsystem with one engine, one transport, one
tool surface, one proof memory, and one rule text. Nothing computes in the
chat model — ever.

```
Python engine        mathcore/                  sympy/mpmath/numpy/scipy/
                     (pip install -e ./mathcore) networkx/z3/pint + quorum
                            |
                     ops_catalog.py            declares 34 operations;
                                                specialist ops_* modules load
                                                on first use, not at startup
                            |
stdio JSON-RPC       `mathcore-mcp` binary      tools/call compute|check_answer|
                                                list_operations|list_verifiers
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

## Claim verifiers (`verifiers.py`)

`OutputGuard.audit_claim` runs pluggable verifiers before falling back to
verified math. A verifier returns `None` when it does not apply, or a
`ClaimVerdict` with a `verifier` field naming the deciding component:

- **`code`** — extracts fenced Python blocks and calls `ast.parse`; it never
  executes the code. The claim must say the code is valid or invalid.
- **`knowledge`** — exact-question lookup in `MATHCORE_TRUSTED_KB`, either a
  manifest-authenticated directory of curated domains or a legacy JSONL file
  with `question`, `answer`, and optional `source` fields. A directory domain
  is released only when its `.manifest` names the content file and its SHA-256
  matches; a missing, malformed, or mismatched manifest fails closed.

`MATHCORE_VERIFIERS=code,knowledge` restricts the chain and `off` disables
plugins. Third parties register with `register_verifier(ClaimVerifier(...))`;
duplicate names raise unless `replace=True`. A verifier that raises, or an
unknown configured name, produces `UNVERIFIABLE` instead of being skipped, so a
broken plugin cannot silently change the trust decision. `Orchestrator.check`
records the deciding verifier in the audit log, and the MCP server exposes
`list_verifiers`.

The checked-in `trusted_kb/` tree is verified with
`python -m mathcore.trusted_kb verify trusted_kb`; regenerate manifests after
editing content with `update trusted_kb`. See
[Trusted knowledge manifests](TRUST.md#trusted-knowledge-manifests).

## Capability tiers (`capability.py`)

Every math operation declares a minimum model size in billions of parameters
(`OPS_MIN_PARAMS` in `ops_catalog.py`): arithmetic and evaluation need no model,
algebra/statistics start at 1B, solving/calculus/linear algebra at 2–3B, and
`dsolve`, `sat`, and `prove` at 7B. The size of the active model comes from
`ZOVELI_MODEL_PARAMS` (an explicit number, in billions) or the model tag
(`qwen3:70b`, `llama3.2:0.8b`). An unknown size is allowed and left visible in
diagnostics rather than guessed.

A local model below the tier fails fast with `CapabilityError` before loading a
specialist or running the operation; the coordinator emits a `RuntimeWarning`
and seals an `ERROR` certificate. Mathematically, `0.8B` cannot proceed with a
high-tier operation while `70B` can. If `ZOVELI_PROVIDER` is pinned to a known
cloud provider (`openai`, `anthropic`, `deepseek`, `openrouter`, `groq`,
`together`), the request is allowed to fall back to that provider instead of
failing.

## Semantic recall (`semantic.ts`)

`math_recall_semantic`: keyword prefilter over the domain namespace, then
cosine ranking when an embedding model answers
(`ollama pull nomic-embed-text`, `ZOVELI_EMBED_MODEL` overrides), else
deterministic keyword overlap (`mode: 'keyword'`). Never throws, never hangs
(15s embed timeout; chat models stall it — embedding models only).

## Environment

`MATHCORE_MCP_COMMAND` (full path, or a command line with args; checked
before `.venv`/PATH), `MATHCORE_AUDIT` (audit path),
`MATHCORE_TRUSTED_KB` (manifest-authenticated KB directory or legacy JSONL for
the `knowledge` verifier), `MATHCORE_VERIFIERS` (comma-separated verifier chain;
`off` disables plugins), `ZOVELI_MODEL_PARAMS` (explicit active model size in
billions for capability tiers), `MATHCORE_TIMEOUT_MS` (per-request timeout,
default 120000),
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

- Python: `python -m pytest mathcore/tests/test_known_answers.py mathcore/tests/test_cli.py mathcore/tests/test_lazy_ops.py mathcore/tests/test_claim_verifiers.py -q`
- Lazy loading: `test_lazy_ops.py` proves importing `mathcore` loads no
  specialist module, the first operation loads only its own module, and the
  catalog still lists every operation without importing heavy dependencies.
- Verifiers: `test_claim_verifiers.py` covers code/trusted-knowledge verdicts,
  custom registration, configuration errors, and verifier logging.
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
