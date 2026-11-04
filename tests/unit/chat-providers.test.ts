import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHAT_PROVIDER_IDS,
  DEFAULT_OLLAMA_MODEL,
  chatConfigFromEnv,
  configuredOllamaModel,
  resolveChatConfig,
  type ChatMessage,
} from '../../packages/host/src/chat';
import type { ZoveliHost } from '../../packages/host/src/host';
import {
  anthropicTools,
  chatMaxTokens,
  fromAnthropicResponse,
  toAnthropicMessages,
} from '../../packages/host/src/anthropic';
import { chat } from '../../packages/host/src/chat';

const KEYS = [
  'ZOVELI_API_KEY',
  'ZOVELI_API_BASE',
  'ZOVELI_MODEL',
  'ZOVELI_PROVIDER',
  'ZOVELI_MAX_TOKENS',
  'ZOVELI_OLLAMA_MODEL',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'DEEPSEEK_API_KEY',
  'OPENROUTER_API_KEY',
  'GROQ_API_KEY',
  'TOGETHER_API_KEY',
];

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const key of KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key] as string;
  }
  vi.unstubAllGlobals();
});

describe('chat provider selection', () => {
  it('defaults to Ollama when no key or explicit provider is set', () => {
    expect(chatConfigFromEnv()).toBeNull();
  });

  it('supports Anthropic by key and exposes it in the provider list', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const cfg = chatConfigFromEnv();
    expect(cfg?.provider).toBe('anthropic');
    expect(cfg?.baseUrl).toBe('https://api.anthropic.com/v1');
    expect(cfg?.model).toBe('claude-sonnet-4-5');
    expect(CHAT_PROVIDER_IDS).toContain('anthropic');
  });

  it('lets ZOVELI_PROVIDER choose a provider when several keys are present', () => {
    process.env.OPENAI_API_KEY = 'sk-openai';
    process.env.GROQ_API_KEY = 'gsk-groq';
    process.env.ZOVELI_PROVIDER = 'groq';
    const cfg = chatConfigFromEnv();
    expect(cfg?.provider).toBe('groq');
    expect(cfg?.apiKey).toBe('gsk-groq');
    expect(cfg?.baseUrl).toBe('https://api.groq.com/openai/v1');
  });

  it('returns null when the pinned provider has no key', () => {
    process.env.OPENAI_API_KEY = 'sk-openai';
    process.env.ZOVELI_PROVIDER = 'anthropic';
    expect(chatConfigFromEnv()).toBeNull();
  });

  it('fails loudly for an unknown provider instead of silently using another key', () => {
    process.env.OPENAI_API_KEY = 'sk-openai';
    process.env.ZOVELI_PROVIDER = 'not-a-provider';
    expect(() => chatConfigFromEnv()).toThrow(/unknown ZOVELI_PROVIDER/);
  });

  it('treats ZOVELI_PROVIDER=ollama as "probe the local server"', () => {
    process.env.OPENAI_API_KEY = 'sk-openai';
    process.env.ZOVELI_PROVIDER = 'ollama';
    expect(chatConfigFromEnv()).toBeNull();
  });

  it('does not fall back to Ollama when a pinned provider has no key', async () => {
    process.env.ZOVELI_PROVIDER = 'anthropic';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await resolveChatConfig()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('applies ZOVELI_MODEL to cloud providers and keeps Ollama precedence', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    process.env.ZOVELI_MODEL = 'claude-custom';
    expect(chatConfigFromEnv()?.model).toBe('claude-custom');
    delete process.env.ANTHROPIC_API_KEY;
    process.env.ZOVELI_OLLAMA_MODEL = 'llama3.1:70b';
    expect(configuredOllamaModel()).toBe('claude-custom');
    delete process.env.ZOVELI_MODEL;
    expect(configuredOllamaModel()).toBe('llama3.1:70b');
    expect(DEFAULT_OLLAMA_MODEL).toBe('qwen3:4b');
  });
});

