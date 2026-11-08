import * as http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { ZOVELI_VERSION } from '@zoveli/core';
import {
  RemoteMcpConfigError,
  validateRemoteMcpAllowlist,
} from './allowlist.js';
import { CredentialManager } from './credentials.js';
import {
  validateOrigin,
  type OriginPolicyOptions,
} from './origin.js';

/**
 * Zoveli remote MCP server — dual-era Streamable HTTP transport.
 *
 * Supports two protocol eras on the same endpoint:
 *
 *   Modern (2026-07-28): stateless, per-request `_meta`, `server/discover`,
 *   no `initialize`, no sessions, no GET SSE stream. Required headers:
 *   `MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name` (for tools/call).
 *
 *   Legacy (2025-11-25, 2025-06-18, 2025-03-26): `initialize` handshake,
 *   current stateless behavior, GET returns 405.
 *
 * A dual-era server selects its behavior per request: modern per-request
 * metadata selects the modern era; an `initialize` handshake selects legacy.
 *
 * Security:
 *   - Origin validation on all incoming connections (DNS rebinding protection).
 *   - Bearer token auth on every request (401 + WWW-Authenticate).
 *   - Tokens never appear in URLs or logs.
 *   - Per-credential rate limits and usage accounting.
 *   - Strict header/body cross-validation (HeaderMismatch -32020).
 */

export interface RemoteToolDefinition {
  name: string;
  description?: string;
  parameters?: unknown;
}

export interface RemoteToolHost {
  tools(): RemoteToolDefinition[];
  runTool(name: string, args?: Record<string, unknown>): Promise<unknown>;
}

export interface RemoteMcpServerOptions {
  host: RemoteToolHost;
  /** Fixed at startup; request parameters can never extend it. */
  allowedTools: readonly string[];
  path?: string;
  serverName?: string;
  serverVersion?: string;
  instructions?: string;
  /** Single-token shorthand (backward compatible). Ignored if `credentials` is set. */
  token?: string;
  /** Multi-credential manager (takes precedence over `token`). */
  credentials?: CredentialManager | null;
  /** Origin policy; derived from bind host/port if not provided. */
  originPolicy?: OriginPolicyOptions | null;
  bodyLimitBytes?: number;
  maxToolResultBytes?: number;
  /** Modern protocol versions this server supports. Default: ['2026-07-28']. */
  modernSupportedVersions?: readonly string[];
}

export interface AllowlistedRemoteTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

type JsonRpcId = string | number | null;

interface JsonRpcError {
  jsonrpc: '2.0';
  id: JsonRpcId;
  error: { code: number; message: string; data?: unknown };
}

interface JsonRpcResult {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result: unknown;
}

type JsonRpcResponse = JsonRpcError | JsonRpcResult;

type ProtocolEra = 'modern' | 'legacy';

const MODERN_PROTOCOL_VERSIONS: readonly string[] = Object.freeze(['2026-07-28']);
const LEGACY_PROTOCOL_VERSIONS: readonly string[] = Object.freeze([
  '2025-11-25',
  '2025-06-18',
  '2025-03-26',
]);
const ALL_SUPPORTED_VERSIONS = [...LEGACY_PROTOCOL_VERSIONS, ...MODERN_PROTOCOL_VERSIONS];

const DEFAULT_PATH = '/mcp';
const DEFAULT_BODY_LIMIT = 1_000_000;
const DEFAULT_RESULT_LIMIT = 1_000_000;

const DEFAULT_INSTRUCTIONS =
  'Zoveli remote math tools. Only allowlisted verified-math tools are exposed. ' +
  'Computations run on the hosted service through mathcore; do not treat unverified model arithmetic as a result.';

const META_PROTOCOL_VERSION_KEY = 'io.modelcontextprotocol/protocolVersion';
const META_CLIENT_CAPABILITIES_KEY = 'io.modelcontextprotocol/clientCapabilities';
const META_SERVER_INFO_KEY = 'io.modelcontextprotocol/serverInfo';

