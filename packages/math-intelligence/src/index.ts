import { definePlugin } from '@deepseek-ai/dsh-core';
import {
  MATHCORE_MCP_COMMAND,
  MATHCORE_MCP_SERVER_ID,
  MATH_RULES,
  MATH_INTELLIGENCE_RULES,
  defaultMathcoreAuditPath,
  mathcoreServerConfig,
} from './constants.js';
import { mathcore, MathcoreClient } from './transport.js';
import { mathcoreTools, mathIntelligenceTools } from './tools.js';
import { getMathStats } from './intelligence.js';
import { commandParts, resolveMathcoreCommand } from './resolve.js';

export {
  MATHCORE_MCP_COMMAND,
  MATHCORE_MCP_SERVER_ID,
  MATH_RULES,
  MATH_INTELLIGENCE_RULES,
  defaultMathcoreAuditPath,
  mathcoreServerConfig,
};
export { mathcore, MathcoreClient };
export type { MathcoreClientOptions, MathcoreStatus } from './transport.js';
export { resolveMathcoreCommand, commandParts };
export type { ResolveMathcoreOptions } from './resolve.js';
export { mathcoreTools, mathIntelligenceTools };
export { memorizeVerified, recallSimilar, getMathStats, resetMathStatsForTests, recordRecall, recordMismatch, recordWithheld } from './intelligence.js';
export { recallSemantic, cosine, keywordScore } from './semantic.js';
export type { SemanticMode, SemanticHit, SemanticResult } from './semantic.js';
export { routeDomain, DOMAIN_OPERATIONS, domainMemoryTag, domainTitlePrefix, OP_INVOCATION, invocationHead, buildCommand } from './domains.js';
export type { MathDomain } from './domains.js';

export const zoveliMathIntelligence = definePlugin({
  name: 'zoveli-math-intelligence',
  description: 'One AI math intelligence subsystem: verified compute + proof memory + agent rules',

  setup(ctx) {
    ctx.register('mathcore-mcp-client', mathcoreServerConfig());
    ctx.register('assistant-math-tools', mathcoreTools);
    ctx.register('assistant-math-intelligence-tools', mathIntelligenceTools);
    ctx.provide('math-intelligence', { stats: getMathStats });

    ctx.on('agent/created', (agent) => {
      agent.inject({ type: 'system', content: MATH_RULES });
      agent.inject({ type: 'system', content: MATH_INTELLIGENCE_RULES });
    });
  },
});

// Back-compat alias: existing mounts use `zoveliMath`.
export const zoveliMath = zoveliMathIntelligence;

export default zoveliMathIntelligence;
