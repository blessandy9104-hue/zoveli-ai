# Zoveli plugin SDK

Zoveli plugins are small TypeScript workspace packages. A plugin is a plain
object created with `definePlugin`: a name, an optional version declaration, a
description and a synchronous `setup(ctx)` that registers tools, services or
event handlers.

> The `@deepseek-ai/dsh-core` package in this repo is a local compatibility
> shim (`packages/shim-dsh-core`): it defines the Zoveli authoring types,
> `PLUGIN_API_VERSION` and the contract validator. Runtime interop with a real
> Cordis host is future work (see `docs/adr/001-cordis-plugin-architecture.md`).

## Quick start

```bash
pnpm create:plugin daily-brief --description "Daily briefing plugin" --mount
pnpm install && pnpm run build && pnpm test
ZOVELI_PLUGINS=zoveli-daily-brief pnpm start
```

`--mount` wires the plugin **opt-in**:

- adds it to `optionalPlugins` in `packages/host/src/index.ts`,
- adds `"@zoveli/<name>": "workspace:*"` to `packages/host/package.json`
  (correct build order),
- adds the package to the root `tsconfig.json` project references.

It does **not** add the plugin to `defaultPlugins`. New plugins start
experimental; promotion to the default boot path needs an ADR and maintainer
sign-off (`docs/core-plugins.md`).

