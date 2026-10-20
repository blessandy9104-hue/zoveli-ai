import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  MemoryStore,
  openDatabaseSync,
  resolveDbPath,
  resolveVaultPath,
  SCHEMA_VERSION,
  type ImportReport,
} from './store.js';

export const BACKUP_FORMAT = 'zoveli-backup';
export const BACKUP_VERSION = 1;

export interface DataPaths {
  dbPath: string;
  vaultPath: string;
  authDir: string;
  auditPath: string;
}

export type BackupFileKind = 'database' | 'vault' | 'auth' | 'audit';

export interface BackupFileEntry {
  path: string;
  kind: BackupFileKind;
  bytes: number;
  sha256: string;
}

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  version: number;
  createdAt: string;
  schemaVersion: number;
  included: { database: boolean; vault: boolean; auth: boolean; audit: boolean };
  source: DataPaths;
  counts: { notes: number; vaultFiles: number; files: number };
  files: BackupFileEntry[];
}

export interface BackupOptions {
  outDir?: string;
  paths?: Partial<DataPaths>;
}

export interface BackupResult {
  dir: string;
  manifestPath: string;
  manifest: BackupManifest;
  warnings: string[];
}

export interface VerifyResult {
  ok: boolean;
  dir: string;
  errors: string[];
  warnings: string[];
  manifest?: BackupManifest;
}

export interface RestoreOptions {
  paths?: Partial<DataPaths>;
  force?: boolean;
}

export interface RestoreResult {
  restored: string[];
  skipped: string[];
}

export interface MigrateOptions {
  dbPath?: string;
  vaultPath?: string;
}

export interface MigrateResult extends ImportReport {
  schemaVersion: number;
  notes: number;
}

export function resolveDataPaths(overrides: Partial<DataPaths> = {}): DataPaths {
  const home = os.homedir();
  return {
    dbPath: overrides.dbPath ?? resolveDbPath(),
    vaultPath: overrides.vaultPath ?? resolveVaultPath(),
    authDir: overrides.authDir ?? process.env.ZOVELI_AUTH_DIR ?? path.join(home, '.zoveli'),
    auditPath:
      overrides.auditPath ?? process.env.MATHCORE_AUDIT ?? path.join(home, '.mathcore', 'audit.jsonl'),
  };
}

function chmodBestEffort(target: string, mode: number): void {
  try {
    fs.chmodSync(target, mode);
  } catch {
    // Windows ACLs may reject POSIX modes; the file is still user-created.
  }
}

