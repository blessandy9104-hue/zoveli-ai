import type { ZoveliHost } from './host.js';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: {
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }[];
  tool_call_id?: string;
  name?: string;
}

export interface ChatConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  maxSteps?: number;
  provider?: string;
  timeoutMs?: number;
}

export const DEFAULT_OLLAMA_MODEL = 'qwen3:4b';

interface ProviderDef {
  id: string;
  envKey: string;
  baseUrl: string;
  model: string;
}

const PROVIDERS: ProviderDef[] = [
  { id: 'openai', envKey: 'OPENAI_API_KEY', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { id: 'deepseek', envKey: 'DEEPSEEK_API_KEY', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
  { id: 'openrouter', envKey: 'OPENROUTER_API_KEY', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini' },
  { id: 'groq', envKey: 'GROQ_API_KEY', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
  { id: 'together', envKey: 'TOGETHER_API_KEY', baseUrl: 'https://api.together.xyz/v1', model: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo' },
];

export const CHAT_PROVIDER_ENV_KEYS: readonly string[] = PROVIDERS.map((p) => p.envKey);

function stripCompletionsSuffix(url: string): string {
  return url.replace(/\/chat\/completions\/?$/, '');
}

export function chatConfigFromEnv(): ChatConfig | null {
  const overrideBase = process.env.ZOVELI_API_BASE || '';
  const overrideModel = process.env.ZOVELI_MODEL || '';
  const genericKey = process.env.ZOVELI_API_KEY || '';
  if (genericKey) {
    return {
      apiKey: genericKey,
      baseUrl: stripCompletionsSuffix(overrideBase) || 'https://api.openai.com/v1',
      model: overrideModel || 'gpt-4o-mini',
      provider: 'custom',
      maxSteps: 10,
    };
  }
  for (const p of PROVIDERS) {
    const key = process.env[p.envKey] || '';
    if (!key) continue;
    return {
      apiKey: key,
      baseUrl: stripCompletionsSuffix(overrideBase) || p.baseUrl,
      model: overrideModel || p.model,
      provider: p.id,
      maxSteps: 10,
    };
  }
  return null;
}

export function ollamaBaseUrl(): string {
  return (process.env.ZOVELI_OLLAMA_URL || 'http://localhost:11434').replace(/\/+$/, '');
}

export function configuredOllamaModel(): string {
  return process.env.ZOVELI_MODEL || process.env.ZOVELI_OLLAMA_MODEL || '';
}

const NON_CHAT_MODEL = /(?:^|[-_/])(?:embed|embedding|bge|e5|minilm|whisper)(?:[-_/]|$)/i;

function ollamaModelFromTags(payload: unknown, preferred: string, explicit: boolean): string | null {
  const models = (payload as { models?: unknown } | null)?.models;
  if (!Array.isArray(models)) return preferred;
  const names = models.map((entry) => {
    const model = entry as { name?: unknown; model?: unknown } | null;
    if (typeof model?.name === 'string' && model.name) return model.name;
    if (typeof model?.model === 'string' && model.model) return model.model;
    return '';
  }).filter(Boolean);
  if (names.length === 0) return null;
  const exact = names.find((name) => name.toLowerCase() === preferred.toLowerCase());
  if (exact) return exact;
  if (explicit) return null;
  return names.find((name) => !NON_CHAT_MODEL.test(name)) ?? null;
}

export async function probeOllama(timeoutMs = 2000, retries = 1): Promise<ChatConfig | null> {
  const base = ollamaBaseUrl();
  const explicit = configuredOllamaModel();
  const preferred = explicit || DEFAULT_OLLAMA_MODEL;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) return null;
      const payload = await res.json().catch(() => null);
      const model = ollamaModelFromTags(payload, preferred, !!explicit);
      if (!model) return null;
      return { apiKey: 'ollama', baseUrl: `${base}/v1`, model, provider: 'ollama', maxSteps: 10 };
    } catch {
      if (attempt === retries) return null;
    }
  }
  return null;
}

export async function resolveChatConfig(): Promise<ChatConfig | null> {
  return chatConfigFromEnv() ?? (await probeOllama());
}

function toFunctionTool(t: { name: string; description?: string; parameters?: unknown }) {
  return {
    type: 'function' as const,
    function: {
      name: t.name,
      description: (t.description || '').slice(0, 500),
      parameters: (t.parameters as any) || { type: 'object', properties: {} },
    },
  };
}

// Keep tool schemas manageable for small local models.
const SMALL_LOCAL_TOOL_NAMES = new Set([
  'mathcore_compute',
  'mathcore_check_answer',
  'memory_search',
  'memory_create_note',
]);

function safeJsonParse(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

export function chatTemperature(): number {
  const raw = parseFloat(process.env.ZOVELI_TEMPERATURE || '');
  if (!Number.isFinite(raw)) return 0.7;
  return Math.min(2, Math.max(0, raw));
}

export function chatTimeoutMs(raw = process.env.ZOVELI_CHAT_TIMEOUT_MS): number {
  const parsed = parseInt(raw || '', 10);
  if (!Number.isFinite(parsed)) return 120_000;
  return Math.min(600_000, Math.max(1_000, parsed));
}

function isTimeoutError(e: unknown): boolean {
  return e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
}

function timeoutError(baseUrl: string, timeoutMs: number): Error {
  return new Error(
    `chat request timed out after ${timeoutMs}ms with no response from ${baseUrl}. ` +
      `Check your connection or that the local server is running; ` +
      `raise ZOVELI_CHAT_TIMEOUT_MS if the model is just slow to start.`
  );
}

export function isLocalProvider(cfg: Pick<ChatConfig, 'provider' | 'baseUrl'>): boolean {
  if (cfg.provider === 'ollama') return true;
  return /localhost|127\.0\.0\.1|\[::1\]/.test(cfg.baseUrl || '');
}

export function memoryBriefAllowed(cfg: Pick<ChatConfig, 'provider' | 'baseUrl'>): boolean {
  if (process.env.ZOVELI_MEMORY_BRIEF === '0') return false;
  return isLocalProvider(cfg) || process.env.ZOVELI_MEMORY_TO_CLOUD === '1';
}

export interface BriefStore {
  searchNotes: (input: { query: string; tags?: string[]; limit?: number }) => { results: { title: string; content: string }[] };
}

export async function buildMemoryBrief(store?: BriefStore): Promise<string> {
  try {
    if (process.env.ZOVELI_MEMORY_BRIEF === '0') return '';
    let search: BriefStore['searchNotes'];
    if (store) {
      search = store.searchNotes.bind(store);
    } else {
      const { resolveDbPath, getStore } = await import('@zoveli/memory-store');
      const dbPath = resolveDbPath();
      if (dbPath !== ':memory:') {
        const { existsSync } = await import('node:fs');
        if (!existsSync(dbPath)) return '';
      }
      const briefStore = getStore();
      search = briefStore.searchNotes.bind(briefStore);
    }
    const { results } = search({ query: 'user preferences profile about the user', limit: 3 });
    if (results.length === 0) return '';
    const lines = results.map((r) => `- ${r.title}: ${r.content.slice(0, 160)}`);
    return `What you remember about the user (from local memory; use naturally, never announce it):\n${lines.join('\n')}`;
  } catch {
    return '';
  }
}

export async function chat(
  host: ZoveliHost,
  cfg: ChatConfig,
  systemPrompt: string,
  history: ChatMessage[],
  userText: string,
  onEvent: (kind: 'text' | 'tool', text: string) => void
): Promise<ChatMessage[]> {
  const allTools = host.tools();
  const smallLocalModel =
    cfg.provider === 'ollama' && /(?:0\.8b|1b|1\.5b|2b|3b)(?:[-_:]|$)/i.test(cfg.model);
  const tools = (smallLocalModel
    ? allTools.filter((tool) => SMALL_LOCAL_TOOL_NAMES.has(tool.name))
    : allTools
  ).map(toFunctionTool);
  const brief = memoryBriefAllowed(cfg) ? await buildMemoryBrief() : '';
  let personaPrompt = '';
  try {
    const { resolvePersona } = await import('@zoveli/persona');
    personaPrompt = resolvePersona(userText).prompt;
  } catch {
    // personas are enhancement-only; chat works without them
  }
  const system = smallLocalModel
    ? [
        'You are Zoveli, a concise local assistant. Keep replies brief. For math, call mathcore_compute and only report verified results; never guess.',
        brief,
        personaPrompt,
      ].filter(Boolean).join('\n\n')
    : [systemPrompt, brief, personaPrompt].filter(Boolean).join('\n\n');
  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    ...history,
    { role: 'user', content: userText },
  ];
  const steps = cfg.maxSteps ?? 10;
  const temperature = chatTemperature();
  const timeoutMs = cfg.timeoutMs ?? chatTimeoutMs();

  for (let step = 0; step < steps; step++) {
    const postChat = () =>
      fetch(`${cfg.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({
          model: cfg.model,
          messages,
          tools: tools.length > 0 ? tools : undefined,
          temperature,
          ...(smallLocalModel ? { max_tokens: 128, think: false } : {}),
        }),
      });
    let res: Response;
    try {
      res = await postChat();
    } catch (e) {
      if (isTimeoutError(e)) throw timeoutError(cfg.baseUrl, timeoutMs);
      try {
        res = await postChat();
      } catch (retryError) {
        if (isTimeoutError(retryError)) throw timeoutError(cfg.baseUrl, timeoutMs);
        throw retryError;
      }
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      if (res.status === 404 && /localhost:11434|127\.0\.0\.1:11434|ollama/i.test(cfg.baseUrl)) {
        throw new Error(
          `chat API error 404: model '${cfg.model}' is not pulled into your local Ollama. ` +
            `Run: ollama pull ${cfg.model} (start the server first with: ollama serve). ` +
            `Server said: ${body.slice(0, 200)}`
        );
      }
      throw new Error(`chat API error ${res.status}: ${body.slice(0, 300)}`);
    }
    const data: any = await res.json();
    const choice = data.choices?.[0]?.message;
    if (!choice) throw new Error('chat API returned no choices');
    messages.push({ role: 'assistant', content: choice.content ?? null, tool_calls: choice.tool_calls });
    const calls = choice.tool_calls ?? [];
    if (calls.length === 0) {
      if (choice.content) onEvent('text', choice.content);
      return messages.slice(1);
    }
    for (const call of calls) {
      const name = call.function?.name ?? '?';
      const args = safeJsonParse(call.function?.arguments ?? '{}');
      onEvent('tool', `@${name}`);
      let result: string;
      try {
        const out = await host.runTool(name, args);
        result = typeof out === 'string' ? out : JSON.stringify(out);
      } catch (e) {
        result = `tool error: ${e instanceof Error ? e.message : String(e)}`;
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: result.slice(0, 8000) });
    }
  }
  onEvent('text', '(stopped after max tool steps)');
  return messages.slice(1);
}
