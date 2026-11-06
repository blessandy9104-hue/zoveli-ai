import { describe, expect, it } from 'vitest';
import { reviewEfficiency } from '../../packages/capability/src/efficiency';
import { CapabilityScanner } from '../../packages/capability/src/scanner';
import { zoveliCapability } from '../../packages/capability/src/index';
import { promptSectionsText, zoveliPrompt } from '../../packages/core/src/system-prompt';
import { ZoveliHost } from '../../packages/host/src/host';
import { createMockContext } from '../setup';

describe('efficiency review', () => {
  it('reports repeated slow tools, sorted by average latency', () => {
    const report = reviewEfficiency({
      calls: 6,
      failures: 0,
      totalMs: 1365,
      recent: [
        { tool: 'fast', durationMs: 15, ok: true },
        { tool: 'fast', durationMs: 20, ok: true },
        { tool: 'slow', durationMs: 450, ok: true },
        { tool: 'slow', durationMs: 550, ok: true },
        { tool: 'slow', durationMs: 200, ok: true },
      ],
    });

    expect(report.sampledCalls).toBe(5);
    expect(report.findings.map((finding) => finding.tool)).toEqual(['slow']);
    expect(report.findings[0].averageMs).toBe(400);
    expect(report.findings[0].suggestion).toContain('user approval');
    expect(report.automaticChanges).toBe(false);
  });

  it('reports repeated failures even with a small sample', () => {
    const report = reviewEfficiency({
      calls: 3,
      failures: 2,
      totalMs: 220,
      recent: [
        { tool: 'flaky', durationMs: 100, ok: false },
        { tool: 'flaky', durationMs: 120, ok: false },
        { tool: 'one-off', durationMs: 1000, ok: true },
      ],
    });

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatchObject({
      tool: 'flaky',
      calls: 2,
      failures: 2,
      failureRate: 1,
    });
    expect(report.findings[0].suggestion).toContain('regression test');
  });

  it('ignores a single slow healthy call and malformed samples', () => {
    const report = reviewEfficiency({
      calls: 4,
      failures: 0,
      totalMs: 1100,
      recent: [
        { tool: 'one-off', durationMs: 1000, ok: true },
        { tool: '', durationMs: 5000, ok: false },
        { tool: 'bad-time', durationMs: Number.NaN, ok: true },
        { tool: 'bad-ok', durationMs: 10, ok: 'yes' as any },
        { tool: 'negative', durationMs: -5, ok: true },
      ],
    });

    expect(report.findings).toEqual([]);
    expect(report.sampledCalls).toBe(1);
  });

  it('falls back safely for invalid options and counters', () => {
    const report = reviewEfficiency(
      {
        calls: Number.NaN,
        failures: Number.POSITIVE_INFINITY,
        totalMs: Number.NaN,
        recent: [
          { tool: 'slow', durationMs: 150, ok: true },
          { tool: 'slow', durationMs: 150, ok: true },
          { tool: 'slow', durationMs: 150, ok: true },
        ],
      },
      { slowMs: Number.NaN, minCalls: Number.NaN }
    );

    expect(report.findings.map((finding) => finding.tool)).toEqual(['slow']);
    expect(report.findings[0].averageMs).toBe(150);
    expect(report.totalCalls).toBe(3);
    expect(report.totalFailures).toBe(0);
  });

  it('never exposes error text or mutates the snapshot', () => {
    const snapshot = {
      calls: 2,
      failures: 1,
      totalMs: 120,
      recent: [
        { tool: 'leaky', durationMs: 100, ok: false, error: 'sk-secret-value' },
        { tool: 'leaky', durationMs: 20, ok: true },
      ],
    };
    const before = JSON.stringify(snapshot);

    const report = reviewEfficiency(snapshot as any);

    expect(JSON.stringify(report)).not.toContain('sk-secret-value');
    expect(JSON.stringify(snapshot)).toBe(before);
  });
});

