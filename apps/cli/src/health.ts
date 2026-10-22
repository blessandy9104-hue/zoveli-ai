import { mathcore } from '@zoveli/math-intelligence';
import {
  buildHealthReport,
  configChecks,
  mathcorePoolCheck,
  mathcoreProbeCheck,
  runtimeCheck,
  type HealthCheck,
  type HealthLevel,
} from '@zoveli/diagnostics';
import { resolveDbPath } from '@zoveli/memory-store';

interface ParsedFlags {
  json: boolean;
  help: boolean;
  offline: boolean;
  db?: string;
}

function parseFlags(argv: string[]): ParsedFlags {
  const flags: ParsedFlags = { json: false, help: false, offline: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') flags.json = true;
    else if (arg === '--offline') flags.offline = true;
    else if (arg === '--help' || arg === '-h') flags.help = true;
    else if (arg.startsWith('--db=')) flags.db = arg.slice('--db='.length);
    else if (arg === '--db') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error('--db requires a value');
      flags.db = value;
      i += 1;
    } else if (arg.startsWith('-')) {
      throw new Error(`unknown option: ${arg}`);
    } else {
      throw new Error(`unexpected argument: ${arg}`);
    }
  }
  return flags;
}

function usage(): string {
  return `zoveli runtime health
  zoveli health [--db PATH] [--offline] [--json]

Aggregates runtime facts, configuration drift, vault schema and the mathcore
MCP pool, and (unless --offline) spawns mathcore once to verify the full MCP
path. Exit code 1 only on blocking problems (bad config, unreadable vault,
newer schema); missing mathcore degrades verified math but the app runs.
Inside the REPL, /health runs the same rollup and /trace shows tool calls.`;
}

const LABELS: Record<HealthLevel, string> = {
  ok: ' ok ',
  info: 'info',
  warn: 'warn',
  fail: 'FAIL',
};

export async function runHealth(argv: string[]): Promise<number> {
  try {
    const flags = parseFlags(argv);
    if (flags.help) {
      console.log(usage());
      return 0;
    }
    const dbPath = flags.db ?? resolveDbPath();
    const config = configChecks({ dbPath });
    const checks: HealthCheck[] = [
      runtimeCheck(),
      config.env,
      config.vault,
      mathcorePoolCheck(mathcore.status()),
    ];
    if (!flags.offline) checks.push(await mathcoreProbeCheck());
    const report = buildHealthReport(checks);

    if (flags.json) {
      console.log(JSON.stringify(report, null, 2));
      return report.status === 'fail' ? 1 : 0;
    }

    console.log(`zoveli health: ${report.status}`);
    for (const check of report.checks) {
      console.log(`[${LABELS[check.level]}] ${check.title}: ${check.summary}`);
      if (check.level === 'warn' || check.level === 'fail') {
        for (const detail of check.details ?? []) console.log(`       ${detail}`);
      }
    }
    if (report.status !== 'ok') {
      console.log('next: pnpm run doctor · pnpm config:check · docs/runbooks/mcp-disconnect.md');
    }
    return report.status === 'fail' ? 1 : 0;
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    return 1;
  }
}
