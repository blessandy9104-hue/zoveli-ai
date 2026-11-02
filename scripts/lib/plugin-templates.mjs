/**
 * File templates for the plugin scaffolder. Kept separate from generation and
 * mount logic so the generated surface is easy to review as plain text.
 */

export function titleCase(slug) {
  return slug
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function quote(text) {
  return `'${String(text).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

export function packageJsonTemplate(slug, description, version) {
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

export function tsconfigTemplate() {
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

export function sourceTemplate(slug, title, description, toolName) {
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

export function readmeTemplate(slug, title, description, toolName) {
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

export function testTemplate(slug, title, toolName) {
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
