# Remote MCP server and tool allowlist

> Status: experimental. The server is opt-in, binds to loopback by default,
> and is not part of the release artifacts. Read
> [Before public exposure](#before-public-exposure) before putting it on the
> internet.

## What exists today

Before this change Zoveli had one MCP surface: `scripts/zoveli-mcp-server.mjs`,
a **local stdio** bridge that reads `GET /api/tools` and posts
`POST /api/run` on the desktop server. It is loopback-only (`ZOVELI_URL` must
be an HTTP loopback address), so it cannot be used as a hosted service.

The remote server is a separate process in `packages/host/src/remote-mcp`:

```
remote MCP client
  -> POST /mcp (Streamable HTTP, JSON-RPC)
    -> fixed allowlist check (tools/list and tools/call)
      -> ZoveliHost with only math plugins mounted
        -> mathcore stdio on the hosted machine
```

It is a small stateless Streamable HTTP implementation with **dual-era**
protocol support:

| Era | Protocol versions | Behavior |
| --- | --- | --- |
| Legacy | 2025-03-26, 2025-06-18, 2025-11-25 | `initialize` handshake, stateless, GET returns 405 |
| Modern | 2026-07-28 | `server/discover`, per-request `_meta`, no sessions, no GET stream |

- `POST /mcp` with `Content-Type: application/json` is the message endpoint.
- A request gets an `application/json` JSON-RPC response; a notification gets
  `202 Accepted`.
- `GET /mcp` and `DELETE /mcp` return `405` (no server-initiated SSE stream,
  no sessions).
- `initialize`, `ping`, `tools/list` and `tools/call` are supported in both
  eras. Modern era additionally supports `server/discover`.

## Dual-era protocol details

### Modern era (2026-07-28)

Modern clients send per-request metadata in `_meta` and HTTP headers:

| Header | Required | Source |
| --- | --- | --- |
| `MCP-Protocol-Version` | Yes | `_meta.io.modelcontextprotocol/protocolVersion` |
| `Mcp-Method` | Yes | body `method` |
| `Mcp-Name` | Yes (tools/call) | body `params.name` |

Required `_meta` fields:

- `io.modelcontextprotocol/protocolVersion` (string)
- `io.modelcontextprotocol/clientCapabilities` (object)

Server validation:

- Header/body mismatch → `400` + JSON-RPC `-32020` (`HeaderMismatch`)
- Missing required `_meta` field → `400` + JSON-RPC `-32602`
- Unsupported protocol version → `400` + JSON-RPC `-32022`
- Unknown modern method → `404` + JSON-RPC `-32601`
- Missing bearer token → `401` + `WWW-Authenticate: Bearer`

Modern success results use the `resultType: "complete"` envelope with
`ttlMs`, `cacheScope`, and `_meta.serverInfo`. `tools/list` and
`server/discover` include `ttlMs` and `cacheScope`.

### Legacy era (2025-03-26 through 2025-11-25)

Legacy clients perform an `initialize` handshake. The server answers with the
negotiated protocol version, capabilities, and server info. Notifications are
acknowledged with `202 Accepted`. GET returns `405`.

A dual-era server selects its behavior per request: modern per-request
`_meta` selects the modern era; an `initialize` handshake selects legacy.

## Tool registration and identification

Tools are registered by plugins on `ZoveliHost` (`ctx.register(...)`) and
collected by `host.tools()`. The remote host mounts **only** these plugins:

- `@zoveli/math-intelligence` (`mathcore_*`, `math_*`)
- the 12 `@zoveli/math-domains` specialists (`math_*_solve`)

It deliberately does not mount `resolvePlugins()`, so memory, vault, sysinfo,
filesystem/code, web, scheduler, persona and diagnostics tools are not even
present in the remote process. The allowlist is a second gate on top of that
small catalog.

Tool ids are the existing local ids; nothing is renamed or invented.

## Included in the default allowlist

All included tools are deterministic verified-math operations. They read only
the request arguments and the mathcore engine; they do not read the desktop
vault, device state, credentials or user files.

| Tool | Why it is included |
| --- | --- |
| `mathcore_compute` | Primary verified computation; returns mathcore's certified result. |
| `mathcore_check_answer` | Compares a proposed answer with mathcore; pure verification. |
| `mathcore_list_operations` | Liveness and mathcore catalog check; exposes no local state. |
| `math_route` | Pure classifier that maps a request to a math domain. |
| `math_algebra_solve` | Verified algebra through the same mathcore transport. |
| `math_calculus_solve` | Verified calculus through the same mathcore transport. |
| `math_stats_solve` | Verified descriptive statistics through mathcore. |
| `math_logic_solve` | Verified SAT/proof operations through mathcore. |
| `math_units_solve` | Verified unit conversion through mathcore. |
| `math_discrete_solve` | Verified shortest-path operation through mathcore. |
| `math_arithmetic_solve` | Verified percent/ratio operations through mathcore. |
| `math_geometry_solve` | Verified area/volume/Pythagoras operations through mathcore. |
| `math_trigonometry_solve` | Verified trigonometry through mathcore. |
| `math_probability_solve` | Verified probability through mathcore. |
| `math_linear_solve` | Verified linear algebra through mathcore. |
| `math_number_solve` | Verified number-theory operations through mathcore. |

`mathcore_compute` and the `*_solve` tools also write the normal mathcore audit
certificate on the hosted machine. The remote launcher sets
`ZOVELI_MATH_MEMORIZE=0` by default so remote requests do not populate a shared
server-side memory store; set it to `1` only for a single-tenant deployment
that intentionally wants remote proof memory. Local desktop/CLI behavior is
unchanged because the variable is set only inside the remote process.

## Excluded from the default allowlist

| Tools | Classification | Why excluded |
| --- | --- | --- |
| `mathcore_status` | Host diagnostics | Leaks process ids, command paths and last errors. |
| `math_recall`, `math_recall_semantic`, `math_memorize`, `math_stats` | Shared server state | Require a server memory store; cross-tenant reads/writes are unsafe without accounts and isolation. |
| `memory_*`, `vault_search`, `vault_graph` | Private user data | Read or mutate the knowledge store/vault. |
| `sysinfo_*` | Device-dependent | Describe the host machine (CPU, disk, network, battery, processes). |
| `security_scan`, `code_review`, `docs_generate`, `project_health`, `health_report` | Local filesystem/runtime | Accept paths and inspect local files, configuration or process state. |
| `language_*` | Local toolchain/filesystem | Analyze/format/lint/run tests against local files and installed tools. |
| `web_fetch`, `web_search` | Network egress | Add an SSRF/egress and content-trust surface that needs separate review. |
| `tasks_schedule` | Personal planning data | Not needed for math and may contain user task details. |
| `persona_switch`, `persona_current` | User state | Mutates/reads local persona state. |
| `capability_*`, `efficiency_review` | Host introspection | Disclose the local capability inventory and runtime traces. |
| `guard_set_policy` | Security policy | Changes the local approval policy. |
| `auth_request_code`, `auth_verify_code` | Credentials | Desktop-only authentication flow; never expose remotely. |
| `daily_brief_get` | Local context | Reads local time/greeting preferences. |

The remote process does not mount these plugins, so even a mistaken allowlist
entry for most of them fails startup as an unknown tool. That is intentional
defence in depth.

## Authentication and credentials

The server supports two credential models:

### Single-token shorthand (`ZOVELI_REMOTE_MCP_TOKEN`)

One bearer token for all clients. Required for non-loopback binds. Minimum
strength: **32 characters**. Tokens shorter than 32 characters cause startup
to fail closed.

### Multi-credential file (`ZOVELI_REMOTE_MCP_CREDENTIALS_FILE`)

A JSON file with named credentials, each with its own token, rate limit
(requests per minute), and burst allowance. Takes precedence over the single
token. Each credential gets an independent token bucket and usage record, so
one client's consumption can never bleed into another's.

Credentials file format:

```json
[
  {
    "name": "alice",
    "token": "alice-token-0123456789abcdef0123456789",
    "requestsPerMinute": 60,
    "burst": 10
  },
  {
    "name": "bob",
    "token": "bob-token-0123456789abcdef0123456789",
    "requestsPerMinute": 120,
    "burst": 20
  }
]
```

Auth is enforced on every request. Unauthorized requests get `401` with a
`WWW-Authenticate: Bearer` header and never reach a tool. Tokens are never
accepted in URLs and are never logged.

## Rate limiting

Each credential has an independent token bucket:

- `requestsPerMinute`: sustained rate (default 60)
- `burst`: maximum burst above the sustained rate (default 10)

Rate-limited requests get `429 Too Many Requests`. One credential being rate
limited does not affect another.

## Origin validation

Origin validation is enforced on every incoming connection to prevent DNS
rebinding attacks:

- **Local mode** (loopback bind, default): allow absent Origin; allow
  loopback origins; reject non-loopback same-origin requests.
- **Remote mode** (non-loopback bind): allow same-origin plus configured
  origins (`ZOVELI_REMOTE_MCP_ORIGINS`); reject `Origin: null`.

Invalid present Origins get `403 Forbidden`.

## Configuration

The allowlist is resolved once at startup and cannot be changed by a request.
Precedence:

1. `ZOVELI_REMOTE_MCP_ALLOWLIST_FILE` — path to a JSON file.
2. `ZOVELI_REMOTE_MCP_ALLOWED_TOOLS` — comma-separated tool ids.
3. The built-in safe default (the 16 math tools above).

The file may be a JSON array or an object with an `allowedTools` array.
[`config/remote-mcp.allowlist.example.json`](../../config/remote-mcp.allowlist.example.json)
is a complete copy of the default. Keep the edited file outside the repository
or in a deployment secret/config volume.

Unknown ids fail closed with a message such as:

```
Remote MCP configuration error: unknown tool id(s) in ZOVELI_REMOTE_MCP_ALLOWED_TOOLS: mathcore_typo.
No tools will be exposed. Available tool id(s): ...
```

An empty allowlist or an unreadable file is also a startup error. Wildcards are
not supported; list each id explicitly.

## Running the server

```bash
pnpm build
node scripts/remote-mcp-server.mjs
# or: pnpm remote:mcp:start
```

Environment:

| Variable | Default | Meaning |
| --- | --- | --- |
| `ZOVELI_REMOTE_MCP_HOST` | `127.0.0.1` | Bind address. |
| `ZOVELI_REMOTE_MCP_PORT` | `8790` (or `PORT`) | Listen port. |
| `ZOVELI_REMOTE_MCP_TOKEN` | unset | Bearer token shorthand. Required for non-loopback binds; minimum 32 characters. |
| `ZOVELI_REMOTE_MCP_CREDENTIALS_FILE` | unset | JSON file with named credentials (takes precedence over token). |
| `ZOVELI_REMOTE_MCP_ORIGINS` | unset | Comma-separated allowed origins (remote binds). |
| `ZOVELI_REMOTE_MCP_RATE_LIMIT_RPM` | `60` | Requests per minute per credential. |
| `ZOVELI_REMOTE_MCP_RATE_LIMIT_BURST` | `10` | Burst allowance per credential. |
| `ZOVELI_REMOTE_MCP_ALLOWED_TOOLS` | unset | Comma-separated allowlist. |
| `ZOVELI_REMOTE_MCP_ALLOWLIST_FILE` | unset | JSON allowlist file. |
| `ZOVELI_MATH_MEMORIZE` | `0` in the remote process | Set `1` only for intentional single-tenant proof memory. |

A non-loopback bind without credentials is refused. The token is checked before
the body is read; unauthorized requests get `401` and never reach a tool.

Smoke test (legacy era):

```bash
curl -s http://127.0.0.1:8790/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26"}}'

curl -s http://127.0.0.1:8790/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'

curl -s http://127.0.0.1:8790/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"mathcore_compute","arguments":{"expression":"2+2"}}}'
```

Smoke test (modern era):

```bash
curl -s http://127.0.0.1:8790/mcp \
  -H 'content-type: application/json' \
  -H 'MCP-Protocol-Version: 2026-07-28' \
  -H 'Mcp-Method: server/discover' \
  -d '{"jsonrpc":"2.0","id":1,"method":"server/discover","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}}}'
```

A direct call to an omitted tool returns JSON-RPC error `-32602` with
`Tool not allowlisted: <id>`; it is also absent from `tools/list`.

## What is sent to the hosted service

When a client uses the **remote** endpoint, the hosted service receives:

- the MCP handshake (`initialize`) and `tools/list`, or `server/discover`
  (modern era);
- the allowlisted tool id, its arguments, and the tool result;
- normal HTTP metadata (source IP, headers, timing) handled by the deployment.

The **desktop app does not use this server**. Desktop chat and tool calls stay
on `127.0.0.1`: `/api/chat` and `/api/run` execute in the local process, and
the stdio bridge only talks to the loopback desktop URL. No vault, memory,
sysinfo or credential data is sent to the remote server because those plugins
are not mounted there and are not in the default allowlist.

## Before public exposure

This implementation is intentionally a safe starting point, not a finished
public service. Before exposing it:

1. Put TLS in front of it (reverse proxy or platform ingress); do not serve
   bearer tokens over plain HTTP.
2. Use a managed secret for `ZOVELI_REMOTE_MCP_TOKEN` or a credentials file;
   rotate it and add per-client credentials/rate limits.
3. Use per-credential rate limits (built in) and add concurrency limits if
   needed (the desktop rate limiter is not part of this server).
4. Decide on tenant isolation: the current server is stateless but shares one
   mathcore process/audit log. Do not enable `ZOVELI_MATH_MEMORIZE=1` for
   multiple tenants.
5. Add observability for allowlist denials, auth failures and mathcore errors
   without logging request bodies or secrets.
6. Review network egress/firewall rules for the mathcore child process.
7. **Authentication model**: Static bearer tokens are suitable for trusted or
   programmatic clients. Per-user OAuth is required before paid multi-tenant
   access; OAuth is not implemented in this release. See
   [Client-auth limitations](#client-auth-limitations).
8. Decide whether to support server-initiated SSE (`GET /mcp`) if a target MCP
   client requires it; this server currently returns `405`.

## Client-auth limitations

Static bearer tokens authenticate the *client*, not the *end user*. They are
appropriate for:

- Trusted programmatic clients (scripts, internal services)
- Single-tenant deployments where one token represents one organization

They are **not** appropriate for:

- Per-user authorization in multi-tenant SaaS
- Paid access where different users need different entitlements
- Scenarios requiring revocation per user without rotating a shared secret

Before offering paid or multi-tenant remote MCP access, implement OAuth
(per-user authorization) on top of this server. The MCP specification's
[Authorization framework](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization.md)
describes the OAuth 2.0-based flow for HTTP-based transports. Claude custom
connectors and OpenAI Responses API both support OAuth access tokens for
remote MCP; static shared headers are only suitable for trusted/programmatic
clients on Team/Enterprise plans.
