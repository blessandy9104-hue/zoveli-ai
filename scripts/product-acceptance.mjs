#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const IS_WIN = process.platform === 'win32';
const CLEARED_ENV = [
  'OPENAI_API_KEY',
  'DEEPSEEK_API_KEY',
  'OPENROUTER_API_KEY',
  'GROQ_API_KEY',
  'TOGETHER_API_KEY',
  'ZOVELI_API_KEY',
  'ZOVELI_API_BASE',
  'ZOVELI_MODEL',
  'ZOVELI_OLLAMA_MODEL',
  'ZOVELI_MEMORY_DB',
  'ZOVELI_VAULT_PATH',
  'ZOVELI_MEMORY_EXPORT',
  'ZOVELI_AUTH_REQUIRED',
  'ZOVELI_AUTH_DIR',
  'ZOVELI_PLUGINS',
  'ZOVELI_DISABLE_PLUGINS',
  'ZOVELI_TRACE',
  'ZOVELI_TRACE_LOG',
  'ZOVELI_DEBUG',
  'MATHCORE_MCP_COMMAND',
  'MATHCORE_AUDIT',
];

function parseArgs(argv) {
  const options = { maxSeconds: 600, keep: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--archive') options.archive = resolve(argv[++i]);
    else if (arg === '--dir') options.dir = resolve(argv[++i]);
    else if (arg === '--report') options.report = resolve(argv[++i]);
    else if (arg === '--max-seconds') options.maxSeconds = Number(argv[++i]);
    else if (arg === '--keep') options.keep = true;
    else if (arg === '--help') options.help = true;
    else throw new Error(`unknown option: ${arg}`);
  }
  return options;
}

