import { ZoveliHost } from './host.js';
import { runRepl } from './repl.js';
import { chatConfigFromEnv } from './chat.js';
import { zoveliCore } from '@zoveli/core';
import { zoveliMathIntelligence } from '@zoveli/math-intelligence';
import { zoveliMathAlgebra, zoveliMathCalculus, zoveliMathStatistics, zoveliMathLogic, zoveliMathUnits, zoveliMathDiscrete, zoveliMathArithmetic, zoveliMathGeometry, zoveliMathTrigonometry, zoveliMathProbability, zoveliMathLinear, zoveliMathNumber } from '@zoveli/math-domains';
import { zoveliMemoryStore } from '@zoveli/memory-store';
import { zoveliMemory } from '@zoveli/memory';
import { zoveliSkills } from '@zoveli/skills';
import { zoveliLanguages } from '@zoveli/languages';
import { zoveliSysinfo } from '@zoveli/sysinfo';
import { zoveliSearch } from '@zoveli/search';
import { zoveliScheduler } from '@zoveli/scheduler';
import { zoveliSecscan } from '@zoveli/secscan';
import { zoveliHealth } from '@zoveli/health';
import { zoveliGraph } from '@zoveli/graph';
import { zoveliDocgen } from '@zoveli/docgen';
import { zoveliCodeAnalysis } from '@zoveli/code-analysis';
import { zoveliCapability } from '@zoveli/capability';
import { zoveliGuard } from '@zoveli/guard';
import { zoveliPersona } from '@zoveli/persona';
import { zoveliWebResearch } from '@zoveli/webresearch';
import { zoveliDiagnostics } from '@zoveli/diagnostics';

/**
 * The default tool-bearing plugin set. Config-only plugins (agent loop,
 * session, presets, guard policies, ...) are intentionally not mounted:
 * this host implements its own loop; upstream Cordis parity is future work.
 */
export const defaultPlugins = [
  zoveliCore,
  zoveliMathIntelligence,
  zoveliMathAlgebra,
  zoveliMathCalculus,
  zoveliMathStatistics,
  zoveliMathLogic,
  zoveliMathUnits,
  zoveliMathDiscrete,
  zoveliMathArithmetic,
  zoveliMathGeometry,
  zoveliMathTrigonometry,
  zoveliMathProbability,
  zoveliMathLinear,
  zoveliMathNumber,
  zoveliMemoryStore,
  zoveliMemory,
  zoveliSkills,
  zoveliLanguages,
  zoveliSysinfo,
  zoveliSearch,
  zoveliScheduler,
  zoveliSecscan,
  zoveliHealth,
  zoveliGraph,
  zoveliDocgen,
  zoveliCodeAnalysis,
  zoveliCapability,
  zoveliGuard,
  zoveliPersona,
  zoveliWebResearch,
  zoveliDiagnostics,
];

/** Boot the host, mount the default plugins, and start the REPL. */
export async function boot(): Promise<void> {
  const host = new ZoveliHost();
  const agent = host.mount(defaultPlugins as any);
  await runRepl(host, agent);
}

export { ZoveliHost } from './host.js';
export { chatConfigFromEnv, resolveChatConfig, probeOllama, chat, chatTemperature, buildMemoryBrief, isLocalProvider, memoryBriefAllowed } from './chat.js';
export type { ChatConfig } from './chat.js';


