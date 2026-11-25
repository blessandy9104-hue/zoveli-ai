# @zoveli/intelligence-plugin

Optional Zoveli adapter for
[`@zoveli/intelligence`](https://github.com/blessandy9104-hue/zoveli-intelligence).

The plugin is **not** mounted by default. Enable it explicitly:

```bash
export ZOVELI_PLUGINS=zoveli-intelligence
export ZOVELI_INTEL_ROOTS="$HOME/notes,$HOME/projects/docs"
export ZOVELI_INTEL_DATA_DIR="$HOME/.zoveli/intelligence"
pnpm start
```

## What it mounts

- `assistant-intelligence-tools`: 16 tools (`intel_status`, `intel_ask`,
  `intel_docs_*`, `intel_market_interpret`, `intel_plan_create`,
  `intel_preferences_*`, `intel_audit_*`).
- `intelligence` service: `status()`, `verifyAudit()`, `governor()`.
- `agent/created` rules that tell the agent to cite grounded answers, disclose
  `unverified` results, treat market output as interpretation, and treat plans
  as proposals.

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `ZOVELI_INTEL_ROOTS` | process cwd | Comma-separated allowlisted document roots. |
| `ZOVELI_INTEL_DATA_DIR` | `~/.zoveli/intelligence` | Index, preferences, and audit-chain directory. |
| `ZOVELI_PLUGINS` | empty | Must include `zoveli-intelligence` to mount this plugin. |
| `ZOVELI_DISABLE_PLUGINS` | empty | Can disable the plugin without removing the package. |

Roots are resolved against the process cwd. Reads outside them are rejected by
the subsystem, including `..` escapes and symlinks. Point roots at notes and
documents, not at a whole home directory.

## Lazy startup

Mounting registers tool schemas and a service only. The governor — and its
on-disk store — is created on the first tool call or service access. A corrupt
store therefore cannot block host startup; it surfaces as a typed tool error.

## Dependency pinning

`package.json` pins the v0.1.1 release artifact vendored at
`vendor/zoveli-intelligence-0.1.1.tgz`:

```json
"@zoveli/intelligence": "file:../../vendor/zoveli-intelligence-0.1.1.tgz"
```

The tarball contains the built `dist/`, so installs need no build step and no
`allowBuilds` entry. v0.1.1 adds a `default` export condition so this
CommonJS-built adapter can load the ESM package on Node 22.16+. A `file:`
tarball also records `sha512` integrity in `pnpm-lock.yaml`; remote tarball
URLs currently lose their integrity field and break `--frozen-lockfile`
installs. See `vendor/README.md` for the update procedure.

## Tests

The workspace test lives at `tests/unit/intelligence-plugin.test.ts` and covers
configuration resolution, the 16-tool registration, lazy store creation,
grounded answers, the service surface, and agent rule injection.
