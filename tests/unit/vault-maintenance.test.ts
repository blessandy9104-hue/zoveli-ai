import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MemoryStore,
  openDatabaseSync,
  createBackup,
  verifyBackup,
  restoreBackup,
  migrateVault,
} from '../../packages/memory-store/src/index';

const created: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'zoveli-vault-safety-'));
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

describe('vault safety (schema, backup, restore, migration)', () => {
  it('records the schema version and passes integrity checks', () => {
    const base = tempDir();
    const db = join(base, 'memory.db');
    const vault = join(base, 'vault');
    const store = new MemoryStore(db, vault);
    expect(store.schemaVersion()).toBe(1);
    store.createNote({ title: 'Alpha', content: 'hello', tags: ['t'] });
    const integrity = store.checkIntegrity();
    expect(integrity.ok).toBe(true);
    expect(integrity.notes).toBe(1);
    expect(integrity.errors).toEqual([]);
    store.close();
  });

  it('refuses to open a database from a newer schema', () => {
    const base = tempDir();
    const db = join(base, 'future.db');
    const raw = openDatabaseSync(db);
    raw.exec('PRAGMA user_version = 99');
    raw.close();
    expect(() => new MemoryStore(db, join(base, 'vault'))).toThrow(/newer than supported/);
  });

  it('backs up WAL-safe state with checksums and detects tampering', async () => {
    const base = tempDir();
    const db = join(base, 'memory.db');
    const vault = join(base, 'vault');
    const authDir = join(base, 'auth');
    const auditPath = join(base, 'audit.jsonl');
    mkdirSync(authDir, { recursive: true });
    writeFileSync(join(authDir, 'auth.json'), '{"ok":true}');
    writeFileSync(join(authDir, '.session-secret'), 'secret');
    writeFileSync(auditPath, '{"op":"add"}\n');

    const store = new MemoryStore(db, vault);
    store.createNote({ title: 'Alpha', content: 'hello world', tags: ['fact'] });
    store.close();

    const out = join(base, 'backup');
    const backup = await createBackup({
      outDir: out,
      paths: { dbPath: db, vaultPath: vault, authDir, auditPath },
    });
    expect(backup.manifest.counts.notes).toBe(1);
    expect(backup.manifest.included).toEqual({ database: true, vault: true, auth: true, audit: true });
    expect(backup.manifest.files.some((f) => f.path === 'memory.db')).toBe(true);
    expect(backup.manifest.files.some((f) => f.path === 'vault/Alpha.md')).toBe(true);
    expect(backup.manifest.files.some((f) => f.path === 'auth/.session-secret')).toBe(true);

    const good = await verifyBackup(out);
    expect(good.ok).toBe(true);
    expect(good.errors).toEqual([]);
    expect(good.manifest?.counts.notes).toBe(1);

    writeFileSync(join(out, 'vault', 'Alpha.md'), 'tampered');
    const bad = await verifyBackup(out);
    expect(bad.ok).toBe(false);
    expect(bad.errors.join('\n')).toMatch(/checksum mismatch|size mismatch/);
  });

  it('refuses to restore over existing data without force, then restores cleanly', async () => {
    const base = tempDir();
    const db = join(base, 'memory.db');
    const vault = join(base, 'vault');
    const authDir = join(base, 'auth');
    const auditPath = join(base, 'audit.jsonl');
    mkdirSync(authDir, { recursive: true });
    writeFileSync(join(authDir, 'auth.json'), '{"ok":true}');

    const before = new MemoryStore(db, vault);
    before.createNote({ title: 'Alpha', content: 'original' });
    before.close();

    const out = join(base, 'backup');
    await createBackup({ outDir: out, paths: { dbPath: db, vaultPath: vault, authDir, auditPath } });

    const changed = new MemoryStore(db, vault);
    changed.createNote({ title: 'Beta', content: 'should disappear' });
    changed.close();

    await expect(
      restoreBackup(out, { paths: { dbPath: db, vaultPath: vault, authDir, auditPath } })
    ).rejects.toThrow(/already exist/);

    const restored = await restoreBackup(out, {
      paths: { dbPath: db, vaultPath: vault, authDir, auditPath },
      force: true,
    });
    expect(restored.restored).toContain(db);
    expect(restored.restored).toContain(vault);
    expect(existsSync(`${db}-wal`)).toBe(false);

    const after = new MemoryStore(db, vault);
    expect(after.readNote('Alpha').body).toContain('original');
    expect(() => after.readNote('Beta')).toThrow(/not found/);
    after.close();
    expect(readFileSync(join(authDir, 'auth.json'), 'utf-8')).toBe('{"ok":true}');
  });

  it('imports legacy Markdown with timestamps and links, and is idempotent', () => {
    const base = tempDir();
    const vault = join(base, 'legacy');
    mkdirSync(vault, { recursive: true });
    writeFileSync(
      join(vault, 'One.md'),
      '---\ntitle: "Legacy One"\ncreated: 2020-01-02T03:04:05.000Z\ntags: ["old"]\n---\nSee [[Two]]\n'
    );
    writeFileSync(join(vault, 'Two.md'), '# Legacy Two\n\nbody\n');

    const db = join(base, 'new', 'memory.db');
    const first = migrateVault({ dbPath: db, vaultPath: vault });
    expect(first.schemaVersion).toBe(1);
    expect(first.imported).toBe(2);
    expect(first.failed).toEqual([]);

    const store = new MemoryStore(db, join(base, 'mirror'), { importVault: false });
    try {
      const one = store.readNote('Legacy One');
      expect(one.created).toBe('2020-01-02T03:04:05.000Z');
      expect(one.tags).toContain('old');
      expect(one.links).toContain('Two');
      expect(store.readNote('Legacy Two').body).toContain('body');
    } finally {
      store.close();
    }

    const second = migrateVault({ dbPath: db, vaultPath: vault });
    expect(second.imported).toBe(0);
    expect(second.skippedExisting).toBe(2);
    expect(second.failed).toEqual([]);
  });
});
