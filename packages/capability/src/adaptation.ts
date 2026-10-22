import type { Capability } from './types';
import type { CapabilityScanner } from './scanner';
import type { CapabilityRegistry } from './registry';

interface AdaptPreferences {
  preferVerified?: boolean;
  preferLocal?: boolean;
  maxLatency?: number;
  minReliability?: number;
  costOptimize?: boolean;
}

interface AdaptResult {
  strategy: string;
  capabilities: string[];
  gaps: { needed: string; reason: string; alternatives: string[]; blockers: string[] }[];
  fallback?: { strategy: string; note: string };
  warnings: string[];
}

export class CapabilityAdaptation {
  private ctx: any;
  private scanner: CapabilityScanner | null;
  private registry: CapabilityRegistry | null;

  constructor(ctx: any, scanner: CapabilityScanner | null, registry: CapabilityRegistry | null) {
    this.ctx = ctx;
    this.scanner = scanner;
    this.registry = registry;
  }

  private available(name: string): boolean {
    if (this.registry) return this.registry.has(name);
    return true; // no registry (unit test) → assume available
  }

  async adapt(task: any, preferences: AdaptPreferences = {}): Promise<AdaptResult> {
    const type = task?.type ?? 'general';
    const warnings: string[] = [];
    const gaps: AdaptResult['gaps'] = [];
    let strategy = 'general-assist';
    let capabilities: string[] = [];
    let fallback: AdaptResult['fallback'];

    if (type === 'compute' || type === 'math') {
      if (this.available('mathcore.verified-compute') || !this.registry) {
        if (preferences.preferVerified !== false) {
          strategy = 'verified-computation';
          capabilities = ['mathcore.verified-compute'];
          if (!this.available('mathcore.verified-compute') && this.registry) {
            // registry says unavailable
            capabilities = [];
            strategy = 'llm-reasoning-unverified';
            fallback = { strategy: 'llm-reasoning-unverified', note: 'mathcore unavailable; LLM result marked UNVERIFIED' };
            warnings.push('mathcore unavailable — falling back to unverified reasoning');
          }
        } else {
          strategy = 'llm-reasoning';
          capabilities = [];
        }
      } else {
        strategy = 'llm-reasoning-unverified';
        capabilities = [];
        fallback = { strategy: 'llm-reasoning-unverified', note: 'mathcore unavailable; LLM result marked UNVERIFIED' };
        warnings.push('mathcore unavailable — falling back to unverified reasoning');
      }
    } else if (type === 'research') {
      strategy = 'web-research';
      capabilities = ['web.research', 'memory.vault'];
      if (!this.available('web.research')) {
        gaps.push({
          needed: 'web.research', reason: 'web tools unavailable for research',
          alternatives: ['memory.vault'], blockers: [],
        });
      }
    } else if (type === 'code') {
      strategy = 'code-assist';
      capabilities = ['languages.polyglot'];
      if (!this.available('languages.polyglot')) {
        gaps.push({
          needed: 'languages.polyglot', reason: 'language tools unavailable',
          alternatives: ['memory.vault'], blockers: [],
        });
      }
    } else if (type === 'vision') {
      strategy = 'unsupported';
      capabilities = [];
      gaps.push({
        needed: 'perception.vision',
        reason: 'no vision/image-analysis capability registered',
        alternatives: ['web.research'],
        blockers: ['missing-model'],
      });
    } else {
      strategy = 'general-assist';
      capabilities = ['agent.loop', 'memory.vault'];
    }

    // filter to actually-available when registry present (except fallback case)
    if (this.registry && !fallback) {
      const missing = capabilities.filter((c) => !this.available(c));
      for (const m of missing) {
        warnings.push(`preferred capability unavailable: ${m}`);
      }
    }
    if (this.registry && fallback) {
      capabilities = capabilities.filter((c) => this.available(c));
    }

    return { strategy, capabilities, gaps, fallback, warnings };
  }

  async generateReport(format: 'json' | 'markdown' | 'html' = 'markdown', includeRecommendations = true): Promise<any> {
    const caps: Capability[] = this.registry
      ? this.registry.getAll()
      : this.scanner
        ? await this.scanner.scanAll({ deep: false })
        : [];

    const summary = {
      total: caps.length,
      available: caps.filter((c) => c.status === 'available').length,
      degraded: caps.filter((c) => c.status === 'degraded').length,
      unavailable: caps.filter((c) => c.status === 'unavailable').length,
      byCategory: caps.reduce<Record<string, number>>((acc, c) => {
        acc[c.category] = (acc[c.category] ?? 0) + 1;
        return acc;
      }, {}),
    };

    const recommendations = includeRecommendations
      ? this.buildRecommendations(caps)
      : [];
    const gaps = caps
      .filter((c) => c.status === 'unavailable')
      .map((c) => ({
        needed: c.name,
        reason: `${c.displayName} is registered but unavailable`,
        alternatives: [],
        blockers: (c.requires ?? []).map((r: any) => r.name),
      }));

    if (format === 'json') {
      return { timestamp: new Date(), summary, capabilities: caps, recommendations, gaps };
    }

    const lines = [
      '# Capability Awareness Report',
      '',
      `Generated: ${new Date().toISOString()}`,
      '',
      '## Summary',
      '',
      `- Total: ${summary.total}`,
      `- Available: ${summary.available}`,
      `- Degraded: ${summary.degraded}`,
      `- Unavailable: ${summary.unavailable}`,
      '',
      '## Capabilities',
      '',
      ...caps.map((c) => `- [${c.status}] **${c.name}** (${c.category}) — ${c.description}`),
      '',
      '## Recommendations',
      '',
      ...(recommendations.length
        ? recommendations.map((r: any) => `- **${r.type}** ${r.capability}: ${r.reason}`)
        : ['- None. All critical capabilities available.']),
      '',
      '## Gaps',
      '',
      ...(gaps.length
        ? gaps.map((g) => `- **${g.needed}**: ${g.reason}`)
        : ['- None.']),
      '',
    ];
    return lines.join('\n');
  }

  private buildRecommendations(caps: Capability[]): any[] {
    const recs: any[] = [];
    const byName = new Map(caps.map((c) => [c.name, c]));
    const math = byName.get('mathcore.verified-compute');
    if (math && math.status !== 'available') {
      recs.push({
        type: 'enable', capability: 'mathcore.verified-compute',
        reason: 'Verified math is critical; reinstall mathcore (`pip install -e mathcore`)',
        impact: 'high', effort: 'low', steps: ['pip install -e ../mathcore', 'mathcore "2+2"'],
      });
    }
    for (const c of caps) {
      if (c.status === 'degraded') {
        recs.push({
          type: 'configure', capability: c.name,
          reason: `${c.displayName} is degraded (success rate ${(c.health.successRate * 100).toFixed(0)}%)`,
          impact: 'medium', effort: 'medium', steps: ['capability_check with details', 'see runbooks'],
        });
      }
    }
    return recs;
  }
}
