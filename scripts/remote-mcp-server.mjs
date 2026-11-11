#!/usr/bin/env node
/**
 * Zoveli remote MCP server (Streamable HTTP).
 *
 * Run after `pnpm build`:
 *   node scripts/remote-mcp-server.mjs
 *   # or: pnpm remote:mcp:start
 *
 * Configuration (all startup-only; requests cannot change the allowlist or
 * credentials):
 *
 *   ZOVELI_REMOTE_MCP_HOST           bind address (default 127.0.0.1)
 *   ZOVELI_REMOTE_MCP_PORT           port (default 8790, falls back to PORT)
 *   ZOVELI_REMOTE_MCP_TOKEN          single bearer token shorthand;
 *                                    required for non-loopback binds;
 *                                    minimum 32 characters
 *   ZOVELI_REMOTE_MCP_CREDENTIALS_FILE  JSON file with named credentials
 *                                    (takes precedence over ZOVELI_REMOTE_MCP_TOKEN)
 *   ZOVELI_REMOTE_MCP_ORIGINS        comma-separated allowed origins
 *                                    (remote/public binds; e.g.
 *                                    https://client.example.com)
 *   ZOVELI_REMOTE_MCP_RATE_LIMIT_RPM  requests per minute per credential
 *                                    (default 60)
 *   ZOVELI_REMOTE_MCP_RATE_LIMIT_BURST burst allowance per credential
 *                                    (default 10)
 *   ZOVELI_REMOTE_MCP_ALLOWED_TOOLS  comma-separated tool ids
 *   ZOVELI_REMOTE_MCP_ALLOWLIST_FILE JSON array or { "allowedTools": [] }
 *
 * The allowlist and credentials are resolved once at startup and validated
 * against the tools the remote host actually mounted. Unknown ids abort
 * startup. Weak tokens (< 32 chars) abort startup.
 *
 * Security notes:
 *   - Tokens are never logged or echoed in responses.
 *   - Origin validation is enforced on every incoming connection.
 *   - Per-credential rate limits prevent one client from starving others.
 *   - Bind to loopback (default) for local testing; a token is required for
 *     non-loopback binds.
 */

import { isIP } from 'node:net';
import {
  CREDENTIALS_FILE_ENV,
  MIN_TOKEN_LENGTH,
  RemoteMcpConfigError,
  CredentialManager,
  createRemoteMcpHost,
  createRemoteMcpServer,
  resolveCredentials,
  resolveRemoteMcpAllowlist,
} from '../packages/host/dist/remote-mcp/index.js';

function isLoopback(hostname) {
  const h = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h === '::1' || h === '0:0:0:0:0:0:0:1') return true;
  return isIP(h) === 4 && h.startsWith('127.');
}

function readPort() {
  const raw = (process.env.ZOVELI_REMOTE_MCP_PORT || process.env.PORT || '8790').trim();
  if (!/^\d+$/.test(raw)) {
    throw new RemoteMcpConfigError(`invalid port "${raw}"; set ZOVELI_REMOTE_MCP_PORT to 0-65535.`);
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new RemoteMcpConfigError(`invalid port "${raw}"; set ZOVELI_REMOTE_MCP_PORT to 0-65535.`);
  }
  return port;
}

function readPositiveInt(name, fallback) {
  const raw = (process.env[name] || '').trim();
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) {
    throw new RemoteMcpConfigError(`invalid ${name} "${raw}"; must be a positive integer.`);
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new RemoteMcpConfigError(`invalid ${name} "${raw}"; must be a positive integer.`);
  }
  return value;
}

function readOrigins() {
  const raw = (process.env.ZOVELI_REMOTE_MCP_ORIGINS || '').trim();
  if (!raw) return [];
  return raw.split(',').map((o) => o.trim()).filter(Boolean);
}

function serverOrigin(hostname, port) {
  const shown = hostname.includes(':') ? `[${hostname}]` : hostname;
  return `http://${shown}:${port}`;
}

