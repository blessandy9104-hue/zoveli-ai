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
  });
});
