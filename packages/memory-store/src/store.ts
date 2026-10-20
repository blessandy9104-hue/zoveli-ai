import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

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

interface Migration {
  version: number;
  description: string;
  up: (db: DatabaseSyncType) => void;
}

const MIGRATIONS: Migration[] = [
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

export interface CreateNoteInput {
  title: string;
  content: string;
  tags?: string[];
  links?: string[];
}

export interface UpdateNoteInput {
  title: string;
  newTitle?: string;
  content?: string;
  tags?: string[];
  links?: string[];
}

export interface SearchInput {
  query: string;
  tags?: string[];
  limit?: number;
  offset?: number;
  highlight?: boolean;
}

export interface NoteRow {
  title: string;
  body: string;
  created: string;
  updated: string;
  tags: string[];
  links: string[];
}

export interface SearchHit {
  id: string;
  title: string;
  path: string;
  content: string;
  tags: string[];
  links: string[];
  score: number;
  highlights: string[];
}

export interface GraphResult {
  nodes: { id: string; title: string; tags: string[] }[];
  edges: { from: string; to: string }[];
  orphans: string[];
  hubs: { id: string; degree: number }[];
}

export interface ImportReport {
  scanned: number;
  imported: number;
  skippedExisting: number;
  failed: { file: string; error: string }[];
}

export interface IntegrityReport {
  ok: boolean;
  schemaVersion: number;
  notes: number;
  ftsAvailable: boolean;
  ftsRows: number | null;
  errors: string[];
  warnings: string[];
}

export interface MemoryStoreOptions {
  /** Set false when the caller wants an explicit, reported import. */
  importVault?: boolean;
}

export function resolveDbPath(): string {
  if (process.env.ZOVELI_MEMORY_DB) return process.env.ZOVELI_MEMORY_DB;
  return path.join(os.homedir(), '.zoveli', 'memory.db');
}

export function resolveVaultPath(): string {
  return process.env.ZOVELI_VAULT_PATH || path.join(process.cwd(), 'knowledge-vault');
}

export function exportEnabled(): boolean {
  return process.env.ZOVELI_MEMORY_EXPORT !== '0';
}

export function sanitizeFilename(str: string): string {
  return str.replace(/[<>:"/\\|?*]/g, '_').trim();
}

function normalizeTags(tags: string[] = []): string[] {
  const out = new Set<string>();
  for (const t of tags) {
    const v = String(t).trim().replace(/^#+/, '');
    if (v) out.add(v);
  }
  return [...out];
}

function extractWikiLinks(body: string): string[] {
  const re = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const t = m[1].trim();
    if (t) out.add(t);
  }
  return [...out];
}

function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9_#@+-]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length > 1);
}

function toFtsQuery(query: string): string | null {
  const terms = tokenizeQuery(query);
  if (terms.length === 0) return null;
  // Prefix search per term, OR-joined. Escape double quotes for FTS5.
  return terms.map((t) => `"${t.replace(/"/g, '""')}"*`).join(' OR ');
}

function sentenceHighlights(body: string, query: string, max = 3): string[] {
  const terms = tokenizeQuery(query);
  if (terms.length === 0) return [];
  return body
    .split(/[.!?\n]+/)
    .filter((s) => {
      const low = s.toLowerCase();
      return terms.some((t) => low.includes(t));
    })
    .slice(0, max)
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseTimestamp(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const clean = value.trim().replace(/^["']|["']$/g, '');
  return Number.isNaN(Date.parse(clean)) ? undefined : clean;
}

function parseMarkdownFile(
  content: string,
  fallbackTitle: string
): { title: string; body: string; tags: string[]; created?: string; updated?: string } {
  const fm = content.match(/^---\n([\s\S]*?)\n---/);
  let title = fallbackTitle;
  let tags: string[] = [];
  let created: string | undefined;
  let updated: string | undefined;
  let body = content;
  if (fm) {
    const yaml = fm[1];
    const titleMatch = yaml.match(/title:\s*"([^"]+)"/) || yaml.match(/title:\s*(.+)/);
    if (titleMatch) title = titleMatch[1].trim().replace(/"/g, '');
    const tagsMatch = yaml.match(/tags:\s*\[([^\]]*)\]/);
    if (tagsMatch && tagsMatch[1].trim()) {
      tags = tagsMatch[1]
        .split(',')
        .map((t) => t.trim().replace(/"/g, '').replace(/^#+/, ''))
        .filter(Boolean);
    }
    created = parseTimestamp(yaml.match(/^created:\s*(.+)$/m)?.[1]);
    updated = parseTimestamp(yaml.match(/^updated:\s*(.+)$/m)?.[1]);
    body = content.slice(fm[0].length).trim();
  } else {
    const h1 = content.match(/^#\s+(.+)$/m);
    if (h1) title = h1[1].trim();
  }
  // Collect #hashtags in body as well (graph parity).
  const hashTags = [...body.matchAll(/#([\w-]+)/g)].map((m) => m[1]).slice(0, 20);
  const merged = [...new Set([...tags, ...hashTags])];
  return { title, body, tags: merged, created, updated };
}

function toMarkdownFile(
  title: string,
  body: string,
  tags: string[],
  links: string[],
  created: string,
  updated: string
): string {
  const frontmatter = [
    '---',
    `title: "${title.replace(/"/g, "'")}"`,
    `created: ${created}`,
    `updated: ${updated}`,
    `schema: ${SCHEMA_VERSION}`,
    `tags: [${tags.map((t) => `"${t}"`).join(', ')}]`,
    '---',
    '',
  ].join('\n');
  const linkSection = links.length > 0 ? '\n## Links\n' + links.map((l) => `- [[${l}]]`).join('\n') : '';
  return frontmatter + body + linkSection;
}

/**
 * SQLite-backed memory store. Single file, synchronous (node:sqlite),
 * FTS5 with LIKE fallback. Markdown vault is an export mirror, not truth.
 */
export class MemoryStore {
  private db: DatabaseSyncType;
  private ftsAvailable: boolean;
  readonly dbPath: string;
  readonly vaultPath: string;

  constructor(
    dbPath = resolveDbPath(),
    vaultPath = resolveVaultPath(),
    options: MemoryStoreOptions = {}
  ) {
    this.dbPath = dbPath;
    this.vaultPath = vaultPath;
    if (dbPath !== ':memory:') {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    try {
      this.db = openDatabaseSync(dbPath);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      throw new Error(
        `cannot open memory database at ${dbPath}: ${detail}. ` +
          `If another Zoveli process is writing, close it and retry. ` +
          `If the file is corrupt, restore a backup (zoveli restore --help) ` +
          `or move it aside to start fresh.`
      );
    }
    // Owner-only DB file: memory holds personal notes and proof history.
    // Best-effort (no-op on Windows ACLs, harmless if it fails).
    if (dbPath !== ':memory:') {
      try {
        fs.chmodSync(dbPath, 0o600);
      } catch {
        // ignore
      }
    }
    this.db.exec('PRAGMA journal_mode=WAL;');
    this.db.exec('PRAGMA foreign_keys=ON;');
    try {
      this.runMigrations();
    } catch (e) {
      try {
        this.db.close();
      } catch {
        // ignore close failure; surface the migration error
      }
      throw e;
    }
    this.ftsAvailable = this.detectFts();
    if (!this.ftsAvailable) {
      // Recreate FTS as plain table? No — just use LIKE fallback at query time.
    }
    if (options.importVault !== false) this.maybeImportVault();
  }

  private runMigrations(): void {
    const row = this.db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined;
    let current = Number(row?.user_version ?? 0);
    if (current > SCHEMA_VERSION) {
      throw new Error(
        `memory database schema v${current} is newer than supported v${SCHEMA_VERSION}; upgrade Zoveli`
      );
    }
    for (const migration of MIGRATIONS) {
      if (migration.version <= current) continue;
      this.db.exec('BEGIN IMMEDIATE');
      try {
        migration.up(this.db);
        this.db.exec(`PRAGMA user_version = ${migration.version}`);
        this.db.exec('COMMIT');
        current = migration.version;
      } catch (e) {
        try {
          this.db.exec('ROLLBACK');
        } catch {
          // ignore rollback failure; surface the original error
        }
        throw e;
      }
    }
  }

  schemaVersion(): number {
    const row = this.db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined;
    return Number(row?.user_version ?? 0);
  }

  private detectFts(): boolean {
    try {
      this.db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(title, body, tokenize='porter');`);
      return true;
    } catch {
      return false;
    }
  }

  private maybeImportVault(): void {
    try {
      const count = (this.db.prepare('SELECT COUNT(*) AS c FROM notes').get() as { c: number }).c;
      if (count > 0) return;
      const files = this.findMarkdownFiles(this.vaultPath);
      if (files.length === 0) return;
      // Seed without re-exporting (files already exist). Best-effort on boot;
      // `migrate` uses importMarkdownFiles directly for a full report.
      this.importMarkdownFiles(this.vaultPath);
    } catch {
      // Import is best-effort; DB remains usable.
    }
  }

  /**
   * Import Markdown files from a legacy vault into SQLite. Existing titles
   * are skipped (never overwritten). Timestamps come from frontmatter when
   * present, otherwise from the file mtime.
   */
  importMarkdownFiles(dir: string): ImportReport {
    const files = this.findMarkdownFiles(dir);
    const report: ImportReport = { scanned: files.length, imported: 0, skippedExisting: 0, failed: [] };
    for (const file of files) {
      try {
        const raw = fs.readFileSync(file, 'utf-8');
        const parsed = parseMarkdownFile(raw, path.basename(file, '.md'));
        const title = parsed.title.trim();
        if (!title) throw new Error('empty note title');
        const existing = this.db.prepare('SELECT title FROM notes WHERE title = ?').get(title) as
          | { title: string }
          | undefined;
        if (existing) {
          report.skippedExisting += 1;
          continue;
        }
        const stat = fs.statSync(file);
        const created = parsed.created ?? stat.mtime.toISOString();
        const updated = parsed.updated ?? created;
        const links = extractWikiLinks(raw);
        this.insertNoteRow(title, parsed.body, parsed.tags, links, false, { created, updated });
        report.imported += 1;
      } catch (e) {
        report.failed.push({
          file,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    return report;
  }

  /** Run SQLite integrity checks and compare the FTS index with the notes table. */
  checkIntegrity(): IntegrityReport {
    const errors: string[] = [];
    const warnings: string[] = [];
    let notes = 0;
    try {
      notes = this.count();
    } catch (e) {
      errors.push(`notes count failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    try {
      const rows = this.db.prepare('PRAGMA integrity_check').all() as { integrity_check: string }[];
      for (const row of rows) {
        if (row.integrity_check !== 'ok') errors.push(`integrity_check: ${row.integrity_check}`);
      }
    } catch (e) {
      errors.push(`integrity_check failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    try {
      const rows = this.db.prepare('PRAGMA foreign_key_check').all() as unknown[];
      if (rows.length > 0) errors.push(`${rows.length} foreign key violation(s)`);
    } catch (e) {
      errors.push(`foreign_key_check failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    let ftsRows: number | null = null;
    if (this.ftsAvailable) {
      try {
        ftsRows = (this.db.prepare('SELECT COUNT(*) AS c FROM notes_fts').get() as { c: number }).c;
        if (ftsRows !== notes) {
          warnings.push(`FTS index has ${ftsRows} row(s) but notes has ${notes}`);
        }
      } catch (e) {
        warnings.push(`FTS check failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return {
      ok: errors.length === 0,
      schemaVersion: this.schemaVersion(),
      notes,
      ftsAvailable: this.ftsAvailable,
      ftsRows,
      errors,
      warnings,
    };
  }

  private findMarkdownFiles(dir: string): string[] {
    const out: string[] = [];
    const walk = (d: string) => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.name.startsWith('.')) continue;
        const full = path.join(d, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.isFile() && e.name.endsWith('.md')) out.push(full);
      }
    };
    walk(dir);
    return out;
  }

  private exportNote(title: string, body: string, tags: string[], links: string[]): void {
    if (!exportEnabled()) return;
    if (this.dbPath === ':memory:') return;
    try {
      const row = this.db
        .prepare('SELECT created, updated FROM notes WHERE title = ?')
        .get(title) as { created: string; updated: string } | undefined;
      if (!row) return;
      fs.mkdirSync(this.vaultPath, { recursive: true });
      const file = path.join(this.vaultPath, sanitizeFilename(title) + '.md');
      fs.writeFileSync(file, toMarkdownFile(title, body, tags, links, row.created, row.updated), 'utf-8');
    } catch {
      // Export is best-effort.
    }
  }

  private removeExport(title: string): void {
    if (!exportEnabled()) return;
    if (this.dbPath === ':memory:') return;
    try {
      const file = path.join(this.vaultPath, sanitizeFilename(title) + '.md');
      fs.rmSync(file, { force: true });
    } catch {
      // ignore
    }
  }

  private getRowId(title: string): number | null {
    try {
      const row = this.db.prepare('SELECT rowid AS id FROM notes WHERE title = ?').get(title) as { id: number } | undefined;
      return row ? row.id : null;
    } catch {
      return null;
    }
  }

  private insertNoteRow(
    title: string,
    body: string,
    tags: string[],
    links: string[],
    doExport = true,
    timestamps?: { created?: string; updated?: string }
  ): void {
    const now = new Date().toISOString();
    const created = timestamps?.created ?? now;
    const updated = timestamps?.updated ?? created;
    const cleanTags = normalizeTags(tags);
    const wiki = extractWikiLinks(body);
    const allLinks = [...new Set([...(links || []).map(String).map((s) => s.trim()).filter(Boolean), ...wiki])];
    // Single transaction: one round trip instead of 1 + N_tags + N_links.
    // Export stays outside the txn (best-effort file write, never rolls back DB).
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const info = this.db.prepare('INSERT INTO notes(title, body, created, updated) VALUES(?, ?, ?, ?)').run(title, body, created, updated) as unknown as { lastInsertRowid: number | bigint };
      if (this.ftsAvailable && info && info.lastInsertRowid !== undefined) {
        this.db.prepare('INSERT INTO notes_fts(rowid, title, body) VALUES(?, ?, ?)').run(Number(info.lastInsertRowid), title, body);
      }
      for (const t of cleanTags) {
        this.db.prepare('INSERT OR IGNORE INTO tags(note_title, tag) VALUES(?, ?)').run(title, t);
      }
      for (const l of allLinks) {
        this.db.prepare('INSERT OR IGNORE INTO links(from_title, to_title) VALUES(?, ?)').run(title, l);
      }
      this.db.exec('COMMIT');
    } catch (e) {
      try { this.db.exec('ROLLBACK'); } catch { /* ignore */ }
      throw e;
    }
    if (doExport) this.exportNote(title, body, cleanTags, allLinks);
  }

  createNote(input: CreateNoteInput): { success: boolean; title: string } {
    const title = String(input.title || '').trim();
    if (!title) throw new Error('title is required');
    const body = String(input.content ?? '');
    const existing = this.db.prepare('SELECT title FROM notes WHERE title = ?').get(title) as { title: string } | undefined;
    if (existing) throw new Error(`note already exists: ${title}`);
    this.insertNoteRow(title, body, input.tags || [], input.links || [], true);
    return { success: true, title };
  }

  readNote(title: string): NoteRow {
    const name = String(title || '').trim();
    // Single round trip: note + tags + links via GROUP_CONCAT subselects
    // (unit separator avoids comma collisions in tag/link names).
    const fetch = (key: string) => this.db.prepare(
      `SELECT title, body, created, updated,
        (SELECT GROUP_CONCAT(tag, CHAR(31)) FROM tags WHERE note_title = notes.title) AS tags,
        (SELECT GROUP_CONCAT(to_title, CHAR(31)) FROM links WHERE from_title = notes.title) AS links
       FROM notes WHERE title = ?`
    ).get(key) as { title: string; body: string; created: string; updated: string; tags: string | null; links: string | null } | undefined;
    let row = fetch(name);
    if (!row && name.endsWith('.md')) {
      row = fetch(path.basename(name, '.md'));
    }
    if (!row) throw new Error(`note not found: ${title}`);
    return {
      ...row,
      tags: row.tags ? row.tags.split('\u001f').sort() : [],
      links: row.links ? row.links.split('\u001f').sort() : [],
    };
  }

  updateNote(input: UpdateNoteInput): { success: boolean; title: string } {
    const title = String(input.title || '').trim();
    if (!title) throw new Error('title is required');
    const current = this.db.prepare('SELECT title, body FROM notes WHERE title = ?').get(title) as { title: string; body: string } | undefined;
    if (!current) throw new Error(`note not found: ${title}`);
    const newTitle = (input.newTitle || title).trim() || title;
    const body = input.content !== undefined ? String(input.content) : current.body;
    const now = new Date().toISOString();

    if (newTitle !== title) {
      const clash = this.db.prepare('SELECT title FROM notes WHERE title = ?').get(newTitle) as { title: string } | undefined;
      if (clash) throw new Error(`note already exists: ${newTitle}`);
    }

    const tags = input.tags !== undefined ? normalizeTags(input.tags) : null;
    let links: string[] | null = null;
    if (input.links !== undefined) {
      const wiki = extractWikiLinks(body);
      links = [...new Set([...input.links.map(String).map((s) => s.trim()).filter(Boolean), ...wiki])];
    } else if (input.content !== undefined) {
      // Body changed: merge stored explicit links with newly extracted wiki links.
      const stored = (this.db.prepare('SELECT to_title AS t FROM links WHERE from_title = ?').all(title) as { t: string }[]).map((r) => r.t);
      const wiki = extractWikiLinks(body);
      links = [...new Set([...stored, ...wiki])];
    }

    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('UPDATE notes SET title = ?, body = ?, updated = ? WHERE title = ?').run(newTitle, body, now, title);
      if (newTitle !== title) {
        // ON UPDATE CASCADE handles tags.from/link.from; to_title is dangling by design — remap manually.
        this.db.prepare('UPDATE links SET to_title = ? WHERE to_title = ?').run(newTitle, title);
        this.removeExport(title);
      }
      const rowid = this.getRowId(newTitle);
      if (this.ftsAvailable && rowid !== null) {
        this.db.prepare('UPDATE notes_fts SET title = ?, body = ? WHERE rowid = ?').run(newTitle, body, rowid);
      }
      if (tags !== null) {
        this.db.prepare('DELETE FROM tags WHERE note_title = ?').run(newTitle);
        for (const t of tags) this.db.prepare('INSERT OR IGNORE INTO tags(note_title, tag) VALUES(?, ?)').run(newTitle, t);
      }
      if (links !== null) {
        this.db.prepare('DELETE FROM links WHERE from_title = ?').run(newTitle);
        for (const l of links) this.db.prepare('INSERT OR IGNORE INTO links(from_title, to_title) VALUES(?, ?)').run(newTitle, l);
      }
      this.db.exec('COMMIT');
    } catch (e) {
      try { this.db.exec('ROLLBACK'); } catch { /* ignore */ }
      throw e;
    }
    const finalTags = tags !== null ? tags : (this.db.prepare('SELECT tag FROM tags WHERE note_title = ?').all(newTitle) as { tag: string }[]).map((r) => r.tag);
    const finalLinks = links !== null ? links : (this.db.prepare('SELECT to_title AS t FROM links WHERE from_title = ?').all(newTitle) as { t: string }[]).map((r) => r.t);
    this.exportNote(newTitle, body, finalTags, finalLinks);
    return { success: true, title: newTitle };
  }

  deleteNote(title: string): { success: boolean; title: string } {
    const name = String(title || '').trim();
    const row = this.db.prepare('SELECT title FROM notes WHERE title = ?').get(name) as { title: string } | undefined;
    const target = row ? row.title : name.endsWith('.md') ? path.basename(name, '.md') : null;
    if (!target) throw new Error(`note not found: ${title}`);
    const exists = this.db.prepare('SELECT title FROM notes WHERE title = ?').get(target) as { title: string } | undefined;
    if (!exists) throw new Error(`note not found: ${title}`);
    const rowid = this.getRowId(target);
    this.db.prepare('DELETE FROM notes WHERE title = ?').run(target);
    if (this.ftsAvailable && rowid !== null) {
      try {
        this.db.prepare('DELETE FROM notes_fts WHERE rowid = ?').run(rowid);
      } catch {
        // ignore
      }
    }
    this.removeExport(target);
    return { success: true, title: target };
  }

  searchNotes(input: SearchInput): { results: SearchHit[] } {
    const query = String(input.query || '');
    const tags = (input.tags || []).map(String).map((s) => s.trim()).filter(Boolean);
    const limit = Math.min(Math.max(input.limit ?? 10, 1), 100);
    const offset = Math.max(input.offset ?? 0, 0);
    const highlight = input.highlight !== false;

    const tagFilter = tags.length > 0 ? `AND n.title IN (SELECT note_title FROM tags WHERE tag IN (${tags.map(() => '?').join(', ')}))` : '';
    const tagParams: string[] = [...tags];

    const ftsQuery = toFtsQuery(query);
    let rows: { title: string; body: string; rank: number; tags: string | null; links: string | null }[] = [];

    if (this.ftsAvailable && ftsQuery) {
      try {
        const sql = `
          SELECT n.title AS title, n.body AS body, bm25(notes_fts) AS rank,
            (SELECT GROUP_CONCAT(tag, CHAR(31)) FROM tags WHERE note_title = n.title) AS tags,
            (SELECT GROUP_CONCAT(to_title, CHAR(31)) FROM links WHERE from_title = n.title) AS links
          FROM notes_fts JOIN notes n ON n.rowid = notes_fts.rowid
          WHERE notes_fts MATCH ? ${tagFilter}
          ORDER BY rank LIMIT ? OFFSET ?`;
        rows = this.db.prepare(sql).all(ftsQuery, ...tagParams, limit, offset) as typeof rows;
      } catch {
        rows = [];
      }
    }

    if (rows.length === 0) {
      // LIKE fallback (also covers single-char queries and FTS-unavailable runtimes).
      const like = `%${query}%`;
      const sql = `
        SELECT n.title AS title, n.body AS body, 0 AS rank,
          (SELECT GROUP_CONCAT(tag, CHAR(31)) FROM tags WHERE note_title = n.title) AS tags,
          (SELECT GROUP_CONCAT(to_title, CHAR(31)) FROM links WHERE from_title = n.title) AS links FROM notes n
        WHERE (n.title LIKE ? OR n.body LIKE ?) ${tagFilter}
        ORDER BY n.updated DESC LIMIT ? OFFSET ?`;
      try {
        rows = this.db.prepare(sql).all(like, like, ...tagParams, limit, offset) as typeof rows;
      } catch {
        rows = [];
      }
      // Emulate old substring case-insensitivity already handled by LIKE (ASCII).
      // Filter empty query to nothing (preserve old searchNotes contract of slice, not full dump).
      if (!query.trim()) return { results: [] };
    }

    const results: SearchHit[] = rows.map((r) => {
      // Tags/links arrive pre-joined (unit separator); split + sort to match
      // the old per-row ORDER BY queries without the N+1 round trips.
      const tags = r.tags ? (r.tags as unknown as string).split('\u001f').sort() : [];
      const links = r.links ? (r.links as unknown as string).split('\u001f').sort() : [];
      // FTS rank is negative (lower = better); convert to positive score.
      const score = typeof r.rank === 'number' && r.rank < 0 ? -r.rank : 1;
      return {
        id: r.title,
        title: r.title,
        path: r.title,
        content: r.body.slice(0, 500),
        tags,
        links,
        score,
        highlights: highlight ? sentenceHighlights(r.body, query) : [],
      };
    });
    return { results };
  }

  listTags(): { tags: string[] } {
    const rows = this.db.prepare('SELECT tag FROM tags GROUP BY tag ORDER BY tag').all() as { tag: string }[];
    return { tags: rows.map((r) => r.tag) };
  }

  buildGraph(): GraphResult {
    // One round trip for notes+tags (was 1 + N per-note tag queries).
    const notes = this.db.prepare(
      `SELECT title,
        (SELECT GROUP_CONCAT(tag, CHAR(31)) FROM tags WHERE note_title = notes.title) AS tags
       FROM notes ORDER BY title`
    ).all() as { title: string; tags: string | null }[];
    const nodes = notes.map((n) => ({
      id: n.title,
      title: n.title,
      tags: (n.tags ? n.tags.split('\u001f').sort() : []).slice(0, 20),
    }));
    const edges = (this.db.prepare('SELECT from_title AS f, to_title AS t FROM links ORDER BY from_title, to_title').all() as { f: string; t: string }[])
      .filter((e) => e.f && e.t && e.f !== e.t)
      .map((e) => ({ from: e.f, to: e.t }));
    const degree = new Map<string, number>();
    for (const e of edges) {
      degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
      degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
    }
    const linked = new Set([...edges.map((e) => e.from), ...edges.map((e) => e.to)]);
    const orphans = nodes.map((n) => n.id).filter((id) => !linked.has(id));
    const hubs = [...degree.entries()]
      .map(([id, d]) => ({ id, degree: d }))
      .sort((a, b) => b.degree - a.degree)
      .slice(0, 10);
    return { nodes, edges, orphans, hubs };
  }

  toDot(graph: GraphResult): string {
    const lines = ['digraph vault {', '  rankdir=LR;', '  node [shape=box, style=rounded];'];
    for (const n of graph.nodes) lines.push(`  "${n.id.replace(/"/g, "'")}" [label="${n.title.replace(/"/g, "'")}"];`);
    for (const e of graph.edges) lines.push(`  "${e.from.replace(/"/g, "'")}" -> "${e.to.replace(/"/g, "'")}";`);
    lines.push('}');
    return lines.join('\n');
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS c FROM notes').get() as { c: number }).c;
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      // ignore
    }
  }
}

const singletons = new Map<string, MemoryStore>();

/** Process-wide singleton per DB path (resettable in tests). */
export function getStore(dbPath = resolveDbPath(), vaultPath = resolveVaultPath()): MemoryStore {
  const key = `${dbPath}::${vaultPath}`;
  let s = singletons.get(key);
  if (!s) {
    s = new MemoryStore(dbPath, vaultPath);
    singletons.set(key, s);
  }
  return s;
}

export function resetStoreForTests(): void {
  for (const s of singletons.values()) {
    try {
      s.close();
    } catch {
      // ignore
    }
  }
  singletons.clear();
}
