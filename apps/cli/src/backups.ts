import { createInterface } from 'node:readline/promises';
import {
  listBackups,
  planPrune,
  pruneBackups,
  resolveBackupRoot,
  type BackupEntry,
  type ListBackupsResult,
} from '@zoveli/memory-store/backup-retention';
import { parseFlags, type FlagDefinition } from './flags.js';

export const BACKUPS_COMMANDS = ['list', 'prune'] as const;
export type BackupsCommand = (typeof BACKUPS_COMMANDS)[number];

export function isBackupsCommand(value: string | undefined): value is BackupsCommand {
  return value !== undefined && (BACKUPS_COMMANDS as readonly string[]).includes(value);
}

interface ParsedFlags {
  keep?: string;
  yes: boolean;
  json: boolean;
  help: boolean;
  root?: string;
}

const FLAGS = [
  { key: 'keep', tokens: ['--keep'], takesValue: true },
  { key: 'yes', tokens: ['--yes', '-y'] },
  { key: 'json', tokens: ['--json'] },
  { key: 'help', tokens: ['--help', '-h'] },
  { key: 'root', tokens: ['--root'], takesValue: true },
] as const satisfies readonly FlagDefinition<keyof ParsedFlags>[];

export interface BackupsIO {
  /** Defaults to `process.stdin.isTTY === true`. */
  isTTY?: boolean;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
  /** Defaults to a readline prompt on process.stdin/process.stdout. */
  confirm?: (question: string) => Promise<string>;
}

function usage(): string {
  return `zoveli backups
  zoveli backups list [--root DIR] [--json]
  zoveli backups prune --keep N [--yes] [--root DIR] [--json]

Backups are never deleted automatically: installs, upgrades and uninstalls keep
every pre-upgrade backup. list is read-only. prune deletes only older
pre-upgrade backups, skips symlinks/junctions, manual --out backups and any
entry without a valid manifest.json, and always keeps the newest valid one
(even with --keep 0). On a terminal prune asks for confirmation; pass --yes
when stdin is not a TTY. --json requires --yes.`;
}

function describeEntry(entry: BackupEntry): string {
  if (entry.state === 'ok') return entry.name;
  return `${entry.name} [${entry.state}${entry.detail ? `: ${entry.detail}` : ''}]`;
}

function parseKeep(value: string | undefined): number {
  if (value === undefined) throw new Error('usage: zoveli backups prune --keep N [--yes]');
  if (!/^\d+$/.test(value)) throw new Error(`--keep must be a non-negative integer (got ${value})`);
  const keep = Number(value);
  if (!Number.isSafeInteger(keep)) throw new Error(`--keep is too large: ${value}`);
  return keep;
}

function printList(result: ListBackupsResult, out: (line: string) => void): void {
  out(`backup root: ${result.root}`);
  if (result.entries.length === 0) {
    out('no backups found');
    return;
  }
  for (const entry of result.entries) out(`  ${describeEntry(entry)}`);
  const valid = result.entries.filter((entry) => entry.deletable).length;
  out(`${result.entries.length} entries; ${valid} valid; ${result.entries.length - valid} skipped by prune`);
}

async function promptOnTty(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

async function runPrune(
  flags: ParsedFlags,
  root: string,
  io: BackupsIO,
  out: (line: string) => void
): Promise<number> {
  const keep = parseKeep(flags.keep);
  if (flags.json && !flags.yes) {
    throw new Error('--json requires --yes (no prompt is shown in JSON mode)');
  }

  const isTTY = io.isTTY ?? process.stdin.isTTY === true;
  if (!flags.yes) {
    if (!isTTY) {
      throw new Error('refusing to delete backups without confirmation; re-run with --yes');
    }
    const plan = planPrune({ keep, root });
    if (plan.toDelete.length === 0) {
      out(`nothing to delete under ${plan.root}`);
      return 0;
    }
    const question = `Delete ${plan.toDelete.length} backup(s) under ${plan.root} (keeping ${plan.kept.length})? [y/N] `;
    const answer = (await (io.confirm ?? promptOnTty)(question)).trim().toLowerCase();
    if (answer !== 'y' && answer !== 'yes') {
      out('cancelled');
      return 0;
    }
  }

  const result = pruneBackups({ keep, root });
  if (flags.json) {
    out(JSON.stringify(result, null, 2));
    return 0;
  }
  out(`backup root: ${result.root}`);
  for (const entry of result.deleted) out(`deleted: ${entry.name}`);
  for (const entry of result.kept) out(`kept: ${entry.name}`);
  for (const entry of result.skipped) out(`skipped: ${describeEntry(entry)}`);
  out(`prune: deleted ${result.deleted.length}; kept ${result.kept.length}; skipped ${result.skipped.length}`);
  return 0;
}

export async function runBackupsCommand(argv: string[], io: BackupsIO = {}): Promise<number> {
  const out = io.stdout ?? ((line: string) => console.log(line));
  const err = io.stderr ?? ((line: string) => console.error(line));
  const [command, ...rest] = argv;
  try {
    if (command === '--help' || command === '-h' || command === 'help') {
      out(usage());
      return 0;
    }
    if (!isBackupsCommand(command)) throw new Error(`unknown backups command: ${String(command)}`);
    const flags = parseFlags<ParsedFlags>(
      rest,
      { yes: false, json: false, help: false },
      FLAGS,
      { positional: true }
    );
    if (flags.help) {
      out(usage());
      return 0;
    }
    if (flags.positional.length > 0) throw new Error(`unexpected argument: ${flags.positional[0]}`);

    const root = flags.root ?? resolveBackupRoot();
    if (command === 'list') {
      const result = listBackups(root);
      if (flags.json) out(JSON.stringify(result, null, 2));
      else printList(result, out);
      return 0;
    }
    return await runPrune(flags, root, io, out);
  } catch (e) {
    err(`error: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}