/** JSON-RPC 2.0 error codes reserved by the MCP spec. */
const ERR_HEADER_MISMATCH = -32020;
const ERR_UNSUPPORTED_PROTOCOL_VERSION = -32022;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorResponse(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcError {
  const error: { code: number; message: string; data?: unknown } = {
    code,
    message,
  };
  if (data !== undefined) error.data = data;
  return { jsonrpc: '2.0', id, error };
}

function resultResponse(id: JsonRpcId, result: unknown): JsonRpcResult {
  return { jsonrpc: '2.0', id, result };
}

/** Build a modern-era result envelope with resultType and server _meta. */
function modernResult(
  id: JsonRpcId,
  payload: Record<string, unknown>,
  options: {
    serverName: string;
    serverVersion: string;
    ttlMs?: number;
    cacheScope?: 'public' | 'private';
  } = { serverName: 'zoveli-remote', serverVersion: ZOVELI_VERSION },
): JsonRpcResult {
  const result: Record<string, unknown> = {
    resultType: 'complete',
    ...payload,
  };
  if (options.ttlMs !== undefined) result.ttlMs = options.ttlMs;
  if (options.cacheScope !== undefined) result.cacheScope = options.cacheScope;
  result._meta = {
    [META_SERVER_INFO_KEY]: { name: options.serverName, version: options.serverVersion },
  };
  return resultResponse(id, result);
}

function toolText(value: unknown, maxBytes: number): string {
  let text: string;
  if (typeof value === 'string') {
    text = value;
  } else {
    try {
      text = JSON.stringify(value ?? null, null, 2);
    } catch {
      text = String(value);
    }
  }
  if (Buffer.byteLength(text) <= maxBytes) return text;
  const suffix = '\n…[truncated]';
  return text.slice(0, Math.max(0, maxBytes - Buffer.byteLength(suffix))) + suffix;
}

/**
 * Build the discovery catalog. Unknown ids throw at startup, before the
 * server listens, so a typo cannot leave a partially exposed surface.
 */
export function buildAllowlistedRemoteTools(
  host: RemoteToolHost,
  allowedTools: readonly string[],
  label = 'remote MCP allowlist',
): AllowlistedRemoteTool[] {
  const available = host.tools();
  const ids = validateRemoteMcpAllowlist(
    allowedTools,
    available.map((tool) => tool.name),
    label,
  );
  const byName = new Map(available.map((tool) => [tool.name, tool]));
  return ids.map((name) => {
    const tool = byName.get(name);
    if (!tool) {
      throw new RemoteMcpConfigError(`unknown tool id in ${label}: ${name}`);
    }
    const schema =
      isObject(tool.parameters)
        ? tool.parameters
        : { type: 'object', properties: {}, additionalProperties: false };
    return {
      name,
      description:
        typeof tool.description === 'string'
          ? tool.description.slice(0, 500)
          : `Run Zoveli tool ${name}`,
      inputSchema: schema,
    };
  });
}

/** Decode a Base64-sentinel MCP header value if encoded, otherwise pass through. */
function decodeMcpParamValue(value: string): string {
  const prefix = '=?base64?';
  const suffix = '?=';
  if (
    value.startsWith(prefix) &&
    value.endsWith(suffix) &&
    value.length > prefix.length + suffix.length
  ) {
    const b64 = value.slice(prefix.length, -suffix.length);
    try {
      return Buffer.from(b64, 'base64').toString('utf-8');
    } catch {
      return value;
    }
  }
  return value;
}

/** Extract the bearer token from the Authorization header. Never logs the value. */
function bearerTokenFromReq(req: http.IncomingMessage): string | undefined {
  const header = String(req.headers.authorization || '');
  // Linear scan instead of a backtracking regex (ReDoS-safe). HTTP header
  // values cannot contain line breaks, so spaces and tabs are the only
  // whitespace that can separate the scheme from the token.
  const scheme = 'bearer';
  if (header.length <= scheme.length) return undefined;
  if (header.slice(0, scheme.length).toLowerCase() !== scheme) return undefined;
  let i = scheme.length;
  if (header[i] !== ' ' && header[i] !== '\t') return undefined;
  while (i < header.length && (header[i] === ' ' || header[i] === '\t')) i++;
  const token = header.slice(i);
  return token.length > 0 ? token : undefined;
}

/** Constant-time bearer authorization against a single shorthand token. */
function bearerAuthorized(token: string, expected: string): boolean {
  if (!expected) return true;
  const got = Buffer.from(token);
  const exp = Buffer.from(expected);
  return got.length === exp.length && got.length > 0 && timingSafeEqual(got, exp);
}

function readBody(req: http.IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let raw = '';
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        tooLarge = true;
        return;
      }
      raw += chunk.toString('utf-8');
    });
    req.on('end', () => {
      if (tooLarge) {
        reject(new Error('body too large'));
        return;
      }
      resolve(raw);
    });
    req.on('error', reject);
  });
}

