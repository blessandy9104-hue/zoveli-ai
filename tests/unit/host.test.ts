import { describe, it, expect } from 'vitest';
import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import { ZoveliHost } from '../../packages/host/src/host';
import {
  chatConfigFromEnv,
  resolveChatConfig,
  probeOllama,
  chat,
} from '../../packages/host/src/chat';

function fakePlugin(name: string, tools: any[] = []) {
  return {
    name,
    description: `fake ${name}`,
    setup(ctx: any) {
      ctx.register(`${name}-tools`, tools);
    },
  };
}

describe('ZoveliHost', () => {
  it('mounts plugins and collects their tools', () => {
    const host = new ZoveliHost();
    host.mount([
      fakePlugin('a', [
        { name: 'alpha', description: 'a', execute: async () => 'A' },
      ]),
      fakePlugin('b', [
        { name: 'beta', description: 'b', execute: async (args: any) => `B:${args.x}` },
      ]),
    ]);
    const names = host.tools().map((t) => t.name);
    expect(names).toContain('alpha');
    expect(names).toContain('beta');
  });

  it('dedupes tools by name (first wins)', () => {
    const host = new ZoveliHost();
    host.mount([
      fakePlugin('a', [{ name: 'dup', description: 'first', execute: async () => 1 }]),
      fakePlugin('b', [{ name: 'dup', description: 'second', execute: async () => 2 }]),
    ]);
    expect(host.tools().filter((t) => t.name === 'dup')).toHaveLength(1);
  });

  it('dispatches tool calls with args', async () => {
    const host = new ZoveliHost();
    host.mount([
      fakePlugin('a', [{ name: 'echo', description: 'e', execute: async (args: any) => args.msg }]),
    ]);
    await expect(host.runTool('echo', { msg: 'hi' })).resolves.toBe('hi');
  });

  it('rejects unknown tools with a clear error', async () => {
    const host = new ZoveliHost();
    host.mount([]);
    await expect(host.runTool('nope', {})).rejects.toThrow('unknown tool: nope');
  });

  it('resolves provided services before registrations', () => {
    const host = new ZoveliHost();
    host.ctx.register('thing', { source: 'registration' });
    expect((host.ctx.get('thing') as any).source).toBe('registration');
    host.ctx.provide('thing', { source: 'service' });
    expect((host.ctx.get('thing') as any).source).toBe('service');
  });

  it('fires agent/created handlers with an injectable agent', () => {
    const host = new ZoveliHost();
    const seen: string[] = [];
    host.mount([
      {
        name: 'injector',
        setup(ctx: any) {
          ctx.on('agent/created', (agent: any) => {
            agent.inject({ type: 'system', content: 'hello-agent' });
            seen.push('fired');
          });
        },
      },
    ]);
    expect(seen).toEqual(['fired']);
  });
});

describe('ZoveliHost tool trace', () => {
  it('records successful and failed calls with counters', async () => {
    const host = new ZoveliHost();
    host.mount([
      fakePlugin('a', [
        { name: 'ok', description: 'ok', execute: async () => 1 },
        {
          name: 'boom',
          description: 'boom',
          execute: async () => {
            throw new Error('upstream rejected sk-abcdefghijklmnopqrstuvwxyz');
          },
        },
      ]),
    ]);

    await host.runTool('ok');
    await expect(host.runTool('boom')).rejects.toThrow('upstream rejected');

    const stats = host.toolStats();
    expect(stats.calls).toBe(2);
    expect(stats.failures).toBe(1);
    expect(stats.recent.map((e) => e.tool)).toEqual(['ok', 'boom']);
    expect(stats.recent[0]).toMatchObject({ ok: true, registration: 'a-tools' });
    expect(stats.recent[1].ok).toBe(false);
    expect(stats.recent[1].error).toContain('[REDACTED]');
    expect(stats.lastError).toContain('[REDACTED]');
    expect(stats.totalMs).toBeGreaterThanOrEqual(0);
  });

  it('keeps only the requested recent slice', async () => {
    const host = new ZoveliHost();
    host.mount([
      fakePlugin('a', [{ name: 'noop', description: 'n', execute: async () => null }]),
    ]);
    for (let i = 0; i < 5; i += 1) await host.runTool('noop');
    expect(host.toolStats(2).recent).toHaveLength(2);
    expect(host.toolStats(2).calls).toBe(5);
  });
});

