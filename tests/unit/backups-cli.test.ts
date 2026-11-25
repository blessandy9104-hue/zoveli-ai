import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runBackupsCommand, type BackupsIO } from '../../apps/cli/src/backups';

const created: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'zoveli-backups-cli-'));
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

function makeBackup(root: string, name: string): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ format: 'zoveli-backup', version: 1 }));
  writeFileSync(join(dir, 'memory.db'), 'not-a-real-db');
  return dir;
}

interface Captured {
  io: BackupsIO;
  lines: string[];
  errors: string[];
}

function capture(extra: Partial<BackupsIO> = {}): Captured {
  const lines: string[] = [];
  const errors: string[] = [];
  return {
    lines,
    errors,
    io: {
      isTTY: false,
      stdout: (line) => lines.push(line),
      stderr: (line) => errors.push(line),
      ...extra,
    },
  };
}

describe('zoveli backups list', () => {
  it('exits 0 when some entries are invalid', async () => {
    const root = join(tempDir(), 'backups');
    mkdirSync(root, { recursive: true });
    makeBackup(root, 'pre-upgrade-20260102-000000-deadbeef');
    mkdirSync(join(root, 'pre-upgrade-20260101-000000-deadbeef'));
    mkdirSync(join(root, 'zoveli-20260101-000000'));

    const { io, lines, errors } = capture();
    const code = await runBackupsCommand(['list', '--root', root], io);

    expect(code).toBe(0);
    expect(errors).toEqual([]);
    expect(lines.join('\n')).toContain('pre-upgrade-20260101-000000-deadbeef [missing-manifest]');
    expect(lines.join('\n')).toContain('zoveli-20260101-000000 [unknown-name]');
    expect(lines.join('\n')).toContain('3 entries; 1 valid; 2 skipped by prune');
  });

  it('prints JSON when asked', async () => {
    const root = join(tempDir(), 'backups');
    mkdirSync(root, { recursive: true });
    makeBackup(root, 'pre-upgrade-20260101-000000-deadbeef');

    const { io, lines } = capture();
    const code = await runBackupsCommand(['list', '--root', root, '--json'], io);

    expect(code).toBe(0);
    const parsed = JSON.parse(lines.join('\n')) as { root: string; entries: { name: string; state: string }[] };
    expect(parsed.root).toBe(root);
    expect(parsed.entries).toEqual([
      expect.objectContaining({ name: 'pre-upgrade-20260101-000000-deadbeef', state: 'ok' }),
    ]);
  });
});

