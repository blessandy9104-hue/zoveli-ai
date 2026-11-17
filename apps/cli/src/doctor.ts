import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { ZOVELI_VERSION } from '@zoveli/core/version';
import {
  buildHealthReport,
  configChecks,
  mathcorePoolCheck,
  mathcoreProbeCheck,
  runtimeCheck,
  type HealthCheck,
  type HealthLevel,
} from '@zoveli/diagnostics';
import { mathcore, mathcoreCommandAvailable, resolveMathcoreCommand } from '@zoveli/math-intelligence';
import { resolveDbPath } from '@zoveli/memory-store';
import { parseFlags, type FlagDefinition } from './flags.js';

interface ParsedFlags {
  json: boolean;
  help: boolean;
  offline: boolean;
  db?: string;
}

const FLAGS = [
  { key: 'json', tokens: ['--json'] },
  { key: 'offline', tokens: ['--offline'] },
  { key: 'help', tokens: ['--help', '-h'] },
  { key: 'db', tokens: ['--db'], takesValue: true },
] as const satisfies readonly FlagDefinition<keyof ParsedFlags>[];

interface RuntimeMetadata {
  schema?: number;
  version?: string;
  platform?: string;
  arch?: string;
  node?: string;
  mathcore?: string;
}

interface RuntimeInfo {
  dir: string;
  metadata: RuntimeMetadata;
  error?: string;
}

const LABELS: Record<HealthLevel, string> = {
  ok: ' ok ',
  info: 'info',
  warn: 'warn',
  fail: 'FAIL',
};

function usage(): string {
  return `zoveli installation diagnostics
  zoveli doctor [--db PATH] [--offline] [--json]

Checks the installed runtime, configuration drift, vault schema, the mathcore
command and (unless --offline) a live mathcore MCP handshake. Exit code 1 when
a blocking problem is found; optional gaps such as an unlinked PATH entry are
reported as warnings or info only. Secrets are never printed.`;
}

function platformSlug(): string {
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'darwin') return 'macos';
  return 'linux';
}

function readRuntimeMetadata(): RuntimeInfo | null {
  // The portable launcher runs `<dir>/node <dir>/app.cjs`, so the bundled
  // runtime.json is always beside the bundled CLI. Do not consult ZOVELI_HOME:
  // that is an installer variable and could point at a different runtime.
  const candidates: string[] = [];
  if (process.argv[1]) candidates.push(dirname(process.argv[1]));
  for (const dir of candidates) {
    const file = join(dir, 'runtime.json');
    if (!existsSync(file)) continue;
    try {
      return { dir, metadata: JSON.parse(readFileSync(file, 'utf8')) as RuntimeMetadata };
    } catch (e) {
      return { dir, metadata: {}, error: e instanceof Error ? e.message : String(e) };
    }
  }
  return null;
}

function installCheck(runtime: RuntimeInfo | null): HealthCheck {
  if (!runtime) {
    return {
      id: 'install',
      title: 'Install',
      level: 'info',
      summary: 'source checkout (no runtime.json beside the launcher)',
      details: ['prebuilt runtime installs report their archive and bundled Node here'],
    };
  }
  if (runtime.error) {
    return {
      id: 'install',
      title: 'Install',
      level: 'fail',
      summary: `runtime.json is unreadable in ${runtime.dir}`,
      details: [runtime.error, 'fix: reinstall with install/install.sh --force'],
    };
  }
  const metadata = runtime.metadata;
  const details = [
    `install dir: ${runtime.dir}`,
    `bundled node: ${metadata.node ?? 'unknown'}`,
    `mathcore: ${metadata.mathcore ?? 'unknown'}`,
  ];
  if (!metadata.version) {
    return {
      id: 'install',
      title: 'Install',
      level: 'fail',
      summary: 'runtime.json has no version',
      details: [...details, 'fix: reinstall with install/install.sh --force'],
    };
  }
  const mismatches: string[] = [];
  if (metadata.version !== ZOVELI_VERSION) {
    mismatches.push(`runtime.json says ${metadata.version}, binary is ${ZOVELI_VERSION}`);
  }
  if (metadata.platform && metadata.platform !== platformSlug()) {
    mismatches.push(`runtime.json says ${metadata.platform}, this host is ${platformSlug()}`);
  }
  if (metadata.arch && metadata.arch !== process.arch) {
    mismatches.push(`runtime.json says ${metadata.arch}, this host is ${process.arch}`);
  }
  if (mismatches.length > 0) {
    return {
      id: 'install',
      title: 'Install',
      level: 'fail',
      summary: 'runtime metadata does not match this binary',
      details: [...details, ...mismatches, 'fix: install the matching archive for this platform'],
    };
  }
  return {
    id: 'install',
    title: 'Install',
    level: 'ok',
    summary: `runtime ${metadata.version} (${metadata.platform ?? platformSlug()}-${metadata.arch ?? process.arch})`,
    details,
  };
}

