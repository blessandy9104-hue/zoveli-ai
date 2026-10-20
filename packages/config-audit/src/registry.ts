/**
 * The recognized environment surface of Zoveli: every env var the app
 * actually reads, with enough metadata to validate the value and to point
 * out likely typos. Kept dependency-free so any package can import it.
 */

export type EnvKind =
  | 'string'
  | 'secret'
  | 'number'
  | 'boolean01'
  | 'url'
  | 'path-file'
  | 'path-dir'
  | 'command'
  | 'enum';

export interface EnvSpec {
  name: string;
  group: 'Chat' | 'Math' | 'Memory' | 'Auth' | 'Desktop' | 'Observability';
  kind: EnvKind;
  description: string;
  default?: string;
  values?: string[];
  /** number parsing mode; parseInt rejects '1.5', parseFloat accepts it. */
  parse?: 'int' | 'float';
  min?: number;
  max?: number;
  /** For url: accepted protocols (default http/https). */
  protocols?: string[];
  /** For secret: minimum length below which the value is ignored. */
  minLength?: number;
  /** 'disable' = on unless '0'; 'enable' = off unless '1'. */
  toggle?: 'disable' | 'enable';
  /** Set when only the exact literal '1'/'0' has an effect (footgun note). */
  literalOnly?: boolean;
}