function findArchive() {
  const releaseDir = join(ROOT, 'release');
  if (!existsSync(releaseDir)) throw new Error('release/ does not exist; run "pnpm run package:runtime" first');
  const candidates = readdirSync(releaseDir)
    .filter((name) => name.endsWith('.tar.gz'))
    .map((name) => join(releaseDir, name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (candidates.length === 0) throw new Error('no runtime archive found under release/');
  return candidates[0];
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} exited with code ${result.status}\n` +
        `--- stdout ---\n${result.stdout || ''}\n--- stderr ---\n${result.stderr || ''}`
    );
  }
  return result.stdout;
}

function quoteArg(value) {
  return /[ \t"]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

function runLauncher(launcher, args, env, options = {}) {
  if (!IS_WIN) return run(launcher, args, { env, ...options });
  const command = args.length
    ? `""${launcher}" ${args.map(quoteArg).join(' ')}"`
    : `""${launcher}""`;
  return run(
    process.env.ComSpec || 'cmd.exe',
    ['/d', '/s', '/c', command],
    { windowsVerbatimArguments: true, env, ...options }
  );
}

function runInstaller(archive, dir, env) {
  if (IS_WIN) {
    return run(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        join(ROOT, 'install', 'install-zoveli-runtime.ps1'),
        '-Yes',
        '-Archive',
        archive,
        '-Dir',
        dir,
      ],
      { env, timeout: 300000 }
    );
  }
  return run(
    'bash',
    [
      join(ROOT, 'install', 'install-zoveli-runtime.sh'),
      '--yes',
      '--archive',
      archive,
      '--dir',
      dir,
    ],
    { env, timeout: 300000 }
  );
}

function makeRollbackUpgradeArchive(archive, workDir) {
  const extract = join(workDir, 'rollback-upgrade-extract');
  mkdirSync(extract, { recursive: true });
  run('tar', ['-xzf', archive, '-C', extract]);
  const top = readdirSync(extract).find((name) => existsSync(join(extract, name, 'runtime.json')));
  assert(top, 'archive has no runtime root');
  const root = join(extract, top);
  const marker = '.zoveli-acceptance-preflight';
  if (IS_WIN) {
    const launcherPath = join(root, 'zoveli.cmd');
    const lines = readFileSync(launcherPath, 'utf8').split(/\r?\n/);
    const setlocalIndex = lines.findIndex((line) => line.trim() === 'setlocal');
    assert(setlocalIndex >= 0, 'Windows launcher has no setlocal');
    lines.splice(
      setlocalIndex + 1,
      0,
      `if exist "%~dp0${marker}" (`,
      `  del "%~dp0${marker}" >nul 2>&1`,
      '  echo synthetic post-swap failure 1>&2',
      '  exit /b 1',
      ')',
      `type nul > "%~dp0${marker}"`
    );
    writeFileSync(launcherPath, lines.join('\r\n'));
  } else {
    const launcherPath = join(root, 'zoveli');
    const lines = readFileSync(launcherPath, 'utf8').split('\n');
    const dirIndex = lines.findIndex((line) => line.startsWith('DIR='));
    assert(dirIndex >= 0, 'POSIX launcher has no DIR');
    lines.splice(
      dirIndex + 1,
      0,
      `MARKER="$DIR/${marker}"`,
      'if [ -f "$MARKER" ]; then',
      '  rm -f "$MARKER"',
      '  echo "synthetic post-swap failure" >&2',
      '  exit 1',
      'fi',
      ': > "$MARKER"'
    );
    writeFileSync(launcherPath, lines.join('\n'));
  }
  const brokenArchive = join(workDir, 'rollback-upgrade.tar.gz');
  run('tar', ['-czf', brokenArchive, '-C', extract, top]);
  const digest = createHash('sha256').update(readFileSync(brokenArchive)).digest('hex');
  writeFileSync(`${brokenArchive}.sha256`, `${digest}  rollback-upgrade.tar.gz\n`);
  return brokenArchive;
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function makeEnv(home) {
  const env = { ...process.env };
  for (const key of CLEARED_ENV) delete env[key];
  Object.assign(env, {
    HOME: home,
    USERPROFILE: home,
    APPDATA: join(home, 'AppData', 'Roaming'),
    LOCALAPPDATA: join(home, 'AppData', 'Local'),
    XDG_DATA_HOME: join(home, '.local', 'share'),
    XDG_CONFIG_HOME: join(home, '.config'),
    XDG_CACHE_HOME: join(home, '.cache'),
    ZOVELI_OLLAMA_URL: 'http://127.0.0.1:9',
    ZOVELI_MATHCORE_PREWARM: '0',
    PYTHONIOENCODING: 'utf-8',
    NO_COLOR: '1',
  });
  for (const dir of [home, env.APPDATA, env.LOCALAPPDATA, env.XDG_DATA_HOME, env.XDG_CONFIG_HOME, env.XDG_CACHE_HOME]) {
    mkdirSync(dir, { recursive: true });
  }
  return env;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function pass(checks, id, detail, startedAt) {
  const check = { id, status: 'pass', ms: Date.now() - startedAt, detail };
  checks.push(check);
  console.log(`[pass] ${id}${detail ? `: ${detail}` : ''}`);
  return check;
}

function tail(text, lines = 20) {
  return String(text || '').trim().split(/\r?\n/).slice(-lines).join('\n');
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(
      'usage: node scripts/product-acceptance.mjs [--archive FILE] [--dir INSTALL] [--report FILE] [--max-seconds N] [--keep]'
    );
    return;
  }
  const startedAt = Date.now();
  const startedIso = new Date(startedAt).toISOString();
  const checks = [];
  const timings = {};
  const archive = options.dir ? null : options.archive ?? findArchive();
  assert(!archive || existsSync(archive), `archive not found: ${archive}`);
  assert(!archive || existsSync(`${archive}.sha256`), `checksum file not found: ${archive}.sha256`);

  const sandbox = mkdtempSync(join(tmpdir(), 'zoveli-acceptance-'));
  const home = join(sandbox, 'home');
  const installDir = options.dir ?? join(sandbox, 'install');
  const env = makeEnv(home);
  const launcher = join(installDir, IS_WIN ? 'zoveli.cmd' : 'zoveli');
  let reportPath = options.report;
  let runtime = null;
  let token = null;
  let toolCount = null;
  let capabilities = null;
  let successful = false;

  try {
    if (archive) {
      const tamperStart = Date.now();
      const tamperedArchive = join(sandbox, 'tampered.tar.gz');
      copyFileSync(archive, tamperedArchive);
      writeFileSync(`${tamperedArchive}.sha256`, `${'0'.repeat(64)}  tampered.tar.gz\n`);
      const tamperedDir = join(sandbox, 'tampered-install');
      let rejected = false;
      try {
        runInstaller(tamperedArchive, tamperedDir, env);
      } catch {
        rejected = true;
      }
      assert(rejected, 'installer accepted a mismatched SHA-256 checksum');
      assert(!existsSync(join(tamperedDir, 'runtime.json')), 'tampered install left a runtime behind');
      pass(checks, 'checksum-rejection', 'mismatched archive refused', tamperStart);

      const installStart = Date.now();
      runInstaller(archive, installDir, env);
      timings.installMs = Date.now() - installStart;
      assert(existsSync(launcher), `installer did not create ${launcher}`);
      runtime = readJson(join(installDir, 'runtime.json'));
      pass(checks, 'clean-install', `${runtime.version} ${runtime.platform}-${runtime.arch} in ${timings.installMs}ms`, installStart);

      const rollbackStart = Date.now();
      const rollbackArchive = makeRollbackUpgradeArchive(archive, sandbox);
      const backupsDir = join(home, '.zoveli', 'backups');
      const backupsBefore = existsSync(backupsDir)
        ? readdirSync(backupsDir).filter((name) => name.startsWith('pre-upgrade-')).length
        : 0;
      let rollbackRejected = false;
      try {
        runInstaller(rollbackArchive, installDir, env);
      } catch {
        rollbackRejected = true;
      }
      assert(rollbackRejected, 'installer accepted an upgrade that fails its installed version check');
      const backupsAfter = existsSync(backupsDir)
        ? readdirSync(backupsDir).filter((name) => name.startsWith('pre-upgrade-')).length
        : 0;
      assert(backupsAfter === backupsBefore + 1, 'failed upgrade did not reach the backup and swap phase');
      const preservedVersion = runLauncher(launcher, ['--version'], env).trim();
      assert(preservedVersion === `zoveli ${runtime.version}`, `failed upgrade changed the runtime: ${preservedVersion}`);
      const leftovers = readdirSync(sandbox).filter(
        (name) => name.startsWith('.zoveli-stage-') || name.startsWith('.zoveli-previous-')
      );
      assert(leftovers.length === 0, `failed upgrade left staging data: ${leftovers.join(', ')}`);
      pass(checks, 'failed-upgrade-rollback', 'post-swap failure rolled back; runtime preserved', rollbackStart);
    } else {
      assert(existsSync(launcher), `launcher not found: ${launcher}`);
      runtime = readJson(join(installDir, 'runtime.json'));
      pass(checks, 'existing-install', `${runtime.version} ${runtime.platform}-${runtime.arch}`, Date.now());
    }

    const versionStart = Date.now();
    const versionOut = runLauncher(launcher, ['--version'], env).trim();
    assert(versionOut === `zoveli ${runtime.version}`, `unexpected version: ${versionOut}`);
    const helpOut = runLauncher(launcher, ['--help'], env);
    assert(helpOut.includes('Usage:'), 'help output is missing usage');
    pass(checks, 'launch-version-help', versionOut, versionStart);

    token = `acceptance-${Date.now()}-cobalt`;
    const fact = `My acceptance fact is ${token}`;
    const firstSessionStart = Date.now();
    const firstOut = runLauncher(launcher, [], env, {
      timeout: 180000,
      input: ['/math 2+2', `/remember ${fact}`, `/recall ${token}`, '/sys', '/caps', '/health', '/quit', ''].join('\n'),
    });
    timings.firstSessionMs = Date.now() - firstSessionStart;
    timings.firstTaskMs = Date.now() - startedAt;
    assert(firstOut.includes('"value": "4"'), `verified math did not return 4:\n${tail(firstOut)}`);
    assert(firstOut.includes('VERIFIED'), `verified math did not report VERIFIED:\n${tail(firstOut)}`);
    pass(checks, 'verified-math', '2+2 -> 4 VERIFIED', firstSessionStart);
    assert(firstOut.includes(`remembered: ${fact}`), `remember did not confirm the note:\n${tail(firstOut)}`);
    assert(firstOut.includes(token), `recall did not return the note:\n${tail(firstOut)}`);
    pass(checks, 'remember-recall', 'local note saved and found without a model', firstSessionStart);
    assert(firstOut.includes('"hostname"'), `sys snapshot missing hostname:\n${tail(firstOut)}`);
    pass(checks, 'system-snapshot', 'local OS/CPU snapshot returned', firstSessionStart);
    const capMatch = firstOut.match(/(\d+)\/(\d+) capabilities available/);
    assert(capMatch, `capability summary missing:\n${tail(firstOut)}`);
    capabilities = { available: Number(capMatch[1]), total: Number(capMatch[2]) };
    assert(capabilities.available === capabilities.total, `capabilities degraded: ${capMatch[0]}`);
    pass(checks, 'capabilities', capMatch[0], firstSessionStart);
    assert(/health: (ok|warn)/.test(firstOut), `health did not report ok/warn:\n${tail(firstOut)}`);
    assert(!/health: fail/.test(firstOut), `health reported fail:\n${tail(firstOut)}`);
    pass(checks, 'repl-health', firstOut.match(/health: (ok|warn)/)[0], firstSessionStart);

    const toolsStart = Date.now();
    const toolsOut = runLauncher(launcher, [], env, {
      timeout: 120000,
      input: '/tools\n/quit\n',
    });
    const toolNames = toolsOut
      .split(/\r?\n/)
      .filter((line) => line.startsWith('- '))
      .map((line) => line.slice(2).split(/\s+/)[0]);
    toolCount = toolNames.length;
    for (const required of ['mathcore_compute', 'memory_create_note', 'vault_search', 'sysinfo_snapshot', 'vault_graph']) {
      assert(toolNames.includes(required), `tool list is missing ${required}:\n${tail(toolsOut)}`);
    }
    assert(toolCount >= 50 && toolCount <= 80, `unexpected tool count: ${toolCount}`);
    pass(checks, 'tool-surface', `${toolCount} tools`, toolsStart);

    const pluginStart = Date.now();
    const pluginOut = JSON.parse(
      runLauncher(
        launcher,
        ['plugins', '--json'],
        { ...env, ZOVELI_DISABLE_PLUGINS: 'zoveli-webresearch' },
        { timeout: 60000 }
      )
    );
    const disabledPlugin = (pluginOut.plugins ?? []).find(
      (plugin) => plugin.name === 'zoveli-webresearch'
    );
    assert(
      pluginOut.enabled === 25 && pluginOut.optIn === 1 && pluginOut.disabled === 1,
      `unexpected plugin inventory: ${JSON.stringify({
        enabled: pluginOut.enabled,
        optIn: pluginOut.optIn,
        disabled: pluginOut.disabled,
      })}`
    );
    assert(disabledPlugin?.status === 'disabled', 'zoveli-webresearch was not disabled');
    pass(checks, 'plugin-disable', '27 plugins; webresearch disabled', pluginStart);

    const recoveryStart = Date.now();
    const recovery = JSON.parse(
      runLauncher(launcher, ['recovery-check', '--json'], env, { timeout: 60000 })
    );
    assert(recovery.status === 'pass', `recovery drill failed: ${recovery.error ?? 'unknown error'}`);
    assert(recovery.isolated === true, 'recovery drill did not report isolation');
    assert(recovery.backupNotes === 1, `recovery drill restored ${recovery.backupNotes} notes`);
    assert(
      (recovery.backupFiles ?? 0) >= 5,
      `recovery drill backed up only ${recovery.backupFiles} files`
    );
    pass(checks, 'recovery-drill', `${recovery.backupFiles} files; note restored`, recoveryStart);

    const configStart = Date.now();
    const config = JSON.parse(runLauncher(launcher, ['config-check', '--json'], env));
    assert(config.ready === true, `config-check reported: ${JSON.stringify(config.failures ?? config)}`);
    pass(checks, 'config-check', 'ready', configStart);

    const healthCliStart = Date.now();
    const health = JSON.parse(runLauncher(launcher, ['health', '--json'], env, { timeout: 180000 }));
    assert(health.status !== 'fail', `health reported ${health.status}`);
    const probe = (health.checks ?? []).find((entry) => entry.id === 'mathcore-probe');
    assert(probe?.level === 'ok', `mathcore probe was ${probe?.level ?? 'missing'}`);
    pass(checks, 'health-cli', `${health.status}; ${probe.summary}`, healthCliStart);

    const backupStart = Date.now();
    const backupDir = join(sandbox, 'backup');
    const backup = JSON.parse(runLauncher(launcher, ['backup', '--out', backupDir, '--json'], env));
    assert((backup.manifest?.counts?.notes ?? 0) >= 1, 'backup contains no notes');
    const verify = JSON.parse(runLauncher(launcher, ['verify', backupDir, '--json'], env));
    assert(verify.ok === true, `backup verification failed: ${JSON.stringify(verify.errors ?? verify)}`);
    pass(checks, 'backup-verify', `${backup.manifest.counts.notes} note(s) verified`, backupStart);

    const restoreStart = Date.now();
    const restoreRoot = join(sandbox, 'restore');
    const restoreDb = join(restoreRoot, 'memory.db');
    const restoreVault = join(restoreRoot, 'vault');
    const restoreAuth = join(restoreRoot, 'auth');
    const restoreAudit = join(restoreRoot, 'audit.jsonl');
    runLauncher(
      launcher,
      [
        'restore',
        backupDir,
        '--force',
        '--db',
        restoreDb,
        '--vault',
        restoreVault,
        '--auth-dir',
        restoreAuth,
        '--audit',
        restoreAudit,
        '--json',
      ],
      env
    );
    const restoreEnv = {
      ...env,
      ZOVELI_MEMORY_DB: restoreDb,
      ZOVELI_VAULT_PATH: restoreVault,
      MATHCORE_AUDIT: restoreAudit,
    };
    const restoredOut = runLauncher(launcher, [], restoreEnv, {
      timeout: 120000,
      input: `/recall ${token}\n/quit\n`,
    });
    assert(restoredOut.includes(token), `restored vault did not return the note:\n${tail(restoredOut)}`);
    pass(checks, 'restore-readback', 'restored note searchable', restoreStart);

    if (archive) {
      const upgradeStart = Date.now();
      runInstaller(archive, installDir, env);
      const versionAfter = runLauncher(launcher, ['--version'], env).trim();
      assert(versionAfter === `zoveli ${runtime.version}`, `version changed after upgrade: ${versionAfter}`);
      const upgradesDir = join(home, '.zoveli', 'backups');
      const backups = existsSync(upgradesDir)
        ? readdirSync(upgradesDir).filter((name) => name.startsWith('pre-upgrade-'))
        : [];
      assert(backups.length >= 1, 'upgrade did not create a pre-upgrade backup');
      const upgradeBackup = join(upgradesDir, backups[backups.length - 1]);
      assert(existsSync(join(upgradeBackup, 'manifest.json')), 'pre-upgrade backup has no manifest');
      const afterOut = runLauncher(launcher, [], env, {
        timeout: 120000,
        input: `/recall ${token}\n/quit\n`,
      });
      assert(afterOut.includes(token), `upgrade lost the note:\n${tail(afterOut)}`);
      pass(checks, 'upgrade-preserves-data', `verified backup at ${upgradeBackup}`, upgradeStart);
    }

    const elapsed = Date.now() - startedAt;
    assert(
      timings.firstTaskMs <= options.maxSeconds * 1000,
      `first task took ${Math.round(timings.firstTaskMs / 1000)}s, over the ${options.maxSeconds}s budget`
    );
    timings.totalMs = elapsed;
    successful = true;

    const report = {
      schema: 1,
      status: 'pass',
      startedAt: startedIso,
      finishedAt: new Date().toISOString(),
      platform: process.platform,
      arch: process.arch,
      runtime: {
        version: runtime.version,
        node: runtime.node,
        mathcore: runtime.mathcore,
        archive,
      },
      timings,
      metrics: { toolCount, capabilities },
      checks,
    };
    if (reportPath) {
      mkdirSync(dirname(reportPath), { recursive: true });
      writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    }
    console.log(
      `product acceptance: PASS (install ${Math.round(timings.installMs ?? 0)}ms, ` +
        `first task ${Math.round(timings.firstTaskMs ?? 0)}ms, total ${Math.round(elapsed)}ms)`
    );
    console.log(
      `runtime ${runtime.version} ${runtime.platform}-${runtime.arch}; ${toolCount} tools; ` +
        `${capabilities.available}/${capabilities.total} capabilities; ${checks.length} checks`
    );
    if (reportPath) console.log(`report: ${reportPath}`);
  } finally {
    if (!options.keep && successful) rmSync(sandbox, { recursive: true, force: true });
    else if (!successful) console.error(`acceptance sandbox kept for debugging: ${sandbox}`);
  }
}

try {
  main();
} catch (error) {
  console.error('product acceptance: FAIL');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
