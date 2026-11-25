import { homedir } from 'node:os';
import { resolve } from 'node:path';
import {
  definePlugin,
  PLUGIN_API_VERSION,
  type Tool,
  type ZoveliPlugin,
} from '@deepseek-ai/dsh-core';
import {
  createIntelligenceKit,
  createIntelligenceTools,
  type IntelligenceGovernor,
  type IntelligenceStatus,
  type IntelligenceTool,
} from '@zoveli/intelligence';

export const INTELLIGENCE_PLUGIN_NAME = 'zoveli-intelligence';
export const INTELLIGENCE_TOOLS_KEY = 'assistant-intelligence-tools';
export const INTELLIGENCE_SERVICE_KEY = 'intelligence';

/** Agent-facing rules. Kept short: the tools carry the real contract. */
export const INTELLIGENCE_RULES = [
  'Intelligence subsystem (optional, local-first, deterministic):',
  '- For questions about indexed owner files, call intel_ask or intel_docs_answer before answering from memory. Cite the returned source and line range; never invent a citation.',
  '- If verification is "unverified", say the subsystem withheld the answer instead of guessing.',
  '- Market output describes price structure only: never present it as a prediction or financial advice.',
  '- Plans are proposals for owner review; do not execute steps automatically.',
  '- Record preferences only from explicit owner feedback via intel_preferences_record.',
].join('\n');

export interface IntelligenceConfig {
  /** Local state directory (index, preferences, audit chain). */
  dataDir: string;
  /** Allowlisted document roots. Reads outside these are rejected. */
  roots: string[];
}

export interface IntelligenceAdapterOptions {
  /** Override document roots instead of reading ZOVELI_INTEL_ROOTS. */
  roots?: readonly string[];
  /** Override the state directory instead of reading ZOVELI_INTEL_DATA_DIR. */
  dataDir?: string;
  /** Environment source; defaults to process.env. */
  env?: Record<string, string | undefined>;
}

export interface IntelligenceService {
  /** Create the governor on first use and return it. */
  governor(): IntelligenceGovernor;
  status(): IntelligenceStatus;
  verifyAudit(): ReturnType<IntelligenceGovernor['verifyAudit']>;
}

export interface IntelligenceAdapter {
  plugin: ZoveliPlugin;
  /** Create the governor on first use (no disk I/O before this). */
  getGovernor(): IntelligenceGovernor;
  /** Tool table registered by the plugin. */
  tools: Tool[];
  /** Service provided under the `intelligence` key. */
  service: IntelligenceService;
}

/**
 * Resolve roots and data directory from the environment.
 *
 * Roots are comma-separated and resolved against the process cwd. An empty
 * value falls back to the cwd so a misconfigured mount can still answer
 * questions about the working directory, but cannot read the whole home
 * directory by accident.
 */
export function resolveIntelligenceConfig(
  env: Record<string, string | undefined> = process.env,
  overrides: { dataDir?: string; roots?: readonly string[] } = {}
): IntelligenceConfig {
  const overrideRoots = (overrides.roots ?? [])
    .map((root) => root.trim())
    .filter(Boolean)
    .map((root) => resolve(root));
  const envRoots = (env.ZOVELI_INTEL_ROOTS ?? '')
    .split(',')
    .map((root) => root.trim())
    .filter(Boolean)
    .map((root) => resolve(root));
  const roots = overrideRoots.length > 0 ? overrideRoots : envRoots;
  const dataDirRaw = overrides.dataDir?.trim() || env.ZOVELI_INTEL_DATA_DIR?.trim() || '';
  const dataDir = dataDirRaw
    ? resolve(dataDirRaw)
    : resolve(homedir(), '.zoveli', 'intelligence');

  return {
    dataDir,
    roots: roots.length > 0 ? roots : [process.cwd()],
  };
}

function toHostTool(tool: IntelligenceTool): Tool {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    execute: (args: Record<string, unknown> = {}) => tool.execute(args ?? {}),
  };
}

/**
 * Build the optional Zoveli adapter around one intelligence governor.
 *
 * The governor is created lazily: mounting the plugin registers tool schemas
 * without touching the data directory, so a broken or unreadable store cannot
 * block host startup. A `Proxy` forwards tool calls to the real governor the
 * first time one runs.
 */
export function createIntelligenceAdapter(
  options: IntelligenceAdapterOptions = {}
): IntelligenceAdapter {
  let governor: IntelligenceGovernor | null = null;

  const getGovernor = (): IntelligenceGovernor => {
    if (!governor) {
      const config = resolveIntelligenceConfig(options.env ?? process.env, {
        dataDir: options.dataDir,
        roots: options.roots,
      });
      governor = createIntelligenceKit(config).governor;
    }
    return governor;
  };

  // Tools close over this proxy; no governor (and no disk I/O) until execute.
  const lazyGovernor = new Proxy({} as IntelligenceGovernor, {
    get(_target, property) {
      const real = getGovernor();
      const value = Reflect.get(real as object, property, real);
      return typeof value === 'function' ? value.bind(real) : value;
    },
  });

  const tools = createIntelligenceTools(lazyGovernor).map(toHostTool);

  const service: IntelligenceService = {
    governor: getGovernor,
    status: () => getGovernor().status(),
    verifyAudit: () => getGovernor().verifyAudit(),
  };

  const plugin = definePlugin({
    name: INTELLIGENCE_PLUGIN_NAME,
    apiVersion: PLUGIN_API_VERSION,
    description:
      'Optional local-first intelligence subsystem: grounded documents, deterministic market interpretation, planning, preferences, and hash-chained receipts',
    setup(ctx) {
      ctx.register(INTELLIGENCE_TOOLS_KEY, tools);
      ctx.provide(INTELLIGENCE_SERVICE_KEY, service);
      ctx.on('agent/created', (agent: { inject: (msg: { type: string; content: string }) => void }) => {
        agent.inject({ type: 'system', content: INTELLIGENCE_RULES });
      });
    },
  });

  return { plugin, getGovernor, tools, service };
}

/**
 * Opt-in plugin instance. Enable with `ZOVELI_PLUGINS=zoveli-intelligence`.
 * Not part of `defaultPlugins`, so the default surface stays unchanged.
 */
export const zoveliIntelligence = createIntelligenceAdapter().plugin;

export default zoveliIntelligence;