export const ENV_REGISTRY: EnvSpec[] = [
  // Chat
  {
    name: 'ZOVELI_API_KEY',
    group: 'Chat',
    kind: 'secret',
    description: 'universal API key for any OpenAI-compatible endpoint (highest precedence)',
  },
  {
    name: 'OPENAI_API_KEY',
    group: 'Chat',
    kind: 'secret',
    description: 'OpenAI provider key',
  },
  {
    name: 'DEEPSEEK_API_KEY',
    group: 'Chat',
    kind: 'secret',
    description: 'DeepSeek provider key',
  },
  {
    name: 'OPENROUTER_API_KEY',
    group: 'Chat',
    kind: 'secret',
    description: 'OpenRouter provider key',
  },
  {
    name: 'GROQ_API_KEY',
    group: 'Chat',
    kind: 'secret',
    description: 'Groq provider key',
  },
  {
    name: 'TOGETHER_API_KEY',
    group: 'Chat',
    kind: 'secret',
    description: 'Together provider key',
  },
  {
    name: 'ZOVELI_API_BASE',
    group: 'Chat',
    kind: 'url',
    description: 'custom chat endpoint base URL; ignored unless a key is set',
    default: 'provider default (https://api.openai.com/v1 for custom keys)',
  },
  {
    name: 'ZOVELI_MODEL',
    group: 'Chat',
    kind: 'string',
    description: 'model name override',
    default: 'provider default (qwen3:4b for Ollama)',
  },
  {
    name: 'ZOVELI_OLLAMA_URL',
    group: 'Chat',
    kind: 'url',
    description: 'Ollama server base URL (no API key needed)',
    default: 'http://localhost:11434',
  },
  {
    name: 'ZOVELI_OLLAMA_MODEL',
    group: 'Chat',
    kind: 'string',
    description: 'Ollama model to chat with',
    default: 'qwen3:4b',
  },
  {
    name: 'ZOVELI_TEMPERATURE',
    group: 'Chat',
    kind: 'number',
    parse: 'float',
    min: 0,
    max: 2,
    description: 'chat sampling temperature (clamped at runtime)',
    default: '0.7',
  },
  {
    name: 'ZOVELI_MEMORY_BRIEF',
    group: 'Chat',
    kind: 'boolean01',
    toggle: 'disable',
    literalOnly: true,
    description: 'set 0 to disable the private memory brief in chat',
    default: 'enabled',
  },
  {
    name: 'ZOVELI_MEMORY_TO_CLOUD',
    group: 'Chat',
    kind: 'boolean01',
    toggle: 'enable',
    literalOnly: true,
    description: 'set 1 to allow memory briefs for cloud providers',
    default: 'local providers only',
  },
  {
    name: 'ZOVELI_PERSONA',
    group: 'Chat',
    kind: 'enum',
    values: ['friend', 'tutor', 'engineer', 'coach'],
    description: 'pins a persona',
    default: 'remembered preference',
  },
  // Math
  {
    name: 'MATHCORE_MCP_COMMAND',
    group: 'Math',
    kind: 'command',
    description: 'mathcore-mcp executable or command line (env -> .venv -> PATH)',
  },
  {
    name: 'MATHCORE_TIMEOUT_MS',
    group: 'Math',
    kind: 'number',
    parse: 'int',
    min: 1000,
    description: 'mathcore tool call timeout in milliseconds',
    default: '120000',
  },
  {
    name: 'MATHCORE_AUDIT',
    group: 'Math',
    kind: 'path-file',
    description: 'hash-chained math audit certificate log',
    default: '~/.mathcore/audit.jsonl',
  },
  {
    name: 'ZOVELI_MATH_MEMORIZE',
    group: 'Math',
    kind: 'boolean01',
    toggle: 'disable',
    literalOnly: true,
    description: 'set 0 to stop memorizing verified proofs',
    default: 'enabled',
  },
  {
    name: 'ZOVELI_MATHCORE_PREWARM',
    group: 'Math',
    kind: 'boolean01',
    toggle: 'disable',
    literalOnly: true,
    description: 'set 0 to stop warming mathcore when the interactive REPL opens',
    default: 'enabled',
  },
  {
    name: 'ZOVELI_EMBED_MODEL',
    group: 'Math',
    kind: 'string',
    description: 'Ollama embedding model for semantic proof recall',
    default: 'nomic-embed-text',
  },
  // Memory
  {
    name: 'ZOVELI_MEMORY_DB',
    group: 'Memory',
    kind: 'path-file',
    description: 'SQLite memory database path',
    default: '~/.zoveli/memory.db',
  },
  {
    name: 'ZOVELI_VAULT_PATH',
    group: 'Memory',
    kind: 'path-dir',
    description: 'Markdown mirror directory',
    default: '<cwd>/knowledge-vault',
  },
  {
    name: 'ZOVELI_MEMORY_EXPORT',
    group: 'Memory',
    kind: 'boolean01',
    toggle: 'disable',
    literalOnly: true,
    description: 'set 0 to stop writing the Markdown mirror',
    default: 'enabled',
  },
  // Observability
  {
    name: 'ZOVELI_TRACE',
    group: 'Observability',
    kind: 'boolean01',
    toggle: 'enable',
    literalOnly: true,
    description: 'set 1 to mirror tool calls to stderr',
    default: 'off',
  },
  {
    name: 'ZOVELI_TRACE_LOG',
    group: 'Observability',
    kind: 'path-file',
    description: 'opt-in JSONL tool-call log (rotated; parent directories created on first write)',
    default: 'off',
  },
  {
    name: 'ZOVELI_TRACE_LOG_MAX_BYTES',
    group: 'Observability',
    kind: 'number',
    parse: 'int',
    min: 1024,
    description: 'rotate the JSONL log before it grows past this size',
    default: '5000000',
  },
  {
    name: 'ZOVELI_TRACE_LOG_KEEP',
    group: 'Observability',
    kind: 'number',
    parse: 'int',
    min: 0,
    max: 20,
    description: 'rotated JSONL backups to keep (0 truncates on overflow)',
    default: '3',
  },
  // Auth
  {
    name: 'ZOVELI_AUTH_DIR',
    group: 'Auth',
    kind: 'path-dir',
    description: 'auth state directory (sessions, OTP state)',
    default: '~/.zoveli',
  },
  {
    name: 'ZOVELI_AUTH_SECRET',
    group: 'Auth',
    kind: 'secret',
    minLength: 16,
    description: 'session signing secret (ignored below 16 chars; generated instead)',
  },
  {
    name: 'ZOVELI_AUTH_DEV_ECHO',
    group: 'Auth',
    kind: 'boolean01',
    toggle: 'enable',
    literalOnly: true,
    description: 'set 1 to echo login codes and disable login rate limits (dev only)',
    default: 'off',
  },
  {
    name: 'ZOVELI_API_TOKEN',
    group: 'Auth',
    kind: 'secret',
    minLength: 16,
    description: 'bearer token gate for POST /api/run and /api/chat (inactive below 16 chars)',
    default: 'off',
  },
  {
    name: 'ZOVELI_SMTP_URL',
    group: 'Auth',
    kind: 'url',
    protocols: ['smtp:', 'smtps:'],
    description: 'SMTP URL for sending login codes (e.g. smtp://user:pass@host:1025)',
    default: 'codes print to the console',
  },
  {
    name: 'ZOVELI_SMTP_FROM',
    group: 'Auth',
    kind: 'string',
    description: 'From address for login-code emails',
  },
  {
    name: 'ZOVELI_ALLOWED_HOSTS',
    group: 'Auth',
    kind: 'string',
    description: 'comma-separated extra Host headers for the desktop server (no port)',
  },
  // Desktop
  {
    name: 'ZOVELI_DESKTOP_PORT',
    group: 'Desktop',
    kind: 'number',
    parse: 'int',
    min: 1,
    max: 65535,
    description: 'desktop window server port',
    default: '3080',
  },
  {
    name: 'ZOVELI_DESKTOP_SMOKE',
    group: 'Desktop',
    kind: 'boolean01',
    toggle: 'enable',
    literalOnly: true,
    description: 'set 1 for the headless boot smoke run',
    default: 'off',
  },
  {
    name: 'PORT',
    group: 'Desktop',
    kind: 'number',
    parse: 'int',
    min: 1,
    max: 65535,
    description: 'desktop HTTP server port',
    default: '3080',
  },
  {
    name: 'ZOVELI_UNICORN_PROJECT',
    group: 'Desktop',
    kind: 'string',
    description: 'custom Unicorn Studio project id for the desktop background',
  },
];