const BASE_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'",
};

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    ...BASE_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(Buffer.byteLength(text)),
  });
  res.end(text);
}

function sendEmpty(
  res: http.ServerResponse,
  status: number,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, { ...BASE_HEADERS, ...headers });
  res.end();
}

function sendUnauthorized(
  res: http.ServerResponse,
  body: unknown,
): void {
  res.writeHead(401, {
    ...BASE_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'WWW-Authenticate': 'Bearer realm="zoveli-remote-mcp"',
    'Content-Length': String(Buffer.byteLength(JSON.stringify(body))),
  });
  res.end(JSON.stringify(body));
}

/**
 * Classify the protocol era of a parsed JSON-RPC message.
 *
 *   - `_meta.protocolVersion` is a modern version → modern
 *   - `_meta.protocolVersion` is a legacy version → legacy
 *   - `initialize` without a modern version claim → legacy
 *   - no protocol version → legacy (pre-2025-06-18 clients may omit the header)
 */
function classifyEra(message: unknown): ProtocolEra {
  if (!isObject(message)) return 'legacy';
  const params = isObject(message.params) ? message.params : {};
  const meta = isObject(params._meta) ? params._meta : {};
  const version = meta[META_PROTOCOL_VERSION_KEY];
  if (typeof version === 'string') {
    if (MODERN_PROTOCOL_VERSIONS.includes(version)) return 'modern';
    if (LEGACY_PROTOCOL_VERSIONS.includes(version)) return 'legacy';
  }
  const method = typeof message.method === 'string' ? message.method : undefined;
  if (method === 'initialize') return 'legacy';
  return 'legacy';
}

function safeId(message: unknown): JsonRpcId {
  if (!isObject(message)) return null;
  const id = (message as { id?: unknown }).id;
  if (typeof id === 'string' || typeof id === 'number' || id === null) return id;
  return null;
}

/** Extract the modern protocol version from a message's `_.meta`, if present. */
function modernMetaVersion(message: unknown): string | undefined {
  if (!isObject(message)) return undefined;
  const params = (message as { params?: unknown }).params;
  if (!isObject(params)) return undefined;
  const meta = params._meta;
  if (!isObject(meta)) return undefined;
  const v = meta[META_PROTOCOL_VERSION_KEY];
  if (typeof v === 'string') return v;
  return undefined;
}

/** Validate modern-era required `_meta` fields. Returns an error or null. */
function validateModernMeta(message: unknown): JsonRpcError | null {
  if (!isObject(message)) return errorResponse(null, -32600, 'Invalid Request');
  const params = isObject(message.params) ? message.params : {};
  const meta = isObject(params._meta) ? params._meta : {};
  if (!(META_PROTOCOL_VERSION_KEY in meta)) {
    return errorResponse(
      safeId(message),
      -32602,
      `Missing required _meta field: ${META_PROTOCOL_VERSION_KEY}`,
    );
  }
  if (!(META_CLIENT_CAPABILITIES_KEY in meta)) {
    return errorResponse(
      safeId(message),
      -32602,
      `Missing required _meta field: ${META_CLIENT_CAPABILITIES_KEY}`,
    );
  }
  return null;
}

