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
| Schema upgrades | An existing database is copied with `VACUUM INTO` to `memory.db.pre-v<from>-<timestamp>.bak` before migration; migration is refused if that copy fails |

## Before upgrading

1. Stop the assistant (Ctrl+C in the REPL or
   `docker compose -f docker/docker-compose.yml down`).
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

Portable install: check first, then let the updater or installer do the work:

```bash
zoveli update --check          # latest release vs. this runtime
zoveli update                  # downloads, verifies SHA-256, runs the installer
zoveli update --yes            # non-interactive (scripts/CI)

# Or download an installer/archive yourself:
install/install-zoveli-runtime.sh --check
install/install-zoveli-runtime.ps1 -Check
```

`zoveli update` follows GitHub release redirects manually and refuses anything
outside HTTPS GitHub hosts on port 443, including localhost and private network
addresses. It verifies the published SHA-256 before invoking the unified
installer. Release downloads include unsigned macOS `.dmg` and Windows `.exe`
installers; the portable `.tar.gz` archives remain the cross-platform fallback.
Gatekeeper and SmartScreen warnings are expected on first launch; follow the
[Sovereign Install Guide](../INSTALL_GUIDE.md).

Rerunning `install-zoveli-runtime.sh` or `install-zoveli-runtime.ps1` (with no
archive) upgrades to the latest release. Both installers report the installed
and target versions, prompt before an upgrade or downgrade, and keep
`--check`/`-Check` read-only. When an existing runtime is present, the
installer:

1. stages the new archive beside the install and runs its `--version` check
   before touching the current runtime;
2. runs `zoveli backup` and `zoveli verify` and aborts if either fails, leaving
   the verified backup under `~/.zoveli/backups`;
3. moves the existing runtime aside, swaps in the staged runtime, and verifies
   the installed launcher;
4. on any failure after the swap, removes the new runtime and restores the
   previous runtime automatically.

The vault and configuration under your home directory are untouched. Staging
directories are removed on both success and failure. Use `--skip-backup`
(POSIX) or `-SkipBackup` (PowerShell) only when you already have a verified
backup.

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
zoveli recovery-check    # backup/restore drill; real data untouched
```

Source checkout:

```bash
pnpm config:check        # environment drift; exit 1 only on blocking issues
pnpm migrate:vault       # explicit forward migration + report (also runs on open)
pnpm health:check        # runtime/config/vault/MCP/capability rollup
node apps/cli/dist/cli.js recovery-check   # same isolated backup/restore drill
```

The first open that needs a schema migration writes a consistent copy next to
the database (`memory.db.pre-v<from>-<timestamp>.bak`) before changing it. If
that copy cannot be written, the migration is refused and the database is left
alone. Keep those snapshots until `zoveli health` is green.

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

Failed installer upgrades roll back automatically. The manual rollback below
is for undoing a successful upgrade to an older release.

1. Stop the app.
2. Install the previous release archive with `--archive <previous.tar.gz>`.
   The installer keeps and verifies your current vault before replacing the
   runtime. Source checkouts can use `git checkout v<previous>` and rebuild.
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
