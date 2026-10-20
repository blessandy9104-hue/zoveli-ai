import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  MATHCORE_MCP_COMMAND,
  MATHCORE_MCP_SERVER_ID,
  MATH_RULES,
  mathcoreServerConfig,
  mathcore,
  mathcoreTools,
  mathIntelligenceTools,
  memorizeVerified,
  recallSimilar,
  getMathStats,
  resetMathStatsForTests,
  zoveliMathIntelligence,
  resolveMathcoreCommand,
  commandParts,
} from '../../packages/math-intelligence/src/index';
import { mathcore as coreMathcore } from '../../packages/core/src/index';
import { mathcoreTools as coreTools } from '../../packages/core/src/mathcore-tools';
import { resetStoreForTests } from '../../packages/memory-store/src/store';
import { createMockContext } from '../setup';

describe('one AI math intelligence subsystem (single source of truth)', () => {
  beforeEach(() => {
    process.env.ZOVELI_MEMORY_DB = ':memory:';
    process.env.ZOVELI_MEMORY_EXPORT = '0';
    process.env.ZOVELI_MATH_MEMORIZE = '1';
    resetStoreForTests();
    resetMathStatsForTests();
  });

  afterEach(() => {
    resetStoreForTests();
    resetMathStatsForTests();
    delete process.env.ZOVELI_MEMORY_DB;
    delete process.env.ZOVELI_MEMORY_EXPORT;
    delete process.env.ZOVELI_MATH_MEMORIZE;
  });

  it('canonical constants match the frozen contract', () => {
    expect(MATHCORE_MCP_COMMAND).toBe('mathcore-mcp');
    expect(MATHCORE_MCP_SERVER_ID).toBe('mathcore');
    expect(MATH_RULES).toContain('DO NOT compute in your head');
    expect(mathcoreServerConfig().config.command).toBe(
      commandParts(resolveMathcoreCommand()).command
    );
    expect(mathcoreServerConfig().config.serverName).toBe(MATHCORE_MCP_SERVER_ID);
  });

  it('transport singleton defaults to the resolved command', () => {
    expect((mathcore as any).command).toBe(resolveMathcoreCommand());
    expect((coreMathcore as any).command).toBe(resolveMathcoreCommand());
    expect(typeof coreMathcore.compute).toBe('function');
  });

  it('core tools delegate with preserved names', () => {
    expect(coreTools.map((t: any) => t.name).sort()).toEqual(
      mathcoreTools.map((t: any) => t.name).sort()
    );
    for (const name of ['mathcore_compute', 'mathcore_check_answer', 'mathcore_list_operations']) {
      expect(mathcoreTools.some((t: any) => t.name === name)).toBe(true);
    }
    for (const name of ['math_recall', 'math_memorize', 'math_stats']) {
      expect(mathIntelligenceTools.some((t: any) => t.name === name)).toBe(true);
    }
  });

  it('memorizes verified proofs and recalls them', async () => {
    const title = await memorizeVerified('solve x^2 - 5x + 6 = 0', 'VERIFIED: x = 2, x = 3');
    expect(title).toContain('math/');
    const hits = await recallSimilar('quadratic roots');
    expect(hits.length).toBeGreaterThanOrEqual(0);
    const stats = getMathStats();
    expect(stats.verified).toBe(1);
  });

  it('withholds without DB spam and respects opt-out', async () => {
    const off = await memorizeVerified('1/0', 'WITHHELD: division by zero');
    expect(off).toBeNull();
    process.env.ZOVELI_MATH_MEMORIZE = '0';
    const out = await memorizeVerified('2+2', 'VERIFIED: 4');
    expect(out).toBeNull();
  });

  it('plugin registers one client + both toolsets + both rule texts', () => {
    const ctx = createMockContext();
    zoveliMathIntelligence.setup(ctx);
    const client = ctx.register.mock.calls.find((c) => c[0] === 'mathcore-mcp-client');
    expect(client?.[1]).toEqual(mathcoreServerConfig());
    expect(ctx.register.mock.calls.some((c) => c[0] === 'assistant-math-tools')).toBe(true);
    expect(ctx.register.mock.calls.some((c) => c[0] === 'assistant-math-intelligence-tools')).toBe(true);
    const handler = ctx.on.mock.calls.find((c) => c[0] === 'agent/created');
    const agent = { inject: vi.fn() };
    handler[1](agent);
    const injected = agent.inject.mock.calls.map((c: any) => c[0].content).join('\n');
    expect(injected).toContain('MATH RULES');
    expect(injected).toContain('MATH INTELLIGENCE');
  });
});
