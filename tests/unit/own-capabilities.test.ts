import { describe, it, expect } from 'vitest';
import { zoveliCodeAnalysis } from '../../packages/code-analysis/src/index';
import { zoveliDocgen } from '../../packages/docgen/src/index';
import { zoveliHealth } from '../../packages/health/src/index';
import { zoveliGraph } from '../../packages/graph/src/index';
import { zoveliScheduler } from '../../packages/scheduler/src/index';
import { zoveliSecscan } from '../../packages/secscan/src/index';
import { createMockContext } from '../setup';

function setup(plugin: any) {
  const ctx = createMockContext();
  plugin.setup(ctx);
  return ctx;
}

describe('zoveli own capabilities register', () => {
  it('code-analysis registers code_review tool', () => {
    const ctx = setup(zoveliCodeAnalysis);
    const call = ctx.register.mock.calls.find((c: any[]) => c[0] === 'code-analysis-tools');
    expect(call).toBeDefined();
    expect(call[1][0].name).toBe('code_review');
  });

  it('docgen registers docs_generate tool', () => {
    const ctx = setup(zoveliDocgen);
    const call = ctx.register.mock.calls.find((c: any[]) => c[0] === 'docgen-tools');
    expect(call).toBeDefined();
  });

  it('health registers project_health tool', () => {
    const ctx = setup(zoveliHealth);
    const call = ctx.register.mock.calls.find((c: any[]) => c[0] === 'health-tools');
    expect(call).toBeDefined();
  });

  it('graph registers vault_graph tool', () => {
    const ctx = setup(zoveliGraph);
    const call = ctx.register.mock.calls.find((c: any[]) => c[0] === 'graph-tools');
    expect(call).toBeDefined();
    expect(call[1][0].name).toBe('vault_graph');
  });

  it('scheduler registers tasks_schedule tool', () => {
    const ctx = setup(zoveliScheduler);
    const call = ctx.register.mock.calls.find((c: any[]) => c[0] === 'scheduler-tools');
    expect(call).toBeDefined();
  });

  it('secscan registers security_scan tool', () => {
    const ctx = setup(zoveliSecscan);
    const call = ctx.register.mock.calls.find((c: any[]) => c[0] === 'secscan-tools');
    expect(call).toBeDefined();
  });
});

