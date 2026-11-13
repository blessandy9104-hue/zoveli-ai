# Interfaces and support tiers

Zoveli has one product front door and several ways to reach the same local
runtime. The runtime — verified math, memory, tools, audit — is shared; the
interface tier describes how much product polish and stability each surface
gets.

## Tier 1 — Desktop (primary)

The Electron app in `apps/desktop` is the primary experience:

- First-run onboarding for chat and verified math.
- Chat, verified answers, local memory, and tool activity in one window.
- Optional passwordless email login (`ZOVELI_AUTH_REQUIRED=1`).
- The same local host and mathcore engine as every other surface.

Run it from a source checkout with `pnpm run desktop`. The desktop guide covers
packaging and troubleshooting: [desktop.md](guides/desktop.md).

Packaged Electron installers are not shipped yet, so the currently shipped
one-command install is the portable CLI runtime
([install.sh](../install/install.sh)). Desktop remains the primary surface in
the source tree and the place where new user-facing work lands first.

## Tier 2 — CLI (supported automation surface)

The CLI in `apps/cli` remains fully supported for scripting, servers, CI, and
headless machines. It is intentionally stable and documented, but it is no
longer the surface that drives product design:

```bash
pnpm start
node apps/cli/dist/cli.js --help
```

Use it for `/math`, `/check`, backups, health checks, plugin inventory, and
automation. The command reference is [guides/cli.md](guides/cli.md). Breaking
changes to documented CLI commands still need a changelog entry.

## Tier 3 — Browser/web UI (experimental)

The desktop server also serves its UI over HTTP. Running that UI as a separate
web deployment is experimental:

- No stability promise for routes, markup, or auth flows beyond the desktop use
  case.
- You own the network boundary: bind to loopback unless you have added TLS, a
  reverse proxy, and an authentication gate.
- Do not expose an unauthenticated instance to the public internet.

The server keeps desktop security defaults (Host/origin checks, CSP, rate
limits), but a browser deployment is not a supported product tier.

## Community surfaces

TUI wrappers, third-party clients, editor integrations, and messaging bridges
are community-supported. They may use the host API and MCP server, but they are
not maintained as part of the product and may lag behind host changes. If a
community surface grows a durable user base, propose promotion through an ADR.

## Why tiering matters

- **Focus:** a single primary interface gets the onboarding, accessibility, and
  release testing budget.
- **Honesty:** users can tell which surface is covered by the stability promise.
- **Shared core:** every tier still gets the same verified math, local memory,
  and audit trail. Tiering is about interface support, not about weakening the
  trust model.