describe('chatConfigFromEnv', () => {
  it('returns null without a key and config with one', () => {
    const prev = process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    expect(chatConfigFromEnv()).toBeNull();
    process.env.DEEPSEEK_API_KEY = 'test-key';
    const cfg = chatConfigFromEnv();
    expect(cfg?.model).toBe('deepseek-chat');
    expect(cfg?.baseUrl).toBe('https://api.deepseek.com');
    if (prev === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = prev;
  });
});

const CHAT_KEYS = [
  'ZOVELI_API_KEY',
  'ZOVELI_API_BASE',
  'ZOVELI_MODEL',
  'ZOVELI_OLLAMA_URL',
  'ZOVELI_OLLAMA_MODEL',
  'OPENAI_API_KEY',
  'DEEPSEEK_API_KEY',
  'OPENROUTER_API_KEY',
  'GROQ_API_KEY',
  'TOGETHER_API_KEY',
];

function snapshotChatEnv(): Record<string, string | undefined> {
  const snap: Record<string, string | undefined> = {};
  for (const k of CHAT_KEYS) snap[k] = process.env[k];
  return snap;
}

function restoreChatEnv(snap: Record<string, string | undefined>) {
  for (const k of CHAT_KEYS) {
    if (snap[k] === undefined) delete process.env[k];
    else process.env[k] = snap[k] as string;
  }
}

function clearChatEnv() {
  for (const k of CHAT_KEYS) delete process.env[k];
}

describe('chatConfigFromEnv (any key)', () => {
  it('accepts an OpenAI key with OpenAI defaults', () => {
    const snap = snapshotChatEnv();
    try {
      clearChatEnv();
      process.env.OPENAI_API_KEY = 'sk-test';
      const cfg = chatConfigFromEnv();
      expect(cfg?.provider).toBe('openai');
      expect(cfg?.baseUrl).toBe('https://api.openai.com/v1');
      expect(cfg?.model).toBe('gpt-4o-mini');
    } finally {
      restoreChatEnv(snap);
    }
  });

  it('prefers ZOVELI_API_KEY with explicit base and model', () => {
    const snap = snapshotChatEnv();
    try {
      clearChatEnv();
      process.env.DEEPSEEK_API_KEY = 'ds-key';
      process.env.ZOVELI_API_KEY = 'custom-key';
      process.env.ZOVELI_API_BASE = 'https://my-proxy.example/v1';
      process.env.ZOVELI_MODEL = 'my-model';
      const cfg = chatConfigFromEnv();
      expect(cfg?.apiKey).toBe('custom-key');
      expect(cfg?.baseUrl).toBe('https://my-proxy.example/v1');
      expect(cfg?.model).toBe('my-model');
    } finally {
      restoreChatEnv(snap);
    }
  });

  it('lets ZOVELI_API_BASE override a provider base', () => {
    const snap = snapshotChatEnv();
    try {
      clearChatEnv();
      process.env.DEEPSEEK_API_KEY = 'ds-key';
      process.env.ZOVELI_API_BASE = 'http://localhost:11434/v1';
      const cfg = chatConfigFromEnv();
      expect(cfg?.baseUrl).toBe('http://localhost:11434/v1');
      expect(cfg?.model).toBe('deepseek-chat');
    } finally {
      restoreChatEnv(snap);
    }
  });
});

function startTagsStub(statusCode = 200): Promise<{ server: http.Server; port: number; hits: () => number }> {
  let hits = 0;
  const server = http.createServer((req, res) => {
    if (req.url === '/api/tags') {
      hits++;
      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ models: [{ name: 'qwen3:4b' }] }));
    } else {
      res.writeHead(404);
      res.end('{}');
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: (server.address() as AddressInfo).port, hits: () => hits });
    });
  });
}

