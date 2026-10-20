import { definePlugin } from '@deepseek-ai/dsh-core';
import { mathcoreTools } from './mathcore-tools';
import { memoryTools } from './memory-tools';
import { zoveliPrompt } from './system-prompt';
import { ZOVELI_VERSION } from './version';

export const zoveliCore = definePlugin({
  name: 'zoveli-core',
  description: 'Personal Assistant AI core integration plugin',

  setup(ctx) {
    ctx.register('zoveli-prompt', zoveliPrompt);
    ctx.register('assistant-math-tools', mathcoreTools);
    ctx.register('assistant-memory-tools', memoryTools);

    ctx.on('agent/pre-step', (next, input) => {
      const enhancedInput = enhanceWithContext(input);
      return next(enhancedInput);
    });
  }
});

function enhanceWithContext(input: any) {
  return {
    ...input,
    metadata: {
      ...input.metadata,
      zoveliVersion: ZOVELI_VERSION,
      capabilities: ['verified-math', 'persistent-memory', 'skill-system']
    }
  };
}

export { ZOVELI_VERSION } from './version';
export { zoveliPrompt } from './system-prompt';
export { promptSectionsText } from './system-prompt';
export { mathcoreTools } from './mathcore-tools';
export { memoryTools } from './memory-tools';
// Single math surface: the transport singleton lives in @zoveli/math's
// subsystem; re-exported here so existing deep imports keep working.
export { mathcore } from './mathcore-mcp';


