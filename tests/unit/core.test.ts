import { describe, it, expect, vi } from 'vitest';
import { zoveliCore } from '../../packages/core/src/index';
import { zoveliMath } from '../../packages/math-intelligence/src/index';
import {
  MATHCORE_MCP_SERVER_ID,
  MATH_RULES,
  mathcoreServerConfig,
  resolveMathcoreCommand,
  commandParts,
} from '../../packages/math-intelligence/src/index';
import { mathcore } from '../../packages/core/src/index';
import { zoveliMemory } from '../../packages/memory/src/index';
import { createMockContext } from '../setup';

describe('zoveli core', () => {
  it('registers only the legacy prompt', () => {
    const ctx = createMockContext();
    zoveliCore.setup(ctx);

    expect(ctx.register).toHaveBeenCalledWith('zoveli-prompt', expect.any(Object));
    expect(ctx.register).toHaveBeenCalledTimes(1);
    expect(ctx.on).not.toHaveBeenCalled();
  });

  it('does not reclaim tool surfaces owned by other packages', () => {
    const ctx = createMockContext();
    zoveliCore.setup(ctx);

    const keys = ctx.register.mock.calls.map((c: any[]) => c[0]);
    expect(keys).not.toContain('assistant-math-tools');
    expect(keys).not.toContain('assistant-memory-tools');
  });

  it('should have system prompt with math rules', () => {
    const ctx = createMockContext();
    zoveliCore.setup(ctx);
    
    const promptCall = ctx.register.mock.calls.find(c => c[0] === 'zoveli-prompt');
    expect(promptCall).toBeDefined();
    expect(promptCall[1].sections).toBeDefined();
    expect(promptCall[1].sections.some((s: any) => s.id === 'math-rules')).toBe(true);
  });
});

describe('zoveli math', () => {
  it('should register mathcore MCP client', () => {
    const ctx = createMockContext();
    zoveliMath.setup(ctx);
    
    const mcpCall = ctx.register.mock.calls.find(c => c[0] === 'mathcore-mcp-client');
    expect(mcpCall).toBeDefined();
    expect(mcpCall[1].config.command).toBe(commandParts(resolveMathcoreCommand()).command);
  });

  it('should inject math rules on agent creation', () => {
    const ctx = createMockContext();
    zoveliMath.setup(ctx);
    
    const agentCreatedHandler = ctx.on.mock.calls.find(c => c[0] === 'agent/created');
    expect(agentCreatedHandler).toBeDefined();
    
    const mockAgent = { inject: vi.fn() };
    agentCreatedHandler[1](mockAgent);
    
    expect(mockAgent.inject).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'system',
        content: expect.stringContaining('MATH RULES')
      })
    );
  });
});

describe('one math subsystem (single source of truth)', () => {
  it('math plugin config uses the canonical command and server id', () => {
    const ctx = createMockContext();
    zoveliMath.setup(ctx);

    const mcpCall = ctx.register.mock.calls.find((c: any) => c[0] === 'mathcore-mcp-client');
    expect(mcpCall).toBeDefined();
    expect(mcpCall[1]).toEqual(mathcoreServerConfig());
    expect(mcpCall[1].config.command).toBe(commandParts(resolveMathcoreCommand()).command);
    expect(mcpCall[1].config.serverName).toBe(MATHCORE_MCP_SERVER_ID);
  });

  it('transport singleton defaults to the resolved command', () => {
    expect((mathcore as any).command).toBe(resolveMathcoreCommand());
  });

  it('injected agent rules are the canonical MATH_RULES verbatim', () => {
    const ctx = createMockContext();
    zoveliMath.setup(ctx);

    const handler = ctx.on.mock.calls.find((c: any) => c[0] === 'agent/created');
    const mockAgent = { inject: vi.fn() };
    handler[1](mockAgent);
    expect(mockAgent.inject).toHaveBeenCalledWith({ type: 'system', content: MATH_RULES });
  });
});

describe('zoveli memory', () => {
  it('should provide memory service', () => {
    const ctx = createMockContext();
    zoveliMemory.setup(ctx);

    expect(ctx.provide).toHaveBeenCalledWith('memory', expect.objectContaining({
      createNote: expect.any(Function),
      searchNotes: expect.any(Function),
      readNote: expect.any(Function),
      listTags: expect.any(Function)
    }));
  });

  it('should register vault path', () => {
    const ctx = createMockContext();
    zoveliMemory.setup(ctx);
    
    const vaultCall = ctx.register.mock.calls.find(c => c[0] === 'memory-vault-path');
    expect(vaultCall).toBeDefined();
  });
});