/** Variables that used to exist but were removed; setting them is pure drift. */
export const OBSOLETE_ENV: { name: string; detail: string }[] = [
  { name: 'TELEMETRY_ENABLED', detail: 'telemetry was removed from Zoveli; this variable has no effect' },
  { name: 'OTLP_ENDPOINT', detail: 'telemetry was removed from Zoveli; this variable has no effect' },
  { name: 'PROM_PORT', detail: 'telemetry was removed from Zoveli; this variable has no effect' },
];

const TRACKED_PREFIX = /^(ZOVELI_|MATHCORE_)/;

export function isKnownEnvName(name: string): boolean {
  return ENV_REGISTRY.some((spec) => spec.name === name);
}

export function isTrackedEnvName(name: string): boolean {
  return TRACKED_PREFIX.test(name);
}

function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const prev = Array.from({ length: n + 1 }, () => 0);
  const cur = Array.from({ length: n + 1 }, () => 0);
  for (let j = 0; j <= n; j += 1) prev[j] = j;
  for (let i = 1; i <= m; i += 1) {
    cur[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j += 1) prev[j] = cur[j];
  }
  return prev[n];
}

/** Close matches (edit distance <= 2) among the registry + obsolete names. */
export function suggestEnvName(name: string): string | undefined {
  let best: string | undefined;
  let bestDistance = 3;
  for (const candidate of [...ENV_REGISTRY.map((s) => s.name), ...OBSOLETE_ENV.map((s) => s.name)]) {
    const d = editDistance(name, candidate);
    if (d < bestDistance) {
      bestDistance = d;
      best = candidate;
    }
  }
  return bestDistance <= 2 ? best : undefined;
}
