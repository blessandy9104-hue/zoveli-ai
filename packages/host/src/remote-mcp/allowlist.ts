import { readFileSync } from 'node:fs';

/**
 * Remote MCP tool allowlist.
 *
 * The remote server is a separate deployment surface from the desktop app:
 * it never reads the desktop's local tool selection and callers cannot pass
 * an allowlist in a request. The list is resolved once at startup from one
 * of three places, in order:
 *
 *   1. ZOVELI_REMOTE_MCP_ALLOWLIST_FILE (JSON array or { allowedTools: [] })
 *   2. ZOVELI_REMOTE_MCP_ALLOWED_TOOLS (comma-separated tool ids)
 *   3. REMOTE_MCP_DEFAULT_ALLOWED_TOOLS (safe math-only default)
 *
 * Any unknown id is a configuration error: the process refuses to start
 * instead of silently exposing the rest of the catalog.
 */

export const REMOTE_MCP_ALLOWLIST_ENV = 'ZOVELI_REMOTE_MCP_ALLOWED_TOOLS';
export const REMOTE_MCP_ALLOWLIST_FILE_ENV = 'ZOVELI_REMOTE_MCP_ALLOWLIST_FILE';

/**
 * Safe default: verified math only. Every id below is an existing local tool
 * id (see packages/math-intelligence and packages/math-domains); this list
 * never invents or aliases tool names.
 *
 * mathcore_compute/check_answer/list_operations are the governor tools.
 * math_route is a pure classifier. The *_solve tools are the 12 specialist
 * wrappers over the same mathcore transport.
 */
export const REMOTE_MCP_DEFAULT_ALLOWED_TOOLS: readonly string[] = Object.freeze([
  'mathcore_compute',
  'mathcore_check_answer',
  'mathcore_list_operations',
  'math_route',
  'math_algebra_solve',
  'math_calculus_solve',
  'math_stats_solve',
  'math_logic_solve',
  'math_units_solve',
  'math_discrete_solve',
  'math_arithmetic_solve',
  'math_geometry_solve',
  'math_trigonometry_solve',
  'math_probability_solve',
  'math_linear_solve',
  'math_number_solve',
]);

export type RemoteMcpAllowlistSource = 'default' | 'env' | 'file';

export interface RemoteMcpAllowlist {
  allowedTools: string[];
  source: RemoteMcpAllowlistSource;
  /** Human-readable source used in startup logs and configuration errors. */
  label: string;
}

export interface ResolveRemoteMcpAllowlistOptions {
  /** Every tool id registered by the remote host. */
  available: Iterable<string>;
  env?: NodeJS.ProcessEnv;
  /** Injectable for tests; defaults to readFileSync(path, 'utf8'). */
  readFile?: (path: string) => string;
}

/** A startup configuration problem that must stop the server. */
export class RemoteMcpConfigError extends Error {
  constructor(message: string) {
    super(`Remote MCP configuration error: ${message}`);
    this.name = 'RemoteMcpConfigError';
  }
}

const TOOL_ID = /^[a-zA-Z0-9_-]{1,64}$/;

function normalizeIds(values: unknown[], label: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== 'string') {
      throw new RemoteMcpConfigError(`${label} must contain tool id strings only.`);
    }
    const id = value.trim();
    if (!id) continue;
    if (!TOOL_ID.test(id)) {
      throw new RemoteMcpConfigError(
        `${label} contains an invalid tool id "${id}" (allowed: letters, digits, "_" and "-"; max 64 chars).`
      );
    }
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  if (out.length === 0) {
    throw new RemoteMcpConfigError(
      `${label} is empty. Export at least one allowlisted tool id; the server will not start with an empty allowlist.`
    );
  }
  return out;
}

/** Parse the comma-separated environment form. Returns null when unset. */
export function parseRemoteMcpAllowlistEnv(raw: string | undefined): string[] | null {
  if (raw === undefined) return null;
  return normalizeIds(raw.split(','), REMOTE_MCP_ALLOWLIST_ENV);
}

/** Parse the JSON allowlist file form (array or { allowedTools: [...] }). */
export function parseRemoteMcpAllowlistFile(
  text: string,
  label = 'remote MCP allowlist file'
): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new RemoteMcpConfigError(`${label} is not valid JSON.`);
  }
  if (Array.isArray(parsed)) return normalizeIds(parsed, label);
  if (
    parsed &&
    typeof parsed === 'object' &&
    Array.isArray((parsed as { allowedTools?: unknown }).allowedTools)
  ) {
    return normalizeIds((parsed as { allowedTools: unknown[] }).allowedTools, label);
  }
  throw new RemoteMcpConfigError(
    `${label} must be a JSON array of tool ids or an object with an "allowedTools" array.`
  );
}

/**
 * Validate an allowlist against the tools the remote host actually
 * registered. Throws a clear configuration error on the first unknown id.
 */
export function validateRemoteMcpAllowlist(
  allowedTools: readonly string[],
  available: Iterable<string>,
  label = 'remote MCP allowlist'
): string[] {
  const availableIds = [...available];
  const availableSet = new Set(availableIds);
  if (availableIds.length === 0) {
    throw new RemoteMcpConfigError(
      'the remote host registered no tools; refusing to start an empty tool surface.'
    );
  }
  if (allowedTools.length === 0) {
    throw new RemoteMcpConfigError(
      `${label} is empty. Export at least one allowlisted tool id; the server will not start with an empty allowlist.`
    );
  }
  const unknown = [...new Set(allowedTools.filter((id) => !availableSet.has(id)))].sort();
  if (unknown.length > 0) {
    throw new RemoteMcpConfigError(
      `unknown tool id(s) in ${label}: ${unknown.join(', ')}. ` +
        `No tools will be exposed. Available tool id(s): ${availableIds.slice().sort().join(', ')}. ` +
        'Fix the allowlist and restart the server.'
    );
  }
  return [...allowedTools];
}

/** Resolve the startup allowlist from file, environment, or the safe default. */
export function resolveRemoteMcpAllowlist(
  options: ResolveRemoteMcpAllowlistOptions
): RemoteMcpAllowlist {
  const env = options.env ?? process.env;
  const readFile = options.readFile ?? ((path: string) => readFileSync(path, 'utf8'));
  const file = (env[REMOTE_MCP_ALLOWLIST_FILE_ENV] || '').trim();

  let allowedTools: string[];
  let source: RemoteMcpAllowlistSource;
  let label: string;

  if (file) {
    label = `${REMOTE_MCP_ALLOWLIST_FILE_ENV} (${file})`;
    let text: string;
    try {
      text = readFile(file);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new RemoteMcpConfigError(`cannot read ${label}: ${message}`);
    }
    allowedTools = parseRemoteMcpAllowlistFile(text, label);
    source = 'file';
  } else {
    const fromEnv = parseRemoteMcpAllowlistEnv(env[REMOTE_MCP_ALLOWLIST_ENV]);
    if (fromEnv) {
      allowedTools = fromEnv;
      source = 'env';
      label = REMOTE_MCP_ALLOWLIST_ENV;
    } else {
      allowedTools = [...REMOTE_MCP_DEFAULT_ALLOWED_TOOLS];
      source = 'default';
      label = 'built-in default allowlist';
    }
  }

  return {
    allowedTools: validateRemoteMcpAllowlist(allowedTools, options.available, label),
    source,
    label,
  };
}
