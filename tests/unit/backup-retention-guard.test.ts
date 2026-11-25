import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

const guarded = [
  { file: 'install/install-zoveli-runtime.ps1', proof: 'Backup-ExistingRuntime' },
  { file: 'install/install-zoveli-runtime.sh', proof: 'BACKUP_DIR' },
  { file: 'apps/cli/src/update.ts', proof: 'export async function runUpdate' },
] as const;

describe('backup retention stays manual', () => {
  for (const { file, proof } of guarded) {
    it(`${file} cannot reach the prune path`, () => {
      const source = readFileSync(join(repoRoot, file), 'utf8');
      expect(source).toContain(proof);
      expect(source.toLowerCase()).not.toContain('prune');
      expect(source).not.toContain('backup-retention');
    });
  }
});