describe('zoveli backups prune', () => {
  it('refuses to delete without --yes when stdin is not a TTY', async () => {
    const root = join(tempDir(), 'backups');
    mkdirSync(root, { recursive: true });
    const jan1 = makeBackup(root, 'pre-upgrade-20260101-000000-deadbeef');
    makeBackup(root, 'pre-upgrade-20260102-000000-deadbeef');

    const { io, errors } = capture({ isTTY: false });
    const code = await runBackupsCommand(['prune', '--keep', '1', '--root', root], io);

    expect(code).toBe(1);
    expect(errors.join('\n')).toContain('--yes');
    expect(existsSync(jan1)).toBe(true);
  });

  it('deletes older backups with --yes', async () => {
    const root = join(tempDir(), 'backups');
    mkdirSync(root, { recursive: true });
    const jan1 = makeBackup(root, 'pre-upgrade-20260101-000000-deadbeef');
    const jan2 = makeBackup(root, 'pre-upgrade-20260102-000000-deadbeef');

    const { io, lines } = capture({ isTTY: false });
    const code = await runBackupsCommand(['prune', '--keep', '1', '--yes', '--root', root], io);

    expect(code).toBe(0);
    expect(lines).toContain('deleted: pre-upgrade-20260101-000000-deadbeef');
    expect(lines).toContain('kept: pre-upgrade-20260102-000000-deadbeef');
    expect(existsSync(jan1)).toBe(false);
    expect(existsSync(jan2)).toBe(true);
  });

  it('keeps the newest valid backup with --keep 0', async () => {
    const root = join(tempDir(), 'backups');
    mkdirSync(root, { recursive: true });
    const jan1 = makeBackup(root, 'pre-upgrade-20260101-000000-deadbeef');
    const jan2 = makeBackup(root, 'pre-upgrade-20260102-000000-deadbeef');

    const { io } = capture({ isTTY: false });
    const code = await runBackupsCommand(['prune', '--keep', '0', '--yes', '--root', root], io);

    expect(code).toBe(0);
    expect(existsSync(jan1)).toBe(false);
    expect(existsSync(jan2)).toBe(true);
  });

  it.each(['n', 'no', ' '])('cancels without deleting when the TTY answer is %j', async (answer) => {
    const root = join(tempDir(), 'backups');
    mkdirSync(root, { recursive: true });
    const jan1 = makeBackup(root, 'pre-upgrade-20260101-000000-deadbeef');
    const jan2 = makeBackup(root, 'pre-upgrade-20260102-000000-deadbeef');
    let question = '';

    const { io, lines } = capture({
      isTTY: true,
      confirm: async (prompt) => {
        question = prompt;
        return answer;
      },
    });
    const code = await runBackupsCommand(['prune', '--keep', '1', '--root', root], io);

    expect(code).toBe(0);
    expect(question).toContain('Delete 1 backup(s)');
    expect(lines).toContain('cancelled');
    expect(existsSync(jan1)).toBe(true);
    expect(existsSync(jan2)).toBe(true);
  });

  it('proceeds on a TTY when the answer is y', async () => {
    const root = join(tempDir(), 'backups');
    mkdirSync(root, { recursive: true });
    const jan1 = makeBackup(root, 'pre-upgrade-20260101-000000-deadbeef');
    const jan2 = makeBackup(root, 'pre-upgrade-20260102-000000-deadbeef');

    const { io } = capture({ isTTY: true, confirm: async () => 'y' });
    const code = await runBackupsCommand(['prune', '--keep', '1', '--root', root], io);

    expect(code).toBe(0);
    expect(existsSync(jan1)).toBe(false);
    expect(existsSync(jan2)).toBe(true);
  });

  it('does not prompt when there is nothing to delete', async () => {
    const root = join(tempDir(), 'backups');
    mkdirSync(root, { recursive: true });
    makeBackup(root, 'pre-upgrade-20260101-000000-deadbeef');

    const { io, lines } = capture({
      isTTY: true,
      confirm: async () => {
        throw new Error('prompt should not be shown');
      },
    });
    const code = await runBackupsCommand(['prune', '--keep', '1', '--root', root], io);

    expect(code).toBe(0);
    expect(lines.join('\n')).toContain('nothing to delete');
  });

  it('refuses --json without --yes', async () => {
    const root = join(tempDir(), 'backups');
    mkdirSync(root, { recursive: true });
    const jan1 = makeBackup(root, 'pre-upgrade-20260101-000000-deadbeef');
    makeBackup(root, 'pre-upgrade-20260102-000000-deadbeef');

    const { io, errors } = capture({ isTTY: true, confirm: async () => 'y' });
    const code = await runBackupsCommand(['prune', '--keep', '1', '--json', '--root', root], io);

    expect(code).toBe(1);
    expect(errors.join('\n')).toContain('--json requires --yes');
    expect(existsSync(jan1)).toBe(true);
  });

  it('prints JSON with --json --yes', async () => {
    const root = join(tempDir(), 'backups');
    mkdirSync(root, { recursive: true });
    makeBackup(root, 'pre-upgrade-20260101-000000-deadbeef');
    makeBackup(root, 'pre-upgrade-20260102-000000-deadbeef');

    const { io, lines } = capture();
    const code = await runBackupsCommand(['prune', '--keep', '1', '--yes', '--json', '--root', root], io);

    expect(code).toBe(0);
    const parsed = JSON.parse(lines.join('\n')) as { deleted: { name: string }[]; kept: { name: string }[] };
    expect(parsed.deleted.map((entry) => entry.name)).toEqual(['pre-upgrade-20260101-000000-deadbeef']);
    expect(parsed.kept.map((entry) => entry.name)).toEqual(['pre-upgrade-20260102-000000-deadbeef']);
  });

  it.each([
    [[]],
    [['--keep', '-1']],
    [['--keep', '1.5']],
    [['--keep', 'abc']],
  ])('rejects invalid --keep usage %j', async (args) => {
    const root = join(tempDir(), 'backups');
    mkdirSync(root, { recursive: true });
    const jan1 = makeBackup(root, 'pre-upgrade-20260101-000000-deadbeef');

    const { io, errors } = capture({ isTTY: false });
    const code = await runBackupsCommand(['prune', ...args, '--yes', '--root', root], io);

    expect(code).toBe(1);
    expect(errors.length).toBeGreaterThan(0);
    expect(existsSync(jan1)).toBe(true);
  });

  it('shows usage for --help', async () => {
    const { io, lines } = capture();
    const code = await runBackupsCommand(['--help'], io);
    expect(code).toBe(0);
    expect(lines.join('\n')).toContain('zoveli backups prune --keep N');
  });

  it('rejects unknown subcommands', async () => {
    const { io, errors } = capture();
    const code = await runBackupsCommand(['explode'], io);
    expect(code).toBe(1);
    expect(errors.join('\n')).toContain('unknown backups command');
  });
});
