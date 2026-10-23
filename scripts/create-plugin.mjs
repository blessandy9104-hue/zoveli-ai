/**
 * Zoveli plugin scaffolder: `pnpm create:plugin <name> [--description "…"] [--mount]`.
 *
 * Generates a workspace package (packages/<name>) with the repo's real
 * authoring convention (definePlugin + apiVersion + ctx.register tool table),
 * a README and a unit test in tests/unit/<name>.test.ts. With --mount it wires
 * the plugin into optionalPlugins (loaded only via ZOVELI_PLUGINS), the host
 * dependency and the root tsconfig references.
 *
 * Node >= 22, zero dependencies. Refuses to overwrite unless --force.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(SCRIPT_DIR, '..');

export const SLUG_PATTERN = /^[a-z][a-z0-9-]{1,30}$/;

/** New packages share the product version so `release:check` stays green. */
export function rootVersion(rootDir = DEFAULT_ROOT) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : '0.1.0';
  } catch {
    return '0.1.0';
  }
}

export function validatePluginName(name) {
  if (!name) throw new Error('plugin name is required (example: pnpm create:plugin daily-brief)');
  if (!SLUG_PATTERN.test(name)) {
    throw new Error(
      `invalid plugin name "${name}": use lowercase letters, digits and dashes (2-31 chars, must start with a letter)`
    );
  }
  return name;
}

function titleCase(slug) {
  return slug
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function quote(text) {
  return `'${String(text).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function packageJsonTemplate(slug, description, version) {
  return (
    JSON.stringify(
      {
        name: `@zoveli/${slug}`,
        version,
        description,
        main: 'dist/index.js',
        types: 'dist/index.d.ts',
        scripts: {
          build: 'tsdown',
          dev: 'tsdown --watch',
          test: 'vitest run',
          lint: 'oxlint',
          clean: 'rm -rf dist',
        },
        keywords: ['zoveli', 'zoveli-plugin'],
        dependencies: {
          '@deepseek-ai/dsh-core': 'workspace:*',
        },
        devDependencies: {
          tsdown: '^0.3.0',
          typescript: 'catalog:',
          vitest: 'catalog:',
          oxlint: 'catalog:',
          '@types/node': '^24.0.0',
        },
        engines: {
          node: '>=22.16.0',
        },
      },
      null,
      2
    ) + '\n'
  );
}

function tsconfigTemplate() {
  return `{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "tsBuildInfoFile": "dist/tsconfig.tsbuildinfo"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
`;
}

function sourceTemplate(slug, title, description, toolName) {
  return `import { definePlugin, PLUGIN_API_VERSION, type Tool } from '@deepseek-ai/dsh-core';

const ${title}Hello: Tool = {
  name: ${quote(toolName)},
  description: ${quote(`Example tool scaffolded for zoveli-${slug}; replace it.`)},
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Who to greet (optional)' },
    },
    additionalProperties: false,
  },
  async execute(args: { name?: string } = {}) {
    return {
      ok: true,
      plugin: ${quote(`zoveli-${slug}`)},
      message: 'hello ' + (args.name || 'world') + ${quote(` from ${slug}`)},
    };
  },
};

export const zoveli${title} = definePlugin({
  name: ${quote(`zoveli-${slug}`)},
  apiVersion: PLUGIN_API_VERSION,
  description: ${quote(description)},
  setup(ctx) {
    ctx.register(${quote(`zoveli-${slug}-tools`)}, [${title}Hello]);
  },
});

export default zoveli${title};
`;
}

function readmeTemplate(slug, title, description, toolName) {
  return `# @zoveli/${slug}

${description}

## Enable

\`\`\`bash
pnpm install && pnpm run build
ZOVELI_PLUGINS=zoveli-${slug} pnpm start
\`\`\`

The \`--mount\` scaffolder option wires this package into
\`optionalPlugins\` in \`packages/host/src/index.ts\`; it stays unloaded
until named in \`ZOVELI_PLUGINS\`. Promoting it to \`defaultPlugins\` is a
core change (ADR + maintainer sign-off, see \`docs/core-plugins.md\`).

## Tool

\`${toolName}\` accepts \`{ name?: string }\` and returns
\`{ ok, plugin, message }\`. Replace it in \`src/index.ts\`.

## Test

\`\`\`bash
pnpm exec vitest run tests/unit/${slug}.test.ts
pnpm run plugin:check
\`\`\`

Authoring guide: [docs/plugin-sdk/README.md](../../docs/plugin-sdk/README.md).
`;
}

