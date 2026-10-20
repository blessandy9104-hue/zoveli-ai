import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = join(__dirname, '..', '..');
const CLI = join(ROOT, 'apps', 'cli', 'dist', 'cli.js');
const HOOK = join(__dirname, '..', 'fixtures', 'cli-require-guard.cjs');
const READY = existsSync(CLI);

function runCli(...args: string[]) {
  return spawnSync(process.execPath, ['--require', HOOK, CLI, ...args], {
    encoding: 'utf8',
    timeout: 30000,
    cwd: ROOT,
  });
}

describe.skipIf(!READY)('CLI fast paths', () => {
  it('prints --version without loading the host', () => {
    const run = runCli('--version');
    expect(run.status).toBe(0);
    expect(run.stdout).toMatch(/^zoveli \d+\.\d+\.\d+/);
    expect(run.stderr).not.toContain('fast-path loaded @zoveli/host');
  });

  it('prints --help without loading the host', () => {
    const run = runCli('--help');
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('Usage:');
    expect(run.stdout).toContain('assistant config-check');
    expect(run.stderr).not.toContain('fast-path loaded @zoveli/host');
  });

  it('runs config-check without mounting the default plugins', () => {
    const run = runCli('config-check', '--json');
    expect([0, 1]).toContain(run.status);
    expect(run.stdout).toContain('"ready"');
    expect(run.stderr).not.toContain('fast-path loaded @zoveli/host');
  });
});
