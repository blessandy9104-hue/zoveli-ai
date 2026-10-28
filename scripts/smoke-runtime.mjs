#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function quoteArg(value) {
  const text = String(value);
  if (text.includes('\0') || /[\r\n%]/.test(text)) {
    throw new Error('unsafe control character in argument');
  }
  if (!/[ \t"]/.test(text)) return text;
  const escaped = text.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1');
  return `"${escaped}"`;
}

function safeExecutablePath(value) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.includes('\0') ||
    /["\r\n%]/.test(value)
  ) {
    throw new Error('unsafe executable path');
  }
  return value;
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dir') options.dir = resolve(argv[++i]);
    else if (arg === '--help') options.help = true;
    else throw new Error(`unknown option: ${arg}`);
  }
  return options;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} exited with code ${result.status}\n${result.stdout || ''}${result.stderr || ''}`
    );
  }
  return result.stdout;
}

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('usage: node scripts/smoke-runtime.mjs --dir <runtime directory>');
    return;
  }
  let dir = options.dir;
  if (!dir) {
    const releaseDir = join(ROOT, 'release');
    const candidates = readdirSync(releaseDir)
      .filter((name) => name.startsWith('zoveli-'))
      .map((name) => join(releaseDir, name))
      .filter((candidate) => existsSync(join(candidate, 'runtime.json')))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
    if (candidates.length === 0) throw new Error('no packaged runtime found under release/');
    dir = candidates[0];
  }

  const runtime = JSON.parse(readFileSync(join(dir, 'runtime.json'), 'utf8'));
  check(runtime.schema === 1, 'runtime.json schema must be 1');
  check(runtime.mathcore === 'bundled', 'runtime.json must declare bundled mathcore');

  const node = join(dir, process.platform === 'win32' ? 'node.exe' : 'node');
  const app = join(dir, 'app.cjs');
  const mathcore = join(
    dir,
    'mathcore',
    process.platform === 'win32' ? 'mathcore-mcp.exe' : 'mathcore-mcp'
  );
  const launcher = join(dir, process.platform === 'win32' ? 'zoveli.cmd' : 'zoveli');
  for (const file of [node, app, mathcore, launcher]) {
    check(existsSync(file), `missing runtime file: ${file}`);
  }

  const versionOut = run(node, [app, '--version']).trim();
  check(versionOut === `zoveli ${runtime.version}`, `unexpected version: ${versionOut}`);
  const help = run(node, [app, '--help']);
  check(help.includes('Usage:'), 'help output is missing usage');

  const runLauncher = (args, options = {}) =>
    process.platform === 'win32'
      ? run(
          'cmd.exe',
          [
            '/d',
            '/s',
            '/c',
            args.length
              ? `""${safeExecutablePath(launcher)}" ${args.map(quoteArg).join(' ')}"`
              : `""${safeExecutablePath(launcher)}""`,
          ],
          { windowsVerbatimArguments: true, ...options }
        )
      : run(launcher, args, options);

  const launcherVersion = runLauncher(['--version']).trim();
  check(
    launcherVersion === `zoveli ${runtime.version}`,
    `launcher returned unexpected version: ${launcherVersion}`
  );

  const temp = mkdtempSync(join(tmpdir(), 'zoveli-runtime-smoke-'));
  try {
    const env = {
      ...process.env,
      MATHCORE_AUDIT: join(temp, 'audit.jsonl'),
      MATHCORE_MCP_COMMAND: mathcore,
      ZOVELI_MEMORY_DB: join(temp, 'memory.db'),
      ZOVELI_VAULT_PATH: join(temp, 'vault'),
    };

    const rpc = [
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
      JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'compute', arguments: { request: '2+2' } },
      }),
      '',
    ].join('\n');
    const mathOut = run(mathcore, [], { env, input: rpc });
    const replies = mathOut
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const compute = replies.find((reply) => reply.id === 2);
    check(compute, 'mathcore did not answer the compute call');
    check(compute.result?.isError === false, 'mathcore compute failed');
    check(compute.result.content[0].text.includes('"all_verified": true'), 'mathcore result was not verified');
    check(compute.result.content[0].text.includes('"value": "4"'), 'mathcore returned the wrong value');

    const launcherEnv = { ...env };
    delete launcherEnv.MATHCORE_MCP_COMMAND;

    const config = JSON.parse(runLauncher(['config-check', '--json'], { env: launcherEnv }));
    check(config.ready === true, `config-check reported: ${config.failures}`);
    check(
      config.effective.math.command === mathcore,
      `launcher resolved the wrong math command: ${config.effective.math.command}`
    );

    const healthOut = runLauncher(['health', '--json'], { env: launcherEnv });
    const health = JSON.parse(healthOut);
    const probe = health.checks.find((entry) => entry.id === 'mathcore-probe');
    check(health.status !== 'fail', `health reported ${health.status}`);
    check(probe?.level === 'ok', `mathcore health probe was ${probe?.level ?? 'missing'}`);

    console.log(
      `runtime OK: zoveli ${runtime.version}, ${runtime.node}, mathcore ${probe.summary}`
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
