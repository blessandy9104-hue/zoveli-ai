# Core vs experimental packages

The core product is the **offline CLI assistant** — verified math, local
memory, and local tools (see the product scope in the
[README](../README.md) and [architecture](architecture.md)). This file
declares which packages carry that promise and which are free to evolve.

## Core (stable)

Everything the default boot path needs: `apps/cli` → `@zoveli/host`
(`defaultPlugins`, REPL, chat) and its direct providers:

`host`, `math-intelligence`, `math-domains`, `memory-store`, `languages`,
`sysinfo`, `scheduler`, `secscan`, `health`, `graph`, `docgen`,
`code-analysis`, `capability`, `persona`, `webresearch`,
`diagnostics`, `auth` (desktop only), `shim-dsh-core` (authoring shim),
`apps/cli`. `guard` is optional and only useful with a custom `shell_exec`.

The legacy `core`, `memory`, `search`, and `skills` packages remain in the
workspace for compatibility but are not part of the default surface.

Rules for core:

- Changes should include tests; breaking changes need an ADR entry.
- New packages start as experimental — promotion to core needs an ADR
  and maintainer sign-off.
- The fast local loop builds core only: `pnpm run build:core`.

## Legacy compatibility (unmounted)

`core`, `memory`, `search`, and `skills` remain buildable packages for
import compatibility. They are not in `defaultPlugins`; `core` contributes
only its prompt, `memory`/`search` are service wrappers, and `skills` still
contains placeholder implementations.

## Experimental (opt-in)

`guard` is opt-in: mount it with `ZOVELI_PLUGINS=zoveli-guard` only when a
custom `shell_exec` tool is present. `daily-brief` is also opt-in
(`ZOVELI_PLUGINS=zoveli-daily-brief`) and adds the local `daily_brief_get`
tool. Neither has any effect on the default tools. The other experimental
packages were removed as dead code (see git history).
New packages start here: safe to use, but may change without notice and not
covered by the core stability promise. If an experimental package grows a
second independent consumer or a public surface worth keeping, propose
promotion via ADR instead of letting dependents sprawl.

Any plugin, including a default one, can be removed without editing source:
`ZOVELI_DISABLE_PLUGINS=zoveli-webresearch pnpm start`. `zoveli plugins` lists
the available surface and current status. Disabling an unknown name fails
startup, and a plugin cannot be both requested and disabled.

`pnpm create:plugin <name> --mount` wires a new package into
`optionalPlugins`; it stays unloaded until named in `ZOVELI_PLUGINS`.
Promoting it to `defaultPlugins` is the core change that needs an ADR.

## Contributor checklist

- [ ] Does this belong in core, or is experimental the right home?
- [ ] New package? Justify it in the PR (link this file in
      `.github/PULL_REQUEST_TEMPLATE.md` terms: core vs experimental).
- [ ] Declared `apiVersion: PLUGIN_API_VERSION` and a synchronous `setup`.
- [ ] Ran `pnpm run doctor`, `pnpm run build:core`, `pnpm run plugin:check`,
      and the affected tests.