describe('Anthropic request translation', () => {
  it('hoists system messages and converts assistant tool calls to tool_use blocks', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'be precise' },
      { role: 'user', content: '2+2?' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'mathcore_compute', arguments: '{"expression":"2+2"}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', content: '{"value":"4"}' },
    ];
    const out = toAnthropicMessages(messages);
    expect(out.system).toBe('be precise');
    expect(out.messages[0]).toEqual({ role: 'user', content: '2+2?' });
    expect(out.messages[1]).toEqual({
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 'call_1', name: 'mathcore_compute', input: { expression: '2+2' } },
      ],
    });
    expect(out.messages[2]).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'call_1', content: '{"value":"4"}' }],
    });
  });

  it('merges parallel tool results into one user turn', () => {
    const out = toAnthropicMessages([
      { role: 'user', content: 'do two things' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'a', type: 'function', function: { name: 'one', arguments: '{}' } },
          { id: 'b', type: 'function', function: { name: 'two', arguments: '{}' } },
        ],
      },
      { role: 'tool', tool_call_id: 'a', content: 'ok-a' },
      { role: 'tool', tool_call_id: 'b', content: 'ok-b' },
    ]);
    const last = out.messages.at(-1);
    expect(last?.role).toBe('user');
    expect(last?.content).toEqual([
      { type: 'tool_result', tool_use_id: 'a', content: 'ok-a' },
      { type: 'tool_result', tool_use_id: 'b', content: 'ok-b' },
    ]);
  });

  it('normalizes text and tool_use response blocks', () => {
    const turn = fromAnthropicResponse({
      content: [
        { type: 'text', text: 'Checking. ' },
        { type: 'tool_use', id: 't1', name: 'mathcore_compute', input: { expression: '2+2' } },
      ],
    });
    expect(turn.content).toBe('Checking. ');
    expect(turn.tool_calls?.[0].function.name).toBe('mathcore_compute');
    expect(turn.tool_calls?.[0].function.arguments).toBe('{"expression":"2+2"}');
  });

  it('maps OpenAI function tools to Anthropic input_schema', () => {
    const tools = anthropicTools([
      {
        type: 'function',
        function: {
          name: 'mathcore_compute',
          description: 'compute',
          parameters: { type: 'object', properties: {} },
        },
      },
    ]);
    expect(tools).toEqual([
      {
        name: 'mathcore_compute',
        description: 'compute',
        input_schema: { type: 'object', properties: {} },
      },
    ]);
  });

  it('clamps the Anthropic token budget', () => {
    expect(chatMaxTokens(undefined)).toBe(4096);
    expect(chatMaxTokens('10')).toBe(256);
    expect(chatMaxTokens('999999')).toBe(8192);
    expect(chatMaxTokens('nonsense')).toBe(4096);
  });
});

describe('chat with Anthropic', () => {
  it('runs a local tool and sends the tool result back in Anthropic form', async () => {
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
              content: [
                {
                  type: 'tool_use',
                  id: 'tool_1',
                  name: 'mathcore_compute',
                  input: { expression: '2+2' },
                },
              ],
            }
          : { content: [{ type: 'text', text: 'The verified answer is 4.' }] };
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const events: string[] = [];
    const cfg = {
      apiKey: 'sk-ant-test',
      baseUrl: 'https://api.anthropic.com/v1',
      model: 'claude-sonnet-4-5',
      provider: 'anthropic',
    };
    const result = await chat(host, cfg, 'system prompt', [], 'What is 2+2?', (kind, text) =>
      events.push(`${kind}:${text}`)
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[0][0] as string)).toContain('/messages');
    expect(bodies[0].system).toContain('system prompt');
    expect(bodies[0].tools[0].input_schema).toBeDefined();
    expect(bodies[1].messages.at(-1)).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'tool_1', content: '{"value":"4"}' }],
    });
    expect(host.runTool).toHaveBeenCalledWith('mathcore_compute', { expression: '2+2' });
    expect(events).toContain('tool:@mathcore_compute');
    expect(events).toContain('text:The verified answer is 4.');
    expect(result[result.length - 1]?.role).toBe('assistant');
  });
});