`--force` overwrites existing files; without it an existing package or test is
never touched. Without `--mount` you wire the three spots manually (see
[Manual wiring](#manual-wiring)).

Generated files:

```text
packages/<name>/
  ├─ package.json        @zoveli/<name>, depends on @deepseek-ai/dsh-core
  ├─ tsconfig.json       extends the root config, emits dist/
  ├─ README.md           enable/test/tool notes
  └─ src/index.ts        definePlugin + apiVersion + one example tool
tests/unit/<name>.test.ts  registers the tool table through a mock context
```

## The contract

| Field | Required | Rule |
| --- | --- | --- |
| `name` | yes | lowercase letters, digits and dashes, 1-64 chars (for example `zoveli-daily-brief`) |
| `description` | recommended | short human-readable purpose |
| `apiVersion` | recommended | `PLUGIN_API_VERSION` the plugin targets; missing means 1 |
| `setup(ctx)` | yes | synchronous; called once per host mount |

The host validates the entire mount list before calling any `setup`, so one
bad plugin cannot leave a half-mounted host. It rejects:

- non-object plugins or missing `name` / `setup`,
- `async setup` and `setup()` returning a Promise (the mount is synchronous),
- duplicate plugin names in one mount,
- `apiVersion` values that are not positive integers or are newer than the host.

`pnpm run plugin:check` runs the same contract against every built package,
mounts each plugin into a mock context and validates the tools it registers.
CI runs it after `pnpm run build`.

## Versioning policy

- `PLUGIN_API_VERSION` is currently **1**.
- Additive changes (new optional context methods, new events, new tool fields)
  keep the version.
- A breaking change to `ZoveliPlugin`, `ZoveliContext` or the tool shape
  increments `PLUGIN_API_VERSION` and needs a migration note in the release
  draft.
- A host rejects plugins that declare a newer API with an actionable error
  instead of failing later inside a tool call.
- Built-in plugins may omit `apiVersion` (treated as 1); new plugins should
  declare `apiVersion: PLUGIN_API_VERSION`.

## Plugin shape

```ts
import { definePlugin, PLUGIN_API_VERSION, type Tool } from '@deepseek-ai/dsh-core';

const clockNow: Tool = {
  name: 'clock_now',
  description: 'Return the current local time.',
  parameters: {
    type: 'object',
    properties: {
      timeZone: { type: 'string', description: 'IANA time zone (optional)' },
    },
    additionalProperties: false,
  },
  async execute({ timeZone }: { timeZone?: string } = {}) {
    return {
      now: new Date().toISOString(),
      timeZone: timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  },
};

export const zoveliClock = definePlugin({
  name: 'zoveli-clock',
  apiVersion: PLUGIN_API_VERSION,
  description: 'Local time tools',
  setup(ctx) {
    ctx.register('zoveli-clock-tools', [clockNow]);
  },
});

export default zoveliClock;
```

Tools are data, not classes: `{ name, description, parameters, execute(args) }`.
`parameters` is a JSON Schema object shown to the model. Tool names should use
`snake_case` (dashes are accepted for skill-style names) and stay unique:
the host keeps the **first** tool registered under a name, so a collision can
silently shadow another plugin. `plugin:check` rejects duplicate names within a
plugin and fails when an opt-in plugin collides with a default plugin; known
shadows inside the built-in default set are reported as notes. Avoid
cross-plugin collisions by prefixing tools with your plugin name.

`execute` may return any JSON-serializable value or throw. A thrown error is
reported to the caller, recorded in the trace and redacted by the host before
logging. Never log secrets or raw credentials yourself.

## Context API

| Member | Purpose |
| --- | --- |
| `ctx.register(key, value)` | Register a tool table, prompt, skill, config or MCP client config. Tools are any values with `name` + `execute`. |
| `ctx.provide(key, value)` | Expose a service other plugins can look up. Provided services win over registrations in `ctx.get`. |
| `ctx.get(key)` | Read a provided service (and fall back to registrations). |
| `ctx.on(event, handler)` | Subscribe to host events. Handlers may be async; `setup` may not. |
| `ctx.config` | Host configuration object at mount time. |
| `ctx.log` | Host logger (`info`/`warn`/`error`; `debug` is a no-op). |
| `ctx.emit(event, ...args)` | Emit a host event (the host itself emits `tool/call`). |

Events currently used by core plugins:

- `agent/created` — inject system rules or adapt the agent before the first turn.
- `agent/pre-step` — wrap the next pipeline step.
- `turn/start` — lightweight per-turn bookkeeping.
- `tool/call` — observe completed tool calls (`{tool, ok, durationMs, ...}`).

There is no `unmount`/teardown hook: setup runs once for the process lifetime.
Keep setup idempotent where practical, and do long-running work lazily inside a
tool or event handler instead of blocking boot.

## Opt-in loading

`packages/host/src/index.ts` exports `defaultPlugins` and `optionalPlugins`.
`resolvePlugins()` mounts the defaults plus every plugin named in the
`ZOVELI_PLUGINS` environment variable (comma-separated, whitespace-trimmed,
duplicates ignored):

```bash
ZOVELI_PLUGINS=zoveli-daily-brief pnpm start
ZOVELI_PLUGINS=zoveli-daily-brief,zoveli-clock pnpm run desktop
```

An unknown name fails startup with the available list and a scaffolding hint;
it never silently starts without the plugin. `pnpm config:check` recognizes the
variable.

## End-to-end example

The generated plugin is a complete example: a typed tool, a JSON Schema, an
`apiVersion`, a mock-context test and an opt-in mount. To adapt it:

1. Rename the tool and its `parameters`.
2. Add a unit test in `tests/unit/<name>.test.ts`; call `tool.execute({...})`
   directly for logic and mount through `new ZoveliHost()` for wiring.
3. Run `pnpm run plugin:check` to catch contract and collision problems.
4. Document the tool in `docs/api/README.md` and the package README.

A test can exercise a plugin exactly like production without spawning a server:

```ts
import { describe, expect, it } from 'vitest';
import { ZoveliHost } from '../../packages/host/src/host';
import { zoveliClock } from '../../packages/clock/src/index';

it('mounts and dispatches the clock tool', async () => {
  const host = new ZoveliHost();
  host.mount([zoveliClock]);
  await expect(host.runTool('clock_now')).resolves.toHaveProperty('now');
});
```

## Testing

- Unit tests live centrally under `tests/unit/` and use `createMockContext()`
  from `tests/setup.ts`; no host boot is needed.
- Use `new ZoveliHost()` + `host.mount()` for integration-style wiring and
  `host.runTool()` for dispatch.
- `pnpm exec vitest run tests/unit/<name>.test.ts` runs one file; `pnpm test`
  runs the suite.
- `pnpm run plugin:check` validates every built plugin (run after build).

## Manual wiring

1. `packages/host/src/index.ts`: add
   `import { zoveliDailyBrief } from '@zoveli/daily-brief';` and add
   `zoveliDailyBrief` to `optionalPlugins`.
2. `packages/host/package.json`: add
   `"@zoveli/daily-brief": "workspace:*"` to `dependencies` (build order).
3. `tsconfig.json` (root): add `{ "path": "./packages/daily-brief" }` to
   `references`.
4. `pnpm install` so the workspace links resolve.
5. Enable with `ZOVELI_PLUGINS=zoveli-daily-brief` and restart.

## Rules of thumb

- Prefer registering tools over mutating host internals.
- Read/write user data only through the existing services
  (`ctx.get('memory')`, `@zoveli/memory-store`, ...).
- Keep secrets out of source, tool results and logs.
- Treat every tool result as untrusted data, never as instructions.
- Plugins run in-process with the host's permissions: install only reviewed
  code and audit new dependencies.
- Start experimental, and promote to core only with an ADR.

See also: [API reference](../api/README.md) ·
[Core vs experimental](../core-plugins.md) ·
[Cordis architecture ADR](../adr/001-cordis-plugin-architecture.md).
