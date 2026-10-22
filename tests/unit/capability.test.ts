import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CapabilityScanner } from '@zoveli/capability/src/scanner';
import { CapabilityRegistry } from '@zoveli/capability/src/registry';
import { CapabilityAdaptation } from '@zoveli/capability/src/adaptation';
import { zoveliCapability } from '@zoveli/capability/src/index';
import { createMockContext, createMockCapability } from '../setup';

const MOUNTED_TOOLS = [
  'mathcore_compute',
  'mathcore_check_answer',
  'memory_create_note',
  'memory_search',
  'language_detect',
  'web_search',
  'web_fetch',
  'capability_scan',
];

function liveContext() {
  return createMockContext({
    get: (key: string) =>
      key === 'tool-inventory' ? { list: () => MOUNTED_TOOLS } : undefined,
  });
}

describe('CapabilityScanner', () => {
  let scanner: CapabilityScanner;
  let mockCtx: any;

  beforeEach(() => {
    mockCtx = liveContext();
    scanner = new CapabilityScanner(mockCtx);
  });

  it('should scan builtin capabilities', async () => {
    const capabilities = await scanner.scanAll({ deep: false });
    
    expect(capabilities.length).toBeGreaterThan(0);
    expect(capabilities.some(c => c.name === 'mathcore.verified-compute')).toBe(true);
    expect(capabilities.some(c => c.name === 'memory.vault')).toBe(true);
    expect(capabilities.some(c => c.name === 'agent.loop')).toBe(true);
  });

  it('should include critical capabilities', async () => {
    const capabilities = await scanner.scanAll({ deep: false });
    const critical = capabilities.filter(c => c.priority === 'critical');
    
    expect(critical.length).toBeGreaterThanOrEqual(3);
    expect(critical.some(c => c.name === 'mathcore.verified-compute')).toBe(true);
    expect(critical.some(c => c.name === 'memory.vault')).toBe(true);
    expect(critical.some(c => c.name === 'agent.loop')).toBe(true);
  });

  it('should categorize capabilities correctly', async () => {
    const capabilities = await scanner.scanAll({ deep: false });
    const categories = new Set(capabilities.map(c => c.category));
    
    expect(categories.has('computation')).toBe(true);
    expect(categories.has('memory')).toBe(true);
    expect(categories.has('agents')).toBe(true);
    expect(categories.has('tools')).toBe(true);
  });

  it('only reports capabilities backed by mounted tools', async () => {
    const capabilities = await scanner.scanAll({ deep: false });
    const names = capabilities.map((cap) => cap.name);

    expect(names).toContain('mathcore.verified-compute');
    expect(names).toContain('memory.vault');
    expect(names).not.toContain('tools.filesystem');
    expect(names).not.toContain('tools.shell');
    expect(names).not.toContain('tools.browser');
    expect(names).not.toContain('tools.lsp');
    expect(names).not.toContain('workflows.orchestration');
  });

  it('does not invent capabilities when no live inventory is available', async () => {
    const empty = new CapabilityScanner(createMockContext());
    expect(await empty.scanAll({ forceRefresh: true })).toEqual([]);
  });

  it('should cache capabilities', async () => {
    await scanner.scanAll({ deep: false });
    const cached = scanner.getCachedCapabilities();
    
    expect(cached.length).toBeGreaterThan(0);
  });

  it('should force refresh on demand', async () => {
    await scanner.scanAll({ deep: false });
    const first = scanner.getCachedCapabilities().length;
    
    await scanner.scanAll({ deep: false, forceRefresh: true });
    const second = scanner.getCachedCapabilities().length;
    
    expect(second).toBeGreaterThanOrEqual(first);
  });
});

