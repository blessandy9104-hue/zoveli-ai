import { definePlugin } from '@deepseek-ai/dsh-core';
import { zoveliPrompt } from './system-prompt';

export const zoveliCore = definePlugin({
  name: 'zoveli-core',
  description: 'System prompt plugin (tools live in their owning packages)',

  setup(ctx) {
    ctx.register('zoveli-prompt', zoveliPrompt);
  }
});

export { ZOVELI_VERSION } from './version';
export { zoveliPrompt } from './system-prompt';
export { promptSectionsText } from './system-prompt';
export { mathcoreTools } from './mathcore-tools';
// Single math surface: the transport singleton lives in @zoveli/math-intelligence;
// re-exported here so existing deep imports keep working.
export { mathcore } from './mathcore-mcp';


