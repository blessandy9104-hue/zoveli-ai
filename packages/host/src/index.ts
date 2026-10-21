import type { ZoveliPlugin } from '@deepseek-ai/dsh-core';
import { ZoveliHost } from './host.js';
import { runRepl } from './repl.js';
import { chatConfigFromEnv } from './chat.js';
import { selectPlugins } from './plugin-set.js';
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

/**
 * Opt-in plugins wired by `pnpm create:plugin <name> --mount`. They stay
 * unloaded unless selected with `ZOVELI_PLUGINS=<plugin-name,...>`; promoting
 * one to `defaultPlugins` is a core change (see docs/core-plugins.md).
 */
export const optionalPlugins: ZoveliPlugin[] = [];

/** Resolve defaults plus any plugins requested by name in `ZOVELI_PLUGINS`. */
export function resolvePlugins(env: Record<string, string | undefined> = process.env): ZoveliPlugin[] {
  return selectPlugins(env, defaultPlugins, optionalPlugins);
}

export { selectPlugins } from './plugin-set.js';

/** Boot the host, mount defaults plus `ZOVELI_PLUGINS`, and start the REPL. */
export async function boot(): Promise<void> {
  const host = new ZoveliHost();
  const agent = host.mount(resolvePlugins());
  await runRepl(host, agent);
}

export { ZoveliHost } from './host.js';
export type { HostOptions, ToolCallTrace, ToolCallStats } from './host.js';
export { StructuredLogSink, resolveStructuredLog } from './structured-log.js';
export type { StructuredLogOptions, StructuredLogStats } from './structured-log.js';
export { chatConfigFromEnv, resolveChatConfig, probeOllama, chat, chatTemperature, buildMemoryBrief, isLocalProvider, memoryBriefAllowed } from './chat.js';
export type { ChatConfig } from './chat.js';