describe('probeOllama / resolveChatConfig', () => {
  it('returns a keyless local config when Ollama answers', async () => {
    const snap = snapshotChatEnv();
    const stub = await startTagsStub();
    try {
      clearChatEnv();
      process.env.ZOVELI_OLLAMA_URL = `http://127.0.0.1:${stub.port}`;
      const cfg = await probeOllama();
      expect(cfg?.provider).toBe('ollama');
      expect(cfg?.apiKey).toBe('ollama');
      expect(cfg?.baseUrl).toBe(`http://127.0.0.1:${stub.port}/v1`);
      expect(cfg?.model).toBe('qwen3:4b');
    } finally {
      restoreChatEnv(snap);
      stub.server.close();
    }
  });

  it('returns null fast when no server listens', async () => {
    const snap = snapshotChatEnv();
    try {
      clearChatEnv();
      process.env.ZOVELI_OLLAMA_URL = 'http://127.0.0.1:1';
      const started = Date.now();
      expect(await probeOllama(1000)).toBeNull();
      expect(Date.now() - started).toBeLessThan(5000);
    } finally {
      restoreChatEnv(snap);
    }
  });

  it('prefers an API key over a live Ollama server (no probe issued)', async () => {
    const snap = snapshotChatEnv();
    const stub = await startTagsStub();
    try {
      clearChatEnv();
      process.env.OPENAI_API_KEY = 'sk-test';
      process.env.ZOVELI_OLLAMA_URL = `http://127.0.0.1:${stub.port}`;
      const cfg = await resolveChatConfig();
      expect(cfg?.provider).toBe('openai');
      expect(stub.hits()).toBe(0);
    } finally {
      restoreChatEnv(snap);
      stub.server.close();
    }
  });

  it('falls back to Ollama when no key is set', async () => {
    const snap = snapshotChatEnv();
    const stub = await startTagsStub();
    try {
      clearChatEnv();
      process.env.ZOVELI_OLLAMA_URL = `http://127.0.0.1:${stub.port}`;
      const cfg = await resolveChatConfig();
      expect(cfg?.provider).toBe('ollama');
    } finally {
      restoreChatEnv(snap);
      stub.server.close();
    }
  });
});

describe('chat transport', () => {
  it('times out a wedged endpoint once, without retrying', async () => {
    let hits = 0;
    const server = http.createServer(() => {
      hits += 1;
      // Accept the request and never answer: a wedged model/server.
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      const host = new ZoveliHost();
      host.mount([]);
      const startedAt = Date.now();
      await expect(
        chat(
          host,
          {
            apiKey: 'test',
            baseUrl: `http://127.0.0.1:${port}/v1`,
            model: 'test',
            timeoutMs: 120,
          },
          'system',
          [],
          'hello',
          () => {}
        )
      ).rejects.toThrow(/timed out after 120ms/);
      expect(hits).toBe(1);
      expect(Date.now() - startedAt).toBeLessThan(3000);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('retries once on a transport-level failure, then delivers the reply', async () => {
    const origFetch = globalThis.fetch;
    let calls = 0;
    (globalThis as any).fetch = async () => {
      calls++;
      if (calls === 1) throw new TypeError('fetch failed');
      return new Response(
        JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'mango' } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };
    try {
      const host = new ZoveliHost();
      host.mount([]);
      const history = await chat(
        host,
        { apiKey: 'ollama', baseUrl: 'http://127.0.0.1:1/v1', model: 'qwen3:4b' },
        'system',
        [],
        'say mango',
        () => {}
      );
      expect(calls).toBe(2);
      expect(history.some((m: any) => m.role === 'assistant' && m.content === 'mango')).toBe(true);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