function testTemplate(slug, title, toolName) {
  return `import { describe, it, expect } from 'vitest';
import { zoveli${title} } from '../../packages/${slug}/src/index';
import { createMockContext } from '../setup';

describe('zoveli-${slug} (scaffolded)', () => {
  it('registers the ${slug} tool table', () => {
    const ctx = createMockContext();
    zoveli${title}.setup(ctx);
    const call = ctx.register.mock.calls.find((c: any[]) => c[0] === 'zoveli-${slug}-tools');
    expect(call).toBeDefined();
    expect(call[1].some((t: any) => t.name === '${toolName}')).toBe(true);
  });

  it('${toolName} returns a result', async () => {
    const ctx = createMockContext();
    zoveli${title}.setup(ctx);
    const call = ctx.register.mock.calls.find((c: any[]) => c[0] === 'zoveli-${slug}-tools');
    const tool = call[1].find((t: any) => t.name === '${toolName}');
    await expect(tool.execute({})).resolves.toEqual(expect.objectContaining({ ok: true }));
  });
});
`;
}

export function mountHostPlugin(text, importName, packageName) {
  if (text.includes(`'${packageName}'`)) return { text, changed: false };
  const lastImport = text.lastIndexOf('\nimport ');
  let insertAt;
  if (lastImport === -1) {
    if (!text.startsWith('import ')) throw new Error('no import block found in packages/host/src/index.ts');
    insertAt = text.indexOf('\n');
    if (insertAt === -1) insertAt = text.length;
  } else {
    insertAt = text.indexOf('\n', lastImport + 1);
  }
  let out = text.slice(0, insertAt) + `\nimport { ${importName} } from '${packageName}';` + text.slice(insertAt);
  const declaration = /export const optionalPlugins\b/.exec(out);
  if (!declaration) {
    throw new Error('optionalPlugins array not found in packages/host/src/index.ts');
  }
  const equals = out.indexOf('=', declaration.index);
  const arrayStart = out.indexOf('[', equals);
  if (equals === -1 || arrayStart === -1) {
    throw new Error('optionalPlugins array not found in packages/host/src/index.ts');
  }
  const arrayEnd = out.indexOf('];', arrayStart);
  if (arrayEnd === -1) {
    throw new Error('optionalPlugins array end not found in packages/host/src/index.ts');
  }
  out = out.slice(0, arrayEnd) + `  ${importName},\n` + out.slice(arrayEnd);
  return { text: out, changed: true };
}

export function mountHostDependency(text, packageName) {
  const manifest = JSON.parse(text);
  manifest.dependencies = manifest.dependencies ?? {};
  if (manifest.dependencies[packageName]) return { text, changed: false };
  manifest.dependencies[packageName] = 'workspace:*';
  return { text: JSON.stringify(manifest, null, 2) + '\n', changed: true };
}

export function mountTsReference(text, relPath) {
  if (text.includes(`"${relPath}"`)) return { text, changed: false };
  const refsKey = text.indexOf('"references"');
  if (refsKey === -1) throw new Error('"references" array not found in tsconfig.json');
  const open = text.indexOf('[', refsKey);
  const close = text.indexOf(']', open);
  if (open === -1 || close === -1) throw new Error('"references" array is malformed in tsconfig.json');
  const entries = text
    .slice(open + 1, close)
    .split('\n')
    .map((line) => line.trim().replace(/,$/, ''))
    .filter(Boolean);
  entries.push(`{ "path": "${relPath}" }`);
  const rebuilt = '\n' + entries.map((entry) => `    ${entry}`).join(',\n') + '\n  ';
  const out = text.slice(0, open + 1) + rebuilt + text.slice(close);
  JSON.parse(out);
  return { text: out, changed: true };
}

