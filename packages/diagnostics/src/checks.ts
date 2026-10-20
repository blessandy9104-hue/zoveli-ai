import {
  configAuditReport,
  vaultIssue,
  type AuditIssue,
  type AuditOptions,
  type AuditReport,
} from '@zoveli/config-audit';
import { ZOVELI_VERSION } from '@zoveli/core';
import { MathcoreClient, mathcore, type MathcoreStatus } from '@zoveli/math-intelligence';

export type HealthLevel = 'ok' | 'info' | 'warn' | 'fail';
export type HealthStatus = 'ok' | 'degraded' | 'fail';

export interface HealthCheck {
  id: string;
  title: string;
  level: HealthLevel;
  summary: string;
  details?: string[];
}

export interface HealthReport {
  status: HealthStatus;
  checkedAt: string;
  counts: Record<HealthLevel, number>;
  checks: HealthCheck[];
}

export interface CapabilitySummary {
  total: number;
  available: number;
  degraded: number;
  unavailable: number;
  unknown: number;
  criticalMissing: string[];
}

export interface ConfigCheckBundle {
  env: HealthCheck;
  vault: HealthCheck;
  report: AuditReport;
}

function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function renderIssue(issue: AuditIssue): string {
  const fix = issue.fix ? ` (fix: ${issue.fix})` : '';
  return `${issue.level.toUpperCase()} ${issue.name}: ${issue.detail}${fix}`;
}

function issueCheck(
  id: string,
  title: string,
  issues: AuditIssue[],
  cleanSummary: string
): HealthCheck {
  const failures = issues.filter((i) => i.level === 'fail').length;
  const warnings = issues.filter((i) => i.level === 'warn').length;
  const notable = issues.filter((i) => i.level === 'fail' || i.level === 'warn');
  const level: HealthLevel = failures > 0 ? 'fail' : warnings > 0 ? 'warn' : 'ok';
  const summary =
    failures > 0
      ? `${failures} blocking issue(s), ${warnings} warning(s)`
      : warnings > 0
        ? `${warnings} warning(s)`
        : cleanSummary;
  return {
    id,
    title,
    level,
    summary,
    details: notable.length > 0 ? notable.slice(0, 6).map(renderIssue) : undefined,
  };
}

export function runtimeCheck(now: number = Date.now()): HealthCheck {
  const memory = process.memoryUsage();
  const heapMb = Math.round(memory.heapUsed / 1024 / 1024);
  const rssMb = Math.round(memory.rss / 1024 / 1024);
  return {
    id: 'runtime',
    title: 'Runtime',
    level: 'ok',
    summary: `Zoveli ${ZOVELI_VERSION} · Node ${process.version} on ${process.platform}/${process.arch}; pid ${process.pid}`,
    details: [
      `process uptime: ${formatDuration(process.uptime())}`,
      `memory: heap ${heapMb} MB, rss ${rssMb} MB`,
      `time: ${new Date(now).toISOString()}`,
    ],
  };
}

/** One vault read for both the env and vault checks. */
export function configChecks(options: AuditOptions = {}): ConfigCheckBundle {
  const report = configAuditReport(options);
  const env = issueCheck(
    'config',
    'Configuration',
    report.issues.filter((i) => i.name !== 'vault schema'),
    'no environment drift'
  );
  const vaultAudit = report.vault;
  const issue = vaultIssue(vaultAudit);
  const vault: HealthCheck = {
    id: 'vault',
    title: 'Vault',
    level: issue.level,
    summary: issue.detail,
    details: [
      `database: ${vaultAudit.dbPath}`,
      ...(vaultAudit.exists ? [`schema: v${vaultAudit.userVersion} (expected v${vaultAudit.expectedVersion})`] : []),
      ...(issue.fix ? [`fix: ${issue.fix}`] : []),
    ],
  };
  return { env, vault, report };
}

