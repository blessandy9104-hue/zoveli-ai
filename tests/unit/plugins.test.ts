import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { validatePlugin } from '../../packages/shim-dsh-core/src/index';
import { createMockContext } from '../setup';

const PACKAGES_DIR = path.join(__dirname, '..', '..', 'packages');

function discoverPluginEntries(): { pkg: string; entry: string }[] {
  return fs
    .readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({
      pkg: e.name,
      entry: path.join(PACKAGES_DIR, e.name, 'dist', 'index.js'),
    }))
    .filter(({ entry }) => fs.existsSync(entry));
}

describe('plugin contract: every built package loads and sets up', () => {
  const entries = discoverPluginEntries();

  it('discovers a healthy package set', () => {
    // Guard against the test silently covering nothing.
    // 23 feature packages ship (CLI boot path + web); the rest were deleted as dead.
    expect(entries.length).toBeGreaterThanOrEqual(20);
  });

  for (const { pkg, entry } of entries) {
    it(`${pkg} loads and every exported plugin sets up without throwing`, async () => {
      const mod = await import(pathToFileURL(entry).href);
      const plugins = Object.values(mod).filter(
        (v: any) =>
          v && typeof v === 'object' && typeof v.setup === 'function' && typeof v.name === 'string'
      ) as any[];
      if (plugins.length === 0) {
        // Library packages (e.g. the dsh-core shim) export helpers, not plugins.
        const fns = Object.values(mod).filter((v: any) => typeof v === 'function');
        expect(fns.length).toBeGreaterThan(0);
        return;
      }
      for (const plugin of plugins) {
        expect(validatePlugin(plugin)).toEqual([]);
        const ctx = createMockContext();
        await plugin.setup(ctx);
        // A plugin must contribute something: a registration, a
        // provided service, or an event subscription.
        expect(
          ctx.register.mock.calls.length +
            ctx.provide.mock.calls.length +
            ctx.on.mock.calls.length
        ).toBeGreaterThan(0);
      }
    });
  }
});
