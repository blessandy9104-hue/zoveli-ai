import {
  createBackup,
  migrateVault,
  restoreBackup,
  verifyBackup,
  type DataPaths,
} from '@zoveli/memory-store';
import { parseFlags, type FlagDefinition } from './flags.js';

export const MAINTENANCE_COMMANDS = ['backup', 'verify', 'restore', 'migrate'] as const;
export type MaintenanceCommand = (typeof MAINTENANCE_COMMANDS)[number];

export function isMaintenanceCommand(value: string | undefined): value is MaintenanceCommand {
  return value !== undefined && (MAINTENANCE_COMMANDS as readonly string[]).includes(value);
}

interface ParsedFlags {
  out?: string;
  db?: string;
  vault?: string;
  authDir?: string;
  audit?: string;
  force: boolean;
  json: boolean;
  help: boolean;
}

const FLAGS = [
  { key: 'force', tokens: ['--force'] },
  { key: 'json', tokens: ['--json'] },
  { key: 'help', tokens: ['--help', '-h'] },
  { key: 'out', tokens: ['--out'], takesValue: true },
  { key: 'db', tokens: ['--db'], takesValue: true },
  { key: 'vault', tokens: ['--vault'], takesValue: true },
  { key: 'authDir', tokens: ['--auth-dir'], takesValue: true },
  { key: 'audit', tokens: ['--audit'], takesValue: true },
] as const satisfies readonly FlagDefinition<keyof ParsedFlags>[];

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
  zoveli backup [--out DIR] [--db PATH] [--vault PATH] [--auth-dir DIR] [--audit FILE] [--json]
  zoveli verify <backup-dir> [--json]
  zoveli restore <backup-dir> [--force] [--db PATH] [--vault PATH] [--auth-dir DIR] [--audit FILE]
  zoveli migrate [--db PATH] [--vault PATH] [--json]

Stop Zoveli before restore. backups include the SQLite database (WAL-safe),
the Markdown mirror, auth state and the math audit log, plus SHA-256 checksums.`;
}

export async function runMaintenanceCommand(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  try {
    if (!isMaintenanceCommand(command)) throw new Error(`unknown maintenance command: ${String(command)}`);
    const flags = parseFlags<ParsedFlags>(
      rest,
      { force: false, json: false, help: false },
      FLAGS,
      { positional: true }
    );
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
          console.log(`next: zoveli verify "${result.dir}"`);
        }
        return 0;
      }
      case 'verify': {
        const dir = flags.positional[0];
        if (!dir) throw new Error('usage: zoveli verify <backup-dir>');
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
        if (!dir) throw new Error('usage: zoveli restore <backup-dir> [--force]');
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
