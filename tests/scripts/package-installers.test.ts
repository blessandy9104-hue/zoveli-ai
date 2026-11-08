import { describe, expect, it } from 'vitest';
import { findRuntime } from '../../scripts/package-installers.mjs';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('findRuntime', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'zoveli-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function createDirs(names: string[]) {
    names.forEach((name) => {
      const dirPath = join(tmpDir, name);
      mkdirSync(dirPath, { recursive: true });
      writeFileSync(join(dirPath, 'runtime.json'), '{}');
    });
  }

  it('selects the highest stable version', () => {
    createDirs(['zoveli-0.1.0-windows-x64', 'zoveli-0.1.5-windows-x64', 'zoveli-0.2.0-windows-x64']);
    const result = findRuntime(tmpDir, 'windows', 'x64');
    expect(result).toBe(join(tmpDir, 'zoveli-0.2.0-windows-x64'));
  });

  it('selects stable release over prerelease of same version', () => {
    createDirs(['zoveli-0.1.0-alpha.1-windows-x64', 'zoveli-0.1.0-windows-x64']);
    const result = findRuntime(tmpDir, 'windows', 'x64');
    expect(result).toBe(join(tmpDir, 'zoveli-0.1.0-windows-x64'));
  });

  it('prefers higher prerelease over lower prerelease of same version', () => {
    createDirs(['zoveli-0.1.0-alpha.1-windows-x64', 'zoveli-0.1.0-alpha.2-windows-x64']);
    const result = findRuntime(tmpDir, 'windows', 'x64');
    expect(result).toBe(join(tmpDir, 'zoveli-0.1.0-alpha.2-windows-x64'));
  });

  it('returns null for empty directory', () => {
    const result = findRuntime(tmpDir, 'windows', 'x64');
    expect(result).toBeNull();
  });

  it('filters out malformed directory names', () => {
    createDirs(['zoveli-invalid-windows-x64', 'zoveli-0.1.0-windows-x64', 'zoveli-abc-windows-x64']);
    const result = findRuntime(tmpDir, 'windows', 'x64');
    expect(result).toBe(join(tmpDir, 'zoveli-0.1.0-windows-x64'));
  });

  it('filters out non-matching platform/arch', () => {
    createDirs(['zoveli-0.1.0-windows-x64', 'zoveli-0.2.0-darwin-arm64']);
    const result = findRuntime(tmpDir, 'linux', 'x64');
    expect(result).toBeNull();
  });

  it('returns null when no candidates match platform/arch', () => {
    createDirs(['zoveli-0.1.0-windows-x64']);
    const result = findRuntime(tmpDir, 'linux', 'x64');
    expect(result).toBeNull();
  });

  it('selects higher major version', () => {
    createDirs(['zoveli-0.9.0-windows-x64', 'zoveli-1.0.0-windows-x64']);
    const result = findRuntime(tmpDir, 'windows', 'x64');
    expect(result).toBe(join(tmpDir, 'zoveli-1.0.0-windows-x64'));
  });

  it('handles prerelease versions with numeric and string identifiers', () => {
    createDirs([
      'zoveli-0.1.0-alpha.1-windows-x64',
      'zoveli-0.1.0-alpha.2-windows-x64',
      'zoveli-0.1.0-alpha.10-windows-x64',
    ]);
    const result = findRuntime(tmpDir, 'windows', 'x64');
    expect(result).toBe(join(tmpDir, 'zoveli-0.1.0-alpha.10-windows-x64'));
  });

  it('sorts prerelease before release of same version', () => {
    createDirs(['zoveli-0.1.0-beta.1-windows-x64', 'zoveli-0.1.0-windows-x64']);
    const result = findRuntime(tmpDir, 'windows', 'x64');
    expect(result).toBe(join(tmpDir, 'zoveli-0.1.0-windows-x64'));
  });
});
