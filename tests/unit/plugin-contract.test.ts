import { describe, expect, it } from 'vitest';
import {
  PLUGIN_API_VERSION,
  PluginContractError,
  assertPlugins,
  validatePlugin,
} from '../../packages/shim-dsh-core/src/index';
import { ZoveliHost } from '../../packages/host/src/host';
import { selectPlugins } from '../../packages/host/src/plugin-set';
import { resolvePlugins } from '../../packages/host/src/index';

function plugin(name = 'zoveli-test', extra: Record<string, unknown> = {}) {
  return {
    name,
    description: 'test plugin',
    setup() {},
    ...extra,
  };
}

describe('plugin authoring contract', () => {
  it('accepts a minimal plugin and the current API version', () => {
    expect(validatePlugin(plugin())).toEqual([]);
    expect(validatePlugin(plugin('zoveli-v1', { apiVersion: PLUGIN_API_VERSION }))).toEqual([]);
  });

  it('reports bad names, missing setup, async setup and a newer API', () => {
    const issues = [
      ...validatePlugin({ name: 'Bad Name' }),
      ...validatePlugin({ name: 'zoveli-async', setup: async () => {} }),
      ...validatePlugin(plugin('zoveli-new', { apiVersion: PLUGIN_API_VERSION + 1 })),
      ...validatePlugin({ name: 'zoveli-no-setup', setup: 42 }),
    ];
    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'PLUGIN_NAME',
        'PLUGIN_SETUP',
        'PLUGIN_ASYNC_SETUP',
        'PLUGIN_API_UNSUPPORTED',
      ])
    );
  });

  it('rejects duplicate names for a whole mount list', () => {
    expect(() => assertPlugins([plugin('zoveli-dup'), plugin('zoveli-dup')])).toThrow(
      PluginContractError
    );
    try {
      assertPlugins([plugin('zoveli-dup'), plugin('zoveli-dup')]);
    } catch (error) {
      expect((error as PluginContractError).issues[0].code).toBe('PLUGIN_DUPLICATE');
    }
  });
});

describe('host mount validation', () => {
  it('validates the whole list before running any setup', () => {
    const host = new ZoveliHost();
    let ran = false;
    expect(() =>
      host.mount([
        plugin('zoveli-good', {
          setup() {
            ran = true;
          },
        }),
        { name: 'BAD NAME', setup() {} },
      ])
    ).toThrow(/invalid plugin contract/);
    expect(ran).toBe(false);
    expect(host.tools()).toEqual([]);
  });

  it('rejects a setup that returns a Promise', () => {
    const host = new ZoveliHost();
    expect(() =>
      host.mount([
        {
          name: 'zoveli-promise',
          setup() {
            return Promise.resolve();
          },
        },
      ])
    ).toThrow(/setup\(\) returned a Promise/);
  });
});

describe('ZOVELI_PLUGINS selection', () => {
  const base = [plugin('zoveli-core')];
  const optional = [plugin('zoveli-daily'), plugin('zoveli-brief')];

  it('returns the base set when nothing is requested', () => {
    expect(selectPlugins({}, base, optional)).toEqual(base);
    expect(selectPlugins({ ZOVELI_PLUGINS: '  , ' }, base, optional)).toEqual(base);
  });

  it('selects optional plugins by name, trims and dedupes', () => {
    const out = selectPlugins(
      { ZOVELI_PLUGINS: ' zoveli-brief, zoveli-daily, zoveli-brief ' },
      base,
      optional
    );
    expect(out.map((p) => p.name)).toEqual(['zoveli-core', 'zoveli-brief', 'zoveli-daily']);
  });

  it('does not double-mount a name already in the base set', () => {
    const out = selectPlugins({ ZOVELI_PLUGINS: 'zoveli-core' }, base, [
      plugin('zoveli-core'),
    ]);
    expect(out).toHaveLength(1);
  });

  it('fails fast on unknown names and lists what is available', () => {
    expect(() => selectPlugins({ ZOVELI_PLUGINS: 'zoveli-missing' }, base, optional)).toThrow(
      /unknown optional plugin\(s\): zoveli-missing.*zoveli-brief, zoveli-daily/s
    );
    expect(() => selectPlugins({ ZOVELI_PLUGINS: 'zoveli-missing' }, base, [])).toThrow(
      /Available: \(none\)/
    );
  });

  it('resolvePlugins boots the real defaults and rejects unknown opt-ins', () => {
    const names = resolvePlugins({}).map((plugin) => plugin.name);
    expect(names).toContain('zoveli-core');
    expect(names.length).toBeGreaterThan(20);
    expect(() => resolvePlugins({ ZOVELI_PLUGINS: 'zoveli-nope' })).toThrow(/unknown optional/);
  });
});
