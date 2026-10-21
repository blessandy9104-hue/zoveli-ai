# Core vs experimental packages

The core product is the **offline CLI assistant** — verified math, local
memory, and local tools (see the product scope in the
[README](../README.md) and [architecture](architecture.md)). This file
declares which packages carry that promise and which are free to evolve.

## Core (stable)

Everything the default boot path needs: `apps/cli` → `@zoveli/host`
(`defaultPlugins`, REPL, chat) and its direct providers — 22 shipped
packages:

`host`, `core`, `math-intelligence`, `math-domains`,
`memory-store`, `memory`, `skills`, `languages`, `sysinfo`, `search`,
`scheduler`, `secscan`, `health`, `graph`, `docgen`, `code-analysis`,
`capability`, `guard`, `persona`, `webresearch`, `auth`,
`shim-dsh-core` (authoring shim), `apps/cli`.

Rules for core:

- Changes should include tests; breaking changes need an ADR entry.
- New packages start as experimental — promotion to core needs an ADR
  and maintainer sign-off.
- The fast local loop builds core only: `pnpm run build:core`.

## Experimental (opt-in)

None currently — the 41 unreachable packages were removed as dead code
(see git history). New packages start here: safe to use, but may change
without notice and not covered by the core stability promise. If an
experimental package grows a second independent consumer or a public
surface worth keeping, propose promotion via ADR instead of letting
dependents sprawl.

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
