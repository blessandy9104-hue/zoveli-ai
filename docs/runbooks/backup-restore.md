# Runbook: backup & restore your Zoveli data

Everything Zoveli remembers lives in four places on your machine. The
built-in backup collects all of them into one verified directory.

## What to back up

| Data | Default path | Override env |
|------|--------------|--------------|
| Memory database | `~/.zoveli/memory.db` (plus `-wal`/`-shm`/`-journal` sidecars) | `ZOVELI_MEMORY_DB` |
| Vault mirror (Markdown export) | `~/.zoveli/knowledge-vault` (portable) or `./knowledge-vault` (source checkout) | `ZOVELI_VAULT_PATH` |
| Auth sessions + OTP state | `~/.zoveli/auth.json`, `~/.zoveli/.session-secret` | `ZOVELI_AUTH_DIR` |
| Math audit log | `~/.mathcore/audit.jsonl` | `MATHCORE_AUDIT` |

(`~` is `%USERPROFILE%` on Windows, `$HOME` on macOS/Linux.)

## Backup

```bash
# Portable install:
zoveli backup

# Source checkout:
pnpm vault:backup

# Or choose an empty directory outside the vault:
zoveli backup --out ./backups/2026-10-19
# pnpm vault:backup -- --out ./backups/2026-10-19
```

The database is copied with SQLite `VACUUM INTO`, so the backup is consistent
even while Zoveli is running; there is no need to stop it for a backup. The
vault, `auth.json` + `.session-secret`, and `audit.jsonl` are copied when
present. `manifest.json` records the schema version, note count, source paths
and a SHA-256 checksum per file.

Path overrides: `--db`, `--vault`, `--auth-dir`, `--audit`. A backup directory
must be empty and must not live inside the vault.

Schema migrations make their own database-only snapshot next to the live file,
named `memory.db.pre-v<from>-<timestamp>.bak`. This is separate from the
full backup above and is created automatically before an existing database is
migrated; the migration is refused if the snapshot fails.

## Verify

```bash
zoveli verify ./backups/2026-10-19          # portable
pnpm vault:verify -- ./backups/2026-10-19   # source
```

Verification checks file sizes/checksums, SQLite `integrity_check` and
`foreign_key_check`, the note count against the manifest, and whether the
backup schema is newer than this build supports. It never modifies the
backup. Run it after copying a backup to another disk or machine.

## Restore

```bash
# 1. Stop the server (Ctrl-C) — never replace an open database.
# 2. Restore (refuses to overwrite existing data without --force):
pnpm vault:restore -- ./backups/2026-10-19 --force
# 3. Start and verify:
pnpm start
curl http://127.0.0.1:3080/health   # {"ok":true,"tools":<n>}
```

`--force` overwrites the current database, vault mirror, auth state and audit
log with the backup contents. If you are unsure, take a fresh backup first.
Restore removes stale `-wal`/`-shm`/`-journal` sidecars before copying the
database. The backup is verified before anything is written.

Use the same `--db`/`--vault`/`--auth-dir`/`--audit` overrides at restore
time to put the data back where Zoveli will look for it.

## Restore drill

Prove the local backup/restore path works without touching live data:

```bash
zoveli recovery-check
zoveli recovery-check --json    # machine-readable for scripts
```

The drill creates a synthetic note, auth state and audit file in an isolated
temporary directory, backs them up, verifies checksums and SQLite integrity,
restores into a second temporary directory, reads the note back, and cleans
up. Your real vault, auth state and audit log are never read or written, so it
is safe while Zoveli is running. Exit code 1 means the backup/restore path is
broken and should be reported with the output. `--keep` retains the temporary
directory for inspection.

To drill a real backup, restore it into a temporary directory:

```bash
tmp=$(mktemp -d)
zoveli restore ./backups/2026-10-19 \
  --db "$tmp/memory.db" --vault "$tmp/vault" \
  --auth-dir "$tmp/auth" --audit "$tmp/audit.jsonl"
find "$tmp" -maxdepth 2 -type f
rm -rf "$tmp"
```

The restore verifies the backup before writing. If it reports a schema that is
newer than the binary, install the newer Zoveli version instead of deleting
anything. On Windows, use `$env:TEMP` with `zoveli.cmd` and the same flags.

## Manual fallback

If the CLI is unavailable and the server is **stopped**:

```bash
# macOS/Linux (robocopy/xcopy on Windows):
cp ~/.zoveli/memory.db* ./zoveli-backup/
cp -r ./knowledge-vault ./zoveli-backup/
cp ~/.zoveli/auth.json ~/.zoveli/.session-secret ./zoveli-backup/
cp ~/.mathcore/audit.jsonl ./zoveli-backup/
```

Copy `memory.db` together with all sidecars when using this method, or prefer
the built-in backup above.

## Notes

- The database and vault mirror each other, but back up **both**: the
  DB is the source of truth, the vault is the human-readable copy.
- `auth.json` + `.session-secret` are secrets — store the backup where
  you store passwords, never in git.
- `audit.jsonl` is append-only and hash-chained; `mathcore verify-log`
  detects edits after restore.
- Backups are not encrypted by Zoveli; encrypt the directory or its
  destination if it leaves your machine.