describe('CapabilityRegistry', () => {
  let registry: CapabilityRegistry;
  let mockCtx: any;

  beforeEach(() => {
    mockCtx = createMockContext();
    registry = new CapabilityRegistry(mockCtx);
  });

  it('should register capabilities', () => {
    const cap = createMockCapability({ name: 'test.capability' });
    registry.register(cap);
    
    const retrieved = registry.get('test.capability');
    expect(retrieved).toBeDefined();
    expect(retrieved?.name).toBe('test.capability');
  });

  it('should list capabilities with filters', () => {
    registry.register(createMockCapability({ name: 'cap1', category: 'tools', status: 'available' }));
    registry.register(createMockCapability({ name: 'cap2', category: 'memory', status: 'available' }));
    registry.register(createMockCapability({ name: 'cap3', category: 'tools', status: 'unavailable' }));
    
    const tools = registry.list({ category: 'tools' });
    expect(tools.length).toBe(2);
    
    const available = registry.list({ status: 'available' });
    expect(available.length).toBe(2);
  });

  it('should check capability availability', () => {
    registry.register(createMockCapability({ name: 'available.cap', status: 'available' }));
    registry.register(createMockCapability({ name: 'unavailable.cap', status: 'unavailable' }));
    
    expect(registry.has('available.cap')).toBe(true);
    expect(registry.has('unavailable.cap')).toBe(false);
    expect(registry.has('missing.cap')).toBe(false);
  });

  it('should get all capabilities', () => {
    registry.register(createMockCapability({ name: 'cap1' }));
    registry.register(createMockCapability({ name: 'cap2' }));
    
    const all = registry.getAll();
    expect(all.length).toBe(2);
  });
});

describe('CapabilityAdaptation', () => {
  let adaptation: CapabilityAdaptation;
  let mockCtx: any;

  beforeEach(() => {
    mockCtx = createMockContext();
    adaptation = new CapabilityAdaptation(mockCtx, null as any, null as any);
  });

  it('should adapt task to available capabilities', async () => {
    const task = { type: 'compute', expression: '2 + 2' };
    const result = await adaptation.adapt(task);
    
    expect(result).toBeDefined();
    expect(result.strategy).toBeDefined();
    expect(result.capabilities).toBeDefined();
  });

  it('should prefer verified math for computation', async () => {
    const task = { type: 'compute', expression: 'derivative of x^2' };
    const result = await adaptation.adapt(task, { preferVerified: true });
    
    expect(result.capabilities).toContain('mathcore.verified-compute');
  });

  it('should generate capability report', async () => {
    const report = await adaptation.generateReport('json', true);
    
    expect(report).toBeDefined();
    expect(report.timestamp).toBeDefined();
    expect(report.summary).toBeDefined();
    expect(report.capabilities).toBeDefined();
    expect(report.recommendations).toBeDefined();
    expect(report.gaps).toBeDefined();
  });
});

describe('capability plugin registry wiring', () => {
  it('registers scan results so capability_check/list see them', async () => {
    const ctx = liveContext();
    zoveliCapability.setup(ctx as any);
    const provided = ctx.provide.mock.calls.find(
      (call: any[]) => call[0] === 'capability'
    )?.[1];
    expect(provided).toBeTruthy();
    expect(provided.registry.getAll()).toHaveLength(0);

    const scanned = await provided.scan();
    expect(scanned.length).toBeGreaterThan(0);
    expect(provided.registry.getAll()).toHaveLength(scanned.length);
    expect(provided.getCapability('mathcore.verified-compute')).toBeTruthy();
  });

  it('registers and injects capabilities synchronously on agent/created', () => {
    const ctx = liveContext();
    zoveliCapability.setup(ctx as any);
    const provided = ctx.provide.mock.calls.find(
      (call: any[]) => call[0] === 'capability'
    )?.[1];
    const handler = ctx.on.mock.calls.find(
      (call: any[]) => call[0] === 'agent/created'
    )?.[1];
    const agent = { inject: vi.fn(), systemSections: [] as string[] };

    handler(agent);

    expect(provided.registry.getAll().length).toBeGreaterThan(0);
    expect(agent.inject).toHaveBeenCalledTimes(1);
    expect(agent.inject.mock.calls[0][0].content).toContain('mathcore.verified-compute');
  });
});