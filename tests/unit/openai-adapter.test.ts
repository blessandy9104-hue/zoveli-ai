import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chat } from '../../packages/host/src/chat';
import type { ZoveliHost } from '../../packages/host/src/host';
import {
  CircuitBreaker,
  fromOpenAIResponse,
  openaiHealthPing,
  postOpenAITurn,
  resetOpenAIStateForTests,
} from '../../packages/host/src/openai';
import {
  ProviderError,
  mapOpenAIError,
  parseRetryAfter,
} from '../../packages/host/src/provider-errors';

const KEYS = [
  'OPENAI_API_KEY',
  'ZOVELI_PROVIDER',
  'ZOVELI_MODEL',
  'ZOVELI_API_BASE',
  'ZOVELI_OPENAI_HEALTHCHECK',
  'ZOVELI_MEMORY_TO_CLOUD',
  'ZOVELI_MEMORY_BRIEF',
];

const CFG = {
  apiKey: 'sk-openai-test',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  provider: 'openai',
};

const TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'mathcore_compute',
      description: 'verified math',
      parameters: { type: 'object', properties: { expression: { type: 'string' } } },
    },
  },
];

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const key of KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  resetOpenAIStateForTests();
  vi.unstubAllGlobals();
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key] as string;
  }
  resetOpenAIStateForTests();
  vi.unstubAllGlobals();
});

function jsonResponse(payload: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

describe('OpenAI response normalization', () => {
  it('keeps text and tool calls in the shared turn shape', () => {
    const turn = fromOpenAIResponse({
      choices: [
        {
          message: {
            content: 'Checking. ',
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'mathcore_compute', arguments: '{"expression":"2+2"}' },
              },
            ],
          },
        },
      ],
    });
    expect(turn.content).toBe('Checking. ');
    expect(turn.tool_calls?.[0].function.name).toBe('mathcore_compute');
    expect(turn.tool_calls?.[0].function.arguments).toBe('{"expression":"2+2"}');
  });

  it('accepts null content and rejects an empty choices array', () => {
    expect(fromOpenAIResponse({ choices: [{ message: { content: null } }] })).toEqual({
      content: null,
    });
    expect(() => fromOpenAIResponse({ choices: [] })).toThrow(/no choices/);
    expect(() => fromOpenAIResponse({})).toThrow(/no choices/);
  });
});

describe('unified OpenAI error mapping', () => {
  it('maps authentication failures as non-retryable', () => {
    const error = mapOpenAIError(401, '{"error":{"message":"Incorrect API key"}}');
    expect(error).toBeInstanceOf(ProviderError);
    expect(error.code).toBe('authentication_failed');
    expect(error.retryable).toBe(false);
    expect(error.status).toBe(401);
  });

  it('maps rate limits and parses Retry-After seconds', () => {
    const error = mapOpenAIError(
      429,
      '{"error":{"code":"rate_limit_exceeded","message":"slow down"}}',
      new Headers({ 'retry-after': '7' })
    );
    expect(error.code).toBe('rate_limited');
    expect(error.retryable).toBe(true);
    expect(error.retryAfterMs).toBe(7000);
  });

  it('maps context-window failures', () => {
    const error = mapOpenAIError(
      400,
      '{"error":{"code":"context_length_exceeded","message":"This model has a maximum context length"}}'
    );
    expect(error.code).toBe('context_window_exceeded');
    expect(error.retryable).toBe(false);
  });

  it('maps unknown models and provider outages', () => {
    expect(
      mapOpenAIError(404, '{"error":{"message":"The model `gpt-nope` does not exist"}}').code
    ).toBe('model_not_found');
    const outage = mapOpenAIError(503, 'upstream unavailable');
    expect(outage.code).toBe('provider_unavailable');
    expect(outage.retryable).toBe(true);
    expect(mapOpenAIError(400, 'invalid request').code).toBe('bad_request');
  });

  it('parses Retry-After HTTP dates and ignores junk', () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    expect(parseRetryAfter('Thu, 01 Jan 2026 00:00:10 GMT', now)).toBe(10_000);
    expect(parseRetryAfter('soon', now)).toBeUndefined();
    expect(parseRetryAfter(null, now)).toBeUndefined();
  });
});

