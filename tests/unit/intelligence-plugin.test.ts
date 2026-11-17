import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { validatePlugin } from '../../packages/shim-dsh-core/src/index';
import {
  INTELLIGENCE_PLUGIN_NAME,
  INTELLIGENCE_RULES,
  INTELLIGENCE_SERVICE_KEY,
  INTELLIGENCE_TOOLS_KEY,
  createIntelligenceAdapter,
  resolveIntelligenceConfig,
  zoveliIntelligence,
  type IntelligenceAdapter,
} from '../../packages/intelligence-plugin/src/index';
import { createMockAgent, createMockContext } from '../setup';

function setup(adapter: IntelligenceAdapter) {
  const ctx = createMockContext();
  adapter.plugin.setup(ctx);
  const registration = ctx.register.mock.calls.find(
    (call: any[]) => call[0] === INTELLIGENCE_TOOLS_KEY
  );
  expect(registration).toBeDefined();
  const tools = registration![1] as any[];
  return { ctx, tools, tool: (name: string) => tools.find((t) => t.name === name) };
}

describe('resolveIntelligenceConfig', () => {
  it('defaults roots to cwd and data to the Zoveli home directory', () => {
    const config = resolveIntelligenceConfig({});
    expect(config.roots).toEqual([resolve(process.cwd())]);
    expect(config.dataDir).toBe(resolve(homedir(), '.zoveli', 'intelligence'));
  });

  it('parses comma-separated roots, trims blanks, and resolves paths', () => {
    const config = resolveIntelligenceConfig({
      ZOVELI_INTEL_ROOTS: ' notes , , documents ',
    });
    expect(config.roots).toEqual([resolve('notes'), resolve('documents')]);
  });

  it('reads the data directory and lets explicit options win', () => {
    expect(
      resolveIntelligenceConfig({ ZOVELI_INTEL_DATA_DIR: 'state' }).dataDir
    ).toBe(resolve('state'));
    expect(
      resolveIntelligenceConfig(
        { ZOVELI_INTEL_DATA_DIR: 'state', ZOVELI_INTEL_ROOTS: 'env-root' },
        { dataDir: 'override', roots: [' option-root '] }
      )
    ).toEqual({
      dataDir: resolve('override'),
      roots: [resolve('option-root')],
    });
  });

  it('falls back when environment values are blank', () => {
    const config = resolveIntelligenceConfig({
      ZOVELI_INTEL_DATA_DIR: '   ',
      ZOVELI_INTEL_ROOTS: ' , ',
    });
    expect(config.roots).toEqual([resolve(process.cwd())]);
    expect(config.dataDir).toBe(resolve(homedir(), '.zoveli', 'intelligence'));
  });
});

