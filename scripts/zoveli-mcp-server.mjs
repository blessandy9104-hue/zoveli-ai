#!/usr/bin/env node
import { isIP } from 'node:net';

const baseUrl = new URL(process.env.ZOVELI_URL || 'http://127.0.0.1:8080');
const host = baseUrl.hostname.toLowerCase();
if (baseUrl.protocol !== 'http:' || !(host === 'localhost' || host === '::1' || host.startsWith('127.') || isIP(host) === 6 && host === '::1')) {
  throw new Error('ZOVELI_URL must use HTTP on localhost or a loopback IP');
}
baseUrl.pathname = baseUrl.pathname.replace(/\/+$/, '');
const token = process.env.ZOVELI_API_TOKEN || '';
const timeoutMs = Math.max(1000, Math.min(600000, Number.parseInt(process.env.ZOVELI_MCP_TIMEOUT_MS || '30000', 10) || 30000));
const toolsUrl = new URL('api/tools', baseUrl);
const runUrl = new URL('api/run', baseUrl);
let buffered = '';
let writeChain = Promise.resolve();

function send(message) {
  writeChain = writeChain.then(async () => {
    if (!process.stdout.write(`${JSON.stringify(message)}\n`)) {
      await new Promise((resolve) => process.stdout.once('drain', resolve));
    }
  });
}

function fail(id, message, code = -32000) {
  if (id !== undefined) send({ jsonrpc: '2.0', id, error: { code, message } });
}

async function getTools() {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const response = await fetch(toolsUrl, { headers, signal: AbortSignal.timeout(timeoutMs) });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error || `Zoveli tool catalog returned HTTP ${response.status}`);
  if (!Array.isArray(body)) throw new Error('Zoveli returned an invalid tool catalog');
  const seen = new Set();
  return body.flatMap((item) => {
    if (!item || typeof item.name !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(item.name) || seen.has(item.name)) return [];
    seen.add(item.name);
    return [{
      name: item.name,
      description: typeof item.description === 'string' ? item.description.slice(0, 500) : `Run Zoveli tool ${item.name}`,
      inputSchema: item.inputSchema && typeof item.inputSchema === 'object'
        ? item.inputSchema
        : { type: 'object', properties: {}, additionalProperties: false },
    }];
  });
}

async function handle(message) {
  if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') return;
  const { id, method, params = {} } = message;
  if (method.startsWith('notifications/')) return;
  try {
    if (method === 'initialize') {
      return send({ jsonrpc: '2.0', id, result: {
        protocolVersion: params.protocolVersion || '2025-03-26',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'zoveli-local', version: '0.1.0' },
        instructions: 'Zoveli local-first tools. Use mathcore tools for calculations; they return independently verified results.',
      } });
    }
    if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
    if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: await getTools() } });
    if (method === 'tools/call') {
      if (typeof params.name !== 'string') return fail(id, 'A tool name is required', -32602);
      const tools = await getTools();
      if (!tools.some((tool) => tool.name === params.name)) return fail(id, `Unknown Zoveli tool: ${params.name}`, -32602);
      const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
      const response = await fetch(runUrl, {
        method: 'POST', headers,
        body: JSON.stringify({ tool: params.name, args: params.arguments ?? {} }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || `Zoveli tool endpoint returned HTTP ${response.status}`);
      if (!body || typeof body !== 'object') throw new Error('Zoveli returned an invalid tool result');
      if (body.ok === false) return send({ jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: String(body.error || 'Zoveli tool failed') }] } });
      const value = body.result;
      const text = typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 2);
      return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }] } });
    }
    return fail(id, `Method not found: ${method}`, -32601);
  } catch (error) {
    return fail(id, error instanceof Error ? error.message : String(error));
  }
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffered += chunk;
  while (true) {
    const newline = buffered.indexOf('\n');
    if (newline < 0) break;
    const line = buffered.slice(0, newline).trim();
    buffered = buffered.slice(newline + 1);
    if (!line) continue;
    let message;
    try { message = JSON.parse(line); }
    catch { continue; }
    void handle(message);
  }
});
process.stdin.on('end', () => { if (buffered.trim()) { try { void handle(JSON.parse(buffered)); } catch {} } });
process.stdin.on('error', () => process.exit(1));
