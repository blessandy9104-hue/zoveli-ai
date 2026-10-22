import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = join(__dirname, '..', '..');
const CLI = join(ROOT, 'apps', 'cli', 'dist', 'cli.js');
const READY = existsSync(CLI);

function runCli(args: string[], extraEnv: Record<string, string> = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    timeout: 30000,
    cwd: ROOT,
    env: {
      ...process.env,
      ZOVELI_PLUGINS: '',
      ZOVELI_DISABLE_PLUGINS: '',
      ...extraEnv,
    },
  });
}

describe.skipIf(!READY)('zoveli plugins', () => {
  it('lists the default and optional plugin surface', () => {
    const run = runCli(['plugins']);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('26 enabled, 1 opt-in, 0 disabled');
    expect(run.stdout).toContain('zoveli-memory-store');
    expect(run.stdout).toContain('zoveli-guard');
    expect(run.stderr).toBe('');
  });

  it('reports disabled plugins in JSON', () => {
    const run = runCli(['plugins', '--json'], {
      ZOVELI_DISABLE_PLUGINS: 'zoveli-memory-store',
    });
    expect(run.status).toBe(0);
    const report = JSON.parse(run.stdout);
    expect(report.enabled).toBe(25);
    expect(report.disabled).toBe(1);
    expect(report.plugins).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'zoveli-memory-store',
          tier: 'default',
          status: 'disabled',
        }),
      ])
    );
  });

  it('fails on an unknown plugin name instead of ignoring it', () => {
    const run = runCli(['plugins'], { ZOVELI_DISABLE_PLUGINS: 'zoveli-nope' });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('unknown plugin(s) to disable: zoveli-nope');
  });
});