describe('zoveli intelligence adapter', () => {
  let base: string;
  let dataDir: string;
  let root: string;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'zoveli-intelligence-plugin-'));
    dataDir = join(base, 'data');
    root = join(base, 'root');
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, 'runbook.md'),
      'Restart the gateway with the blue button. The maintenance window is Monday at 09:00.'
    );
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  function adapter() {
    return createIntelligenceAdapter({ dataDir, roots: [root] });
  }

  it('exports a valid opt-in plugin and does not touch disk at mount time', () => {
    const instance = adapter();
    expect(validatePlugin(instance.plugin)).toEqual([]);
    expect(instance.plugin.name).toBe(INTELLIGENCE_PLUGIN_NAME);
    expect(instance.plugin.apiVersion).toBe(1);
    expect(zoveliIntelligence.name).toBe(INTELLIGENCE_PLUGIN_NAME);

    setup(instance);
    expect(existsSync(dataDir)).toBe(false);
  });

  it('registers all 16 tools, the service, and the agent rules', () => {
    const instance = adapter();
    const { ctx, tools } = setup(instance);

    expect(tools).toHaveLength(16);
    expect(new Set(tools.map((tool) => tool.name)).size).toBe(16);
    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        'intel_status',
        'intel_ask',
        'intel_docs_index',
        'intel_docs_answer',
        'intel_market_interpret',
        'intel_plan_create',
        'intel_preferences_record',
        'intel_audit_verify',
      ])
    );

    const serviceCall = ctx.provide.mock.calls.find(
      (call: any[]) => call[0] === INTELLIGENCE_SERVICE_KEY
    );
    expect(serviceCall).toBeDefined();
    expect(serviceCall![1]).toMatchObject({
      status: expect.any(Function),
      verifyAudit: expect.any(Function),
      governor: expect.any(Function),
    });

    const handlerCall = ctx.on.mock.calls.find(
      (call: any[]) => call[0] === 'agent/created'
    );
    expect(handlerCall).toBeDefined();
    const agent = createMockAgent();
    handlerCall![1](agent);
    expect(agent.inject).toHaveBeenCalledWith({
      type: 'system',
      content: INTELLIGENCE_RULES,
    });
  });

  it('creates the governor and store on first use', async () => {
    const instance = adapter();
    const { tool } = setup(instance);

    const status = (await tool('intel_status').execute({})) as Record<string, any>;
    expect(status.name).toBe('@zoveli/intelligence');
    expect(status.domains).toHaveLength(4);
    expect(existsSync(dataDir)).toBe(true);
    expect(instance.getGovernor()).toBe(instance.getGovernor());
  });

  it('indexes and answers from local documents with grounded citations', async () => {
    const instance = adapter();
    const { tool } = setup(instance);

    const indexed = (await tool('intel_docs_index').execute({ paths: [root] })) as Record<string, any>;
    expect(indexed.indexed).toHaveLength(1);
    expect(indexed.receipt.domain).toBe('documents');

    const answer = (await tool('intel_docs_answer').execute({
      query: 'How do I restart the gateway?',
    })) as Record<string, any>;
    expect(answer.domain).toBe('documents');
    expect(answer.verification).toBe('grounded');
    expect(answer.answer).toContain('blue button');
    expect(answer.evidence[0].locator).toMatch(/^lines \d+-\d+$/);
    expect(answer.receipt.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('runs planning, market, and preference tools through the governor', async () => {
    const instance = adapter();
    const { tool } = setup(instance);

    const plan = (await tool('intel_plan_create').execute({
      objective: 'Build a local search feature',
      constraints: ['no network'],
      deadline: '2099-01-01',
    })) as Record<string, any>;
    expect(plan.verification).toBe('advisory');
    expect(plan.data.steps.length).toBeGreaterThan(0);

    const market = (await tool('intel_market_interpret').execute({
      prices: [100, 101, 102, 103, 104, 105, 106],
      instrument: 'equity',
    })) as Record<string, any>;
    expect(market.verification).toBe('verified');
    expect(market.data.interpretation.trend.kind).toBe('uptrend');

    const preference = (await tool('intel_preferences_record').execute({
      category: 'coding',
      signal: 'more_detail',
    })) as Record<string, any>;
    expect(preference.data.signals.more_detail).toBe(1);
  });

  it('exposes status and audit verification through the service', async () => {
    const instance = adapter();
    const { ctx, tool } = setup(instance);
    await tool('intel_plan_create').execute({ objective: 'Build a local search feature' });

    const service = ctx.provide.mock.calls.find(
      (call: any[]) => call[0] === INTELLIGENCE_SERVICE_KEY
    )![1];
    expect(service.status().audit.entries).toBe(1);
    const verification = service.verifyAudit();
    expect(verification).toMatchObject({ ok: true, entries: 1 });
    expect(service.governor().audit.tip).toBe(verification.tipHash);
  });

  it('reports subsystem errors through the tool boundary', () => {
    const instance = adapter();
    const { tool } = setup(instance);

    let error: unknown;
    try {
      tool('intel_docs_answer').execute({});
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ code: 'INTEL_INPUT' });
  });
});
