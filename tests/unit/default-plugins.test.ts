import { describe, it, expect } from 'vitest';
import { defaultPlugins } from '../../packages/host/src/index';

describe('default plugin surface', () => {
  it('mounts only the canonical owning plugins', () => {
    const names = defaultPlugins.map((plugin) => plugin.name);

    expect(defaultPlugins).toHaveLength(26);
    expect(names).not.toContain('zoveli-guard');
    expect(names).toContain('zoveli-math-intelligence');
    expect(names).toContain('zoveli-memory-store');
    expect(names).toContain('zoveli-languages');
    expect(names).not.toContain('zoveli-core');
    expect(names).not.toContain('zoveli-memory');
    expect(names).not.toContain('zoveli-skills');
    expect(names).not.toContain('zoveli-search');
  });

  it('does not mount legacy placeholder skills', () => {
    const names = new Set(defaultPlugins.map((plugin) => plugin.name));
    expect(names.has('zoveli-skills')).toBe(false);
  });
});