describe('OpenAI health check and circuit breaker', () => {
  it('treats reachability as healthy even when /models rejects the key', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 401 }));
    expect(await openaiHealthPing(CFG, 1000, fetchMock as unknown as typeof fetch)).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.openai.com/v1/models');
  });

  it('reports unhealthy on server failures and transport errors', async () => {
    const serverError = vi.fn(async () => new Response('', { status: 500 }));
    expect(await openaiHealthPing(CFG, 1000, serverError as unknown as typeof fetch)).toBe(false);

    const offline = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    expect(await openaiHealthPing(CFG, 1000, offline as unknown as typeof fetch)).toBe(false);
  });

  it('does not route a request when the health ping fails', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 503 }));
    await expect(
      postOpenAITurn(CFG, [], TOOLS, 0, 1000, {
        fetch: fetchMock as unknown as typeof fetch,
        healthCheck: true,
      })
    ).rejects.toMatchObject({ code: 'provider_unavailable', retryable: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.openai.com/v1/models');
  });

  it('opens after three retryable failures and blocks further calls', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 30_000 });
    const fetchMock = vi.fn(async () => {
      throw new Error('socket hang up');
    });
    for (let i = 0; i < 3; i++) {
      await expect(
        postOpenAITurn(CFG, [], TOOLS, 0, 1000, {
          fetch: fetchMock as unknown as typeof fetch,
          breaker,
          healthCheck: false,
        })
      ).rejects.toMatchObject({ code: 'transport_error' });
    }
    expect(breaker.state).toBe('open');

    await expect(
      postOpenAITurn(CFG, [], TOOLS, 0, 1000, {
        fetch: fetchMock as unknown as typeof fetch,
        breaker,
        healthCheck: false,
      })
    ).rejects.toMatchObject({ code: 'provider_unavailable' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('allows one half-open probe after the cooldown', () => {
    let now = 0;
    const breaker = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 1000, now: () => now });
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.allow()).toBe(false);

    now = 1000;
    expect(breaker.allow()).toBe(true);
    breaker.recordFailure();
    expect(breaker.state).toBe('open');

    breaker.recordSuccess();
    expect(breaker.state).toBe('closed');
    expect(breaker.failureCount).toBe(0);
  });
});

describe('chat with OpenAI', () => {
  it('runs a local tool and sends the tool result back in OpenAI form', async () => {
    process.env.ZOVELI_OPENAI_HEALTHCHECK = '0';
    const tool = {
      name: 'mathcore_compute',
      description: 'verified math',
      parameters: { type: 'object', properties: { expression: { type: 'string' } } },
      execute: async () => ({ value: '4' }),
    };
    const host = {
      tools: () => [tool],
      runTool: vi.fn(async () => ({ value: '4' })),
    } as unknown as ZoveliHost;
    const bodies: any[] = [];
    const fetchMock = vi.fn(async (_url: string, init: any) => {
      bodies.push(JSON.parse(init.body));
      const payload =
        bodies.length === 1
          ? {
              choices: [
                {
                  message: {
                    content: null,
                    tool_calls: [
                      {
                        id: 'call_1',
                        type: 'function',
                        function: {
                          name: 'mathcore_compute',
                          arguments: '{"expression":"2+2"}',
                        },
                      },
                    ],
                  },
                },
              ],
            }
          : { choices: [{ message: { content: 'The verified answer is 4.' } }] };
      return jsonResponse(payload);
    });
    vi.stubGlobal('fetch', fetchMock);

    const events: string[] = [];
    const result = await chat(
      host,
      CFG,
      'system prompt',
      [],
      'What is 2+2?',
      (kind, text) => events.push(`${kind}:${text}`)
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.openai.com/v1/chat/completions');
    expect(bodies[0].messages[0]).toEqual({ role: 'system', content: expect.stringContaining('system prompt') });
    expect(bodies[0].tools[0].function.name).toBe('mathcore_compute');
    expect(bodies[1].messages.at(-1)).toEqual({
      role: 'tool',
      tool_call_id: 'call_1',
      content: '{"value":"4"}',
    });
    expect(host.runTool).toHaveBeenCalledWith('mathcore_compute', { expression: '2+2' });
    expect(events).toContain('tool:@mathcore_compute');
    expect(events).toContain('text:The verified answer is 4.');
    expect(result.at(-1)).toMatchObject({ role: 'assistant', content: 'The verified answer is 4.' });
  });

  it('does not retry authentication failures', async () => {
    process.env.ZOVELI_OPENAI_HEALTHCHECK = '0';
    const fetchMock = vi.fn(async () =>
      jsonResponse({ error: { message: 'Incorrect API key' } }, 401)
    );
    vi.stubGlobal('fetch', fetchMock);
    const host = { tools: () => [], runTool: vi.fn() } as unknown as ZoveliHost;

    await expect(chat(host, CFG, 'system', [], 'hello', () => {})).rejects.toMatchObject({
      code: 'authentication_failed',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a transient server failure once', async () => {
    process.env.ZOVELI_OPENAI_HEALTHCHECK = '0';
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return jsonResponse({ error: { message: 'overloaded' } }, 503);
      return jsonResponse({ choices: [{ message: { content: 'recovered' } }] });
    });
    vi.stubGlobal('fetch', fetchMock);
    const host = { tools: () => [], runTool: vi.fn() } as unknown as ZoveliHost;

    const result = await chat(host, CFG, 'system', [], 'hello', () => {});
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.at(-1)?.content).toBe('recovered');
  });

  it('does not poison the breaker with a non-retryable 400', async () => {
    process.env.ZOVELI_OPENAI_HEALTHCHECK = '0';
    const fetchMock = vi.fn(async () => jsonResponse({ error: { message: 'bad' } }, 400));
    vi.stubGlobal('fetch', fetchMock);
    const host = { tools: () => [], runTool: vi.fn() } as unknown as ZoveliHost;

    await expect(chat(host, CFG, 'system', [], 'hello', () => {})).rejects.toMatchObject({
      code: 'bad_request',
    });
    // A single bad request is not an outage; a later call must still be routed.
    await expect(chat(host, CFG, 'system', [], 'hello', () => {})).rejects.toMatchObject({
      code: 'bad_request',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
