/**
 * LOCAL COMPATIBILITY SHIM for `@deepseek-ai/dsh-core` (Zoveli).
 *
 * The upstream DeepSeek Harness has NO package called `dsh-core` and NO
 * `definePlugin` helper (real harness plugins are Cordis `{ name, apply }`
 * objects built on `@deepseek-ai/cordis`). This shim exists so that:
 *  - `pnpm install` resolves (workspace has exactly one `dsh-core`),
 *  - `tsc --noEmit` typechecks the Zoveli plugin authoring convention,
 *  - `tsdown` builds and `vitest` runs against mock contexts.
 *
 * It is deliberately loose (`any`-friendly) under `strict: true` so that
 * destructured tool args and untyped event handlers typecheck.
 *
 * Runtime interop with the real Cordis host is NOT provided here and is
 * tracked as future work. Do not mistake a passing build for runtime parity.
 */

/** Minimal structural type for the Zoveli plugin context used in tests. */
export interface ZoveliContext {
  register: (key: string, value?: any, ...rest: any[]) => any;
  provide: (key: string, value?: any, ...rest: any[]) => any;
  on: (event: string, handler: (payload?: any, ...rest: any[]) => any, ...rest: any[]) => any;
  emit?: (event: string, ...args: any[]) => any;
  get?: (key: string, ...args: any[]) => any;
  log?: any;
  config?: any;
  plugins?: any[];
  [key: string]: any;
}

/**
 * Plugin authoring contract version. Increment only for a breaking change to
 * `ZoveliPlugin`, `ZoveliContext`, or the tool shape; plugins may declare
 * `apiVersion` and the host refuses newer values with an actionable error.
 */
export const PLUGIN_API_VERSION = 1;

/** Zoveli plugin shape (authoring convention, not upstream Cordis). */
export interface ZoveliPlugin {
  name: string;
  description?: string;
  apiVersion?: number;
  setup: (ctx: ZoveliContext) => unknown;
  [key: string]: unknown;
}

export interface PluginContractIssue {
  code: string;
  index: number;
  plugin?: string;
  message: string;
}

export class PluginContractError extends Error {
  readonly issues: PluginContractIssue[];

  constructor(issues: PluginContractIssue[]) {
    super(
      ['invalid plugin contract:', ...issues.map((issue) => `- ${issue.message}`)].join('\n')
    );
    this.name = 'PluginContractError';
    this.issues = issues;
  }
}

/**
 * Check one plugin against the authoring contract without mounting it.
 * Returns every issue so a scaffolder, CLI, or test can report them at once.
 * `apiVersion` is optional (missing means 1) for back-compat with built-ins.
 */
export function validatePlugin(plugin: unknown, index = 0): PluginContractIssue[] {
  const issues: PluginContractIssue[] = [];
  if (!plugin || typeof plugin !== 'object' || Array.isArray(plugin)) {
    return [
      {
        code: 'PLUGIN_NOT_OBJECT',
        index,
        message: `plugin at index ${index} must be a plain object`,
      },
    ];
  }
  const p = plugin as Partial<ZoveliPlugin> & Record<string, unknown>;
  if (typeof p.name !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(p.name)) {
    issues.push({
      code: 'PLUGIN_NAME',
      index,
      message: `plugin at index ${index} needs a lowercase name (letters, digits, dashes; 1-64 chars)`,
    });
  }
  if (p.description !== undefined && typeof p.description !== 'string') {
    issues.push({
      code: 'PLUGIN_DESCRIPTION',
      index,
      plugin: typeof p.name === 'string' ? p.name : undefined,
      message: `plugin "${p.name}" description must be a string`,
    });
  }
  if (typeof p.setup !== 'function') {
    issues.push({
      code: 'PLUGIN_SETUP',
      index,
      plugin: typeof p.name === 'string' ? p.name : undefined,
      message: `plugin "${p.name}" needs a setup(ctx) function`,
    });
  } else if (p.setup.constructor?.name === 'AsyncFunction') {
    issues.push({
      code: 'PLUGIN_ASYNC_SETUP',
      index,
      plugin: typeof p.name === 'string' ? p.name : undefined,
      message: `plugin "${p.name}" setup() must be synchronous (the host mounts synchronously)`,
    });
  }
  if (p.apiVersion !== undefined) {
    if (!Number.isInteger(p.apiVersion) || p.apiVersion < 1) {
      issues.push({
        code: 'PLUGIN_API_VERSION',
        index,
        plugin: typeof p.name === 'string' ? p.name : undefined,
        message: `plugin "${p.name}" apiVersion must be a positive integer`,
      });
    } else if (p.apiVersion > PLUGIN_API_VERSION) {
      issues.push({
        code: 'PLUGIN_API_UNSUPPORTED',
        index,
        plugin: typeof p.name === 'string' ? p.name : undefined,
        message: `plugin "${p.name}" targets plugin API ${p.apiVersion}, but this host supports ${PLUGIN_API_VERSION}; update Zoveli or the plugin`,
      });
    }
  }
  return issues;
}

/** Validate a mount list as a whole, including duplicate plugin names. */
export function assertPlugins(plugins: readonly unknown[]): asserts plugins is ZoveliPlugin[] {
  const issues: PluginContractIssue[] = [];
  const seen = new Map<string, number>();
  plugins.forEach((plugin, index) => {
    issues.push(...validatePlugin(plugin, index));
    const name =
      plugin && typeof plugin === 'object' && typeof (plugin as any).name === 'string'
        ? (plugin as any).name
        : null;
    if (!name) return;
    const first = seen.get(name);
    if (first !== undefined) {
      issues.push({
        code: 'PLUGIN_DUPLICATE',
        index,
        plugin: name,
        message: `plugin "${name}" is mounted twice (indexes ${first} and ${index})`,
      });
    } else {
      seen.set(name, index);
    }
  });
  if (issues.length > 0) throw new PluginContractError(issues);
}

/** Zoveli skill shape (authoring convention). */
export interface ZoveliSkill {
  name: string;
  description?: string;
  parameters?: unknown;
  execute: (args: any) => unknown;
  [key: string]: unknown;
}

/** Zoveli tool shape (authoring convention). */
export interface Tool {
  name: string;
  description?: string;
  parameters?: unknown;
  // `this: any` because tool implementations call sibling helpers
  // (e.g. `this.callMCP(...)`) on the enclosing tool-table object.
  execute: (this: any, args: any) => unknown;
  [key: string]: unknown;
}

/** Identity helper: returns the plugin object unchanged. */
export function definePlugin(p: ZoveliPlugin): ZoveliPlugin {
  return p;
}

/** Identity helper: returns the skill object unchanged. */
export function defineSkill(s: ZoveliSkill): ZoveliSkill {
  return s;
}

/** Minimal host handle (subset used by Zoveli app entry points). */
export interface ZoveliHost {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  [key: string]: any;
}

function stubHost(name: string): never {
  throw new Error(
    `[zoveli shim] ${name} is a stub: no real Cordis host is wired. ` +
      `Run inside the DeepSeek Harness launcher (dsh) with a Zoveli profile, ` +
      `or implement host wiring. See docs/adr/001-cordis-plugin-architecture.md.`
  );
}

/** STUB — throws at runtime. Real host wiring is future work. */
export function createDsh(..._args: any[]): ZoveliHost {
  return stubHost('createDsh');
}

/** STUB — throws at runtime. Real host wiring is future work. */
export function createWebServer(..._args: any[]): ZoveliHost {
  return stubHost('createWebServer');
}