function binDirectory(): string {
  if (process.platform === 'win32') {
    return join(process.env.LOCALAPPDATA ?? homedir(), 'Zoveli', 'bin');
  }
  return process.env.XDG_BIN_HOME ?? join(homedir(), '.local', 'bin');
}

function pathCheck(): HealthCheck {
  const dir = binDirectory();
  const launcher = process.platform === 'win32' ? 'zoveli.cmd' : 'zoveli';
  const link = join(dir, launcher);
  if (!existsSync(link)) {
    return {
      id: 'path',
      title: 'PATH',
      level: 'info',
      summary: `${launcher} is not linked in ${dir}`,
      details: ['invoke the launcher by its full path, or reinstall to create the link'],
    };
  }
  const separator = process.platform === 'win32' ? ';' : ':';
  const normalize = (value: string) => value.replace(/[\\/]+$/, '');
  const wanted = normalize(dir);
  const onPath = (process.env.PATH ?? '')
    .split(separator)
    .some((entry) => entry.length > 0 && normalize(entry) === wanted);
  if (onPath) {
    return {
      id: 'path',
      title: 'PATH',
      level: 'ok',
      summary: `${dir} is on PATH`,
    };
  }
  return {
    id: 'path',
    title: 'PATH',
    level: 'warn',
    summary: `${dir} is not on PATH`,
    details: [
      process.platform === 'win32'
        ? `fix: $env:Path = "${dir};$env:Path"`
        : `fix: export PATH="${dir}:$PATH"`,
      'or re-run the installer with --add-to-path',
    ],
  };
}

function mathcoreCommandCheck(): HealthCheck {
  const command = resolveMathcoreCommand();
  if (mathcoreCommandAvailable()) {
    return {
      id: 'mathcore-command',
      title: 'Math engine command',
      level: 'ok',
      summary: command,
    };
  }
  return {
    id: 'mathcore-command',
    title: 'Math engine command',
    level: 'fail',
    summary: `cannot execute ${command}`,
    details: [
      'math answers are WITHHELD until this is fixed',
      'runtime installs bundle mathcore; reinstall with install/install.sh --force',
      'source checkouts: activate .venv and run python -m pip install -e ./mathcore',
    ],
  };
}

async function mathcoreCheck(offline: boolean, commandAvailable: boolean): Promise<HealthCheck> {
  if (offline) {
    return {
      id: 'mathcore-probe',
      title: 'Math engine',
      level: 'info',
      summary: 'live MCP handshake skipped (--offline)',
    };
  }
  if (!commandAvailable) {
    return {
      id: 'mathcore-probe',
      title: 'Math engine',
      level: 'info',
      summary: 'live MCP handshake skipped because the command is missing',
    };
  }
  const probe = await mathcoreProbeCheck();
  if (probe.level === 'ok') return probe;
  return { ...probe, level: 'fail' };
}

export async function runDoctor(argv: string[]): Promise<number> {
  try {
    const flags = parseFlags<ParsedFlags>(argv, { json: false, help: false, offline: false }, FLAGS);
    if (flags.help) {
      console.log(usage());
      return 0;
    }

    const dbPath = flags.db ?? resolveDbPath();
    const runtime = readRuntimeMetadata();
    const config = configChecks({ dbPath });
    const commandAvailable = mathcoreCommandAvailable();
    const checks: HealthCheck[] = [
      runtimeCheck(),
      installCheck(runtime),
      config.env,
      config.vault,
      mathcorePoolCheck(mathcore.status()),
      mathcoreCommandCheck(),
      await mathcoreCheck(flags.offline, commandAvailable),
      pathCheck(),
    ];
    const report = buildHealthReport(checks);
    const install = runtime
      ? { mode: 'runtime' as const, dir: runtime.dir, ...runtime.metadata }
      : { mode: 'source' as const, dir: process.argv[1] ? dirname(process.argv[1]) : process.cwd() };

    if (flags.json) {
      console.log(
        JSON.stringify(
          {
            status: report.status,
            checkedAt: report.checkedAt,
            version: ZOVELI_VERSION,
            platform: process.platform,
            arch: process.arch,
            node: process.version,
            install,
            counts: report.counts,
            checks: report.checks,
          },
          null,
          2
        )
      );
      return report.status === 'fail' ? 1 : 0;
    }

    console.log(`zoveli doctor: ${report.status}`);
    for (const check of report.checks) {
      console.log(`[${LABELS[check.level]}] ${check.title}: ${check.summary}`);
      if (check.level === 'warn' || check.level === 'fail') {
        for (const detail of check.details ?? []) console.log(`       ${detail}`);
      }
    }
    if (report.status === 'fail') {
      console.log('next: fix the FAIL items above, then re-run zoveli doctor');
    } else if (report.status === 'degraded') {
      console.log('next: optional items need attention; the core runtime is usable');
    }
    return report.status === 'fail' ? 1 : 0;
  } catch (e) {
    console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}
