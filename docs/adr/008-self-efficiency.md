# ADR 008: Self-Efficiency Review as a Core Capability

## Status

Accepted

## Context

Zoveli already records a bounded in-process trace of tool calls for `/trace`,
diagnostics and structured logging. Users expect an assistant that can notice
when its own work is repeatedly slow or failing, yet an autonomous code or
settings rewriter would violate the local-first trust model:

- the trace can contain provider error text and must not be exposed casually;
- a model cannot safely judge whether a code change preserves behavior;
- persistent telemetry and network reporting are opt-in or forbidden by default.

The product needs a small, honest self-improvement loop rather than an
autonomous self-modifying agent.

## Decision

Make **measure → explain → propose → user approval → test → re-measure** a core
assistant behavior, backed by `efficiency_review` in the capability plugin.

1. **Bounded in-memory evidence.** `ZoveliHost` exposes `host-efficiency` with
   the last 200 tool calls: tool name, duration and success only. Arguments,
   results, prompts and error strings are stripped. The trace resets on restart.
2. **Deterministic analysis.** `reviewEfficiency` groups samples by tool and
   reports repeated slow or failing work with sample counts, average latency
   and failure rate. It ignores malformed samples, clamps invalid options and
   never mutates its input.
3. **Advisory output only.** The result always sets `automaticChanges: false`.
   Suggestions require user approval and a focused test; no tool writes code,
   changes settings, swaps providers or enables telemetry.
4. **Core prompt rule.** The `self-efficiency` prompt section tells the model to
   call `efficiency_review` first, state when the sample is small, propose the
   smallest safe change, wait for explicit approval, then implement, test and
   re-measure.
5. **Capability discovery.** `efficiency.self-review` is reported only when
   `efficiency_review` is actually mounted, matching the existing live-tool
   inventory rule.

## Integration points

- `packages/host/src/host.ts`: provides the `host-efficiency` snapshot service.
- `packages/capability/src/efficiency.ts`: pure review function and types.
- `packages/capability/src/index.ts`: `efficiency_review` tool and
  `capability.reviewEfficiency` API.
- `packages/capability/src/scanner.ts`: `efficiency.self-review` definition.
- `packages/core/src/system-prompt.ts`: measurement, approval and test rules.
- `tests/unit/efficiency.test.ts`: pure review, discovery, prompt and real host
  dispatch coverage.

## Consequences

### Positive

- Users get concrete, repeatable evidence instead of vague "I can optimize" claims.
- The assistant can improve its own workflows without rewriting itself.
- No new storage, network surface or secret exposure.
- Persistent JSONL tracing remains the opt-in `ZOVELI_TRACE_LOG` feature.

### Negative

- The sample is process-local and bounded, so long-term trends are invisible.
- A statistically valid but semantically wrong optimization still needs human
  review and tests; the tool cannot guarantee that a change is correct.
- The default tool surface grows by one (`efficiency_review`).
