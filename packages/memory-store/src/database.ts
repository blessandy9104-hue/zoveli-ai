import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';

// node:sqlite is a runtime builtin (needs Node >=22.16 for FTS5).
// Loaded via process.getBuiltinModule so vite/vitest never sees a static
// `node:sqlite` specifier (Vite 5 strips it to `sqlite` and fails), and the
// same code works in tsc CJS output and tsdown ESM output. The string
// literal below is opaque to bundlers.
function loadDatabaseSync(): typeof import('node:sqlite')['DatabaseSync'] {
  const p = process as unknown as { getBuiltinModule?: (id: string) => { DatabaseSync: typeof import('node:sqlite')['DatabaseSync'] } };
  if (typeof p.getBuiltinModule === 'function') {
    return p.getBuiltinModule('node:sqlite').DatabaseSync;
  }
  const g = globalThis as unknown as { require?: (id: string) => { DatabaseSync: typeof import('node:sqlite')['DatabaseSync'] } };
  if (typeof g.require === 'function') {
    return g.require('node:sqlite').DatabaseSync;
  }
  throw new Error('node:sqlite unavailable (need Node >=22.16)');
}
const DatabaseSync = loadDatabaseSync();

/**
 * Current on-disk schema. Bump this and add a migration below whenever the
 * notes/tags/links layout changes. `PRAGMA user_version` records the applied
 * version; opening a newer database with an older binary is refused instead
 * of silently corrupting it.
 */
export const SCHEMA_VERSION = 1;

export interface Migration {
  version: number;
  description: string;
  up: (db: DatabaseSyncType) => void;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'baseline notes, tags, links schema',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS notes(
          title TEXT PRIMARY KEY,
          body TEXT NOT NULL DEFAULT '',
          created TEXT NOT NULL,
          updated TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS tags(
          note_title TEXT NOT NULL REFERENCES notes(title) ON DELETE CASCADE ON UPDATE CASCADE,
          tag TEXT NOT NULL,
          PRIMARY KEY(note_title, tag)
        );
        CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags(tag);
        CREATE TABLE IF NOT EXISTS links(
          from_title TEXT NOT NULL REFERENCES notes(title) ON DELETE CASCADE ON UPDATE CASCADE,
          to_title TEXT NOT NULL,
          PRIMARY KEY(from_title, to_title)
        );
        CREATE INDEX IF NOT EXISTS idx_links_to ON links(to_title);
      `);
    },
  },
];

/** Open a raw node:sqlite connection (used by maintenance code and tests). */
export function openDatabaseSync(dbPath: string, options?: { readOnly?: boolean }): DatabaseSyncType {
  const db = options ? new DatabaseSync(dbPath, options) : new DatabaseSync(dbPath);
  // A REPL, a CLI health check and a backup may touch the vault at once;
  // wait for the writer instead of failing immediately with SQLITE_BUSY.
  try {
    db.exec('PRAGMA busy_timeout = 5000;');
    // Touch the schema so a corrupt/truncated file fails here, not halfway
    // through boot. Callers can then show one actionable recovery message.
    db.prepare('PRAGMA schema_version').get();
  } catch (e) {
    try {
      db.close();
    } catch {
      // ignore close failure; surface the original open error
    }
    throw e;
  }
  return db;
}
