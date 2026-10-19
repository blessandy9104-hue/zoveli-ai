# Runbook: backup & restore your Zoveli data

Everything Zoveli remembers lives in four places on your machine. Copy
them while the server is stopped and you can survive any disk failure.

## What to back up

| Data | Default path | Override env |
|------|--------------|--------------|
| Memory database | `~/.zoveli/memory.db` (plus `-wal`/`-shm`/`-journal` sidecars — copy the whole set) | `ZOVELI_MEMORY_DB` |
| Vault mirror (Markdown export) | `./knowledge-vault` (next to your clone) | `ZOVELI_VAULT_PATH` |
| Auth sessions + OTP state | `~/.zoveli/auth.json`, `~/.zoveli/.session-secret` | `ZOVELI_AUTH_DIR` |
| Math audit log | `~/.mathcore/audit.jsonl` | `MATHCORE_AUDIT` |

(`~` is `%USERPROFILE%` on Windows, `$HOME` on macOS/Linux.)

## Backup

```bash
# 1. Stop the server (Ctrl-C) so SQLite checkpoints cleanly.
# 2. Copy (example: macOS/Linux; robocopy/xcopy on Windows):
cp ~/.zoveli/memory.db* ~/zoveli-backup/
cp -r ./knowledge-vault ~/zoveli-backup/
cp ~/.zoveli/auth.json ~/.zoveli/.session-secret ~/zoveli-backup/
cp ~/.mathcore/audit.jsonl ~/zoveli-backup/
```

## Restore

```bash
# 1. Stop the server.
# 2. Copy the files back to the paths above (honor the env overrides
#    if you use them).
# 3. Start the server and verify:
curl http://127.0.0.1:3080/health   # {"ok":true,"tools":61}
```

## Notes

- The database and vault mirror each other, but back up **both**: the
  DB is the source of truth, the vault is the human-readable copy.
- `auth.json` + `.session-secret` are secrets — store the backup where
  you store passwords, never in git.
- `audit.jsonl` is append-only and hash-chained; `mathcore verify-log`
  detects edits after restore.
