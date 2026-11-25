import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { BACKUP_FORMAT, BACKUP_VERSION } from './backup-format.js';

/**
 * Names created by the installers:
 *   PowerShell: pre-upgrade-YYYYMMDD-HHmmss-<8 hex>
 *   POSIX shell: pre-upgrade-YYYYMMDD-HHmmss-<pid>
 * Anything else is a manual backup (`--out`) or unrelated data.
 */
export const PRE_UPGRADE_BACKUP_NAME = /^pre-upgrade-\d{8}-\d{6}-(?:[0-9a-f]{8}|\d+)$/;

export type BackupEntryState =
  | 'ok'
  | 'unknown-name'
  | 'not-a-directory'
  | 'symlink'
  | 'missing-manifest'
  | 'malformed-manifest'
  | 'wrong-format';

export interface BackupEntry {
  name: string;
  path: string;
  state: BackupEntryState;
  /** True only when the entry is a regular directory at the expected real path with a valid manifest. */
  deletable: boolean;
  detail?: string;
}

export interface ListBackupsResult {
  root: string;
  entries: BackupEntry[];
}

export interface PruneBackupsOptions {
  /** Keep this many newest valid pre-upgrade backups. The newest valid one is always kept. */
  keep: number;
  /** Defaults to `resolveBackupRoot()`; mainly for tests and relocated state dirs. */
  root?: string;
}

export interface PrunePlan {
  root: string;
  keep: number;
  newest?: BackupEntry;
  toDelete: BackupEntry[];
  kept: BackupEntry[];
  skipped: BackupEntry[];
}

export interface PruneBackupsResult extends PrunePlan {
  deleted: BackupEntry[];
}

/** `~/.zoveli/backups`, the directory both installers write pre-upgrade backups to. */
export function resolveBackupRoot(): string {
  return path.join(os.homedir(), '.zoveli', 'backups');
}

