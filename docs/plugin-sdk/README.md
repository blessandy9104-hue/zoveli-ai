# Zoveli plugin SDK — quick guide

Zoveli plugins are small TypeScript workspace packages. A plugin is a plain
object created with `definePlugin`: a name, a description and a `setup(ctx)`
that registers tools, services or event handlers.

> The `@deepseek-ai/dsh-core` package in this repo is a local compatibility
> shim (`packages/shim-dsh-core`): it defines the Zoveli authoring types and
> identity helpers. Runtime interop with a real Cordis host is future work
> (see `docs/adr/001-cordis-plugin-architecture.md`).

## Scaffold one

```bash
pnpm create:plugin daily-brief --description "Daily briefing plugin" --mount
pnpm install && pnpm run build && pnpm test
```

- `<name>` must be a lowercase slug (letters, digits, dashes).
- `--mount` wires everything up for you:
  - adds the plugin to `defaultPlugins` in `packages/host/src/index.ts`,
  - adds `"@zoveli/<name>": "workspace:*"` to `packages/host/package.json`
    (required for correct build order),
  - adds the package to the root `tsconfig.json` project references.
- `--force` overwrites existing files; without it an existing package or test
  is never touched.
- Without `--mount` you wire the three spots manually (see below).

Generated files:

```
packages/<name>/
  ├─ package.json        @zoveli/<name>, depends on @deepseek-ai/dsh-core
  ├─ tsconfig.json       extends the root config, emits dist/
  └─ src/index.ts        definePlugin + one example tool
tests/unit/<name>.test.ts   registers the tool table through a mock context
```

## Plugin shape

```ts
import { definePlugin, type Tool } from '@deepseek-ai/dsh-core';

const hello: Tool = {
  name: 'daily_brief_hello',
  description: 'Example tool — replace it.',
  parameters: { type: 'object', properties: {} },
  async execute() {
    return { ok: true, message: 'hello' };
  },
};

export const zoveliDailyBrief = definePlugin({
  name: 'zoveli-daily-brief',
  description: 'Daily briefing plugin',
  setup(ctx) {
    ctx.register('zoveli-daily-brief-tools', [hello]);
  },
});

export default zoveliDailyBrief;
```

The context (`ZoveliContext`) exposes:

- `ctx.register(key, value)` — register a tool table, prompt, skill or client
  config. First registration of a name wins in the host, so never register
  the same name with different behavior.
- `ctx.provide(key, value)` — expose a service other plugins can look up.
- `ctx.on(event, handler)` — react to host events (e.g. `agent/created` to
  inject rules).
- `ctx.config` — host configuration passed at mount time.

Tools are data, not classes: `{ name, description, parameters, execute(args) }`.
`parameters` is a JSON Schema object shown to the model.

## Wire it manually (no `--mount`)

1. `packages/host/src/index.ts`: add
   `import { zoveliDailyBrief } from '@zoveli/daily-brief';` and add
   `zoveliDailyBrief` to `defaultPlugins`.
2. `packages/host/package.json`: add
   `"@zoveli/daily-brief": "workspace:*"` to `dependencies` (build order).
3. `tsconfig.json` (root): add `{ "path": "./packages/daily-brief" }` to
   `references`.
4. `pnpm install` so the workspace links resolve.

## Test it

Tests live centrally under `tests/unit/` and use `createMockContext()` from
`tests/setup.ts`; no host boot is needed. `pnpm exec vitest run
tests/unit/<name>.test.ts` runs one file, `pnpm test` runs the suite.

## Rules of thumb

- Prefer registering tools over mutating host internals.
- Read/write user data only through the existing services
  (`ctx.get('memory')`, `@zoveli/memory-store`, ...).
- Keep secrets out of logs; the repo never stores credentials in source.
