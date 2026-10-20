import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_ROOT,
  SHIM_PACKAGE,
  changelogHasVersion,
  releaseCheck,
  tsconfigReferences,
  validateRelease,
  versionConstant,
  workspacePackages,
} from '../../scripts/release-check.mjs';

function pkg(dir: string, name: string, version: string) {
  return { dir, name, version, private: true };
}

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    rootVersion: '0.1.0',
    packages: [
      pkg('packages/core', '@zoveli/core', '0.1.0'),
      pkg('apps/cli', '@zoveli/cli', '0.1.0'),
    ],
    references: ['packages/core', 'apps/cli'],
    constant: '0.1.0',
    changelog: '# Changelog\n\n## [0.1.0] - 2026-10-12\n\n- first release\n',
    release: false,
    dirty: false,
    allowDirty: false,
    requireTag: false,
    tagsAtHead: [],
    ...overrides,
  };
}

describe('release consistency checks', () => {
  it('accepts a consistent workspace', () => {
    const result = validateRelease(validInput());
    expect(result.errors).toEqual([]);
  });

  it('exempts the shim but rejects feature packages that drift', () => {
    const result = validateRelease(
      validInput({
        packages: [
          pkg('packages/shim-dsh-core', SHIM_PACKAGE, '0.0.1-shim.1'),
          pkg('packages/core', '@zoveli/core', '0.2.0'),
        ],
        references: ['packages/shim-dsh-core', 'packages/core'],
      })
    );
    expect(result.errors.join('\n')).toContain('packages/core (@zoveli/core) version 0.2.0');
    expect(result.errors.join('\n')).not.toContain(SHIM_PACKAGE);
  });

  it('requires tsconfig references in both directions', () => {
    const result = validateRelease(
      validInput({ references: ['packages/core', 'packages/core', 'packages/ghost'] })
    );
    const text = result.errors.join('\n');
    expect(text).toContain('missing a reference to apps/cli');
    expect(text).toContain('references packages/ghost, which is not a workspace package');
  });

  it('pins the runtime version constant to package.json', () => {
    const mismatch = validateRelease(validInput({ constant: '0.0.9' }));
    expect(mismatch.errors.join('\n')).toContain('ZOVELI_VERSION 0.0.9');

    const missing = validateRelease(validInput({ constant: null }));
    expect(missing.errors.join('\n')).toContain('does not export ZOVELI_VERSION');
  });

  it('recognizes changelog entry formats', () => {
    expect(changelogHasVersion('## [0.2.0] - 2026-10-19', '0.2.0')).toBe(true);
    expect(changelogHasVersion('## 0.2.0', '0.2.0')).toBe(true);
    expect(changelogHasVersion('## [v0.2.0]', '0.2.0')).toBe(true);
    expect(changelogHasVersion('## [0.2.0-rc.1]', '0.2.0')).toBe(false);
    expect(changelogHasVersion('', '0.2.0')).toBe(false);
  });

  it('gates releases on changelog, clean tree and tag', () => {
    const missing = validateRelease(validInput({ release: true, changelog: null }));
    expect(missing.errors.join('\n')).toContain('no "## 0.1.0" entry');

    const dirty = validateRelease(validInput({ release: true, dirty: true }));
    expect(dirty.errors.join('\n')).toContain('working tree is dirty');

    const allowed = validateRelease(validInput({ release: true, dirty: true, allowDirty: true }));
    expect(allowed.errors).toEqual([]);

    const untagged = validateRelease(validInput({ release: true, requireTag: true }));
    expect(untagged.errors.join('\n')).toContain('HEAD is not tagged v0.1.0');

    const tagged = validateRelease(
      validInput({ release: true, requireTag: true, tagsAtHead: ['v0.1.0'] })
    );
    expect(tagged.errors).toEqual([]);
  });

  it('passes against the real repository', () => {
    const root = DEFAULT_ROOT;
    const rootVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
    const packages = workspacePackages(root);
    expect(packages.length).toBeGreaterThan(20);
    expect(versionConstant(root)).toBe(rootVersion);
    expect(tsconfigReferences(root)).toContain('packages/diagnostics');
    expect(releaseCheck(root).errors).toEqual([]);
  });
});
