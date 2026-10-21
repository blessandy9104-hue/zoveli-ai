import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  generatePlugin,
  mountHostDependency,
  mountHostPlugin,
  mountTsReference,
  validatePluginName,
} from '../../scripts/create-plugin.mjs';

const created: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'zoveli-plugin-gen-'));
  created.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of created.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
});

const HOST_FIXTURE = [
  "import { zoveliCore } from '@zoveli/core';",
  '',
  'export const defaultPlugins = [',
  '  zoveliCore,',
  '];',
  '',
  'export const optionalPlugins = [',
  '];',
  '',
].join('\n');

const TSCONFIG_FIXTURE = `{
  "compilerOptions": {},
  "references": [
    { "path": "./packages/core" }
  ]
}
`;

const HOST_MANIFEST_FIXTURE =
  JSON.stringify(
    {
      name: '@zoveli/host',
      version: '0.1.0',
      dependencies: { '@zoveli/core': 'workspace:*' },
    },
    null,
    2
  ) + '\n';

function fixtureRoot(): string {
  const root = tempDir();
  mkdirSync(join(root, 'packages', 'host', 'src'), { recursive: true });
  writeFileSync(join(root, 'packages', 'host', 'src', 'index.ts'), HOST_FIXTURE);
  writeFileSync(join(root, 'packages', 'host', 'package.json'), HOST_MANIFEST_FIXTURE);
  writeFileSync(join(root, 'tsconfig.json'), TSCONFIG_FIXTURE);
  return root;
}

describe('plugin scaffolder', () => {
  it('inherits the root product version', () => {
    const root = fixtureRoot();
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'zoveli', version: '9.9.9' }));
    generatePlugin({ rootDir: root, name: 'versioned-plugin' });
    const manifest = JSON.parse(
      readFileSync(join(root, 'packages', 'versioned-plugin', 'package.json'), 'utf-8')
    );
    expect(manifest.version).toBe('9.9.9');
  });

  it('validates plugin names', () => {
    expect(validatePluginName('daily-brief')).toBe('daily-brief');
    for (const bad of ['', 'Upper', '1nope', '-lead', 'has space', 'x', 'a'.repeat(40)]) {
      expect(() => validatePluginName(bad)).toThrow();
    }
  });

  it('generates package, source and test without touching the host', () => {
    const root = fixtureRoot();
    const result = generatePlugin({ rootDir: root, name: 'daily-brief', description: 'Daily briefing plugin' });

    expect(result.importName).toBe('zoveliDailyBrief');
    expect(result.pluginName).toBe('zoveli-daily-brief');
    expect(result.toolName).toBe('daily_brief_hello');
    expect(existsSync(join(root, 'packages', 'daily-brief', 'package.json'))).toBe(true);
    expect(existsSync(join(root, 'packages', 'daily-brief', 'tsconfig.json'))).toBe(true);
    expect(existsSync(join(root, 'packages', 'daily-brief', 'src', 'index.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages', 'daily-brief', 'README.md'))).toBe(true);
    expect(existsSync(join(root, 'tests', 'unit', 'daily-brief.test.ts'))).toBe(true);

    const source = readFileSync(join(root, 'packages', 'daily-brief', 'src', 'index.ts'), 'utf-8');
    expect(source).toContain("name: 'zoveli-daily-brief'");
    expect(source).toContain('definePlugin');
    expect(source).toContain('apiVersion: PLUGIN_API_VERSION');
    expect(source).toContain("ctx.register('zoveli-daily-brief-tools'");
    expect(source).toContain("additionalProperties: false");

    const readme = readFileSync(join(root, 'packages', 'daily-brief', 'README.md'), 'utf-8');
    expect(readme).toContain('ZOVELI_PLUGINS=zoveli-daily-brief');
    expect(readme).toContain('optionalPlugins');

    const manifest = JSON.parse(readFileSync(join(root, 'packages', 'daily-brief', 'package.json'), 'utf-8'));
    expect(manifest.name).toBe('@zoveli/daily-brief');
    expect(manifest.dependencies['@deepseek-ai/dsh-core']).toBe('workspace:*');

    const test = readFileSync(join(root, 'tests', 'unit', 'daily-brief.test.ts'), 'utf-8');
    expect(test).toContain("from '../../packages/daily-brief/src/index'");

    expect(readFileSync(join(root, 'packages', 'host', 'src', 'index.ts'), 'utf-8')).toBe(HOST_FIXTURE);
    expect(readFileSync(join(root, 'tsconfig.json'), 'utf-8')).toBe(TSCONFIG_FIXTURE);
  });

  it('refuses to overwrite without --force and mounts when asked', () => {
    const root = fixtureRoot();
    generatePlugin({ rootDir: root, name: 'daily-brief' });
    expect(() => generatePlugin({ rootDir: root, name: 'daily-brief' })).toThrow(/already exists/);

    const result = generatePlugin({
      rootDir: root,
      name: 'daily-brief',
      mount: true,
      force: true,
    });
    expect(result.mounted).toEqual({ host: true, hostDependency: true, tsconfig: true });

    const host = readFileSync(join(root, 'packages', 'host', 'src', 'index.ts'), 'utf-8');
    expect(host).toContain("import { zoveliDailyBrief } from '@zoveli/daily-brief';");
    expect(host).toMatch(/export const defaultPlugins = \[\n  zoveliCore,\n\];/);
    expect(host).toMatch(/export const optionalPlugins = \[\n  zoveliDailyBrief,\n\];/);

    const hostManifest = JSON.parse(readFileSync(join(root, 'packages', 'host', 'package.json'), 'utf-8'));
    expect(hostManifest.dependencies['@zoveli/daily-brief']).toBe('workspace:*');

    const tsconfig = JSON.parse(readFileSync(join(root, 'tsconfig.json'), 'utf-8'));
    expect(tsconfig.references).toContainEqual({ path: './packages/daily-brief' });

    const again = generatePlugin({ rootDir: root, name: 'daily-brief', mount: true, force: true });
    expect(again.mounted).toEqual({ host: false, hostDependency: false, tsconfig: false });
    expect(readFileSync(join(root, 'packages', 'host', 'src', 'index.ts'), 'utf-8')).toBe(host);
  });

  it('mount helpers are idempotent and validate tsconfig JSON', () => {
    const host = mountHostPlugin(HOST_FIXTURE, 'zoveliX', '@zoveli/x');
    expect(host.changed).toBe(true);
    expect(host.text).toContain("import { zoveliX } from '@zoveli/x';");
    expect(mountHostPlugin(host.text, 'zoveliX', '@zoveli/x').changed).toBe(false);

    const dep = mountHostDependency(HOST_MANIFEST_FIXTURE, '@zoveli/x');
    expect(dep.changed).toBe(true);
    expect(JSON.parse(dep.text).dependencies['@zoveli/x']).toBe('workspace:*');
    expect(mountHostDependency(dep.text, '@zoveli/x').changed).toBe(false);

    const ts = mountTsReference(TSCONFIG_FIXTURE, './packages/x');
    expect(ts.changed).toBe(true);
    expect(JSON.parse(ts.text).references).toContainEqual({ path: './packages/x' });
    expect(mountTsReference(ts.text, './packages/x').changed).toBe(false);
    expect(() => mountTsReference('{"compilerOptions": {}}', './packages/x')).toThrow(/references/);
  });
});
