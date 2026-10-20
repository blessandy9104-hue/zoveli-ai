# Runbook: Memory Store Corruption / Lost Notes

Source of truth is SQLite (`~/.zoveli/memory.db`, or `ZOVELI_MEMORY_DB`);
`knowledge-vault/` is an export mirror, not the data.

## Symptoms
- `memory_read_note` fails on known notes
- `vault_search` returns 0 results for existing content
- Graph shows sudden orphan spike
- `vault:verify` (or a startup error) reports a schema/integrity problem

## Diagnosis
1. Is the DB present and writable? `ls -la ~/.zoveli/memory.db` (or `$ZOVELI_MEMORY_DB`).
2. Is the process using the DB you think? Check `ZOVELI_MEMORY_DB` and `ZOVELI_VAULT_PATH` env.
3. Check disk: `df -h`; check permissions on the DB file and vault dir.
4. Compare with the mirror: `ls knowledge-vault/*.md | head` — files present?
5. Verify the backup you intend to use **before** restoring:
   `pnpm vault:verify -- <backup-dir>` (checksums, `integrity_check`,
   foreign keys, note count, schema compatibility).

## Resolution
```bash
# 1. Stop writers (CLI/Web/Desktop)
# 2a. Restore from a verified backup (preferred):
pnpm vault:restore -- <backup-dir> --force
# 2b. No usable backup? Rebuild into a FRESH database from the Markdown mirror:
pnpm migrate:vault -- --db ./recovery.db --vault ./knowledge-vault
# 3. With Zoveli stopped, replace ~/.zoveli/memory.db with recovery.db
#    (keep the corrupt file as memory.db.corrupt for inspection).
# 4. Start and verify:
pnpm start
# /tools -> memory_list_tags, vault_search for a known term
```

`migrate:vault` never overwrites an existing title: it imports notes that are
missing from the target DB, honors frontmatter `created`/`updated`, and
reports per-file failures. Running it against the live DB is a safe way to
re-import Markdown that was written outside Zoveli.

If the database refuses to open because it is from a **newer** schema
(`... newer than supported ...`), install the newer Zoveli build; do not edit
`PRAGMA user_version`.

## Prevention
- Run `pnpm vault:backup` on a schedule you trust; keep copies off the machine.
- Run `pnpm vault:verify -- <backup-dir>` after copying backups.
- Keep `knowledge-vault/` export mirror in git (recovery source of last resort).
- Stop Zoveli before restoring; never copy over an open database.