describe('self-efficiency wiring', () => {
  it('discovers the capability only when its tool is mounted', async () => {
    const withTool = new CapabilityScanner(
      createMockContext({
        get: (key: string) =>
          key === 'tool-inventory'
            ? { list: () => ['efficiency_review', 'mathcore_compute'] }
            : undefined,
      })
    );
    expect(
      (await withTool.scanAll({ forceRefresh: true })).map((cap) => cap.name)
    ).toContain('efficiency.self-review');

    const withoutTool = new CapabilityScanner(
      createMockContext({
        get: (key: string) =>
          key === 'tool-inventory' ? { list: () => ['mathcore_compute'] } : undefined,
      })
    );
    expect(
      (await withoutTool.scanAll({ forceRefresh: true })).map((cap) => cap.name)
    ).not.toContain('efficiency.self-review');
  });

  it('provides the review API and a tool that accepts null arguments', async () => {
    const snapshot = {
      calls: 3,
      failures: 0,
      totalMs: 450,
      recent: [
        { tool: 'slow_tool', durationMs: 150, ok: true },
        { tool: 'slow_tool', durationMs: 150, ok: true },
        { tool: 'slow_tool', durationMs: 150, ok: true },
      ],
    };
    const ctx = createMockContext({
      get: (key: string) => {
        if (key === 'tool-inventory') {
          return { list: () => ['efficiency_review'] };
        }
        if (key === 'host-efficiency') return { snapshot: () => snapshot };
        return undefined;
      },
    });

    zoveliCapability.setup(ctx as any);
    const provided = ctx.provide.mock.calls.find(
      (call: any[]) => call[0] === 'capability'
    )?.[1];
    const tools = ctx.register.mock.calls.find(
      (call: any[]) => call[0] === 'capability-tools'
    )?.[1];
    const tool = tools.find((entry: any) => entry.name === 'efficiency_review');

    expect(provided.reviewEfficiency().findings[0].tool).toBe('slow_tool');
    await expect(tool.execute(null)).resolves.toMatchObject({
      sampledCalls: 3,
      automaticChanges: false,
    });
  });

  it('routes host telemetry through the real dispatch loop without error text', async () => {
    const host = new ZoveliHost();
    host.mount([
      zoveliCapability,
      {
        name: 'perf-tools',
        setup(ctx: any) {
          ctx.register('perf-tools', [
            {
              name: 'slow_tool',
              description: 'slow',
              execute: async () => {
                await new Promise((resolve) => setTimeout(resolve, 25));
                return 'ok';
              },
            },
            {
              name: 'failing_tool',
              description: 'fails',
              execute: async () => {
                throw new Error('upstream rejected sk-secret-value');
              },
            },
          ]);
        },
      },
    ]);

    for (let index = 0; index < 3; index += 1) {
      await host.runTool('slow_tool');
      await expect(host.runTool('failing_tool')).rejects.toThrow('upstream rejected');
    }

    const snapshot = (host.ctx.get('host-efficiency') as any).snapshot();
    expect(snapshot.calls).toBe(6);
    expect(snapshot.failures).toBe(3);
    expect(snapshot.recent.every((entry: any) => !('error' in entry))).toBe(true);
    expect(JSON.stringify(snapshot)).not.toContain('sk-secret-value');

    const report = (await host.runTool('efficiency_review', {
      slowMs: 10,
      minCalls: 2,
    })) as any;
    expect(report.findings.map((finding: any) => finding.tool)).toEqual(
      expect.arrayContaining(['slow_tool', 'failing_tool'])
    );
    expect(report.automaticChanges).toBe(false);
  });

  it('teaches the core prompt to measure first and wait for approval', () => {
    const section = zoveliPrompt.sections.find(
      (candidate) => candidate.id === 'self-efficiency'
    );
    const text = promptSectionsText();

    expect(section).toBeDefined();
    expect(text).toContain('## Self-Efficiency Rules');
    expect(text).toContain('efficiency_review');
    expect(text).toContain('WAIT for explicit user approval');
    expect(text).toContain('Never enable persistent telemetry');
  });
});
