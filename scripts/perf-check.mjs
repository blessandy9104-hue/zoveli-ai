#!/usr/bin/env node
/**
 * Performance/footprint budgets. Run after `pnpm run build`.
 * Generous ceilings: this catches pathological regressions (accidental full
 * plugin loads, per-call spawns) without flaking on cold CI disks.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUDGETS = {
  cliVersionMs: 10_000,
  hostImportMs: 15_000,
  mountMs: 5_000,
  toolCallMs: 5,
};
const failures = [];
const dir = mkdtempSync(join(tmpdir(), 'zoveli-perf-'));
process.env.ZOVELI_MEMORY_DB = join(dir, 'memory.db');
process.env.ZOVELI_VAULT_PATH = join(dir, 'vault');
delete process.env.ZOVELI_TRACE_LOG;

try {
  const cli = join(ROOT, 'apps', 'cli', 'dist', 'cli.js');
  const hostEntry = join(ROOT, 'packages', 'host', 'dist', 'index.js');
  if (!existsSync(cli) || !existsSync(hostEntry)) {
    console.error('perf:check needs built output; run pnpm run build first');
    process.exit(1);
  }

  const hook = join(dir, 'guard.cjs');
  writeFileSync(
    hook,
    `const Module = require('node:module');
const load = Module._load;
Module._load = function (request) {
  if (request === '@zoveli/host') {
    process.stderr.write('host loaded by fast path\\n');
    process.exit(42);
  }
  return load.apply(this, arguments);
};
`
  );
  const versionStart = performance.now();
  const version = spawnSync(process.execPath, ['--require', hook, cli, '--version'], {
    encoding: 'utf8',
    timeout: BUDGETS.cliVersionMs,
    cwd: ROOT,
  });
  const cliVersionMs = performance.now() - versionStart;
  if (version.status !== 0 || !/^zoveli \d+\.\d+\.\d+/.test(version.stdout)) {
    failures.push(
      `--version failed (status ${version.status}, stderr ${version.stderr.trim() || 'none'})`
    );
  }
  if (cliVersionMs > BUDGETS.cliVersionMs) {
    failures.push(`--version took ${cliVersionMs.toFixed(0)}ms (budget ${BUDGETS.cliVersionMs}ms)`);
  }

  const importStart = performance.now();
  const mod = await import(pathToFileURL(hostEntry).href);
  const hostImportMs = performance.now() - importStart;
  if (hostImportMs > BUDGETS.hostImportMs) {
    failures.push(`host import took ${hostImportMs.toFixed(0)}ms (budget ${BUDGETS.hostImportMs}ms)`);
  }

  const host = new mod.ZoveliHost();
  const mountStart = performance.now();
  host.mount(mod.defaultPlugins);
  const mountMs = performance.now() - mountStart;
  if (mountMs > BUDGETS.mountMs) {
    failures.push(`default mount took ${mountMs.toFixed(0)}ms (budget ${BUDGETS.mountMs}ms)`);
  }

  const tool = {
    name: 'perf_probe',
    description: 'perf probe',
    execute: async () => 1,
  };
  host.mount([
    {
      name: 'perf',
      description: 'perf probe plugin',
      setup(ctx) {
        ctx.register('perf-tools', [tool]);
      },
    },
  ]);
  for (let i = 0; i < 200; i += 1) await host.runTool('perf_probe');
  const callStart = performance.now();
  const calls = 1000;
  for (let i = 0; i < calls; i += 1) await host.runTool('perf_probe');
  const toolCallMs = (performance.now() - callStart) / calls;
  if (toolCallMs > BUDGETS.toolCallMs) {
    failures.push(
      `tool dispatch averaged ${toolCallMs.toFixed(3)}ms (budget ${BUDGETS.toolCallMs}ms)`
    );
  }

  const rssMb = process.memoryUsage().rss / 1048576;
  console.log(`perf: cli --version ${cliVersionMs.toFixed(0)}ms · host import ${hostImportMs.toFixed(0)}ms · mount ${mountMs.toFixed(0)}ms · tool call ${toolCallMs.toFixed(3)}ms · rss ${rssMb.toFixed(0)}MB · tools ${host.tools().length}`);
  if (failures.length > 0) {
    for (const failure of failures) console.error(`perf budget failed: ${failure}`);
    process.exit(1);
  }
} finally {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows may hold the SQLite file briefly; best-effort cleanup.
  }
}