function compareNames(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function samePath(a: string, b: string): boolean {
  // Windows paths are case-insensitive; realpath may return canonical casing
  // that differs from the spelling used to build the expected path.
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function realRootOf(root: string): string | null {
  try {
    if (!fs.statSync(root).isDirectory()) return null;
    return fs.realpathSync(root);
  } catch {
    return null;
  }
}

function isLinkLike(stat: fs.Stats): boolean {
  // Junctions are reported as symlinks by lstat on Windows, but other reparse
  // points may not be. The realpath comparison below is the authoritative
  // check; this is only the cheap first pass.
  return stat.isSymbolicLink();
}

function resolvesToExpectedEntry(realRoot: string, name: string, entryPath: string): { ok: boolean; resolved?: string } {
  try {
    const resolved = fs.realpathSync(entryPath);
    return { ok: samePath(resolved, path.join(realRoot, name)), resolved };
  } catch (e) {
    return { ok: false, resolved: e instanceof Error ? e.message : String(e) };
  }
}

function checkManifest(dir: string): { state: BackupEntryState; detail?: string } {
  const manifestPath = path.join(dir, 'manifest.json');
  let raw: string;
  try {
    raw = fs.readFileSync(manifestPath, 'utf-8');
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return {
      state: 'missing-manifest',
      ...(code === 'ENOENT' ? {} : { detail: e instanceof Error ? e.message : String(e) }),
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { state: 'malformed-manifest', detail: e instanceof Error ? e.message : String(e) };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { state: 'malformed-manifest', detail: 'manifest is not an object' };
  }
  const manifest = parsed as { format?: unknown; version?: unknown };
  if (manifest.format !== BACKUP_FORMAT || manifest.version !== BACKUP_VERSION) {
    return {
      state: 'wrong-format',
      detail: `format=${String(manifest.format)} version=${String(manifest.version)}`,
    };
  }
  return { state: 'ok' };
}

function classify(realRoot: string, root: string, name: string): BackupEntry {
  const entryPath = path.join(root, name);
  const base = { name, path: entryPath, deletable: false };

  if (!PRE_UPGRADE_BACKUP_NAME.test(name)) return { ...base, state: 'unknown-name' };

  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(entryPath);
  } catch (e) {
    return { ...base, state: 'not-a-directory', detail: e instanceof Error ? e.message : String(e) };
  }
  if (isLinkLike(stat)) return { ...base, state: 'symlink' };
  if (!stat.isDirectory()) return { ...base, state: 'not-a-directory' };

  // Refuse anything that resolves somewhere other than <real root>/<name>:
  // junctions, mount points, and reparse points that lstat reports as a
  // directory but that actually live elsewhere.
  const resolved = resolvesToExpectedEntry(realRoot, name, entryPath);
  if (!resolved.ok) {
    return {
      ...base,
      state: 'symlink',
      detail: `resolves to ${resolved.resolved ?? 'an unknown location'}`,
    };
  }

  const manifest = checkManifest(entryPath);
  return {
    ...base,
    state: manifest.state,
    deletable: manifest.state === 'ok',
    ...(manifest.detail ? { detail: manifest.detail } : {}),
  };
}

/**
 * Read-only inventory. Invalid entries are reported, not treated as errors:
 * callers list them so the user can inspect them before deleting anything.
 */
export function listBackups(root: string = resolveBackupRoot()): ListBackupsResult {
  const resolvedRoot = path.resolve(root);
  const realRoot = realRootOf(resolvedRoot);
  if (!realRoot) return { root: resolvedRoot, entries: [] };

  let names: string[];
  try {
    names = fs.readdirSync(resolvedRoot);
  } catch {
    return { root: resolvedRoot, entries: [] };
  }

  const entries = names
    .map((name) => classify(realRoot, resolvedRoot, name))
    .sort((a, b) => compareNames(a.name, b.name));
  return { root: resolvedRoot, entries };
}

function normalizeKeep(keep: number): number {
  if (!Number.isInteger(keep) || keep < 0) {
    throw new Error(`keep must be a non-negative integer (got ${String(keep)})`);
  }
  return keep;
}

/**
 * Decide what a prune would remove without touching the filesystem. Only
 * entries in state `ok` are candidates; invalid entries are always skipped.
 */
export function planPrune(options: PruneBackupsOptions): PrunePlan {
  const keep = normalizeKeep(options.keep);
  const listing = listBackups(options.root);
  const valid = listing.entries.filter((entry) => entry.deletable);
  const newestFirst = [...valid].sort((a, b) => compareNames(b.name, a.name));

  // Keep-all floor: the newest valid pre-upgrade backup survives even
  // `--keep 0`. With no valid backups there is nothing to protect.
  const retain = Math.max(keep, newestFirst.length > 0 ? 1 : 0);
  const retained = new Set(newestFirst.slice(0, retain).map((entry) => entry.name));

  const toDelete: BackupEntry[] = [];
  const kept: BackupEntry[] = [];
  const skipped: BackupEntry[] = [];
  for (const entry of listing.entries) {
    if (!entry.deletable) skipped.push(entry);
    else if (retained.has(entry.name)) kept.push(entry);
    else toDelete.push(entry);
  }

  return { root: listing.root, keep, newest: newestFirst[0], toDelete, kept, skipped };
}

/**
 * Delete older pre-upgrade backups. Every candidate is re-classified
 * immediately before `rmSync`, so an entry swapped for a symlink/junction or
 * given a bad manifest after listing is skipped rather than followed.
 */
export function pruneBackups(options: PruneBackupsOptions): PruneBackupsResult {
  const plan = planPrune(options);
  const realRoot = realRootOf(plan.root);
  const deleted: BackupEntry[] = [];
  const skipped = [...plan.skipped];

  for (const entry of plan.toDelete) {
    if (!realRoot) {
      skipped.push({ ...entry, deletable: false, state: 'not-a-directory', detail: 'backup root disappeared before deletion' });
      continue;
    }
    const recheck = classify(realRoot, plan.root, entry.name);
    if (!recheck.deletable) {
      skipped.push({ ...recheck, detail: `changed before deletion (now ${recheck.state})` });
      continue;
    }
    try {
      fs.rmSync(recheck.path, { recursive: true, force: false });
      deleted.push(recheck);
    } catch (e) {
      skipped.push({
        ...recheck,
        deletable: false,
        detail: `deletion failed: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  return { ...plan, deleted, skipped };
}
