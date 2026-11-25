import { afterEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PRE_UPGRADE_BACKUP_NAME,
  listBackups,
  planPrune,
  pruneBackups,
  resolveBackupRoot,
} from '../../packages/memory-store/src/backup-retention';

const created: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'zoveli-backup-retention-'));
  created.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of created.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows may briefly hold a handle; best-effort cleanup.
    }
  }
});

function validManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { format: 'zoveli-backup', version: 1, createdAt: '2026-11-01T00:00:00.000Z', ...overrides };
}

function writeManifest(dir: string, manifest: unknown): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
}

function makeBackup(root: string, name: string): string {
  const dir = join(root, name);
  writeManifest(dir, validManifest());
  writeFileSync(join(dir, 'memory.db'), 'not-a-real-db');
  return dir;
}

function states(root: string): Record<string, string> {
  return Object.fromEntries(listBackups(root).entries.map((entry) => [entry.name, entry.state]));
}

function linkType(): 'junction' | 'dir' {
  return process.platform === 'win32' ? 'junction' : 'dir';
}

describe('backup retention inventory', () => {
  it('recognizes both installer suffixes and nothing else', () => {
    expect(PRE_UPGRADE_BACKUP_NAME.test('pre-upgrade-20261118-120000-deadbeef')).toBe(true);
    expect(PRE_UPGRADE_BACKUP_NAME.test('pre-upgrade-20261118-120000-4821')).toBe(true);
    expect(PRE_UPGRADE_BACKUP_NAME.test('zoveli-20261118-120000')).toBe(false);
    expect(PRE_UPGRADE_BACKUP_NAME.test('pre-upgrade-20261118-1200-deadbeef')).toBe(false);
    expect(PRE_UPGRADE_BACKUP_NAME.test('pre-upgrade-20261118-120000-DEADBEEF')).toBe(false);
  });

  it('lists valid backups and labels every entry prune will refuse', () => {
    const root = join(tempDir(), 'backups');
    mkdirSync(root, { recursive: true });
    makeBackup(root, 'pre-upgrade-20260101-000000-deadbeef');
    makeBackup(root, 'pre-upgrade-20260102-000000-1234');

    mkdirSync(join(root, 'zoveli-20260101-000000'), { recursive: true });
    writeFileSync(join(root, 'pre-upgrade-20260103-000000-deadbeef'), 'not a directory');
    mkdirSync(join(root, 'pre-upgrade-20260104-000000-deadbeef'));
    writeManifest(join(root, 'pre-upgrade-20260105-000000-deadbeef'), 'not json');
    writeManifest(join(root, 'pre-upgrade-20260106-000000-deadbeef'), validManifest({ format: 'other' }));

    const outside = join(tempDir(), 'outside');
    mkdirSync(outside, { recursive: true });
    symlinkSync(outside, join(root, 'pre-upgrade-20260107-000000-deadbeef'), linkType());

    expect(states(root)).toEqual({
      'pre-upgrade-20260101-000000-deadbeef': 'ok',
      'pre-upgrade-20260102-000000-1234': 'ok',
      'pre-upgrade-20260103-000000-deadbeef': 'not-a-directory',
      'pre-upgrade-20260104-000000-deadbeef': 'missing-manifest',
      'pre-upgrade-20260105-000000-deadbeef': 'malformed-manifest',
      'pre-upgrade-20260106-000000-deadbeef': 'wrong-format',
      'pre-upgrade-20260107-000000-deadbeef': 'symlink',
      'zoveli-20260101-000000': 'unknown-name',
    });
  });

  it('returns an empty inventory when the backup root does not exist', () => {
    const root = join(tempDir(), 'missing');
    expect(listBackups(root)).toEqual({ root, entries: [] });
    const result = pruneBackups({ root, keep: 0 });
    expect(result.deleted).toEqual([]);
    expect(result.skipped).toEqual([]);
  });
});