function main() {
  const hostname = (process.env.ZOVELI_REMOTE_MCP_HOST || '127.0.0.1').trim() || '127.0.0.1';
  const port = readPort();
  const token = (process.env.ZOVELI_REMOTE_MCP_TOKEN || '').trim();
  const isLocal = isLoopback(hostname);
  const origins = readOrigins();

  // Resolve credentials: file takes precedence over the single-token shorthand.
  let credentials;
  try {
    credentials = resolveCredentials(process.env);
  } catch (error) {
    throw new RemoteMcpConfigError(
      `credentials: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // If a single token is provided, validate its strength.
  if (token && token.length < MIN_TOKEN_LENGTH) {
    throw new RemoteMcpConfigError(
      `ZOVELI_REMOTE_MCP_TOKEN is ${token.length} characters; the minimum is ${MIN_TOKEN_LENGTH}. ` +
        'Use a stronger bearer token (32+ characters), or bind to loopback only.',
    );
  }

  // A non-loopback bind requires at least one credential.
  if (!isLocal && credentials.length === 0) {
    throw new RemoteMcpConfigError(
      `refusing to bind ${hostname} without credentials. ` +
        'Set ZOVELI_REMOTE_MCP_TOKEN (32+ characters) or ' +
        `${CREDENTIALS_FILE_ENV} before exposing this server.`,
    );
  }

  // Remote/public binds should declare allowed origins. In local mode origins
  // are still validated (loopback allowed, non-loopback same-origin rejected).
  const originPolicy = {
    mode: isLocal ? 'local' : 'remote',
    configuredOrigins: origins,
    serverOrigin: serverOrigin(hostname, port),
  };

  // Remote math requests must not silently populate a shared server-side
  // memory store. Operators can opt in explicitly (single-tenant deployments
  // only); the local desktop/CLI behavior is untouched because this env var
  // is set only inside the remote server process. An empty/whitespace value
  // is treated as unset (the math layer treats anything but "0" as enabled).
  if (!process.env.ZOVELI_MATH_MEMORIZE?.trim()) {
    process.env.ZOVELI_MATH_MEMORIZE = '0';
  }

  const host = createRemoteMcpHost();
  const allowlist = resolveRemoteMcpAllowlist({
    available: host.tools().map((tool) => tool.name),
  });

  // Build a single-credential manager from the shorthand token if no file was
  // provided and a token exists. Otherwise use the file-resolved credentials.
  let credentialManager = null;
  if (credentials.length > 0) {
    credentialManager = new CredentialManager(credentials);
  } else if (token) {
    credentialManager = new CredentialManager([
      {
        name: 'default',
        token,
        requestsPerMinute: readPositiveInt('ZOVELI_REMOTE_MCP_RATE_LIMIT_RPM', 60),
        burst: readPositiveInt('ZOVELI_REMOTE_MCP_RATE_LIMIT_BURST', 10),
      },
    ]);
  }

  const server = createRemoteMcpServer({
    host,
    allowedTools: allowlist.allowedTools,
    token,
    credentials: credentialManager,
    originPolicy,
  });

  server.on('error', (error) => {
    console.error(`remote MCP server failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });

  server.listen(port, hostname, () => {
    const shownHost = hostname.includes(':') ? `[${hostname}]` : hostname;
    console.log(`Zoveli remote MCP listening on http://${shownHost}:${port}/mcp`);
    console.log(`Allowlist source: ${allowlist.label}`);
    console.log(`Allowlisted tools (${allowlist.allowedTools.length}): ${allowlist.allowedTools.join(', ')}`);
    console.log(
      `Credential count: ${credentials.length} ` +
        `(source: ${credentials.length > 0 ? (process.env[CREDENTIALS_FILE_ENV] ? 'file' : 'token') : 'none'})`,
    );
    if (!isLocal && credentials.length === 0) {
      console.warn('No credentials: non-loopback bind should not happen (startup guard above).');
    }
    if (origins.length > 0) {
      console.log(`Allowed origins: ${origins.join(', ')}`);
    }
    console.log(
      `Excluded by default: local memory/vault, sysinfo, filesystem/code tools, web access, scheduler, persona and status/diagnostics tools. ` +
        `Edit ${CREDENTIALS_FILE_ENV} or ZOVELI_REMOTE_MCP_ALLOWED_TOOLS to narrow the surface.`
    );
  });

  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

try {
  main();
} catch (error) {
  if (error instanceof RemoteMcpConfigError) {
    console.error(error.message);
  } else {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exit(1);
}
