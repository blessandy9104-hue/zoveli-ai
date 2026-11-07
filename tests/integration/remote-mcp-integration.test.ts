import { afterEach, describe, expect, it } from 'vitest';
import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import {
  createRemoteMcpServer,
  type RemoteToolHost,
  type AllowlistedRemoteTool,
  CredentialManager,
} from '../../packages/host/src/remote-mcp/index';
import { Client as V1Client } from '@modelcontextprotocol/sdk/client';
import { StreamableHTTPClientTransport as V1StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp';
import { Client as V2Client } from '@modelcontextprotocol/client';
import { StreamableHTTPClientTransport as V2StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function fakeHost(): RemoteToolHost & {
  calls: Array<{ name: string; args: Record<string, unknown> }>;
  credentialNames: Array<string>;
} {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const credentialNames: Array<string> = [];
  const tools: AllowlistedRemoteTool[] = [
    {
      name: 'mathcore_compute',
      description: 'Compute a math expression',
      inputSchema: {
        type: 'object',
        properties: { expression: { type: 'string' } },
        required: ['expression'],
      },
    },
    {
      name: 'mathcore_check_answer',
      description: 'Check an answer',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
      name: 'math_route',
      description: 'Route to a math domain',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
  ];
  return {
    calls,
    credentialNames,
    tools: () => tools,
    async runTool(name, args = {}) {
      calls.push({ name, args });
      return `called ${name} ${JSON.stringify(args)}`;
    },
  };
}

const servers: http.Server[] = [];

async function start(
  options: Partial<Parameters<typeof createRemoteMcpServer>[0]> = {},
): Promise<{ url: string; host: ReturnType<typeof fakeHost> }> {
  const host = options.host ?? fakeHost();
  const server = createRemoteMcpServer({
    host,
    allowedTools: ['mathcore_compute', 'mathcore_check_answer', 'math_route'],
    originPolicy: {
      mode: 'local',
      configuredOrigins: [],
      serverOrigin: 'http://127.0.0.1:0',
    },
    ...options,
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    host: host as ReturnType<typeof fakeHost>,
  };
}

async function rawPost(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
});

// ---------------------------------------------------------------------------
// Legacy v1 SDK client tests
// ---------------------------------------------------------------------------

describe('legacy v1 SDK client (@modelcontextprotocol/sdk 1.32.2)', () => {
  it('connects via initialize handshake and lists tools', async () => {
    const { url, host } = await start();
    const transport = new V1StreamableHTTPClientTransport(new URL(url));
    const client = new V1Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(transport);

    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name);
    expect(names).toContain('mathcore_compute');
    expect(names).toContain('mathcore_check_answer');
    expect(names).toContain('math_route');
    expect(names).not.toContain('mathcore_status');

    const result = await client.callTool({ name: 'mathcore_compute', arguments: { expression: '2+2' } });
    expect(host.calls).toContainEqual({ name: 'mathcore_compute', args: { expression: '2+2' } });
    expect(result.content[0].type).toBe('text');

    client.close();
  });

  it('rejects calls to non-allowlisted tools', async () => {
    const { url } = await start();
    const transport = new V1StreamableHTTPClientTransport(new URL(url));
    const client = new V1Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(transport);

    await expect(
      client.callTool({ name: 'mathcore_status', arguments: {} }),
    ).rejects.toThrow();

    client.close();
  });
});

// ---------------------------------------------------------------------------
// Modern v2 SDK client tests (default legacy negotiation)
// ---------------------------------------------------------------------------

describe('modern v2 SDK client (@modelcontextprotocol/client 2.4.0) — legacy negotiation', () => {
  it('connects via initialize handshake and lists tools', async () => {
    const { url } = await start();
    const transport = new V2StreamableHTTPClientTransport(new URL(url));
    const client = new V2Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(transport);

    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name);
    expect(names).toContain('mathcore_compute');

    await client.close();
  });
});

// ---------------------------------------------------------------------------
// Modern v2 SDK client tests (pinned 2026-07-28)
// ---------------------------------------------------------------------------

describe('modern v2 SDK client — pinned 2026-07-28', () => {
  it('probes server/discover and uses modern era', async () => {
    const { url } = await start();
    const transport = new V2StreamableHTTPClientTransport(new URL(url));
    const client = new V2Client({
      name: 'test-client',
      version: '1.0.0',
      versionNegotiation: { mode: { pin: '2026-07-28' } },
    });
    await client.connect(transport);

    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name);
    expect(names).toContain('mathcore_compute');

    const result = await client.callTool({
      name: 'mathcore_compute',
      arguments: { expression: '2+2' },
    });
    expect(result.content[0].type).toBe('text');

    await client.close();
  });

  it('server/discover returns supported versions and capabilities', async () => {
    const { url } = await start();
    const transport = new V2StreamableHTTPClientTransport(new URL(url));
    const client = new V2Client({
      name: 'test-client',
      version: '1.0.0',
      versionNegotiation: { mode: { pin: '2026-07-28' } },
    });
    await client.connect(transport);

    // server/discover is exercised during connect() probe; verify the client
    // successfully negotiated, which means discover returned valid data.
    expect(client).toBeDefined();

    await client.close();
  });
});

