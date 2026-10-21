# Upgrading Zoveli

Zoveli upgrades in place: the vault migrates forward, configuration drift is
reported before it bites, and a newer vault is refused rather than corrupted.
This guide covers a safe upgrade and rollback.

## Compatibility contract

| Surface | Guarantee |
| --- | --- |
| Node.js | 22.16+ for source checkouts; bundled in prebuilt runtimes (the memory store needs `node:sqlite` FTS5) |
| Vault schema | Forward migrations only; a database written by a newer Zoveli is refused with "upgrade Zoveli" |
| Configuration | Unknown/removed env vars, typos and invalid values are reported by `pnpm config:check`; defaults keep working |
| Plugins | The `@deepseek-ai/dsh-core` shim keeps plugin APIs stable across point releases; plugin packages share the product version |
| Backups | Backups are checksum-verified and include the vault database, Markdown vault, auth state and audit log |

## Before upgrading

1. Stop the assistant (Ctrl+C in the REPL or `docker compose down`).
2. Back up and verify:
   ```bash
   zoveli backup                     # portable
   zoveli verify <backup-dir>
   # or: pnpm vault:backup && pnpm vault:verify <backup-dir>
   ```
3. Record the current health baseline:
   ```bash
   zoveli health --json > health-before.json   # portable
   # or: pnpm health:check -- --json > health-before.json
   ```

## Upgrade

Portable install: stop Zoveli, back up with `zoveli backup`, copy the current
install directory somewhere safe, then rerun `install-zoveli-runtime.sh` or
`install-zoveli-runtime.ps1`. The installer replaces only the runtime; the
vault and configuration under your home directory are untouched.

Source checkout:

```bash
git pull --ff-only
pnpm install --frozen-lockfile
pnpm run build
```

If you use the vendor mathcore backend, refresh it in the same venv:

```bash
python -m pip install -e ./mathcore
```

Then validate before using the vault.

Portable install:

```bash
zoveli config-check      # environment drift; exit 1 only on blocking issues
zoveli migrate           # explicit forward migration + report (also runs on open)
zoveli health            # runtime/config/vault/MCP/capability rollup
```

Source checkout:

```bash
pnpm config:check        # environment drift; exit 1 only on blocking issues
pnpm migrate:vault       # explicit forward migration + report (also runs on open)
pnpm health:check        # runtime/config/vault/MCP/capability rollup
```

Open the app and confirm `/health` is `ok` (or `degraded` only for an optional
dependency such as mathcore) and `/trace` shows normal tool calls.

### If the vault is newer than the binary

The app refuses to open it. Do not delete `memory.db`. Either install the
newer Zoveli version that wrote it, or restore the backup taken before the
downgrade:

```bash
zoveli restore <backup-dir> --force   # portable
pnpm vault:restore <backup-dir> --force   # source
```

### If configuration drifted

`zoveli config-check` (portable) or `pnpm config:check` (source) names the
variable and suggests the intended one. Update
your shell profile, `.env`, or Docker Compose file, then re-run it. Nothing is
rewritten automatically.

## Rollback

1. Stop the app.
2. Restore the copied runtime directory, or install the previous release
   archive with `--archive <previous.tar.gz>`. Source checkouts can use
   `git checkout v<previous>` and rebuild.
3. Restore the pre-upgrade backup if the older binary cannot read the migrated
   vault:
   ```bash
   zoveli restore <backup-dir> --force   # portable
   pnpm vault:restore <backup-dir> --force   # source
   ```
4. Run `zoveli health` (portable) or `pnpm health:check --offline` (source) and
   confirm the baseline matches `health-before.json`.

## Release verification (maintainers)

Before tagging, run the release guard:

```bash
pnpm release:check --release
```

It requires matching versions across the workspace, a `CHANGELOG.md` entry for
the current version, a matching `ZOVELI_VERSION`, a clean tree and (in CI) a
`v<version>` tag on HEAD. See `docs/runbooks/release.md`.
