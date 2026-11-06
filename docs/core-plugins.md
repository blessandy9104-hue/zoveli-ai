# Core vs experimental packages

The **core runtime** is verified math, local memory, and local tools. The
**Desktop app** is the primary interface over that runtime; the CLI remains
supported for automation and headless use. The browser/web UI is experimental
and other surfaces are community-supported. See the product scope in the
[README](../README.md), [interface tiers](interfaces.md), and
[architecture](architecture.md). This file declares which packages carry the
core promise and which are free to evolve.

## Core (stable)

Everything the default boot path needs: `apps/desktop` and `apps/cli` →
`@zoveli/host` (`defaultPlugins`, REPL, chat) and its direct providers:

`host`, `math-intelligence`, `math-domains`, `memory-store`, `languages`,
`sysinfo`, `scheduler`, `secscan`, `health`, `graph`, `docgen`,
`code-analysis`, `capability`, `persona`, `webresearch`,
`diagnostics`, `auth` (desktop only), `shim-dsh-core` (authoring shim),
`apps/cli`, `apps/desktop`. `guard` is optional and only useful with a custom
`shell_exec`.

The former `memory`, `search`, and `skills` wrappers were removed because
`memory-store` owns those services and tools.

Rules for core:

- The capability plugin exposes `efficiency_review`. It reads only the host's
  bounded in-memory tool trace (tool name, duration and success), returns
  advisory findings, and never edits code or settings or enables persistent
  telemetry. Applying a suggestion needs user approval, tests and review;
  persistent JSONL tracing stays opt-in via `ZOVELI_TRACE_LOG`. See
  [ADR 008](adr/008-self-efficiency.md).
- Changes should include tests; breaking changes need an ADR entry.
- New packages start as experimental — promotion to core needs an ADR
  and maintainer sign-off.
- The fast local loop builds core only: `pnpm run build:core`.

## Shared library package

`core` is a small prompt/version library, not a mounted plugin. The CLI
imports `ZOVELI_VERSION` and the desktop server imports `promptSectionsText`.
It contributes no tools and no services.

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