describe('backup retention pruning', () => {
  it('deletes only older valid pre-upgrade backups and never manual or invalid entries', () => {
    const root = join(tempDir(), 'backups');
    mkdirSync(root, { recursive: true });
    const jan1 = makeBackup(root, 'pre-upgrade-20260101-000000-deadbeef');
    const jan2 = makeBackup(root, 'pre-upgrade-20260102-000000-deadbeef');
    const jan3 = makeBackup(root, 'pre-upgrade-20260103-000000-deadbeef');
    const jan4 = makeBackup(root, 'pre-upgrade-20260104-000000-deadbeef');
    const manual = join(root, 'zoveli-20260101-000000');
    writeManifest(manual, validManifest());
    const invalid = join(root, 'pre-upgrade-20260105-000000-deadbeef');
    mkdirSync(invalid, { recursive: true });

    const plan = planPrune({ root, keep: 2 });
    expect(plan.newest?.name).toBe('pre-upgrade-20260104-000000-deadbeef');
    expect(plan.toDelete.map((entry) => entry.name)).toEqual([
      'pre-upgrade-20260101-000000-deadbeef',
      'pre-upgrade-20260102-000000-deadbeef',
    ]);
    expect(plan.kept.map((entry) => entry.name)).toEqual([
      'pre-upgrade-20260103-000000-deadbeef',
      'pre-upgrade-20260104-000000-deadbeef',
    ]);
    expect(plan.skipped.map((entry) => entry.name).sort()).toEqual([
      'pre-upgrade-20260105-000000-deadbeef',
      'zoveli-20260101-000000',
    ]);

    const result = pruneBackups({ root, keep: 2 });
    expect(result.deleted.map((entry) => entry.name)).toEqual([
      'pre-upgrade-20260101-000000-deadbeef',
      'pre-upgrade-20260102-000000-deadbeef',
    ]);
    expect(existsSync(jan1)).toBe(false);
    expect(existsSync(jan2)).toBe(false);
    expect(existsSync(jan3)).toBe(true);
    expect(existsSync(jan4)).toBe(true);
    expect(existsSync(manual)).toBe(true);
    expect(existsSync(invalid)).toBe(true);
  });

  it('keeps the newest valid backup even with --keep 0', () => {
    const root = join(tempDir(), 'backups');
    mkdirSync(root, { recursive: true });
    const jan1 = makeBackup(root, 'pre-upgrade-20260101-000000-deadbeef');
    const jan2 = makeBackup(root, 'pre-upgrade-20260102-000000-deadbeef');

    const plan = planPrune({ root, keep: 0 });
    expect(plan.newest?.name).toBe('pre-upgrade-20260102-000000-deadbeef');
    expect(plan.toDelete.map((entry) => entry.name)).toEqual(['pre-upgrade-20260101-000000-deadbeef']);
    expect(plan.kept.map((entry) => entry.name)).toEqual(['pre-upgrade-20260102-000000-deadbeef']);

    const result = pruneBackups({ root, keep: 0 });
    expect(result.deleted.map((entry) => entry.name)).toEqual(['pre-upgrade-20260101-000000-deadbeef']);
    expect(existsSync(jan1)).toBe(false);
    expect(existsSync(jan2)).toBe(true);
  });

  it('deletes nothing when keep is larger than the number of valid backups', () => {
    const root = join(tempDir(), 'backups');
    mkdirSync(root, { recursive: true });
    makeBackup(root, 'pre-upgrade-20260101-000000-deadbeef');
    makeBackup(root, 'pre-upgrade-20260102-000000-deadbeef');

    const result = pruneBackups({ root, keep: 5 });
    expect(result.deleted).toEqual([]);
    expect(result.kept).toHaveLength(2);
  });

  it('skips an entry swapped for a symlink between list and prune', () => {
    const root = join(tempDir(), 'backups');
    mkdirSync(root, { recursive: true });
    const jan1 = makeBackup(root, 'pre-upgrade-20260101-000000-deadbeef');
    const jan2 = makeBackup(root, 'pre-upgrade-20260102-000000-deadbeef');
    const outside = join(tempDir(), 'outside-data');
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, 'keep.txt'), 'do not delete');

    expect(states(root)['pre-upgrade-20260101-000000-deadbeef']).toBe('ok');
    rmSync(jan1, { recursive: true, force: true });
    symlinkSync(outside, jan1, linkType());

    const result = pruneBackups({ root, keep: 1 });
    const skipped = result.skipped.find((entry) => entry.name === 'pre-upgrade-20260101-000000-deadbeef');
    expect(result.deleted).toEqual([]);
    expect(skipped?.state).toBe('symlink');
    expect(existsSync(join(outside, 'keep.txt'))).toBe(true);
    expect(existsSync(join(jan1, 'keep.txt'))).toBe(true);
    expect(existsSync(jan2)).toBe(true);
  });

  it.skipIf(process.platform !== 'win32')('skips a Windows junction whose real path is outside the root', () => {
    const root = join(tempDir(), 'backups');
    mkdirSync(root, { recursive: true });
    const jan1 = makeBackup(root, 'pre-upgrade-20260101-000000-deadbeef');
    const jan2 = makeBackup(root, 'pre-upgrade-20260102-000000-deadbeef');
    const outside = join(tempDir(), 'junction-target');
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, 'keep.txt'), 'do not delete');

    rmSync(jan1, { recursive: true, force: true });
    symlinkSync(outside, jan1, 'junction');
    expect(lstatSync(jan1).isSymbolicLink()).toBe(true);

    const result = pruneBackups({ root, keep: 1 });
    const skipped = result.skipped.find((entry) => entry.name === 'pre-upgrade-20260101-000000-deadbeef');
    expect(result.deleted).toEqual([]);
    expect(skipped?.state).toBe('symlink');
    expect(existsSync(join(outside, 'keep.txt'))).toBe(true);
    expect(existsSync(jan2)).toBe(true);
  });

  it('skips a valid entry whose manifest changes between list and prune', () => {
    const root = join(tempDir(), 'backups');
    mkdirSync(root, { recursive: true });
    const jan1 = makeBackup(root, 'pre-upgrade-20260101-000000-deadbeef');
    const jan2 = makeBackup(root, 'pre-upgrade-20260102-000000-deadbeef');

    expect(states(root)['pre-upgrade-20260101-000000-deadbeef']).toBe('ok');
    writeManifest(jan1, validManifest({ version: 2 }));

    const result = pruneBackups({ root, keep: 1 });
    const skipped = result.skipped.find((entry) => entry.name === 'pre-upgrade-20260101-000000-deadbeef');
    expect(result.deleted).toEqual([]);
    expect(skipped?.state).toBe('wrong-format');
    expect(existsSync(jan1)).toBe(true);
    expect(existsSync(jan2)).toBe(true);
  });

  it('defaults to ~/.zoveli/backups for the root', () => {
    expect(resolveBackupRoot().endsWith(join('.zoveli', 'backups'))).toBe(true);
  });
});
