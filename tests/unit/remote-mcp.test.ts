import { afterEach, describe, expect, it } from 'vitest';
import * as http from 'node:http';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { AddressInfo } from 'node:net';
import {
  REMOTE_MCP_ALLOWLIST_ENV,
  REMOTE_MCP_ALLOWLIST_FILE_ENV,
  REMOTE_MCP_DEFAULT_ALLOWED_TOOLS,
  RemoteMcpConfigError,
  createRemoteMcpHost,
  createRemoteMcpRequestHandler,
  createRemoteMcpServer,
  parseRemoteMcpAllowlistFile,
  resolveRemoteMcpAllowlist,
  type RemoteToolHost,
} from '../../packages/host/src/remote-mcp/index';
import { mathcore, mathcoreCommandAvailable } from '../../packages/math-intelligence/src/index';
import { mathcoreTools, mathIntelligenceTools } from '../../packages/math-intelligence/src/tools';

const EXCLUDED = ['mathcore_status', 'sysinfo_snapshot', 'memory_search'];

function fakeHost(): RemoteToolHost & { calls: Array<{ name: string; args: Record<string, unknown> }> } {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const tools = [
    ...REMOTE_MCP_DEFAULT_ALLOWED_TOOLS.map((name) => ({
      name,
      description: `Test tool ${name}`,
      parameters: {
        type: 'object',
        properties: { expression: { type: 'string' } },
        additionalProperties: true,
      },
    })),
    ...EXCLUDED.map((name) => ({
      name,
      description: `Excluded tool ${name}`,
      parameters: { type: 'object', properties: {} },
    })),
  ];
  return {
    calls,
    tools: () => tools,
    async runTool(name, args = {}) {
      calls.push({ name, args });
      return `called ${name} ${JSON.stringify(args)}`;
    },
  };
}

const servers: http.Server[] = [];