export function generatePlugin(options) {
  const rootDir = path.resolve(options.rootDir ?? DEFAULT_ROOT);
  const slug = validatePluginName(options.name);
  const description = options.description ?? `Zoveli plugin ${slug} (scaffolded)`;
  const version = options.version ?? rootVersion(rootDir);
  const mount = options.mount === true;
  const force = options.force === true;
  const title = titleCase(slug);
  const importName = `zoveli${title}`;
  const toolName = `${slug.replace(/-/g, '_')}_hello`;
  const packageDir = path.join(rootDir, 'packages', slug);
  const testFile = path.join(rootDir, 'tests', 'unit', `${slug}.test.ts`);
  const warnings = [];

  if (fs.existsSync(packageDir) && !force) {
    throw new Error(`packages/${slug} already exists (use --force to overwrite)`);
  }
  if (fs.existsSync(testFile) && !force) {
    throw new Error(`tests/unit/${slug}.test.ts already exists (use --force to overwrite)`);
  }

  const files = [
    {
      file: path.join(packageDir, 'package.json'),
      content: packageJsonTemplate(slug, description, version),
    },
    { file: path.join(packageDir, 'tsconfig.json'), content: tsconfigTemplate() },
    {
      file: path.join(packageDir, 'src', 'index.ts'),
      content: sourceTemplate(slug, title, description, toolName),
    },
    { file: path.join(packageDir, 'README.md'), content: readmeTemplate(slug, title, description, toolName) },
    { file: testFile, content: testTemplate(slug, title, toolName) },
  ];
  for (const { file, content } of files) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, 'utf-8');
  }

  const mounted = { host: false, hostDependency: false, tsconfig: false };
  if (mount) {
    const hostPath = path.join(rootDir, 'packages', 'host', 'src', 'index.ts');
    if (!fs.existsSync(hostPath)) {
      warnings.push('packages/host/src/index.ts not found; mount skipped');
    } else {
      try {
        const before = fs.readFileSync(hostPath, 'utf-8');
        const result = mountHostPlugin(before, importName, `@zoveli/${slug}`);
        if (result.changed) {
          fs.writeFileSync(hostPath, result.text, 'utf-8');
          mounted.host = true;
        }
      } catch (e) {
        warnings.push(`host mount failed: ${e instanceof Error ? e.message : String(e)}`);
      }
      const hostManifestPath = path.join(rootDir, 'packages', 'host', 'package.json');
      if (!fs.existsSync(hostManifestPath)) {
        warnings.push('packages/host/package.json not found; dependency mount skipped');
      } else {
        try {
          const before = fs.readFileSync(hostManifestPath, 'utf-8');
          const result = mountHostDependency(before, `@zoveli/${slug}`);
          if (result.changed) {
            fs.writeFileSync(hostManifestPath, result.text, 'utf-8');
            mounted.hostDependency = true;
          }
        } catch (e) {
          warnings.push(`host dependency mount failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
    const tsconfigPath = path.join(rootDir, 'tsconfig.json');
    if (!fs.existsSync(tsconfigPath)) {
      warnings.push('tsconfig.json not found; reference mount skipped');
    } else {
      try {
        const before = fs.readFileSync(tsconfigPath, 'utf-8');
        const result = mountTsReference(before, `./packages/${slug}`);
        if (result.changed) {
          fs.writeFileSync(tsconfigPath, result.text, 'utf-8');
          mounted.tsconfig = true;
        }
      } catch (e) {
        warnings.push(`tsconfig mount failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  return {
    dir: packageDir,
    testFile,
    files: files.map((f) => f.file),
    mounted,
    warnings,
    importName,
    pluginName: `zoveli-${slug}`,
    toolName,
  };
}

function usage() {
  return `Zoveli plugin scaffolder
Usage: pnpm create:plugin <name> [options]

Arguments:
  <name>                lowercase slug (letters, digits, dashes; e.g. daily-brief)

Options:
  -d, --description <text>  package + plugin description
      --mount               wire optionalPlugins in packages/host/src/index.ts, the
                            host dependency and root tsconfig.json (opt-in, not core)
      --force               overwrite existing files
  -h, --help                show this help

Next steps after scaffolding:
  pnpm install && pnpm run build && pnpm test
  ZOVELI_PLUGINS=zoveli-<name> pnpm start   (only with --mount)
  (without --mount, wire optionalPlugins yourself; see docs/plugin-sdk/README.md)`;
}

export function parseArgs(argv) {
  const parsed = { name: undefined, description: undefined, mount: false, force: false, help: false, rootDir: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') parsed.help = true;
    else if (arg === '--mount') parsed.mount = true;
    else if (arg === '--force') parsed.force = true;
    else if (arg === '--description' || arg === '-d') {
      const value = argv[i + 1];
      if (!value) throw new Error(`${arg} requires a value`);
      parsed.description = value;
      i += 1;
    } else if (arg.startsWith('--description=')) parsed.description = arg.slice('--description='.length);
    else if (arg === '--root') {
      const value = argv[i + 1];
      if (!value) throw new Error('--root requires a path');
      parsed.rootDir = value;
      i += 1;
    } else if (arg.startsWith('-')) throw new Error(`unknown option: ${arg}`);
    else if (!parsed.name) parsed.name = arg;
    else throw new Error(`unexpected argument: ${arg}`);
  }
  return parsed;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.name) {
    console.log(usage());
    process.exit(args.help ? 0 : 1);
  }
  const result = generatePlugin(args);
  console.log(`created packages/${path.basename(result.dir)}/ (plugin ${result.importName}, tool ${result.toolName})`);
  for (const file of result.files) console.log(`  + ${path.relative(path.resolve(args.rootDir ?? DEFAULT_ROOT), file)}`);
  if (args.mount) {
    console.log(
      `mounted (opt-in): host=${result.mounted.host ? 'yes' : 'no'}, ` +
        `host-dependency=${result.mounted.hostDependency ? 'yes' : 'no'}, ` +
        `tsconfig=${result.mounted.tsconfig ? 'yes' : 'no'}`
    );
    console.log(`enable with: ZOVELI_PLUGINS=${result.pluginName} pnpm start`);
  }
  for (const warning of result.warnings) console.log(`warning: ${warning}`);
  console.log('\nNext steps: pnpm install && pnpm run build && pnpm test');
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    main();
  } catch (e) {
    console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
