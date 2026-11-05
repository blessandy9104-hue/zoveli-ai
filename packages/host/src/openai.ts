import type { ChatConfig, ChatMessage } from './chat.js';
import type { ChatTurn } from './anthropic.js';
import {
  ProviderError,
  mapOpenAIError,
  transportError,
} from './provider-errors.js';
import { trimTrailingSlashes } from './url.js';

/**
 * Native OpenAI chat-completions adapter.
 *
 * Zoveli's chat loop already speaks the OpenAI shape, so this module is a
 * thin, hardened transport rather than a translator: it owns retry policy
 * inputs (circuit breaker + health ping), maps vendor errors to the unified
 * provider error codes, and normalises the response turn. Other
 * OpenAI-compatible providers keep using the generic transport in `chat.ts`.
 *
 * Only the chat model moves to the cloud. Verified math still runs through
 * the local mathcore MCP process.
 */

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  cooldownMs?: number;
  now?: () => number;
}

export type CircuitState = 'closed' | 'open';

/** Small circuit breaker shared by every turn to one provider endpoint. */
export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = Math.max(1, options.failureThreshold ?? 3);
    this.cooldownMs = Math.max(0, options.cooldownMs ?? 30_000);
    this.now = options.now ?? Date.now;
  }

  get state(): CircuitState {
    return this.allow() ? 'closed' : 'open';
  }

  get failureCount(): number {
    return this.failures;
  }

  allow(): boolean {
    if (this.openedAt === null) return true;
    if (this.now() - this.openedAt >= this.cooldownMs) {
      // Half-open: allow one probe. A further failure re-opens immediately.
      this.openedAt = null;
      this.failures = this.failureThreshold;
      return true;
    }
    return false;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.openedAt = null;
  }

  recordFailure(): void {
    this.failures += 1;
    if (this.failures >= this.failureThreshold) this.openedAt = this.now();
  }

  reset(): void {
    this.failures = 0;
    this.openedAt = null;
  }
}

interface OpenAIState {
  breaker: CircuitBreaker;
  healthChecked: boolean;
}

const STATE = new Map<string, OpenAIState>();

function stateKey(cfg: Pick<ChatConfig, 'provider' | 'baseUrl'>): string {
  return `${cfg.provider || 'openai'}:${trimTrailingSlashes(cfg.baseUrl)}`;
}

function stateFor(cfg: ChatConfig, breaker?: CircuitBreaker): OpenAIState {
  const key = stateKey(cfg);
  let state = STATE.get(key);
  if (!state) {
    state = { breaker: breaker ?? new CircuitBreaker(), healthChecked: false };
    STATE.set(key, state);
  } else if (breaker) {
    state.breaker = breaker;
  }
  return state;
}

/** Test seam: forget health checks and breaker state between cases. */
export function resetOpenAIStateForTests(): void {
  STATE.clear();
}

/** Convert an OpenAI response body into the turn shape the loop uses. */
export function fromOpenAIResponse(payload: unknown): ChatTurn {
  const choice = (payload as { choices?: unknown } | null)?.choices;
  if (!Array.isArray(choice) || choice.length === 0) {
    throw new Error('chat API returned no choices');
  }
  const message = (choice[0] as { message?: unknown } | null)?.message as
    | { content?: string | null; tool_calls?: ChatMessage['tool_calls'] }
    | undefined;
  if (!message) throw new Error('chat API returned no choices');
  return {
    content: message.content ?? null,
    ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}),
  };
}

/** OpenAI already accepts the loop's function-tool shape; keep one mapping point. */
export function openaiTools(
  tools: readonly {
    type: 'function';
    function: { name: string; description: string; parameters: unknown };
  }[]
): { type: 'function'; function: { name: string; description: string; parameters: unknown } }[] {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters,
    },
  }));
}

export interface OpenAIRequestDeps {
  /** Test seam; defaults to global fetch. */
  fetch?: typeof fetch;
  /** Test seam; defaults to the shared breaker for this endpoint. */
  breaker?: CircuitBreaker;
  /** Test seam; defaults to ZOVELI_OPENAI_HEALTHCHECK !== '0'. */
  healthCheck?: boolean;
}

/**
 * Pre-routing health check. A reachable provider that rejects the key or does
 * not expose `/models` is still healthy for routing purposes: the real
 * request will surface the precise mapped error.
 */
export async function openaiHealthPing(
  cfg: ChatConfig,
  timeoutMs = 5000,
  fetchImpl: typeof fetch = fetch
): Promise<boolean> {
  try {
    const res = await fetchImpl(`${trimTrailingSlashes(cfg.baseUrl)}/models`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    // 401/403 prove reachability; 404/405 mean the endpoint is absent, which
    // is common for compatible gateways and must not block chat.
    return res.ok || [401, 403, 404, 405].includes(res.status);
  } catch {
    return false;
  }
}

export async function postOpenAITurn(
  cfg: ChatConfig,
  messages: ChatMessage[],
  tools: readonly {
    type: 'function';
    function: { name: string; description: string; parameters: unknown };
  }[],
  temperature: number,
  timeoutMs: number,
  deps: OpenAIRequestDeps = {}
): Promise<ChatTurn> {
  const fetchImpl = deps.fetch ?? fetch;
  const state = stateFor(cfg, deps.breaker);
  const healthCheck = deps.healthCheck ?? process.env.ZOVELI_OPENAI_HEALTHCHECK !== '0';

  if (!state.breaker.allow()) {
    throw new ProviderError(
      'provider_unavailable',
      `openai circuit breaker is open after repeated failures; retry later or run zoveli health`,
      { provider: 'openai', retryable: true }
    );
  }

  if (healthCheck && !state.healthChecked) {
    const healthy = await openaiHealthPing(cfg, Math.min(timeoutMs, 5000), fetchImpl);
    if (!healthy) {
      state.breaker.recordFailure();
      throw new ProviderError(
        'provider_unavailable',
        `openai health check failed for ${cfg.baseUrl}; the request was not routed`,
        { provider: 'openai', retryable: true }
      );
    }
    state.healthChecked = true;
  }

  const body = {
    model: cfg.model,
    messages,
    tools: tools.length > 0 ? openaiTools(tools) : undefined,
    temperature,
  };

  let res: Response;
  try {
    res = await fetchImpl(`${trimTrailingSlashes(cfg.baseUrl)}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify(body),
    });
  } catch (error) {
    // Timeouts are handled by the chat loop with a friendlier message; do not
    // count them as circuit failures because the server may simply be slow.
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw error;
    }
    state.breaker.recordFailure();
    throw transportError('openai', error);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const error = mapOpenAIError(res.status, detail, res.headers, 'openai');
    if (error.retryable) state.breaker.recordFailure();
    throw error;
  }

  let payload: unknown;
  try {
    payload = await res.json();
  } catch (error) {
    state.breaker.recordFailure();
    throw transportError('openai', error);
  }
  state.breaker.recordSuccess();
  return fromOpenAIResponse(payload);
}
