import { definePlugin } from '@deepseek-ai/dsh-core';
import { CapabilityScanner } from './scanner';
import { CapabilityRegistry } from './registry';
import { CapabilityAdaptation } from './adaptation';

export const zoveliCapability = definePlugin({
  name: 'zoveli-capability',
  description: 'Zoveli capability awareness - Dynamic discovery, introspection, and adaptation',

  setup(ctx) {
    const scanner = new CapabilityScanner(ctx);
    const registry = new CapabilityRegistry(ctx);
    const adaptation = new CapabilityAdaptation(ctx, scanner, registry);
    // Scans feed the registry: without this, capability_check/list (and any
    // consumer of the provided API) never see what capability_scan found.
    const runScan = async (options: { deep?: boolean; forceRefresh?: boolean } = {}) => {
      const caps = await scanner.scanAll(options);
      for (const cap of caps) registry.register(cap);
      return caps;
    };

    ctx.provide('capability', {
      scanner,
      registry,
      adaptation,
      scan: () => runScan(),
      getCapabilities: () => registry.getAll(),
      getCapability: (name: string) => registry.get(name),
      can: (capability: string) => registry.has(capability),
      adapt: (task: any) => adaptation.adapt(task)
    });

    ctx.register('capability-config', {
      autoScan: true,
      scanInterval: 300000,
      deepScan: true,
      includeHidden: false,
      categories: [
        'computation', 'memory', 'tools', 'agents', 'workflows',
        'communication', 'perception', 'action', 'reasoning', 'learning'
      ]
    });

    ctx.register('capability-tools', [
      {
        name: 'capability_scan',
        description: 'Scan and discover all available capabilities',
        parameters: {
          type: 'object',
          properties: {
            deep: { type: 'boolean', default: true },
            category: { type: 'string' }
          }
        },
        async execute({ deep, category }: any) {
          const caps = await runScan({ deep: Boolean(deep) });
          return category ? caps.filter(c => c.category === category) : caps;
        }
      },
      {
        name: 'capability_check',
        description: 'Check if a specific capability is available',
        parameters: {
          type: 'object',
          properties: {
            capability: { type: 'string' },
            details: { type: 'boolean', default: false }
          },
          required: ['capability']
        },
        async execute({ capability, details }: any) {
          const cap = registry.get(capability);
          if (!cap) return { available: false, capability };
          return details ? cap : { available: true, capability, version: cap.version };
        }
      },
      {
        name: 'capability_list',
        description: 'List all registered capabilities',
        parameters: {
          type: 'object',
          properties: {
            category: { type: 'string' },
            status: { type: 'string', enum: ['available', 'degraded', 'unavailable', 'unknown'] }
          }
        },
        async execute({ category, status }: any) {
          return registry.list({ category, status });
        }
      },
      {
        name: 'capability_adapt',
        description: 'Adapt task execution based on available capabilities',
        parameters: {
          type: 'object',
          properties: {
            task: { type: 'object' },
            preferences: { type: 'object' }
          },
          required: ['task']
        },
        async execute({ task, preferences }: any) {
          return adaptation.adapt(task, preferences);
        }
      },
      {
        name: 'capability_report',
        description: 'Generate capability awareness report',
        parameters: {
          type: 'object',
          properties: {
            format: { type: 'string', enum: ['json', 'markdown', 'html'], default: 'markdown' },
            includeRecommendations: { type: 'boolean', default: true }
          }
        },
        async execute({ format, includeRecommendations }: any) {
          return adaptation.generateReport(format, includeRecommendations);
        }
      }
    ]);

    ctx.on('agent/created', async (agent) => {
      const caps = await scanner.scanAll();
      agent.inject({
        type: 'system',
        content: `CAPABILITY AWARENESS: You have access to ${caps.length} capabilities across ${new Set(caps.map(c => c.category)).size} categories. 
Key capabilities: ${caps.filter(c => c.priority === 'critical').map(c => c.name).join(', ')}.
Use capability_check tool to verify specific capabilities before attempting tasks.
Use capability_adapt to automatically select best approach for complex tasks.`
      });
    });

    ctx.on('turn/start', async () => {
      if (ctx.config.capabilityConfig?.autoScan) {
        await scanner.incrementalScan();
      }
    });
  }
});

export { CapabilityScanner } from './scanner';
export { CapabilityRegistry } from './registry';
export { CapabilityAdaptation } from './adaptation';
export type { Capability, CapabilityCategory, CapabilityStatus } from './types';


