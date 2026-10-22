import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = join(__dirname, '..', '..');
const CLI = join(ROOT, 'apps', 'cli', 'dist', 'cli.js');
const READY = existsSync(CLI);

function runCli(input: string, dir: string) {
  return spawnSync(process.execPath, [CLI], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 60000,
    input,
    env: {
      ...process.env,
      ZOVELI_MEMORY_DB: join(dir, 'memory.db'),
      ZOVELI_VAULT_PATH: join(dir, 'vault'),
      ZOVELI_OLLAMA_URL: 'http://127.0.0.1:9',
      ZOVELI_MATHCORE_PREWARM: '0',
    },
  });
}

describe.skipIf(!READY)('REPL quick memory', () => {
  it('saves and searches a note without a chat model', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zoveli-repl-memory-'));
    try {
      const fact = `unit-memory-${Date.now()}-cobalt`;
      const run = runCli(`/remember ${fact}\n/recall ${fact}\n/quit\n`, dir);
      expect(run.status).toBe(0);
      expect(run.stdout).toContain(`remembered: ${fact}`);
      expect(run.stdout).toContain(`- ${fact}: ${fact}`);
      expect(run.stdout).not.toContain('error:');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('explains usage for missing arguments', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zoveli-repl-memory-'));
    try {
      const run = runCli('/remember\n/recall\n/quit\n', dir);
      expect(run.status).toBe(0);
      expect(run.stdout).toContain('usage: /remember <fact>');
      expect(run.stdout).toContain('usage: /recall <query>');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
