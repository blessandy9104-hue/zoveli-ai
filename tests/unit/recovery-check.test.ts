import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runRecoveryDrill } from '../../apps/cli/src/recovery-check';

const created: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'zoveli-recovery-test-'));
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

describe('recovery drill', () => {
  it('backs up, verifies, restores and reads back synthetic data', async () => {
    const root = tempDir();
    const result = await runRecoveryDrill({ tempRoot: root });

    expect(result.status).toBe('pass');
    expect(result.isolated).toBe(true);
    expect(result.backupNotes).toBe(1);
    expect(result.backupFiles).toBeGreaterThanOrEqual(5);
    expect(result.steps.map((step) => step.id)).toEqual([
      'isolated-data',
      'backup',
      'verify',
      'restore',
      'readback',
      'cleanup',
    ]);
    expect(result.tempDir).toBeUndefined();
    expect(readdirSync(root)).toEqual([]);
  });

  it('keeps the temporary drill directory for inspection on request', async () => {
    const root = tempDir();
    const result = await runRecoveryDrill({ tempRoot: root, keep: true });

    expect(result.tempDir).toBeDefined();
    expect(existsSync(result.tempDir!)).toBe(true);
    expect(readdirSync(result.tempDir!).sort()).toEqual(['backup', 'live', 'restored']);
  });
});
