import { describe, it, expect, beforeAll } from 'vitest';
import { CapabilityScanner } from '@zoveli/capability/src/scanner';
import { CapabilityRegistry } from '@zoveli/capability/src/registry';
import { CapabilityAdaptation } from '@zoveli/capability/src/adaptation';
import { createMockContext } from '../setup';

describe('Capability System Integration', () => {
  let scanner: CapabilityScanner;
  let registry: CapabilityRegistry;
  let adaptation: CapabilityAdaptation;
  let mockCtx: any;

  beforeAll(() => {
    const tools = [
      'mathcore_compute',
      'mathcore_check_answer',
      'memory_create_note',
      'memory_search',
      'language_detect',
      'web_search',
      'web_fetch',
      'capability_scan',
    ];
    mockCtx = createMockContext({
      get: (key: string) => (key === 'tool-inventory' ? { list: () => tools } : undefined),
    });
    scanner = new CapabilityScanner(mockCtx);
    registry = new CapabilityRegistry(mockCtx);
    adaptation = new CapabilityAdaptation(mockCtx, scanner, registry);
  });

  it('should scan and register all capabilities', async () => {
    const capabilities = await scanner.scanAll({ deep: true });
    
    for (const cap of capabilities) {
      registry.register(cap);
    }
    
    const registered = registry.getAll();
    expect(registered.length).toBe(capabilities.length);
  });

  it('should adapt computation task to mathcore', async () => {
    const capabilities = await scanner.scanAll({ deep: false });
    for (const cap of capabilities) {
      registry.register(cap);
    }
    
    const task = { type: 'compute', expression: 'integrate x^2 from 0 to 1' };
    const result = await adaptation.adapt(task, { preferVerified: true });
    
    expect(result.capabilities).toContain('mathcore.verified-compute');
    expect(result.strategy).toBe('verified-computation');
  });

  it('should adapt research task to web tools + memory', async () => {
    const capabilities = await scanner.scanAll({ deep: false });
    for (const cap of capabilities) {
      registry.register(cap);
    }
    
    const task = { type: 'research', topic: 'AI agents market trends' };
    const result = await adaptation.adapt(task);
    
    expect(result.capabilities).toContain('web.research');
    expect(result.capabilities).toContain('memory.vault');
    expect(result.strategy).toBeDefined();
  });

  it('should adapt coding task to the language tools', async () => {
    const capabilities = await scanner.scanAll({ deep: false });
    for (const cap of capabilities) {
      registry.register(cap);
    }
    
    const task = { type: 'code', action: 'refactor', files: ['src/utils.ts'] };
    const result = await adaptation.adapt(task);
    
    expect(result.capabilities).toContain('languages.polyglot');
  });

  it('should generate comprehensive report', async () => {
    const capabilities = await scanner.scanAll({ deep: false });
    for (const cap of capabilities) {
      registry.register(cap);
    }
    
    const report = await adaptation.generateReport('markdown', true);
    
    expect(report).toContain('# Capability Awareness Report');
    expect(report).toContain('## Summary');
    expect(report).toContain('## Capabilities');
    expect(report).toContain('## Recommendations');
    expect(report).toContain('## Gaps');
  });

  it('should identify capability gaps', async () => {
    const capabilities = await scanner.scanAll({ deep: false });
    for (const cap of capabilities) {
      registry.register(cap);
    }
    
    // Task requiring unavailable capability
    const task = { type: 'vision', action: 'analyze-image', imageUrl: 'http://example.com/img.png' };
    const result = await adaptation.adapt(task);
    
    expect(result.gaps).toBeDefined();
    expect(result.gaps.length).toBeGreaterThan(0);
  });

  it('should handle missing mathcore gracefully', async () => {
    // Simulate mathcore unavailable
    const caps = await scanner.scanAll({ deep: false });
    const mathcoreCap = caps.find(c => c.name === 'mathcore.verified-compute');
    if (mathcoreCap) {
      mathcoreCap.status = 'unavailable';
      mathcoreCap.health.successRate = 0;
    }
    
    for (const cap of caps) {
      registry.register(cap);
    }
    
    const task = { type: 'compute', expression: '2 + 2' };
    const result = await adaptation.adapt(task, { preferVerified: true });
    
    // Should fall back to LLM reasoning
    expect(result.fallback).toBeDefined();
    expect(result.capabilities).not.toContain('mathcore.verified-compute');
  });
});