/**
 * Validate MCP standard request headers against the body.
 * Returns an error or null. Header names are case-insensitive.
 */
function validateStandardHeaders(
  req: http.IncomingMessage,
  message: unknown,
): JsonRpcError | null {
  if (!isObject(message) || typeof message.method !== 'string') {
    return null;
  }
  const id =
    Object.prototype.hasOwnProperty.call(message, 'id') &&
    (typeof message.id === 'string' ||
      typeof message.id === 'number' ||
      message.id === null)
      ? (message.id as JsonRpcId)
      : null;

  // MCP-Protocol-Version must match _meta.protocolVersion (modern) or be absent.
  const headerVersion = String(req.headers['mcp-protocol-version'] || '');
  const params = isObject(message.params) ? message.params : {};
  const meta = isObject(params._meta) ? params._meta : {};
  const bodyVersion = meta[META_PROTOCOL_VERSION_KEY];
  if (headerVersion !== '') {
    if (typeof bodyVersion !== 'string' || headerVersion !== bodyVersion) {
      return errorResponse(
        id,
        ERR_HEADER_MISMATCH,
        'MCP-Protocol-Version header does not match _meta protocolVersion.',
      );
    }
  } else if (typeof bodyVersion === 'string' && MODERN_PROTOCOL_VERSIONS.includes(bodyVersion)) {
    // Modern request without the header: required by spec.
    return errorResponse(
      id,
      ERR_HEADER_MISMATCH,
      'Missing required MCP-Protocol-Version header.',
    );
  }

  // Mcp-Method must match body method.
  const headerMethod = String(req.headers['mcp-method'] || '');
  if (headerMethod !== '' && headerMethod !== message.method) {
    return errorResponse(
      id,
      ERR_HEADER_MISMATCH,
      'Mcp-Method header does not match body method.',
    );
  }

  // Mcp-Name for tools/call must match params.name (decoding Base64 sentinel if needed).
  if (message.method === 'tools/call' && isObject(params)) {
    const headerName = String(req.headers['mcp-name'] || '');
    const bodyName = typeof params.name === 'string' ? params.name : undefined;
    if (headerName !== '') {
      if (bodyName === undefined || decodeMcpParamValue(headerName) !== bodyName) {
        return errorResponse(
          id,
          ERR_HEADER_MISMATCH,
          'Mcp-Name header does not match body params.name.',
        );
      }
    } else if (bodyName !== undefined) {
      return errorResponse(
        id,
        ERR_HEADER_MISMATCH,
        'Missing required Mcp-Name header for tools/call.',
      );
    }
  }

  return null;
}

/** Check that the client Accept header allows application/json. */
function acceptsJson(req: http.IncomingMessage): boolean {
  const accept = String(req.headers.accept || '');
  return /\bapplication\/json\b/i.test(accept) || /\*\/\*/i.test(accept);
}