export function mathcorePoolCheck(status: MathcoreStatus): HealthCheck {
  if (status.running) {
    return {
      id: 'mathcore-pool',
      title: 'MCP pool',
      level: 'ok',
      summary:
        `running (pid ${status.pid}); ${status.spawns} spawn(s), ` +
        `${status.restarts} restart(s), ${status.pending} pending`,
      details: [`command: ${status.command}`, `request timeout: ${status.timeoutMs}ms`],
    };
  }
  if (status.retryInMs > 0) {
    return {
      id: 'mathcore-pool',
      title: 'MCP pool',
      level: 'warn',
      summary: `restart backoff for ~${Math.ceil(status.retryInMs / 1000)}s`,
      details: [`last error: ${status.lastError ?? 'unknown'}`],
    };
  }
  return {
    id: 'mathcore-pool',
    title: 'MCP pool',
    level: 'info',
    summary: status.lastError
      ? `stopped after error: ${status.lastError}`
      : 'idle; the first math call starts it',
    details: [`command: ${status.command}`],
  };
}

export interface MathcoreProbeResult {
  ok: boolean;
  tools: string[];
  error?: string;
  durationMs: number;
}

export type MathcoreProbe = () => Promise<MathcoreProbeResult>;

/** Spawn mathcore, run tools/list, stop it: verifies the full MCP path. */
export const probeMathcore: MathcoreProbe = async () => {
  const startedAt = Date.now();
  // Reuse a live pool (e.g. /health after a math call) instead of spawning a
  // second interpreter; a one-shot probe client is only needed when idle.
  const shared = mathcore.running;
  const client = shared ? mathcore : new MathcoreClient(undefined, 30000);
  try {
    const tools = await client.listTools();
    return {
      ok: true,
      tools: tools.map((t: any) => String(t?.name ?? '')).filter(Boolean),
      durationMs: Date.now() - startedAt,
    };
  } catch (e) {
    return {
      ok: false,
      tools: [],
      error: e instanceof Error ? e.message : String(e),
      durationMs: Date.now() - startedAt,
    };
  } finally {
    if (!shared) client.stop();
  }
};

export async function mathcoreProbeCheck(
  probe: MathcoreProbe = probeMathcore
): Promise<HealthCheck> {
  const result = await probe();
  if (result.ok) {
    return {
      id: 'mathcore-probe',
      title: 'Math engine',
      level: 'ok',
      summary: `mathcore-mcp replied with ${result.tools.length} tool(s) in ${result.durationMs}ms`,
      details: result.tools.length > 0 ? [`tools: ${result.tools.join(', ')}`] : undefined,
    };
  }
  return {
    id: 'mathcore-probe',
    title: 'Math engine',
    level: 'warn',
    summary: 'mathcore-mcp is unavailable; math answers are WITHHELD until it recovers',
    details: [
      `error: ${result.error ?? 'unknown'}`,
      'fix: python -m pip install -e ./mathcore (in .venv), then pnpm run doctor',
    ],
  };
}

export function capabilityCheck(summary: CapabilitySummary | null): HealthCheck {
  if (!summary) {
    return {
      id: 'capabilities',
      title: 'Capabilities',
      level: 'info',
      summary: 'not scanned in this process (run /caps in the REPL)',
    };
  }
  const affected = summary.degraded + summary.unavailable;
  const level: HealthLevel = affected > 0 ? 'warn' : 'ok';
  return {
    id: 'capabilities',
    title: 'Capabilities',
    level,
    summary: `${summary.available}/${summary.total} available` +
      (affected > 0 ? `, ${summary.degraded} degraded, ${summary.unavailable} unavailable` : ''),
    details:
      summary.criticalMissing.length > 0
        ? [`critical unavailable: ${summary.criticalMissing.join(', ')}`]
        : undefined,
  };
}

export function buildHealthReport(
  checks: HealthCheck[],
  checkedAt: string = new Date().toISOString()
): HealthReport {
  const counts: Record<HealthLevel, number> = { ok: 0, info: 0, warn: 0, fail: 0 };
  for (const check of checks) counts[check.level] += 1;
  const status: HealthStatus =
    counts.fail > 0 ? 'fail' : counts.warn > 0 ? 'degraded' : 'ok';
  return { status, checkedAt, counts, checks };
}
