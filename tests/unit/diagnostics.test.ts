import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabaseSync } from '../../packages/memory-store/src/store';
import {
  buildHealthReport,
  capabilityCheck,
  configChecks,
  mathcorePoolCheck,
  mathcoreProbeCheck,
  runtimeCheck,
} from '../../packages/diagnostics/src/checks';
import type { MathcoreStatus } from '../../packages/math-intelligence/src/transport';

const created: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'zoveli-diagnostics-'));
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

function poolStatus(overrides: Partial<MathcoreStatus> = {}): MathcoreStatus {
  return {
    command: 'mathcore-mcp',
    running: false,
    pid: null,
    pending: 0,
    spawns: 0,
    restarts: 0,
    lastError: null,
    lastExitCode: null,
    startedAt: null,
    retryInMs: 0,
    timeoutMs: 120000,
    ...overrides,
  };
}

describe('runtime health checks', () => {
  it('reports runtime facts', () => {
    const check = runtimeCheck();
    expect(check.level).toBe('ok');
    expect(check.summary).toContain(process.version);
    expect(check.details?.join(' ')).toContain('memory:');
  });

  it('flags invalid config as blocking while a fresh vault stays ok', () => {
    const dbPath = join(tempDir(), 'memory.db');
    const bundle = configChecks({
      env: { MATHCORE_MCP_COMMAND: 'definitely-missing-mathcore' },
      dbPath,
      commandResolves: () => false,
      writable: () => true,
    });
    expect(bundle.env.level).toBe('fail');
    expect(bundle.env.details?.join(' ')).toContain('MATHCORE_MCP_COMMAND');
    expect(bundle.vault.level).toBe('ok');
    expect(bundle.report.ready).toBe(false);
  });

  it('surfaces a newer vault schema as blocking', () => {
    const dbPath = join(tempDir(), 'future.db');
    const raw = openDatabaseSync(dbPath);
    raw.exec('PRAGMA user_version = 99');
    raw.close();

    const bundle = configChecks({ env: {}, dbPath, commandResolves: () => true });
    expect(bundle.vault.level).toBe('fail');
    expect(bundle.vault.summary).toContain('newer');
    expect(bundle.vault.details?.join(' ')).toContain('vault:restore');
  });

  it('maps MCP pool states to ok, warn and info', () => {
    expect(
      mathcorePoolCheck(poolStatus({ running: true, pid: 123, spawns: 2, restarts: 1 })).level
    ).toBe('ok');
    const backoff = mathcorePoolCheck(
      poolStatus({ retryInMs: 5000, lastError: 'exited with code 7' })
    );
    expect(backoff.level).toBe('warn');
    expect(backoff.summary).toContain('backoff');
    expect(backoff.details?.join(' ')).toContain('exited with code 7');
    expect(mathcorePoolCheck(poolStatus()).level).toBe('info');
  });

  it('probe check reports success and failure actionably', async () => {
    const ok = await mathcoreProbeCheck(async () => ({
      ok: true,
      tools: ['compute'],
      durationMs: 5,
    }));
    expect(ok.level).toBe('ok');
    expect(ok.summary).toContain('1 tool');

    const bad = await mathcoreProbeCheck(async () => ({
      ok: false,
      tools: [],
      error: 'mathcore-mcp was not found',
      durationMs: 3,
    }));
    expect(bad.level).toBe('warn');
    expect(bad.summary).toContain('WITHHELD');
    expect(bad.details?.join(' ')).toContain('pnpm run doctor');
  });

  it('warns on unavailable capabilities and names critical gaps', () => {
    expect(capabilityCheck(null).level).toBe('info');
    const check = capabilityCheck({
      total: 4,
      available: 2,
      degraded: 1,
      unavailable: 1,
      unknown: 0,
      criticalMissing: ['mathcore.verified-compute'],
    });
    expect(check.level).toBe('warn');
    expect(check.summary).toBe('2/4 available, 1 degraded, 1 unavailable');
    expect(check.details?.join(' ')).toContain('mathcore.verified-compute');
  });

  it('derives overall status from fail > warn', () => {
    const ok = runtimeCheck();
    expect(buildHealthReport([ok]).status).toBe('ok');

    const warn = mathcorePoolCheck(
      poolStatus({ retryInMs: 1000, lastError: 'crashed' })
    );
    const degraded = buildHealthReport([ok, warn]);
    expect(degraded.status).toBe('degraded');
    expect(degraded.counts.warn).toBe(1);

    const fail = { ...ok, id: 'blocked', title: 'Blocked', level: 'fail' as const, summary: 'bad' };
    const failed = buildHealthReport([warn, fail]);
    expect(failed.status).toBe('fail');
    expect(failed.counts.fail).toBe(1);
  });
});