function isInside(child: string, parent: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function defaultBackupDir(): string {
  const stamp = new Date()
    .toISOString()
    .replace(/\.\d{3}Z$/, '')
    .replace(/[-:]/g, '')
    .replace('T', '-');
  const base = path.join(os.homedir(), '.zoveli', 'backups', `zoveli-${stamp}`);
  let dir = base;
  let i = 1;
  while (fs.existsSync(dir)) {
    i += 1;
    dir = `${base}-${i}`;
  }
  return dir;
}

function walkFiles(root: string, prefix = ''): string[] {
  const out: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walkFiles(path.join(root, entry.name), rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out.sort();
}

function safeRelative(root: string, rel: string): string {
  const normalized = rel.replace(/\\/g, '/');
  if (path.posix.isAbsolute(normalized) || normalized.split('/').some((part) => part === '..')) {
    throw new Error(`unsafe path in backup manifest: ${rel}`);
  }
  const base = path.resolve(root);
  const full = path.resolve(base, ...normalized.split('/'));
  if (full !== base && !full.startsWith(base + path.sep)) {
    throw new Error(`path escapes backup directory: ${rel}`);
  }
  return full;
}

function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function kindFor(rel: string): BackupFileKind {
  const top = rel.split('/')[0];
  if (top === 'memory.db') return 'database';
  if (top === 'vault') return 'vault';
  if (top === 'auth') return 'auth';
  return 'audit';
}

function copyAuthFile(srcDir: string, destDir: string, name: string): boolean {
  const src = path.join(srcDir, name);
  if (!fs.existsSync(src)) return false;
  const dest = path.join(destDir, name);
  fs.mkdirSync(destDir, { recursive: true, mode: 0o700 });
  fs.copyFileSync(src, dest);
  chmodBestEffort(dest, 0o600);
  return true;
}

/**
 * Create a WAL-safe backup: the SQLite copy is produced with VACUUM INTO
 * (no need to stop the server), then the Markdown mirror, auth state and
 * math audit log are copied. A manifest records SHA-256 checksums.
 */
export async function createBackup(options: BackupOptions = {}): Promise<BackupResult> {
  const paths = resolveDataPaths(options.paths);
  const outDir = path.resolve(options.outDir ?? defaultBackupDir());
  if (isInside(outDir, paths.vaultPath)) {
    throw new Error(`backup directory must not be inside the vault: ${outDir}`);
  }
  if (fs.existsSync(outDir) && fs.readdirSync(outDir).length > 0) {
    throw new Error(`backup destination is not empty: ${outDir}`);
  }
  fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
  chmodBestEffort(outDir, 0o700);

  const warnings: string[] = [];
  const included = { database: false, vault: false, auth: false, audit: false };
  let notes = 0;
  let schemaVersion = 0;

  if (fs.existsSync(paths.dbPath)) {
    const dest = path.join(outDir, 'memory.db');
    const db = openDatabaseSync(paths.dbPath);
    try {
      db.exec('PRAGMA busy_timeout = 5000;');
      // A bound parameter is supported by SQLite >= 3.27 and avoids quoting.
      db.prepare('VACUUM INTO ?').run(dest);
    } finally {
      try {
        db.close();
      } catch {
        // ignore
      }
    }
    chmodBestEffort(dest, 0o600);
    const copy = openDatabaseSync(dest, { readOnly: true });
    try {
      notes = (copy.prepare('SELECT COUNT(*) AS c FROM notes').get() as { c: number }).c;
      const row = copy.prepare('PRAGMA user_version').get() as { user_version: number } | undefined;
      schemaVersion = Number(row?.user_version ?? 0);
    } finally {
      copy.close();
    }
    included.database = true;
  } else {
    warnings.push(`no memory database at ${paths.dbPath}; backup contains only the vault/auth data`);
  }

  if (fs.existsSync(paths.vaultPath) && fs.statSync(paths.vaultPath).isDirectory()) {
    fs.cpSync(paths.vaultPath, path.join(outDir, 'vault'), {
      recursive: true,
      filter: (src) => {
        const base = path.basename(src);
        return base !== '.git' && base !== 'node_modules';
      },
    });
    included.vault = true;
  }

  included.auth = copyAuthFile(paths.authDir, path.join(outDir, 'auth'), 'auth.json');
  included.auth = copyAuthFile(paths.authDir, path.join(outDir, 'auth'), '.session-secret') || included.auth;

  if (fs.existsSync(paths.auditPath)) {
    const dest = path.join(outDir, 'audit', 'audit.jsonl');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(paths.auditPath, dest);
    chmodBestEffort(dest, 0o600);
    included.audit = true;
  }

  const files: BackupFileEntry[] = [];
  for (const rel of walkFiles(outDir)) {
    if (rel === 'manifest.json') continue;
    const full = safeRelative(outDir, rel);
    files.push({
      path: rel,
      kind: kindFor(rel),
      bytes: fs.statSync(full).size,
      sha256: await sha256File(full),
    });
  }
  const vaultFiles = files.filter((f) => f.kind === 'vault' && f.path.endsWith('.md')).length;
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    schemaVersion,
    included,
    source: paths,
    counts: { notes, vaultFiles, files: files.length },
    files,
  };
  const manifestPath = path.join(outDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
  chmodBestEffort(manifestPath, 0o600);

  return { dir: outDir, manifestPath, manifest, warnings };
}

/**
 * Verify a backup without modifying it: manifest checksums, database
 * integrity/foreign keys, note count, and schema compatibility.
 */
export async function verifyBackup(dir: string): Promise<VerifyResult> {
  const root = path.resolve(dir);
  const errors: string[] = [];
  const warnings: string[] = [];
  const manifestPath = path.join(root, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    return { ok: false, dir: root, errors: ['manifest.json not found'], warnings };
  }
  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as BackupManifest;
  } catch (e) {
    return {
      ok: false,
      dir: root,
      errors: [`manifest.json is not valid JSON: ${e instanceof Error ? e.message : String(e)}`],
      warnings,
    };
  }
  if (manifest.format !== BACKUP_FORMAT) errors.push(`unexpected backup format: ${String(manifest.format)}`);
  if (manifest.version !== BACKUP_VERSION) {
    errors.push(`unsupported backup version: ${String(manifest.version)} (expected ${BACKUP_VERSION})`);
  }
  if (!manifest.included || typeof manifest.included !== 'object') {
    errors.push('manifest is missing included-data flags');
  }
  if (!Array.isArray(manifest.files)) {
    errors.push('manifest is missing the files list');
  }
  if (!manifest.counts || typeof manifest.counts !== 'object') {
    errors.push('manifest is missing counts');
  }

  const listed = new Set<string>();
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  for (const entry of files) {
    try {
      const normalized = String(entry.path).replace(/\\/g, '/');
      const full = safeRelative(root, normalized);
      listed.add(normalized);
      if (!fs.existsSync(full)) {
        errors.push(`missing file: ${normalized}`);
        continue;
      }
      const stat = fs.statSync(full);
      if (stat.size !== entry.bytes) {
        errors.push(`size mismatch: ${normalized} (${stat.size} != ${entry.bytes})`);
      }
      const hash = await sha256File(full);
      if (hash !== entry.sha256) errors.push(`checksum mismatch: ${normalized}`);
    } catch (e) {
      errors.push(`invalid file entry ${String(entry.path)}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  for (const rel of walkFiles(root)) {
    if (rel === 'manifest.json') continue;
    if (!listed.has(rel)) warnings.push(`unlisted file: ${rel}`);
  }

  const dbPath = path.join(root, 'memory.db');
  const dbEntry = files.find((f) => f.path === 'memory.db');
  if ((manifest.included?.database || dbEntry) && !fs.existsSync(dbPath)) {
    errors.push('manifest declares a database but memory.db is missing');
  }
  if (fs.existsSync(dbPath)) {
    try {
      const db = openDatabaseSync(dbPath, { readOnly: true });
      try {
        const integrity = db.prepare('PRAGMA integrity_check').all() as { integrity_check: string }[];
        for (const row of integrity) {
          if (row.integrity_check !== 'ok') errors.push(`database integrity_check: ${row.integrity_check}`);
        }
        const fk = db.prepare('PRAGMA foreign_key_check').all() as unknown[];
        if (fk.length > 0) errors.push(`database foreign key violations: ${fk.length}`);
        const row = db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined;
        const schemaVersion = Number(row?.user_version ?? 0);
        if (schemaVersion > SCHEMA_VERSION) {
          errors.push(`backup schema v${schemaVersion} is newer than supported v${SCHEMA_VERSION}`);
        } else if (manifest.schemaVersion !== schemaVersion) {
          warnings.push(`manifest schema v${manifest.schemaVersion} != database schema v${schemaVersion}`);
        }
        const count = (db.prepare('SELECT COUNT(*) AS c FROM notes').get() as { c: number }).c;
        if (manifest.counts && count !== manifest.counts.notes) {
          errors.push(`note count mismatch: database has ${count}, manifest says ${manifest.counts.notes}`);
        }
        const fts = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='notes_fts'").get();
        if (fts) {
          const ftsRows = (db.prepare('SELECT COUNT(*) AS c FROM notes_fts').get() as { c: number }).c;
          if (ftsRows !== count) warnings.push(`FTS index has ${ftsRows} row(s) but notes has ${count}`);
        }
      } finally {
        db.close();
      }
    } catch (e) {
      errors.push(`database verification failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { ok: errors.length === 0, dir: root, errors, warnings, manifest };
}

/**
 * Restore a verified backup. Stop Zoveli first: replacing an open SQLite
 * database is unsafe. Existing targets are refused unless `force` is set;
 * stale WAL/SHM sidecars are removed before the database is copied.
 */
export async function restoreBackup(dir: string, options: RestoreOptions = {}): Promise<RestoreResult> {
  const root = path.resolve(dir);
  const verification = await verifyBackup(root);
  if (!verification.ok || !verification.manifest) {
    throw new Error(
      `backup failed verification; refusing to restore:\n- ${verification.errors.join('\n- ')}`
    );
  }
  const manifest = verification.manifest;
  const paths = resolveDataPaths(options.paths);
  const force = options.force === true;
  const authFiles = ['auth.json', '.session-secret'];
  const dbTarget = path.resolve(paths.dbPath);
  const dbSidecars = [dbTarget, `${dbTarget}-wal`, `${dbTarget}-shm`, `${dbTarget}-journal`];

  const targets: { label: string; exists: boolean }[] = [];
  if (manifest.included?.database) {
    targets.push({ label: dbTarget, exists: dbSidecars.some((file) => fs.existsSync(file)) });
  }
  if (manifest.included?.vault) {
    targets.push({ label: paths.vaultPath, exists: fs.existsSync(paths.vaultPath) });
  }
  if (manifest.included?.auth) {
    for (const name of authFiles) {
      const label = path.join(paths.authDir, name);
      targets.push({ label, exists: fs.existsSync(label) });
    }
  }
  if (manifest.included?.audit) {
    targets.push({ label: paths.auditPath, exists: fs.existsSync(paths.auditPath) });
  }
  const existing = targets.filter((target) => target.exists);
  if (existing.length > 0 && !force) {
    throw new Error(
      `restore target(s) already exist; stop Zoveli and re-run with --force:\n- ${existing
        .map((target) => target.label)
        .join('\n- ')}`
    );
  }

  const restored: string[] = [];
  const skipped: string[] = [];

  if (manifest.included?.database) {
    const src = path.join(root, 'memory.db');
    if (fs.existsSync(src)) {
      fs.mkdirSync(path.dirname(dbTarget), { recursive: true });
      for (const sidecar of dbSidecars) fs.rmSync(sidecar, { force: true });
      fs.copyFileSync(src, dbTarget);
      chmodBestEffort(dbTarget, 0o600);
      restored.push(dbTarget);
    } else {
      skipped.push('database (missing in backup)');
    }
  }

  if (manifest.included?.vault) {
    const src = path.join(root, 'vault');
    if (fs.existsSync(src)) {
      fs.rmSync(paths.vaultPath, { recursive: true, force: true });
      fs.mkdirSync(path.dirname(paths.vaultPath), { recursive: true });
      fs.cpSync(src, paths.vaultPath, { recursive: true });
      restored.push(paths.vaultPath);
    } else {
      skipped.push('vault (missing in backup)');
    }
  }

  if (manifest.included?.auth) {
    for (const name of authFiles) {
      const src = path.join(root, 'auth', name);
      if (!fs.existsSync(src)) {
        skipped.push(`auth/${name} (missing in backup)`);
        continue;
      }
      const dest = path.join(paths.authDir, name);
      fs.mkdirSync(paths.authDir, { recursive: true, mode: 0o700 });
      fs.copyFileSync(src, dest);
      chmodBestEffort(dest, 0o600);
      restored.push(dest);
    }
  }

  if (manifest.included?.audit) {
    const src = path.join(root, 'audit', 'audit.jsonl');
    if (fs.existsSync(src)) {
      fs.mkdirSync(path.dirname(paths.auditPath), { recursive: true });
      fs.copyFileSync(src, paths.auditPath);
      chmodBestEffort(paths.auditPath, 0o600);
      restored.push(paths.auditPath);
    } else {
      skipped.push('audit (missing in backup)');
    }
  }

  return { restored, skipped };
}

/**
 * Open the database (applying pending schema migrations) and import legacy
 * Markdown notes. Existing titles are skipped, never overwritten.
 */
export function migrateVault(options: MigrateOptions = {}): MigrateResult {
  const dbPath = options.dbPath ?? resolveDbPath();
  const vaultPath = options.vaultPath ?? resolveVaultPath();
  if (!fs.existsSync(vaultPath) || !fs.statSync(vaultPath).isDirectory()) {
    throw new Error(`vault directory not found: ${vaultPath}`);
  }
  const store = new MemoryStore(dbPath, vaultPath, { importVault: false });
  try {
    const report = store.importMarkdownFiles(vaultPath);
    return { schemaVersion: store.schemaVersion(), notes: store.count(), ...report };
  } finally {
    store.close();
  }
}