async function start(
  options: Partial<Parameters<typeof createRemoteMcpServer>[0]> = {}
): Promise<{ url: string; host: ReturnType<typeof fakeHost> }> {
  const host = options.host ?? fakeHost();
  const server = createRemoteMcpServer({
    host,
    allowedTools: REMOTE_MCP_DEFAULT_ALLOWED_TOOLS,
    ...options,
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${address.port}/mcp`, host: host as ReturnType<typeof fakeHost> };
}

async function post(
  url: string,
  body: unknown,
  headers: Record<string, string> = {}
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
        })
    )
  );
});

describe('remote MCP allowlist', () => {
  it('discovers only allowlisted tools', async () => {
    const { url } = await start();
    const res = await post(url, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.result.tools.map((tool: any) => tool.name)).toEqual([
      ...REMOTE_MCP_DEFAULT_ALLOWED_TOOLS,
    ]);
    for (const excluded of EXCLUDED) {
      expect(body.result.tools.some((tool: any) => tool.name === excluded)).toBe(false);
    }
  });

  it('ignores request parameters that try to expand the allowlist', async () => {
    const { url } = await start();
    const res = await post(url, {
      jsonrpc: '2.0',
      id: 9,
      method: 'tools/list',
      params: { allowedTools: ['mathcore_status'], allowlist: ['mathcore_status'] },
    });
    const body = (await res.json()) as any;
    expect(body.result.tools.map((tool: any) => tool.name)).toEqual([
      ...REMOTE_MCP_DEFAULT_ALLOWED_TOOLS,
    ]);
    expect(body.result.tools.some((tool: any) => tool.name === 'mathcore_status')).toBe(false);
  });

  it('invokes an allowlisted tool and returns its result', async () => {
    const { url, host } = await start();
    const res = await post(url, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'mathcore_compute', arguments: { expression: '2+2' } },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.result.isError).toBe(false);
    expect(body.result.content[0].text).toContain('mathcore_compute');
    expect(body.result.content[0].text).toContain('2+2');
    expect(host.calls).toEqual([{ name: 'mathcore_compute', args: { expression: '2+2' } }]);
  });

  it('rejects a registered but non-allowlisted tool when called directly', async () => {
    const { url, host } = await start();
    const res = await post(url, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'mathcore_status', arguments: {} },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe(-32602);
    expect(body.error.message).toContain('Tool not allowlisted');
    expect(host.calls).toEqual([]);
  });

  it('rejects an entirely unknown tool when called directly', async () => {
    const { url, host } = await start();
    const res = await post(url, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'not_a_real_tool', arguments: {} },
    });
    const body = (await res.json()) as any;
    expect(body.error.code).toBe(-32602);
    expect(body.error.message).toContain('not_a_real_tool');
    expect(host.calls).toEqual([]);
  });

  it('supports initialize and acknowledges notifications with 202', async () => {
    const { url } = await start();
    const init = await post(url, {
      jsonrpc: '2.0',
      id: 5,
      method: 'initialize',
      params: { protocolVersion: '2025-03-26' },
    });
    const initialized = (await init.json()) as any;
    expect(initialized.result.protocolVersion).toBe('2025-03-26');
    expect(initialized.result.serverInfo.name).toBe('zoveli-remote');

    const note = await post(url, { jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(note.status).toBe(202);
    expect(await note.text()).toBe('');
  });

  it('requires the configured bearer token', async () => {
    const { url } = await start({ token: '0123456789abcdef' });
    const denied = await post(url, { jsonrpc: '2.0', id: 6, method: 'tools/list' });
    expect(denied.status).toBe(401);

    const allowed = await post(
      url,
      { jsonrpc: '2.0', id: 7, method: 'tools/list' },
      { authorization: 'Bearer 0123456789abcdef' }
    );
    expect(allowed.status).toBe(200);
  });

  it('does not offer a server-initiated SSE stream', async () => {
    const { url } = await start();
    const res = await fetch(url, { method: 'GET' });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });
});

describe('remote MCP allowlist configuration', () => {
  const available = [...REMOTE_MCP_DEFAULT_ALLOWED_TOOLS, ...EXCLUDED];

  it('fails closed on an unknown configured tool id', () => {
    expect(() =>
      resolveRemoteMcpAllowlist({
        available,
        env: { [REMOTE_MCP_ALLOWLIST_ENV]: 'mathcore_compute,mathcore_typo' },
      })
    ).toThrow(RemoteMcpConfigError);

    try {
      resolveRemoteMcpAllowlist({
        available,
        env: { [REMOTE_MCP_ALLOWLIST_ENV]: 'mathcore_compute,mathcore_typo' },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain('mathcore_typo');
      expect(message).toContain('No tools will be exposed');
      expect(message).toContain('mathcore_compute');
    }
  });

  it('fails closed on an unknown id in the handler catalog', () => {
    expect(() =>
      createRemoteMcpRequestHandler({
        host: fakeHost(),
        allowedTools: ['mathcore_compute', 'mathcore_typo'],
      })
    ).toThrow(/unknown tool id/i);
  });

  it('fails closed on an empty allowlist', () => {
    expect(() =>
      resolveRemoteMcpAllowlist({
        available,
        env: { [REMOTE_MCP_ALLOWLIST_ENV]: '' },
      })
    ).toThrow(/empty/i);
  });

  it('resolves the safe default when no configuration is present', () => {
    const resolved = resolveRemoteMcpAllowlist({ available, env: {} });
    expect(resolved.source).toBe('default');
    expect(resolved.allowedTools).toEqual([...REMOTE_MCP_DEFAULT_ALLOWED_TOOLS]);
  });

  it('parses the JSON file form and lets a file narrow the surface', () => {
    const text = JSON.stringify({
      allowedTools: ['mathcore_compute', 'math_route'],
    });
    expect(parseRemoteMcpAllowlistFile(text)).toEqual(['mathcore_compute', 'math_route']);

    const resolved = resolveRemoteMcpAllowlist({
      available,
      env: {
        [REMOTE_MCP_ALLOWLIST_FILE_ENV]: '/deployment/remote-mcp.json',
      },
      readFile: () => text,
    });
    expect(resolved.source).toBe('file');
    expect(resolved.allowedTools).toEqual(['mathcore_compute', 'math_route']);
    expect(resolved.label).toContain('/deployment/remote-mcp.json');
  });

  it('lets the allowlist file take precedence over the environment list', () => {
    const resolved = resolveRemoteMcpAllowlist({
      available,
      env: {
        [REMOTE_MCP_ALLOWLIST_FILE_ENV]: '/deployment/remote-mcp.json',
        [REMOTE_MCP_ALLOWLIST_ENV]: 'mathcore_status',
      },
      readFile: () => JSON.stringify(['mathcore_compute']),
    });
    expect(resolved.source).toBe('file');
    expect(resolved.allowedTools).toEqual(['mathcore_compute']);
  });

  it('keeps the shipped example in sync with the safe default', () => {
    const example = readFileSync(
      path.join(__dirname, '..', '..', 'config', 'remote-mcp.allowlist.example.json'),
      'utf8'
    );
    expect(parseRemoteMcpAllowlistFile(example)).toEqual([...REMOTE_MCP_DEFAULT_ALLOWED_TOOLS]);
  });
});

describe('local tool surface remains unchanged', () => {
  it('keeps the local math tools, including excluded diagnostics and memory tools', () => {
    expect(mathcoreTools.map((tool) => tool.name)).toEqual([
      'mathcore_compute',
      'mathcore_check_answer',
      'mathcore_list_operations',
      'mathcore_status',
    ]);
    expect(mathIntelligenceTools.map((tool) => tool.name)).toContain('math_recall');
    expect(mathIntelligenceTools.map((tool) => tool.name)).toContain('math_memorize');
  });

  it('mounts only math plugins on the remote host', () => {
    const host = createRemoteMcpHost();
    const names = host.tools().map((tool) => tool.name);
    for (const name of REMOTE_MCP_DEFAULT_ALLOWED_TOOLS) {
      expect(names).toContain(name);
    }
    expect(names).toContain('mathcore_status');
    expect(names).not.toContain('sysinfo_snapshot');
    expect(names).not.toContain('memory_search');
    expect(names).not.toContain('web_fetch');
  });
});

describe.skipIf(!mathcoreCommandAvailable())('real mathcore through the remote server', () => {
  it('computes and returns a verified result for mathcore_compute', async () => {
    const previousMemorize = process.env.ZOVELI_MATH_MEMORIZE;
    process.env.ZOVELI_MATH_MEMORIZE = '0';
    try {
      const host = createRemoteMcpHost();
      const server = createRemoteMcpServer({
        host,
        allowedTools: REMOTE_MCP_DEFAULT_ALLOWED_TOOLS,
      });
      servers.push(server);
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve());
      });
      const address = server.address() as AddressInfo;
      const res = await post(`http://127.0.0.1:${address.port}/mcp`, {
        jsonrpc: '2.0',
        id: 8,
        method: 'tools/call',
        params: { name: 'mathcore_compute', arguments: { expression: '2+2' } },
      });
      const body = (await res.json()) as any;
      expect(body.result.isError).toBe(false);
      expect(body.result.content[0].text).toContain('"all_verified": true');
      expect(body.result.content[0].text).toContain('"value": "4"');
    } finally {
      if (previousMemorize === undefined) delete process.env.ZOVELI_MATH_MEMORIZE;
      else process.env.ZOVELI_MATH_MEMORIZE = previousMemorize;
      mathcore.stop();
    }
  });
});
