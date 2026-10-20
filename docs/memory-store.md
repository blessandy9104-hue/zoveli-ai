# Memory store (one subsystem)

Zoveli's memory is a single SQLite subsystem. The Markdown vault is an
export mirror for humans/Obsidian/git — never the source of truth.

```
Markdown vault     knowledge-vault/           human-readable export mirror
                        (import once when DB is empty, export on every write)
                             |
SQLite (node:sqlite) ~/.zoveli/memory.db      notes / tags / links + FTS5
  zero-dep builtin, WAL, single file          ZOVELI_MEMORY_DB overrides path
                             |
TS store             @zoveli/memory-store     MemoryStore (sync) + getStore()
  single source: DB path, vault path,         no `node:sqlite` static import
  FTS query builder, markdown codec           (process.getBuiltinModule, vite-safe)
                             |
TS tools             memory_create_note       memory_* registered by
                     memory_search            @zoveli/memory-store;
                     memory_read_note         @zoveli/core and
                     memory_list_tags         @zoveli/memory delegate.
                     memory_update_note       vault_search is owned by
                     memory_delete_note       @zoveli/search and vault_graph
                     vault_search             by @zoveli/graph (honors
                     vault_graph              vaultPath).
                             |
Callers              CLI /tools, web /api/tools, agent loop, REPL
```

## Schema (do not duplicate — lives in `packages/memory-store/src/store.ts`)

- `notes(title TEXT PK, body TEXT, created TEXT, updated TEXT)` + implicit `rowid`
- `notes_fts(title, body)` with `tokenize='porter'`; `rowid` mapped manually
  (insert/update/delete keep FTS in sync; LIKE fallback when FTS missing)
- `tags(note_title, tag)` + `idx_tags_tag`; `links(from_title, to_title)` +
  `idx_links_to` (`to_title` dangling by design, like `[[missing]]`)
- `PRAGMA user_version = 1` (schema version). Migrations live in `MIGRATIONS`
  and run inside one transaction on open; a database from a newer schema is
  refused instead of being silently downgraded.

## Environment

`ZOVELI_MEMORY_DB` (default `~/.zoveli/memory.db`, `:memory:` in tests),
`ZOVELI_VAULT_PATH` (default `./knowledge-vault`),
`ZOVELI_MEMORY_EXPORT=0` disables the Markdown mirror.
Engines: Node `>=22.16.0` (FTS5 guarantee; verified on 24.21 / SQLite 3.53.4).

## Tool ownership

The host dedupes tools by name with first registration winning, so plugins
must not register the same name with *different behavior*. `memory_*` tools
are registered here (and mirrored by `@zoveli/core` as identical
delegates), `vault_search` in `@zoveli/search`, and `vault_graph` in
`@zoveli/graph`. This package deliberately does not register `vault_graph`:
it would shadow the graph plugin's `vaultPath`-aware implementation.

## Guarantees

- **ACID + ranked search:** one writer (WAL), FTS5 `bm25` ranking, tag filter,
  `LIMIT/OFFSET` pagination; empty query returns nothing (no full dump).
- **CRUD complete:** old vault had no update/delete; now `memory_update_note`
  (incl. rename + link remap) and `memory_delete_note` (removes export too).
- **Graph from SQL:** nodes/edges/orphans/hubs via queries, `DOT` export —
  no per-call file walk; `vault_graph` accepts the vault path it should read.
- **Obsidian interop kept:** every write exports frontmatter Markdown;
  first boot with an empty DB imports existing `*.md` (migration).
- **Schema evolution is explicit:** `PRAGMA user_version` tracks the schema;
  migrations are transactional and future databases are rejected.

## Backup, verify, restore

`@zoveli/memory-store/maintenance` (also exposed as CLI subcommands) uses
SQLite `VACUUM INTO` for the database, so a backup is consistent even while
Zoveli is running. A manifest records the schema version, note count, source
paths and a SHA-256 checksum for every file.

```bash
pnpm vault:backup -- --out ./backups/2026-10-19
pnpm vault:verify -- ./backups/2026-10-19
pnpm vault:restore -- ./backups/2026-10-19 --force   # stop Zoveli first
pnpm migrate:vault -- --db ./memory.db --vault ./knowledge-vault
```

- Backup includes `memory.db`, the Markdown mirror, `auth.json` +
  `.session-secret`, and `audit.jsonl` when present. Default target is
  `~/.zoveli/backups/zoveli-<UTC timestamp>`; `--out` must be empty and
  outside the vault.
- `verify` checks checksums, sizes, SQLite `integrity_check`,
  `foreign_key_check`, the note count and schema compatibility. It never
  modifies the backup.
- `restore` refuses to overwrite existing database/vault/auth/audit files
  without `--force`, removes stale `-wal`/`-shm`/`-journal` sidecars before
  copying the database, and verifies the backup first.
- `migrate:vault` imports legacy Markdown (honoring frontmatter
  `created`/`updated` and extracting `[[links]]`), skips titles that already
  exist, and reports per-file failures. Run it against a fresh `--db` to
  rebuild a damaged store without touching the vault.

## Tests

- `tests/unit/memory-store.test.ts` — CRUD, ranked+tag search, graph/dot,
  tags sorted, tool-name contract + delegation. Regression: `vault_graph`
  resolves to `graph-tools` and reads the requested `vaultPath`, not the
  default vault.
- `tests/unit/vault-maintenance.test.ts` — schema version + future-DB
  refusal, WAL-safe backup manifest/checksums, tamper detection, restore
  force/refusal + sidecar removal, legacy import with timestamps/links and
  idempotency.
- E2E: `/tools` lists `vault_graph`; host smoke: create→search→graph→
  update→read→delete + legacy `.md` import.
