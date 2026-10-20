import type { ZoveliContext, ZoveliPlugin, Tool } from '@deepseek-ai/dsh-core';
import { checkToolCall, defaultPolicy } from '@zoveli/guard';
import { redactSecrets } from '@zoveli/secscan';

export interface HostTool extends Tool {
  plugin: string;
}

export interface ToolCallTrace {
  at: string;
  tool: string;
  registration: string;
  durationMs: number;
  ok: boolean;
  error?: string;
}

export interface ToolCallStats {
  calls: number;
  failures: number;
  totalMs: number;
  lastError: string | null;
  recent: ToolCallTrace[];
}

const MAX_TRACE_ENTRIES = 200;

interface AgentLike {
  inject: (msg: { type: string; content: string }) => void;
  systemSections: string[];
}

/**
 * Minimal real host for Zoveli plugins. It implements just enough of the
 * plugin context (register/provide/on/emit) to boot the tool-bearing
 * plugins, collect their tools, and dispatch calls. It is NOT a Cordis
 * runtime — see docs/adr/001 for the full-host roadmap.
 */
export class ZoveliHost {
  private registrations = new Map<string, any[]>();
  private provided = new Map<string, any>();
  private handlers = new Map<string, Function[]>();
  readonly systemSections: string[] = [];
  // Cached tool list + name map. Registrations are append-only during
  // mount; any register() call invalidates the cache. Tools are static
  // post-boot, so /health, /api/tools and every chat turn reuse it
  // instead of rebuilding + sorting ~60 tools per call.
  private toolsCache: HostTool[] | null = null;
  private toolMap = new Map<string, HostTool>();
  private trace: ToolCallTrace[] = [];
  private callCount = 0;
  private failureCount = 0;
  private totalMs = 0;
  private lastError: string | null = null;

  readonly ctx: ZoveliContext;

  constructor() {
    this.ctx = {
      register: (key: string, value?: any) => {
        const arr = this.registrations.get(key) ?? [];
        arr.push(value);
        this.registrations.set(key, arr);
        // Tools derive from registrations — invalidate the cached list.
        this.toolsCache = null;
        return value;
      },
      provide: (key: string, value?: any) => {
        this.provided.set(key, value);
        return value;
      },
      on: (event: string, handler: (...args: any[]) => any) => {
        const arr = this.handlers.get(event) ?? [];
        arr.push(handler);
        this.handlers.set(event, arr);
        return handler;
      },
      emit: (event: string, ...args: any[]) => {
        const results: any[] = [];
        for (const h of this.handlers.get(event) ?? []) {
          results.push(h(...args));
        }
        return results;
      },
      get: (key: string) => {
        // Provided services come first (Cordis semantics); registrations are
        // the back-compat fallback for config-style keys.
        if (this.provided.has(key)) return this.provided.get(key);
        const arr = this.registrations.get(key);
        return arr?.[0];
      },
      log: {
        info: (...a: any[]) => console.error('[zoveli]', ...a),
        warn: (...a: any[]) => console.error('[zoveli:warn]', ...a),
        error: (...a: any[]) => console.error('[zoveli:error]', ...a),
        debug: () => {},
      },
      config: {},
      plugins: [],
    };
  }

  /** Mount plugins and fire agent/created so prompt injections apply. */
  mount(plugins: ZoveliPlugin[]): AgentLike {
    for (const p of plugins) {
      p.setup(this.ctx);
    }
    const agent: AgentLike = {
      systemSections: this.systemSections,
      inject: (msg: { type: string; content: string }) => {
        this.systemSections.push(msg.content);
      },
    };
    for (const h of this.handlers.get('agent/created') ?? []) {
      h(agent);
    }
    return agent;
  }

  /** Every executable tool across all mounted plugins (cached; rebuilt on register). */
  tools(): HostTool[] {
    if (this.toolsCache) return [...this.toolsCache];
    const out: HostTool[] = [];
    const seen = new Set<string>();
    const consider = (plugin: string, value: any) => {
      const items = Array.isArray(value) ? value : [value];
      for (const t of items) {
        if (
          t &&
          typeof t === 'object' &&
          typeof t.name === 'string' &&
          typeof t.execute === 'function' &&
          !seen.has(t.name)
        ) {
          seen.add(t.name);
          out.push({ ...(t as Tool), plugin });
        }
      }
    };
    for (const [key, values] of this.registrations) {
      for (const v of values) consider(key, v);
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    this.toolsCache = out;
    this.toolMap = new Map(out.map((t) => [t.name, t]));
    return [...out];
  }

  getTool(name: string): HostTool {
    const t = this.toolMap.get(name) ?? this.tools().find((x) => x.name === name);
    if (!t) throw new Error(`unknown tool: ${name}`);
    return t;
  }

  async runTool(name: string, args: any = {}): Promise<unknown> {
    // Guard enforcement: deny destructive shell commands before dispatch.
    // No guard plugin mounted → allow (back-compat for minimal profiles).
    const policies = this.registrations.get('guard-policies');
    if (policies && policies.length > 0) {
      const verdict = checkToolCall(name, args, defaultPolicy(policies[0]));
      if (!verdict.allowed) throw new Error(verdict.message);
    }
    const t = this.getTool(name);
    const startedAt = Date.now();
    try {
      const result = await t.execute(args);
      this.recordToolCall(t, Date.now() - startedAt);
      return result;
    } catch (e) {
      this.recordToolCall(t, Date.now() - startedAt, e);
      throw e;
    }
  }

  /** Bounded in-process trace + counters (supports `/trace` and `/health`). */
  toolStats(limit = 20): ToolCallStats {
    return {
      calls: this.callCount,
      failures: this.failureCount,
      totalMs: this.totalMs,
      lastError: this.lastError,
      recent: this.trace.slice(-Math.max(1, limit)),
    };
  }

  private recordToolCall(tool: HostTool, durationMs: number, error?: unknown): void {
    this.callCount += 1;
    this.totalMs += durationMs;
    const message =
      error === undefined
        ? undefined
        : redactSecrets(error instanceof Error ? error.message : String(error));
    if (message !== undefined) {
      this.failureCount += 1;
      this.lastError = message;
    }
    const entry: ToolCallTrace = {
      at: new Date().toISOString(),
      tool: tool.name,
      registration: tool.plugin,
      durationMs,
      ok: message === undefined,
    };
    if (message !== undefined) entry.error = message;
    this.trace.push(entry);
    if (this.trace.length > MAX_TRACE_ENTRIES) this.trace.shift();
    if (process.env.ZOVELI_TRACE === '1') {
      const outcome = message === undefined ? 'ok' : `error: ${message}`;
      console.error(`[trace] ${tool.name} ${outcome} ${durationMs}ms`);
    }
  }
}





