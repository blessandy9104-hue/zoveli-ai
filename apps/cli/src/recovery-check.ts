import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  MemoryStore,
  createBackup,
  restoreBackup,
  verifyBackup,
  type DataPaths,
} from '@zoveli/memory-store';

export interface RecoveryStep {
  id: string;
  detail: string;
  ms: number;
}

export interface RecoveryDrillResult {
  status: 'pass';
  isolated: true;
  note: string;
  backupFiles: number;
  backupNotes: number;
  steps: RecoveryStep[];
  warnings: string[];
  tempDir?: string;
}

interface DrillOptions {
  keep?: boolean;
  tempRoot?: string;
}

function step(steps: RecoveryStep[], id: string, detail: string, startedAt: number): void {
  steps.push({ id, detail, ms: Date.now() - startedAt });
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function cleanupReadyDirs(root: string): void {
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {
    // Best-effort: the caller reports the retained path if cleanup fails.
  }
}

/**
 * Prove the backup -> verify -> restore -> read path end to end using a
 * synthetic vault in the OS temp directory. No live Zoveli path is read or
 * written, so the drill is safe to run while the assistant is open.
 */
export async function runRecoveryDrill(options: DrillOptions = {}): Promise<RecoveryDrillResult> {
  const steps: RecoveryStep[] = [];
  const warnings: string[] = [];
  const root = fs.mkdtempSync(path.join(options.tempRoot ?? os.tmpdir(), 'zoveli-recovery-'));
  const live: DataPaths = {
    dbPath: path.join(root, 'live', 'memory.db'),
    vaultPath: path.join(root, 'live', 'vault'),
    authDir: path.join(root, 'live', 'auth'),
    auditPath: path.join(root, 'live', 'audit', 'audit.jsonl'),
  };
  const backupDir = path.join(root, 'backup');
  const restored: DataPaths = {
    dbPath: path.join(root, 'restored', 'memory.db'),
    vaultPath: path.join(root, 'restored', 'vault'),
    authDir: path.join(root, 'restored', 'auth'),
    auditPath: path.join(root, 'restored', 'audit', 'audit.jsonl'),
  };
  const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const title = `Recovery drill ${token}`;
  const body = `Synthetic note ${token}: backup and restore verified.`;
  let store: MemoryStore | null = null;
  let restoredStore: MemoryStore | null = null;
  const previousExport = process.env.ZOVELI_MEMORY_EXPORT;

  try {
    const seedStart = Date.now();
    process.env.ZOVELI_MEMORY_EXPORT = '1';
    fs.mkdirSync(live.authDir, { recursive: true });
    fs.writeFileSync(path.join(live.authDir, 'auth.json'), '{"synthetic":true}\n');
    fs.writeFileSync(path.join(live.authDir, '.session-secret'), 'synthetic-session-secret\n');
    fs.mkdirSync(path.dirname(live.auditPath), { recursive: true });
    fs.writeFileSync(live.auditPath, '{"synthetic":true}\n');
    store = new MemoryStore(live.dbPath, live.vaultPath, { importVault: false });
    store.createNote({ title, content: body, tags: ['recovery-drill'] });
    store.close();
    store = null;
    assert(fs.existsSync(live.vaultPath), 'synthetic Markdown vault was not created');
    step(steps, 'isolated-data', 'synthetic note, vault, auth and audit data created', seedStart);

    const backupStart = Date.now();
    const backup = await createBackup({ outDir: backupDir, paths: live });
    assert(backup.manifest.counts.notes === 1, `backup has ${backup.manifest.counts.notes} notes`);
    assert(backup.manifest.included.database, 'backup does not include the database');
    assert(backup.manifest.included.vault, 'backup does not include the Markdown vault');
    assert(backup.manifest.included.auth, 'backup does not include auth state');
    assert(backup.manifest.included.audit, 'backup does not include the math audit log');
    step(
      steps,
      'backup',
      `${backup.manifest.counts.files} files, ${backup.manifest.counts.notes} note`,
      backupStart
    );

    const verifyStart = Date.now();
    const verified = await verifyBackup(backup.dir);
    assert(verified.ok, `backup verification failed: ${verified.errors.join('; ')}`);
    warnings.push(...verified.warnings);
    step(steps, 'verify', 'checksums, SQLite integrity and schema accepted', verifyStart);

    const restoreStart = Date.now();
    const result = await restoreBackup(backup.dir, { paths: restored });
    assert(result.restored.includes(path.resolve(restored.dbPath)), 'database was not restored');
    assert(result.restored.includes(path.resolve(restored.vaultPath)), 'vault was not restored');
    assert(fs.existsSync(path.join(restored.authDir, 'auth.json')), 'auth state was not restored');
    assert(fs.existsSync(restored.auditPath), 'audit log was not restored');
    step(steps, 'restore', `${result.restored.length} targets written`, restoreStart);

    const readStart = Date.now();
    restoredStore = new MemoryStore(restored.dbPath, restored.vaultPath, { importVault: false });
    const read = restoredStore.readNote(title);
    assert(read.body === body, 'restored note body does not match');
    assert(restoredStore.count() === 1, `restored database has ${restoredStore.count()} notes`);
    restoredStore.close();
    restoredStore = null;
    step(steps, 'readback', 'restored note content and count match', readStart);

    if (options.keep) {
      step(steps, 'cleanup', `kept for inspection: ${root}`, Date.now());
    } else {
      const cleanupStart = Date.now();
      cleanupReadyDirs(root);
      if (fs.existsSync(root)) {
        warnings.push(`could not remove temporary drill data: ${root}`);
        step(steps, 'cleanup', `temporary data retained at ${root}`, cleanupStart);
      } else {
        step(steps, 'cleanup', 'temporary data removed', cleanupStart);
      }
    }

    return {
      status: 'pass',
      isolated: true,
      note: title,
      backupFiles: backup.manifest.counts.files,
      backupNotes: backup.manifest.counts.notes,
      steps,
      warnings,
      ...(options.keep ? { tempDir: root } : {}),
    };
  } catch (error) {
    try {
      store?.close();
    } catch {
      // ignore
    }
    try {
      restoredStore?.close();
    } catch {
      // ignore
    }
    if (options.keep) warnings.push(`drill data retained at ${root}`);
    else cleanupReadyDirs(root);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(options.keep ? `${message} (drill data kept at ${root})` : message);
  } finally {
    if (previousExport === undefined) delete process.env.ZOVELI_MEMORY_EXPORT;
    else process.env.ZOVELI_MEMORY_EXPORT = previousExport;
  }
}

interface ParsedFlags {
  json: boolean;
  keep: boolean;
  help: boolean;
}

function parseFlags(argv: string[]): ParsedFlags {
  const flags: ParsedFlags = { json: false, keep: false, help: false };
  for (const arg of argv) {
    if (arg === '--json') flags.json = true;
    else if (arg === '--keep') flags.keep = true;
    else if (arg === '--help' || arg === '-h') flags.help = true;
    else if (arg.startsWith('-')) throw new Error(`unknown option: ${arg}`);
    else throw new Error(`unexpected argument: ${arg}`);
  }
  return flags;
}

function usage(): string {
  return `zoveli recovery drill
  zoveli recovery-check [--json] [--keep]

Backs up a synthetic vault, verifies the checksums and SQLite integrity,
restores it into a temporary directory, and reads the note back. Your real
vault is never read or written, so this is safe while Zoveli is running.
Exit code 1 means the local backup/restore path is broken.

  --keep   keep the temporary drill directory for inspection
  --json   machine-readable result`;
}

export async function runRecoveryCheck(argv: string[]): Promise<number> {
  let flags: ParsedFlags;
  try {
    flags = parseFlags(argv);
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  if (flags.help) {
    console.log(usage());
    return 0;
  }
  try {
    const result = await runRecoveryDrill({ keep: flags.keep });
    if (flags.json) {
      console.log(JSON.stringify(result, null, 2));
      return 0;
    }
    console.log('zoveli recovery check: PASS\n');
    for (const entry of result.steps) {
      console.log(`  [ok] ${entry.id.padEnd(14)} ${entry.detail} (${entry.ms}ms)`);
    }
    for (const warning of result.warnings) console.log(`  [warn] ${warning}`);
    console.log('\nYour real vault was not touched.');
    console.log('Next: back up real data with `zoveli backup`; verify an existing backup with `zoveli verify <dir>`.');
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (flags.json) {
      console.log(
        JSON.stringify(
          {
            status: 'fail',
            isolated: true,
            realDataTouched: false,
            error: message,
            next:
              'Your real vault was not touched. Run `zoveli health`, then capture this output and open an issue.',
          },
          null,
          2
        )
      );
    } else {
      console.error(`zoveli recovery check: FAIL\n  ${message}`);
      console.error('  Your real vault was not touched.');
      console.error('  Next: run `zoveli health`, then capture this output and open an issue.');
    }
    return 1;
  }
}