export function createRemoteMcpRequestHandler(
  options: RemoteMcpServerOptions,
): http.RequestListener {
  const path = options.path ?? DEFAULT_PATH;
  const bodyLimit = options.bodyLimitBytes ?? DEFAULT_BODY_LIMIT;
  const resultLimit = options.maxToolResultBytes ?? DEFAULT_RESULT_LIMIT;
  const serverName = options.serverName ?? 'zoveli-remote';
  const serverVersion = options.serverVersion ?? ZOVELI_VERSION;
  const instructions = options.instructions ?? DEFAULT_INSTRUCTIONS;
  const catalog = buildAllowlistedRemoteTools(options.host, options.allowedTools);
  const allowed = new Set(catalog.map((tool) => tool.name));

  // Build origin policy from options or derive from bind info.
  const originPolicy = options.originPolicy ?? null;

  // Auth: credentials manager takes precedence over the single-token shorthand.
  let credentialManager: CredentialManager | null = options.credentials ?? null;
  let shorthandToken = '';
  if (!credentialManager && options.token) {
    shorthandToken = options.token.trim();
  }
  const authEnabled = !!credentialManager || !!shorthandToken;

  async function authorizeReq(req: http.IncomingMessage): Promise<string | null> {
    // No credentials configured → auth disabled (loopback-only mode).
    if (!authEnabled) return 'anon';
    const token = bearerTokenFromReq(req);
    if (!token) return null;
    if (credentialManager) {
      return credentialManager.authorize(token);
    }
    return bearerAuthorized(token, shorthandToken) ? 'default' : null;
  }

  async function checkRateLimit(credentialName: string | null): Promise<boolean> {
    if (!credentialManager || !credentialName) return true;
    return credentialManager.tryConsume(credentialName);
  }

  async function handleToolCall(
    id: JsonRpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> {
    const name = params.name;
    if (typeof name !== 'string') {
      return errorResponse(id, -32602, 'A tool name is required.');
    }
    if (!allowed.has(name)) {
      return errorResponse(id, -32602, `Tool not allowlisted: ${name.slice(0, 100)}`);
    }
    const args = params.arguments;
    if (args !== undefined && !isObject(args)) {
      return errorResponse(id, -32602, 'Tool arguments must be an object.');
    }
    try {
      const value = await options.host.runTool(
        name,
        (args as Record<string, unknown> | undefined) ?? {},
      );
      return resultResponse(id, {
        content: [{ type: 'text', text: toolText(value, resultLimit) }],
        isError: false,
      });
    } catch {
      return resultResponse(id, {
        content: [{ type: 'text', text: 'Tool execution failed.' }],
        isError: true,
      });
    }
  }

  async function handleModernToolCall(
    id: JsonRpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> {
    const base = await handleToolCall(id, params);
    // Wrap the legacy-shaped result into a modern envelope.
    // Per the MCP spec, CallToolResult carries resultType but NOT ttlMs/
    // cacheScope — those cache hints belong only to cacheable results such
    // as tools/list and server/discover.
    if ('error' in base) return base;
    const result = base.result as Record<string, unknown>;
    return modernResult(id, result, {
      serverName,
      serverVersion,
    });
  }

  async function handleMessage(
    message: unknown,
    era: ProtocolEra,
  ): Promise<JsonRpcResponse | null> {
    if (!isObject(message)) {
      return errorResponse(null, -32600, 'Invalid Request');
    }
    const hasId = Object.prototype.hasOwnProperty.call(message, 'id');
    const id = hasId &&
      (typeof message.id === 'string' ||
        typeof message.id === 'number' ||
        message.id === null)
      ? (message.id as JsonRpcId)
      : null;
    if (message.jsonrpc !== '2.0') {
      return errorResponse(id, -32600, 'Invalid Request');
    }
    if (typeof message.method !== 'string') {
      if ('result' in message || 'error' in message) return null;
      return errorResponse(id, -32600, 'Invalid Request');
    }
    // Notifications are acknowledged with 202 and never dispatched.
    if (!hasId) return null;

    const params = message.params;
    if (params !== undefined && !isObject(params)) {
      return errorResponse(id, -32602, 'Invalid params');
    }
    const p = (params as Record<string, unknown> | undefined) ?? {};

    switch (message.method) {
      case 'initialize': {
        if (era === 'modern') {
          return errorResponse(id, -32601, 'Method not found: initialize');
        }
        const requested =
          typeof p.protocolVersion === 'string' ? p.protocolVersion : '';
        const protocolVersion =
          LEGACY_PROTOCOL_VERSIONS.includes(requested)
            ? requested
            : LEGACY_PROTOCOL_VERSIONS[LEGACY_PROTOCOL_VERSIONS.length - 1];
        return resultResponse(id, {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: serverName, version: serverVersion },
          instructions,
        });
      }
      case 'server/discover': {
        if (era === 'legacy') {
          return errorResponse(id, -32601, 'Method not found: server/discover');
        }
        return modernResult(
          id,
          {
            supportedVersions: ALL_SUPPORTED_VERSIONS,
            capabilities: {
              tools: {},
              resources: {},
              prompts: {},
            },
            instructions,
          },
          {
            serverName,
            serverVersion,
            ttlMs: 3600000,
            cacheScope: 'public',
          },
        );
      }
      case 'ping':
        if (era === 'modern') {
          return modernResult(id, {}, { serverName, serverVersion });
        }
        return resultResponse(id, {});
      case 'tools/list': {
        const tools = catalog.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        }));
        if (era === 'modern') {
          return modernResult(
            id,
            { tools },
            { serverName, serverVersion, ttlMs: 300000, cacheScope: 'public' },
          );
        }
        return resultResponse(id, { tools });
      }
      case 'tools/call':
        if (era === 'modern') {
          return handleModernToolCall(id, p);
        }
        return handleToolCall(id, p);
      default:
        return errorResponse(id, -32601, `Method not found: ${message.method.slice(0, 100)}`);
    }
  }

  async function handlePayload(
    payload: unknown,
    era: ProtocolEra,
  ): Promise<{ status: number; body?: unknown }> {
    if (Array.isArray(payload)) {
      // Batch requests are a legacy-era feature. The modern spec requires a
      // single JSON-RPC message per POST.
      if (era === 'modern') {
        return {
          status: 400,
          body: errorResponse(null, -32600, 'Batch requests are not supported in the modern era.'),
        };
      }
      if (payload.length === 0) {
        return { status: 200, body: errorResponse(null, -32600, 'Invalid Request') };
      }
      const responses: JsonRpcResponse[] = [];
      for (const message of payload) {
        const messageEra = classifyEra(message);
        const response = await handleMessage(message, messageEra);
        if (response !== null) responses.push(response);
      }
      return responses.length > 0 ? { status: 200, body: responses } : { status: 202 };
    }
    const response = await handleMessage(payload, era);
    if (response === null) return { status: 202 };
    // Per the 2026-07-28 spec, unknown modern methods must be answered with
    // HTTP 404 + -32601 (distinct from legacy HTTP 200 + -32601).
    if (
      era === 'modern' &&
      'error' in response &&
      response.error.code === -32601
    ) {
      return { status: 404, body: response };
    }
    return { status: 200, body: response };
  }

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url || '/', 'http://remote-mcp.local');
    if (url.pathname !== path) {
      sendJson(res, 404, { ok: false, error: 'not found' });
      return;
    }
    if (req.method === 'GET' || req.method === 'DELETE') {
      sendEmpty(res, 405, { Allow: 'POST' });
      return;
    }
    if (req.method === 'OPTIONS') {
      sendEmpty(res, 204, { Allow: 'POST' });
      return;
    }
    if (req.method !== 'POST') {
      sendEmpty(res, 405, { Allow: 'POST' });
      return;
    }

    // --- Origin validation (DNS rebinding protection) ---
    if (originPolicy) {
      const origin = req.headers.origin
        ? String(req.headers.origin)
        : undefined;
      const reason = validateOrigin(origin, originPolicy);
      if (reason !== null) {
        sendJson(res, 403, { ok: false, error: 'forbidden', reason });
        return;
      }
    }

    // --- Authentication ---
    const credentialName = await authorizeReq(req);
    if (credentialName === null) {
      sendUnauthorized(res, errorResponse(null, -32001, 'Unauthorized'));
      return;
    }

    // --- Rate limit ---
    if (!(await checkRateLimit(credentialName))) {
      sendJson(res, 429, {
        ok: false,
        error: 'rate limited',
        retryAfter: 60,
      });
      return;
    }

    // --- Accept header (modern era requires application/json) ---
    // We check this early; legacy clients are not required to send Accept.
    if (!acceptsJson(req)) {
      // Only enforce for modern-looking requests (with MCP-Protocol-Version header).
      const headerVersion = String(req.headers['mcp-protocol-version'] || '');
      if (headerVersion !== '') {
        sendJson(res, 406, errorResponse(null, -32600, 'Accept must include application/json'));
        return;
      }
    }

    // --- Content-Type ---
    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    if (!contentType.includes('application/json')) {
      sendJson(res, 415, errorResponse(null, -32600, 'Content-Type must be application/json'));
      return;
    }

    let raw: string;
    try {
      raw = await readBody(req, bodyLimit);
    } catch (error) {
      const tooLarge = error instanceof Error && error.message === 'body too large';
      sendJson(
        res,
        tooLarge ? 413 : 400,
        errorResponse(
          null,
          tooLarge ? -32001 : -32600,
          tooLarge ? 'Request body too large' : 'Invalid Request',
        ),
      );
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      sendJson(res, 400, errorResponse(null, -32700, 'Parse error'));
      return;
    }

    // --- Post-parse validation ---
    // These checks run regardless of era classification so that unknown or
    // unsupported protocol versions are rejected even when the method would
    // otherwise look legacy (e.g. `initialize` with a modern version header).

    // 1. Unsupported protocol version: any protocol-version indicator (header
    //    or _meta) naming a version we don't support must be rejected with
    //    -32022 before era-specific dispatch.
    const headerVersion = String(req.headers['mcp-protocol-version'] || '');
    const bodyVersion = modernMetaVersion(payload);
    const indicatedVersion =
      typeof bodyVersion === 'string' ? bodyVersion : (headerVersion || undefined);
    if (
      typeof indicatedVersion === 'string' &&
      !ALL_SUPPORTED_VERSIONS.includes(indicatedVersion)
    ) {
      sendJson(
        res,
        400,
        errorResponse(
          safeId(payload),
          ERR_UNSUPPORTED_PROTOCOL_VERSION,
          'Unsupported protocol version',
          { supported: ALL_SUPPORTED_VERSIONS, requested: indicatedVersion },
        ),
      );
      return;
    }

    // 2. Header/body cross-validation: when MCP-Protocol-Version is present,
    //    it must match _meta.protocolVersion. When _meta claims a modern
    //    version, the header is required.
    if (headerVersion !== '' || typeof bodyVersion === 'string') {
      const isModernClaimed =
        typeof bodyVersion === 'string' && MODERN_PROTOCOL_VERSIONS.includes(bodyVersion);
      if (isModernClaimed && headerVersion === '') {
        sendJson(
          res,
          400,
          errorResponse(
            safeId(payload),
            ERR_HEADER_MISMATCH,
            'Missing required MCP-Protocol-Version header.',
          ),
        );
        return;
      }
      if (headerVersion !== '' && typeof bodyVersion === 'string' && headerVersion !== bodyVersion) {
        sendJson(
          res,
          400,
          errorResponse(
            safeId(payload),
            ERR_HEADER_MISMATCH,
            'MCP-Protocol-Version header does not match _meta protocolVersion.',
          ),
        );
        return;
      }
    }

    // Classify era for the payload as a whole. For batch, each message is
    // classified individually inside handlePayload.
    const era = classifyEra(payload);

    // Modern-era header validation (Mcp-Method, Mcp-Name) before dispatch.
    if (era === 'modern' && !Array.isArray(payload)) {
      const metaErr = validateModernMeta(payload);
      if (metaErr) {
        sendJson(res, 400, metaErr);
        return;
      }
      const headerErr = validateStandardHeaders(req, payload);
      if (headerErr) {
        sendJson(res, 400, headerErr);
        return;
      }
    }

    const outcome = await handlePayload(payload, era);
    if (outcome.status === 202) {
      sendEmpty(res, 202);
      return;
    }
    sendJson(res, outcome.status, outcome.body);
  }

  return (req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) {
        sendJson(res, 500, errorResponse(null, -32603, 'Internal error'));
      } else {
        res.end();
      }
    });
  };
}

export function createRemoteMcpServer(options: RemoteMcpServerOptions): http.Server {
  return http.createServer(createRemoteMcpRequestHandler(options));
}
