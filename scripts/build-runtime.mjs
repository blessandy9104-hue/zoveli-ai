#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function platformSlug(platform = process.platform) {
  if (platform === 'win32') return 'windows';
  if (platform === 'darwin') return 'macos';
  return 'linux';
}

function parseArgs(argv) {
  const options = {
    out: join(ROOT, 'release'),
    node: process.execPath,
    archive: true,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out') options.out = resolve(argv[++i]);
    else if (arg === '--node') options.node = resolve(argv[++i]);
    else if (arg === '--mathcore') options.mathcore = resolve(argv[++i]);
    else if (arg === '--no-archive') options.archive = false;
    else if (arg === '--help') options.help = true;
    else throw new Error(`unknown option: ${arg}`);
  }
  return options;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} exited with code ${result.status}: ${result.stderr || ''}`
    );
  }
  return result.stdout;
}

function version() {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const source = readFileSync(join(ROOT, 'packages', 'core', 'src', 'version.ts'), 'utf8');
  const match = source.match(/ZOVELI_VERSION\s*=\s*['"]([^'"]+)['"]/);
  if (!match) throw new Error('ZOVELI_VERSION is missing from packages/core/src/version.ts');
  if (match[1] !== pkg.version) {
    throw new Error(`version mismatch: package.json ${pkg.version}, runtime ${match[1]}`);
  }
  return pkg.version;
}

function writeLaunchers(target, hasMathcore) {
  const winLauncher = [
    '@echo off',
    'setlocal',
    hasMathcore
      ? 'set "MATHCORE_MCP_COMMAND=%~dp0mathcore\\mathcore-mcp.exe"'
      : 'rem mathcore runtime not bundled',
    'if not defined ZOVELI_VAULT_PATH set "ZOVELI_VAULT_PATH=%USERPROFILE%\\.zoveli\\knowledge-vault"',
    '"%~dp0node.exe" "%~dp0app.cjs" %*',
    'exit /b %ERRORLEVEL%',
    '',
  ].join('\r\n');
  writeFileSync(join(target, 'zoveli.cmd'), winLauncher);

  const unixLauncher = [
    '#!/bin/sh',
    'set -eu',
    'DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)',
    hasMathcore
      ? 'MATHCORE_MCP_COMMAND="$DIR/mathcore/mathcore-mcp"'
      : ':',
    hasMathcore ? 'export MATHCORE_MCP_COMMAND' : ':',
    'if [ -z "${ZOVELI_VAULT_PATH:-}" ]; then',
    '  ZOVELI_VAULT_PATH="$HOME/.zoveli/knowledge-vault"',
    '  export ZOVELI_VAULT_PATH',
    'fi',
    'exec "$DIR/node" "$DIR/app.cjs" "$@"',
    '',
  ].join('\n');
  const unixPath = join(target, 'zoveli');
  writeFileSync(unixPath, unixLauncher);
  chmodSync(unixPath, 0o755);
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function archive(target, outRoot, baseName) {
  const file = join(outRoot, `${baseName}.tar.gz`);
  rmSync(file, { force: true });
  run('tar', ['-czf', file, '-C', outRoot, baseName]);
  const digest = sha256(file);
  writeFileSync(`${file}.sha256`, `${digest}  ${baseName}.tar.gz\n`);
  return { file, digest };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(
      'usage: node scripts/build-runtime.mjs [--out DIR] [--node PATH] [--mathcore DIR] [--no-archive]'
    );
    return;
  }

  const required = [
    join(ROOT, 'packages', 'host', 'dist', 'index.js'),
    join(ROOT, 'apps', 'cli', 'dist', 'cli.js'),
  ];
  for (const file of required) {
    if (!existsSync(file)) throw new Error(`${file} is missing; run "pnpm run build" first`);
  }

  const platform = platformSlug();
  const buildVersion = version();
  const baseName = `zoveli-${buildVersion}-${platform}-${process.arch}`;
  const target = join(options.out, baseName);
  const mathcoreSource =
    options.mathcore ?? join(options.out, `mathcore-${platform}-${process.arch}`, 'mathcore-mcp');
  const mathcoreBinary = join(
    mathcoreSource,
    process.platform === 'win32' ? 'mathcore-mcp.exe' : 'mathcore-mcp'
  );
  if (!existsSync(mathcoreBinary)) {
    throw new Error(
      `${mathcoreBinary} is missing; build it with "node scripts/build-mathcore-runtime.mjs" ` +
        'or pass --mathcore <runtime dir>'
    );
  }
  if (!existsSync(options.node)) throw new Error(`node binary not found: ${options.node}`);

  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });

  await build({
    entryPoints: [join(ROOT, 'apps', 'cli', 'src', 'cli.ts')],
    outfile: join(target, 'app.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    logLevel: 'warning',
    legalComments: 'none',
    sourcemap: false,
  });

  const nodeName = process.platform === 'win32' ? 'node.exe' : 'node';
  copyFileSync(options.node, join(target, nodeName));
  if (process.platform !== 'win32') chmodSync(join(target, nodeName), 0o755);

  cpSync(mathcoreSource, join(target, 'mathcore'), { recursive: true });
  if (process.platform !== 'win32') {
    chmodSync(join(target, 'mathcore', 'mathcore-mcp'), 0o755);
  }
  copyFileSync(join(ROOT, 'LICENSE'), join(target, 'LICENSE'));
  writeLaunchers(target, true);

  const nodeVersion = run(join(target, nodeName), ['--version']).trim();
  writeFileSync(
    join(target, 'runtime.json'),
    `${JSON.stringify(
      {
        schema: 1,
        version: buildVersion,
        platform,
        arch: process.arch,
        node: nodeVersion,
        mathcore: 'bundled',
      },
      null,
      2
    )}\n`
  );

  const appSize = statSync(join(target, 'app.cjs')).size;
  console.log(`${target} (app.cjs ${appSize} bytes, ${nodeVersion})`);

  if (options.archive) {
    const result = archive(target, options.out, baseName);
    console.log(`${result.file}`);
    console.log(`sha256 ${result.digest}`);
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
