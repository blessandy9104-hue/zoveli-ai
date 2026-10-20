import {
  createBackup,
  migrateVault,
  restoreBackup,
  verifyBackup,
  type DataPaths,
} from '@zoveli/memory-store';

export const MAINTENANCE_COMMANDS = ['backup', 'verify', 'restore', 'migrate'] as const;
export type MaintenanceCommand = (typeof MAINTENANCE_COMMANDS)[number];

export function isMaintenanceCommand(value: string | undefined): value is MaintenanceCommand {
  return value !== undefined && (MAINTENANCE_COMMANDS as readonly string[]).includes(value);
}

interface ParsedFlags {
  positional: string[];
  out?: string;
  db?: string;
  vault?: string;
  authDir?: string;
  audit?: string;
  force: boolean;
  json: boolean;
  help: boolean;
}

function parseFlags(argv: string[]): ParsedFlags {
  const flags: ParsedFlags = { positional: [], force: false, json: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--force') flags.force = true;
    else if (arg === '--json') flags.json = true;
    else if (arg === '--help' || arg === '-h') flags.help = true;
    else if (arg.startsWith('--out=')) flags.out = arg.slice('--out='.length);
    else if (arg.startsWith('--db=')) flags.db = arg.slice('--db='.length);
    else if (arg.startsWith('--vault=')) flags.vault = arg.slice('--vault='.length);
    else if (arg.startsWith('--auth-dir=')) flags.authDir = arg.slice('--auth-dir='.length);
    else if (arg.startsWith('--audit=')) flags.audit = arg.slice('--audit='.length);
    else if (arg === '--out' || arg === '--db' || arg === '--vault' || arg === '--auth-dir' || arg === '--audit') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      if (arg === '--out') flags.out = value;
      else if (arg === '--db') flags.db = value;
      else if (arg === '--vault') flags.vault = value;
      else if (arg === '--auth-dir') flags.authDir = value;
      else flags.audit = value;
      i += 1;
    } else if (arg.startsWith('-')) {
      throw new Error(`unknown option: ${arg}`);
    } else {
      flags.positional.push(arg);
    }
  }
  return flags;
}

function pathOverrides(flags: ParsedFlags): Partial<DataPaths> {
  return {
    ...(flags.db ? { dbPath: flags.db } : {}),
    ...(flags.vault ? { vaultPath: flags.vault } : {}),
    ...(flags.authDir ? { authDir: flags.authDir } : {}),
    ...(flags.audit ? { auditPath: flags.audit } : {}),
  };
}

function usage(): string {
  return `zoveli data maintenance
  assistant backup [--out DIR] [--db PATH] [--vault PATH] [--auth-dir DIR] [--audit FILE] [--json]
  assistant verify <backup-dir> [--json]
  assistant restore <backup-dir> [--force] [--db PATH] [--vault PATH] [--auth-dir DIR] [--audit FILE]
  assistant migrate [--db PATH] [--vault PATH] [--json]

Stop Zoveli before restore. backups include the SQLite database (WAL-safe),
the Markdown mirror, auth state and the math audit log, plus SHA-256 checksums.`;
}

export async function runMaintenanceCommand(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  try {
    if (!isMaintenanceCommand(command)) throw new Error(`unknown maintenance command: ${String(command)}`);
    const flags = parseFlags(rest);
    if (flags.help) {
      console.log(usage());
      return 0;
    }

    switch (command) {
      case 'backup': {
        const result = await createBackup({ outDir: flags.out, paths: pathOverrides(flags) });
        if (flags.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(`backup: ${result.dir}`);
          console.log(
            `notes: ${result.manifest.counts.notes}; files: ${result.manifest.counts.files}; schema: v${result.manifest.schemaVersion}`
          );
          for (const warning of result.warnings) console.log(`warning: ${warning}`);
          console.log(`next: assistant verify "${result.dir}"`);
        }
        return 0;
      }
      case 'verify': {
        const dir = flags.positional[0];
        if (!dir) throw new Error('usage: assistant verify <backup-dir>');
        const result = await verifyBackup(dir);
        if (flags.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(`backup: ${result.dir}`);
          if (result.ok) {
            console.log(
              `ok; notes: ${result.manifest?.counts.notes ?? '?'}; files: ${result.manifest?.counts.files ?? '?'}`
            );
          } else {
            console.error('verification failed:');
            for (const error of result.errors) console.error(`- ${error}`);
          }
          for (const warning of result.warnings) console.log(`warning: ${warning}`);
        }
        return result.ok ? 0 : 1;
      }
      case 'restore': {
        const dir = flags.positional[0];
        if (!dir) throw new Error('usage: assistant restore <backup-dir> [--force]');
        const result = await restoreBackup(dir, { force: flags.force, paths: pathOverrides(flags) });
        if (flags.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          for (const file of result.restored) console.log(`restored: ${file}`);
          for (const item of result.skipped) console.log(`skipped: ${item}`);
          console.log('next: start Zoveli and verify a known note');
        }
        return 0;
      }
      case 'migrate': {
        const result = migrateVault({ dbPath: flags.db, vaultPath: flags.vault });
        if (flags.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(`schema: v${result.schemaVersion}; notes in DB: ${result.notes}`);
          console.log(
            `scanned: ${result.scanned}; imported: ${result.imported}; skipped existing: ${result.skippedExisting}; failed: ${result.failed.length}`
          );
          for (const failure of result.failed) console.error(`- ${failure.file}: ${failure.error}`);
        }
        return result.failed.length > 0 ? 2 : 0;
      }
      default: {
        throw new Error(`unhandled maintenance command: ${command satisfies never}`);
      }
    }
  } catch (e) {
    console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}
