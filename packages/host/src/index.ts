import type { ZoveliPlugin } from '@deepseek-ai/dsh-core';
import { ZoveliHost } from './host.js';
import { runRepl } from './repl.js';
import { chatConfigFromEnv } from './chat.js';
import { pluginInventory, selectPlugins } from './plugin-set.js';
import { zoveliMathIntelligence } from '@zoveli/math-intelligence';
import { zoveliMathAlgebra, zoveliMathCalculus, zoveliMathStatistics, zoveliMathLogic, zoveliMathUnits, zoveliMathDiscrete, zoveliMathArithmetic, zoveliMathGeometry, zoveliMathTrigonometry, zoveliMathProbability, zoveliMathLinear, zoveliMathNumber } from '@zoveli/math-domains';
import { zoveliMemoryStore } from '@zoveli/memory-store';
import { zoveliLanguages } from '@zoveli/languages';
import { zoveliSysinfo } from '@zoveli/sysinfo';
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
  zoveliLanguages,
  zoveliSysinfo,
  zoveliScheduler,
  zoveliSecscan,
  zoveliHealth,
  zoveliGraph,
  zoveliDocgen,
  zoveliCodeAnalysis,
  zoveliCapability,
  zoveliPersona,
  zoveliWebResearch,
  zoveliDiagnostics,
];

/**
 * Opt-in plugins wired by `pnpm create:plugin <name> --mount`. They stay
 * unloaded unless selected with `ZOVELI_PLUGINS=<plugin-name,...>`, and any
 * plugin can be removed with `ZOVELI_DISABLE_PLUGINS=<plugin-name,...>`;
 * promoting one to `defaultPlugins` is a core change (see docs/core-plugins.md).
 */
export const optionalPlugins: ZoveliPlugin[] = [zoveliGuard];

/**
 * Resolve defaults plus plugins requested in `ZOVELI_PLUGINS`, minus plugins
 * named in `ZOVELI_DISABLE_PLUGINS`.
 */
export function resolvePlugins(env: Record<string, string | undefined> = process.env): ZoveliPlugin[] {
  return selectPlugins(env, defaultPlugins, optionalPlugins);
}

/** Describe every plugin and whether the current environment mounts it. */
export function describePlugins(
  env: Record<string, string | undefined> = process.env
): ReturnType<typeof pluginInventory> {
  return pluginInventory(env, defaultPlugins, optionalPlugins);
}

export { pluginInventory, selectPlugins } from './plugin-set.js';
export type { PluginInventory, PluginInventoryEntry, PluginStatus, PluginTier } from './plugin-set.js';

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
export { chatConfigFromEnv, configuredOllamaModel, resolveChatConfig, probeOllama, chat, chatTemperature, buildMemoryBrief, isLocalProvider, memoryBriefAllowed } from './chat.js';
export type { ChatConfig } from './chat.js';


