import { definePlugin } from '@deepseek-ai/dsh-core';
import { mathcore } from '@zoveli/math-intelligence';
import {
  buildHealthReport,
  capabilityCheck,
  configChecks,
  mathcorePoolCheck,
  mathcoreProbeCheck,
  runtimeCheck,
  type CapabilitySummary,
  type HealthCheck,
  type HealthReport,
} from './checks.js';

export * from './checks.js';

async function capabilitySummaryFrom(ctx: any): Promise<CapabilitySummary | null> {
  const capability = ctx?.get?.('capability');
  let list: any[] = capability?.registry?.getAll?.() ?? [];
  if (list.length === 0 && typeof capability?.scan === 'function') {
    try {
      const scanned = await capability.scan();
      if (Array.isArray(scanned)) list = scanned;
    } catch {
      // capability scan is best-effort; health still reports the rest
    }
  }
  if (!Array.isArray(list) || list.length === 0) return null;
  const count = (status: string) => list.filter((c) => c?.status === status).length;
  return {
    total: list.length,
    available: count('available'),
    degraded: count('degraded'),
    unavailable: count('unavailable'),
    unknown: count('unknown'),
    criticalMissing: list
      .filter((c) => c?.priority === 'critical' && c?.status !== 'available')
      .map((c) => String(c?.name ?? 'unknown')),
  };
}

/**
 * Registers `health_report`: a one-shot rollup for support and `/health`.
 * Config and vault are independent of the MCP child; `probeMathcore` adds
 * a live spawn + tools/list handshake (off by default so a status call in
 * chat never starts a process).
 */
export const zoveliDiagnostics = definePlugin({
  name: 'zoveli-diagnostics',
  description: 'Runtime health rollup: config, vault, MCP pool and capabilities',

  setup(ctx) {
    ctx.register('assistant-diagnostics-tools', [
      {
        name: 'health_report',
        description:
          'One-shot runtime health: config drift, vault schema, mathcore MCP pool and capabilities',
        parameters: {
          type: 'object',
          properties: {
            probeMathcore: {
              type: 'boolean',
              default: false,
              description: 'Spawn mathcore and run tools/list (verifies the full MCP path)',
            },
            dbPath: { type: 'string', description: 'Override the memory database path' },
          },
        },
        async execute({
          probeMathcore = false,
          dbPath,
        }: { probeMathcore?: boolean; dbPath?: string } = {}): Promise<HealthReport> {
          const config = configChecks({ dbPath });
          const checks: HealthCheck[] = [
            runtimeCheck(),
            config.env,
            config.vault,
            mathcorePoolCheck(mathcore.status()),
          ];
          if (probeMathcore) checks.push(await mathcoreProbeCheck());
          checks.push(capabilityCheck(await capabilitySummaryFrom(ctx)));
          return buildHealthReport(checks);
        },
      },
    ]);
  },
});