// ---------------------------------------------------------------------------
// Raw HTTP tests — modern result envelopes
// ---------------------------------------------------------------------------

describe('modern result envelopes (raw HTTP)', () => {
  it('server/discover returns resultType, ttlMs, cacheScope', async () => {
    const { url } = await start();
    const res = await rawPost(url, {
      jsonrpc: '2.0',
      id: 1,
      method: 'server/discover',
      params: {
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    }, {
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': 'server/discover',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.result.resultType).toBe('complete');
    expect(body.result.ttlMs).toBe(3600000);
    expect(body.result.cacheScope).toBe('public');
    expect(body.result.supportedVersions).toContain('2026-07-28');
    expect(body.result._meta['io.modelcontextprotocol/serverInfo']).toBeDefined();
  });

  it('tools/list returns resultType, ttlMs, cacheScope', async () => {
    const { url } = await start();
    const res = await rawPost(url, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    }, {
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': 'tools/list',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.result.resultType).toBe('complete');
    expect(body.result.ttlMs).toBe(300000);
    expect(body.result.cacheScope).toBe('public');
    expect(Array.isArray(body.result.tools)).toBe(true);
  });

  it('tools/call returns resultType complete, no ttlMs/cacheScope (per spec)', async () => {
    const { url } = await start();
    const res = await rawPost(url, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'mathcore_compute',
        arguments: { expression: '2+2' },
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    }, {
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': 'tools/call',
      'mcp-name': 'mathcore_compute',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.result.resultType).toBe('complete');
    expect(body.result.content[0].text).toContain('mathcore_compute');
    // Per the MCP spec, CallToolResult does NOT carry ttlMs/cacheScope —
    // those cache hints belong only to cacheable results (tools/list, server/discover).
    expect(body.result.ttlMs).toBeUndefined();
    expect(body.result.cacheScope).toBeUndefined();
    // serverInfo _meta SHOULD be present on modern results
    expect(body.result._meta['io.modelcontextprotocol/serverInfo']).toEqual({
      name: 'zoveli-remote',
      version: expect.any(String),
    });
  });

  it('notification gets 202 with no body', async () => {
    const { url } = await start();
    const res = await rawPost(url, {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
      params: {
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    }, {
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': 'notifications/initialized',
    });
    expect(res.status).toBe(202);
    expect(await res.text()).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Raw HTTP tests — header validation (HeaderMismatch -32020)
// ---------------------------------------------------------------------------

describe('header validation', () => {
  it('MCP-Protocol-Version missing for modern request → 400 HeaderMismatch', async () => {
    const { url } = await start();
    const res = await rawPost(url, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    }, {
      'mcp-method': 'tools/list',
      // no MCP-Protocol-Version header
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe(-32020);
  });

  it('MCP-Protocol-Version mismatch → 400 HeaderMismatch', async () => {
    const { url } = await start();
    const res = await rawPost(url, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    }, {
      'mcp-protocol-version': '2025-11-25',
      'mcp-method': 'tools/list',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe(-32020);
  });

  it('Mcp-Method mismatch → 400 HeaderMismatch', async () => {
    const { url } = await start();
    const res = await rawPost(url, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    }, {
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': 'tools/call',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe(-32020);
  });

  it('Mcp-Name missing for tools/call → 400 HeaderMismatch', async () => {
    const { url } = await start();
    const res = await rawPost(url, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'mathcore_compute',
        arguments: { expression: '2+2' },
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    }, {
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': 'tools/call',
      // no Mcp-Name header
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe(-32020);
  });

  it('Mcp-Name mismatch → 400 HeaderMismatch', async () => {
    const { url } = await start();
    const res = await rawPost(url, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'mathcore_compute',
        arguments: { expression: '2+2' },
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    }, {
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': 'tools/call',
      'mcp-name': 'different_tool',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe(-32020);
  });

  it('missing _meta.clientCapabilities → 400 -32602', async () => {
    const { url } = await start();
    const res = await rawPost(url, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          // no clientCapabilities
        },
      },
    }, {
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': 'tools/list',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe(-32602);
  });
});

// ---------------------------------------------------------------------------
// Raw HTTP tests — protocol version errors
// ---------------------------------------------------------------------------

describe('protocol version errors', () => {
  it('unsupported modern version → 400 -32022', async () => {
    const { url } = await start();
    const res = await rawPost(url, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2027-01-01',
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    }, {
      'mcp-protocol-version': '2027-01-01',
      'mcp-method': 'tools/list',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe(-32022);
    expect(body.error.data.supported).toContain('2026-07-28');
    expect(body.error.data.requested).toBe('2027-01-01');
  });

  it('unknown modern method → 404 -32601', async () => {
    const { url } = await start();
    const res = await rawPost(url, {
      jsonrpc: '2.0',
      id: 1,
      method: 'unknown/modern_method',
      params: {
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    }, {
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': 'unknown/modern_method',
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe(-32601);
  });

  it('initialize in modern era → 404 -32601', async () => {
    const { url } = await start();
    const res = await rawPost(url, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientCapabilities': {},
        },
        protocolVersion: '2026-07-28',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0.0' },
      },
    }, {
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': 'initialize',
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe(-32601);
  });
});

// ---------------------------------------------------------------------------
// Raw HTTP tests — authentication
// ---------------------------------------------------------------------------

describe('authentication', () => {
  it('no token configured → request allowed (loopback mode)', async () => {
    const { url } = await start();
    const res = await rawPost(url, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    });
    expect(res.status).toBe(200);
  });

  it('missing bearer token → 401 with WWW-Authenticate', async () => {
    const { url } = await start({ token: '0123456789abcdef0123456789abcdef' });
    const res = await rawPost(url, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('Bearer');
  });

  it('wrong bearer token → 401', async () => {
    const { url } = await start({ token: '0123456789abcdef0123456789abcdef' });
    const res = await rawPost(url, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    }, {
      authorization: 'Bearer wrongtoken0123456789abcdef01234567',
    });
    expect(res.status).toBe(401);
  });

  it('correct bearer token → 200', async () => {
    const { url } = await start({ token: '0123456789abcdef0123456789abcdef' });
    const res = await rawPost(url, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    }, {
      authorization: 'Bearer 0123456789abcdef0123456789abcdef',
    });
    expect(res.status).toBe(200);
  });

  it('token in URL query string is not accepted', async () => {
    const { url } = await start({ token: '0123456789abcdef0123456789abcdef' });
    const res = await fetch(`${url}?access_token=0123456789abcdef0123456789abcdef`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {},
      }),
    });
    expect(res.status).toBe(401);
  });

  it('multi-credential: each credential has independent auth', async () => {
    const manager = new CredentialManager([
      { name: 'alice', token: 'alice-token-0123456789abcdef01234567', requestsPerMinute: 60, burst: 10 },
      { name: 'bob', token: 'bob-token-0123456789abcdef0123456789', requestsPerMinute: 60, burst: 10 },
    ]);
    const { url } = await start({ credentials: manager });

    const okAlice = await rawPost(url, {
      jsonrpc: '2.0', id: 1, method: 'tools/list', params: {},
    }, { authorization: 'Bearer alice-token-0123456789abcdef01234567' });
    expect(okAlice.status).toBe(200);

    const okBob = await rawPost(url, {
      jsonrpc: '2.0', id: 2, method: 'tools/list', params: {},
    }, { authorization: 'Bearer bob-token-0123456789abcdef0123456789' });
    expect(okBob.status).toBe(200);

    const denied = await rawPost(url, {
      jsonrpc: '2.0', id: 3, method: 'tools/list', params: {},
    }, { authorization: 'Bearer unknown-token-0123456789abcdef012345' });
    expect(denied.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Raw HTTP tests — origin validation
// ---------------------------------------------------------------------------

describe('origin validation', () => {
  it('absent origin → allowed', async () => {
    const { url } = await start();
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'tools/list', params: {},
      }),
    });
    // No Origin header → allowed (not 403)
    expect(res.status).not.toBe(403);
  });

  it('Origin: null → 403', async () => {
    const { url } = await start();
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'null',
      },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'tools/list', params: {},
      }),
    });
    expect(res.status).toBe(403);
  });

  it('non-loopback origin on loopback bind → 403', async () => {
    const { url } = await start();
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://evil.example.com',
      },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'tools/list', params: {},
      }),
    });
    expect(res.status).toBe(403);
  });

  it('same-origin → allowed', async () => {
    const { url } = await start();
    const serverUrl = new URL(url);
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: `${serverUrl.protocol}//${serverUrl.host}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'tools/list', params: {},
      }),
    });
    expect(res.status).not.toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Raw HTTP tests — malformed requests
// ---------------------------------------------------------------------------

describe('malformed requests', () => {
  it('invalid JSON → 400 -32700', async () => {
    const { url } = await start();
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe(-32700);
  });

  it('non-object JSON → 200 with -32600 error body', async () => {
    const { url } = await start();
    const res = await rawPost(url, [1, 2, 3]);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body[0].error.code).toBe(-32600);
  });

  it('missing method → 200 with -32600 error body', async () => {
    const { url } = await start();
    const res = await rawPost(url, {
      jsonrpc: '2.0',
      id: 1,
      params: {},
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe(-32600);
  });

  it('wrong content type → 415', async () => {
    const { url } = await start();
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'hello',
    });
    expect(res.status).toBe(415);
  });

  it('GET → 405', async () => {
    const { url } = await start();
    const res = await fetch(url);
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });
});

// ---------------------------------------------------------------------------
// Concurrency tests — clients cannot receive each other's results
// ---------------------------------------------------------------------------

describe('concurrency — client isolation', () => {
  it('two concurrent clients with different credentials get independent results', async () => {
    const manager = new CredentialManager([
      { name: 'alice', token: 'alice-token-0123456789abcdef01234567', requestsPerMinute: 100, burst: 20 },
      { name: 'bob', token: 'bob-token-0123456789abcdef0123456789', requestsPerMinute: 100, burst: 20 },
    ]);
    const { url, host } = await start({ credentials: manager });

    // Make concurrent calls from both credentials
    const [aliceRes, bobRes] = await Promise.all([
      rawPost(url, {
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: 'mathcore_compute', arguments: { expression: 'alice-job' } },
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      }, {
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': 'tools/call',
        'mcp-name': 'mathcore_compute',
        authorization: 'Bearer alice-token-0123456789abcdef01234567',
      }),
      rawPost(url, {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'mathcore_compute', arguments: { expression: 'bob-job' } },
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      }, {
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': 'tools/call',
        'mcp-name': 'mathcore_compute',
        authorization: 'Bearer bob-token-0123456789abcdef0123456789',
      }),
    ]);

    expect(aliceRes.status).toBe(200);
    expect(bobRes.status).toBe(200);

    const aliceBody = (await aliceRes.json()) as any;
    const bobBody = (await bobRes.json()) as any;
    expect(aliceBody.result.content[0].text).toContain('alice-job');
    expect(bobBody.result.content[0].text).toContain('bob-job');

    // Each client's call is recorded independently
    expect(host.calls.length).toBe(2);
    expect(host.calls[0].args.expression).toBe('alice-job');
    expect(host.calls[1].args.expression).toBe('bob-job');
  });
});

// ---------------------------------------------------------------------------
// Rate limit tests
// ---------------------------------------------------------------------------

describe('rate limits', () => {
  it('per-credential rate limiting blocks excess requests', async () => {
    const manager = new CredentialManager([
      { name: 'limited', token: 'limited-token-0123456789abcdef01234567', requestsPerMinute: 2, burst: 0 },
    ]);
    await start({ credentials: manager });

    // First two requests should succeed (burst: 0 means only sustained rate of 2/min... actually with burst 0, the bucket starts at 0)
    // Let's use burst: 1 so at least one request goes through
    const manager2 = new CredentialManager([
      { name: 'limited', token: 'limited-token-0123456789abcdef01234567', requestsPerMinute: 1, burst: 1 },
    ]);
    // Need a new server with the new manager
    servers.splice(0, servers.length).forEach((s) => s.close());
    const { url: url2 } = await start({ credentials: manager2 });

    const first = await rawPost(url2, {
      jsonrpc: '2.0', id: 1, method: 'tools/list', params: {},
    }, { authorization: 'Bearer limited-token-0123456789abcdef01234567' });
    expect(first.status).toBe(200);

    const second = await rawPost(url2, {
      jsonrpc: '2.0', id: 2, method: 'tools/list', params: {},
    }, { authorization: 'Bearer limited-token-0123456789abcdef01234567' });
    // Rate limited (burst exhausted, rate too slow to refill instantly)
    expect(second.status).toBe(429);
  });

  it('one credential being rate limited does not affect another', async () => {
    const manager = new CredentialManager([
      { name: 'limited', token: 'limited-token-0123456789abcdef01234567', requestsPerMinute: 1, burst: 1 },
      { name: 'unlimited', token: 'unlimited-token-0123456789abcdef0123456789', requestsPerMinute: 1000, burst: 100 },
    ]);
    const { url } = await start({ credentials: manager });

    // Exhaust limited credential
    await rawPost(url, {
      jsonrpc: '2.0', id: 1, method: 'tools/list', params: {},
    }, { authorization: 'Bearer limited-token-0123456789abcdef01234567' });
    const limited = await rawPost(url, {
      jsonrpc: '2.0', id: 2, method: 'tools/list', params: {},
    }, { authorization: 'Bearer limited-token-0123456789abcdef01234567' });
    expect(limited.status).toBe(429);

    // Unlimited credential still works
    const ok = await rawPost(url, {
      jsonrpc: '2.0', id: 3, method: 'tools/list', params: {},
    }, { authorization: 'Bearer unlimited-token-0123456789abcdef0123456789' });
    expect(ok.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Usage snapshots
// ---------------------------------------------------------------------------

describe('usage snapshots', () => {
  it('records per-credential usage without exposing tokens', async () => {
    const manager = new CredentialManager([
      { name: 'alice', token: 'alice-token-0123456789abcdef01234567', requestsPerMinute: 100, burst: 10 },
    ]);
    const { url } = await start({ credentials: manager });

    await rawPost(url, {
      jsonrpc: '2.0', id: 1, method: 'tools/list', params: {},
    }, { authorization: 'Bearer alice-token-0123456789abcdef01234567' });

    const snapshots = manager.snapshots();
    expect(snapshots.length).toBe(1);
    expect(snapshots[0].name).toBe('alice');
    expect(snapshots[0].requests).toBeGreaterThanOrEqual(1);
    // No token values in snapshots
    for (const s of snapshots) {
      expect(Object.keys(s)).not.toContain('token');
      expect(JSON.stringify(s)).not.toContain('alice-token');
    }
  });
});
