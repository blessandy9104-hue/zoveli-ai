# Zoveli Remote MCP Server — Security Audit Report

**Version:** v0.1.3 (release untouched; all changes uncommitted)
**Date:** 2026-11-06
**Scope:** `packages/host/src/remote-mcp/`, `scripts/remote-mcp-server.mjs`, `docs/guides/remote-mcp.md`, `packages/config-audit/src/registry.ts`
**Status:** Hardening complete; ready for staging review. Do not deploy.

---

## 1. Summary

The remote MCP server previously implemented only the 2025-06-18-era Streamable HTTP
handshake with no origin validation, no strict header checks, a single shared
token with a 16-character minimum, no rate limiting, and no usage accounting.
This audit hardened it for potential public exposure by adding dual-era protocol
support (2026-07-28 modern + legacy), strict header/origin/auth validation,
per-credential rate limits and usage accounting, and a 32-character minimum
token strength. The local stdio MCP server and desktop behavior are unchanged.

---

## 2. Findings (pre-hardening)

| # | Finding | Severity | Location |
|---|---------|----------|----------|
| F1 | No `Origin` header validation — DNS rebinding possible | High | `server.ts` |
| F2 | No strict `Accept` / `Content-Type` enforcement | Medium | `server.ts` |
| F3 | No `MCP-Protocol-Version` / `Mcp-Method` / `Mcp-Name` header validation | Medium | `server.ts` |
| F4 | No `_meta` protocol version / client capabilities validation | Medium | `server.ts` |
| F5 | No `server/discover` endpoint (required by 2026-07-28) | High | `server.ts` |
| F6 | No modern result envelopes (`resultType`, `ttlMs`, `cacheScope`) | High | `server.ts` |
| F7 | Single shared bearer token; no per-credential isolation | High | `server.ts`, `remote-mcp-server.mjs` |
| F8 | No per-credential rate limits or usage accounting | High | `server.ts` |
| F9 | Token minimum 16 characters (weak) | Medium | `remote-mcp-server.mjs`, `registry.ts` |
| F10 | Tokens could be accepted in URLs | Medium | `server.ts` |
| F11 | No `WWW-Authenticate` header on 401 responses | Low | `server.ts` |
| F12 | Batch requests accepted without era distinction | Low | `server.ts` |
| F13 | UTF-8 chunk-splitting bug in `readBody` | Low | `server.ts` |
| F14 | Not compliant with 2026-07-28 Streamable HTTP spec | High | `server.ts` |

---

## 3. Fixes implemented

### 3.1 New modules

- **`packages/host/src/remote-mcp/credentials.ts`** — Multi-credential support with
  `CredentialManager`, per-credential `TokenBucket` rate limiting, in-memory
  usage records, 32-character minimum token strength, credentials-file option
  (`ZOVELI_REMOTE_MCP_CREDENTIALS_FILE`), duplicate token/name detection,
  fail-closed on weak or duplicate config.

- **`packages/host/src/remote-mcp/origin.ts`** — Origin validation per the MCP
  Streamable HTTP spec: reject `Origin: null`, allow absent Origin, allow
  loopback origins in local mode, allow same-origin + configured origins in
  remote mode, reject non-loopback same-origin on loopback binds (DNS rebinding
  protection).

- **`packages/host/src/remote-mcp/usage.ts`** — `aggregateUsage()` helper for
  per-credential usage snapshots (no tokens exposed).

### 3.2 Rewritten `server.ts` — dual-era transport

**Modern era (2026-07-28):**
- `server/discover` implemented with `resultType: "complete"`, `ttlMs`,
  `cacheScope`, `supportedVersions`, `capabilities`, `_meta.serverInfo`.
- Per-request `_meta` validation: `protocolVersion` and `clientCapabilities`
  required; `-32602` / HTTP 400 when missing.
- Header validation: `MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name` (tools/call)
  must match body values; `-32020` `HeaderMismatch` / HTTP 400 on mismatch.
- Unsupported protocol version → `-32022` / HTTP 400 with `supported` list.
- Unknown modern method → `-32601` / HTTP 404 (distinct from legacy HTTP 200).
- Modern results use `resultType: "complete"` envelope with `ttlMs`, `cacheScope`,
  `_meta.serverInfo`.
- No `initialize`, no sessions, no GET SSE stream.

**Legacy era (2025-03-26 / 2025-06-18 / 2025-11-25):**
- `initialize` handshake preserved; `ping`, `tools/list`, `tools/call` unchanged.
- GET returns `405 Allow: POST`.
- Batch requests allowed in legacy era only (modern spec requires single message).

**Security (both eras):**
- Origin validation on every request (`403` for invalid present Origin).
- Bearer token auth on every request (`401` + `WWW-Authenticate: Bearer`).
- Tokens never accepted in URLs; never logged.
- Per-credential rate limits (`429` when exhausted) with independent buckets.
- Batch rejected in modern era (`400`).

### 3.3 Launcher (`scripts/remote-mcp-server.mjs`)

- Credentials file support via `resolveCredentials()`.
- `ZOVELI_REMOTE_MCP_ORIGINS` for remote-mode origin allowlists.
- `ZOVELI_REMOTE_MCP_RATE_LIMIT_RPM` / `ZOVELI_REMOTE_MCP_RATE_LIMIT_BURST`.
- Token minimum raised to 32 characters (`MIN_TOKEN_LENGTH`).
- Safe logging: credential count and source only; no token values.
- Non-loopback bind requires credentials (fails closed).
- `ZOVELI_MATH_MEMORIZE=0` default preserved.

### 3.4 Package.json

- Added `@modelcontextprotocol/sdk@1.32.2` (legacy v1) and
  `@modelcontextprotocol/client@2.4.0` (v2 modern/dual-era) as devDependencies
  for real-client integration tests.

### 3.5 Tests

- **`tests/unit/remote-mcp.test.ts`** — 18 existing unit tests (all pass).
- **`tests/integration/remote-mcp-integration.test.ts`** — 37 new tests:
  - Legacy v1 SDK client (`@modelcontextprotocol/sdk` 1.32.2): initialize
    handshake, tools/list, tools/call, non-allowlisted rejection.
  - Modern v2 SDK client (`@modelcontextprotocol/client` 2.4.0): legacy
    negotiation and pinned `2026-07-28` with `server/discover` probe.
  - Modern result envelopes: `resultType`, `ttlMs`, `cacheScope`, `_meta.serverInfo`.
  - Header validation: `HeaderMismatch` `-32020` for missing/mismatched headers.
  - Protocol errors: `-32022` unsupported version, `-32601` unknown method (404),
    `initialize` in modern era (404).
  - Authentication: 401 + `WWW-Authenticate`, wrong token, token-in-URL rejected,
    multi-credential independence.
  - Origin validation: `Origin: null` → 403, non-loopback → 403, absent → allowed.
  - Malformed requests: invalid JSON (-32700), non-object, missing method.
  - Concurrency: independent credentials, isolated results.
  - Rate limits: per-credential blocking, cross-credential isolation.
  - Usage snapshots: no tokens exposed.

### 3.6 Documentation

- `docs/guides/remote-mcp.md` — Expanded with dual-era protocol details, header
  reference, authentication models, credentials file format, rate limiting,
  origin validation, and client-auth limitations (static bearer vs OAuth).
- `packages/config-audit/src/registry.ts` — Added registry entries for
  `ZOVELI_REMOTE_MCP_CREDENTIALS_FILE`, `ZOVELI_REMOTE_MCP_ORIGINS`,
  `ZOVELI_REMOTE_MCP_RATE_LIMIT_RPM`, `ZOVELI_REMOTE_MCP_RATE_LIMIT_BURST`;
  raised `ZOVELI_REMOTE_MCP_TOKEN` `minLength` from 16 to 32.

---

## 4. Verification results

| Check | Result |
|---|---|
| `pnpm test` | 490 tests passed, 52 files |
| `pnpm typecheck` | Passed |
| `pnpm lint` | 0 warnings, 0 errors |
| `pnpm build` | Passed |
| `pnpm release:check` | ok (v0.1.3, 24 workspace packages) |
| `pnpm plugin:check` | ok (22 packages, 30 plugins, 63 unique tools, 0 warnings) |

Real-client verification:
- v1 SDK `@modelcontextprotocol/sdk@1.32.2` → legacy `initialize` handshake, tools/list, tools/call ✅
- v2 SDK `@modelcontextprotocol/client@2.4.0` → legacy negotiation ✅
- v2 SDK pinned `2026-07-28` → `server/discover` probe, modern era ✅

---

## 5. Remaining risks

| # | Risk | Mitigation | Owner |
|---|------|------------|-------|
| R1 | No OAuth / per-user authorization | Static bearer tokens authenticate the client, not the end user. Not suitable for paid multi-tenant access. Documented in docs; OAuth required before paid access. | Product |
| R2 | Single mathcore process shared across credentials | No tenant isolation at the mathcore level. `ZOVELI_MATH_MEMORIZE=1` must not be enabled for multiple tenants. Documented. | Operations |
| R3 | In-memory usage records reset on restart | Usage accounting is ephemeral. No persistent audit log of per-credential usage. | Future |
| R4 | No TLS at the MCP server layer | Must be fronted by TLS (reverse proxy/ingress). Tokens must not travel over plain HTTP. Documented. | Operations |
| R5 | No observability / metrics emission | Allowlist denials, auth failures, and mathcore errors are not emitted as metrics. Documented as a pre-exposure step. | Future |
| R6 | v1 SDK package has broken `.` export | `@modelcontextprotocol/sdk@1.32.2` exports `./client` subpath but `.` points to missing `dist/esm/index.js`. Tests use subpath imports. Workaround documented in test file. | Build |
| R7 | `server/discover` lists all supported versions (incl. legacy) | May help clients probe legacy support. Not a vulnerability but reduces version obfuscation. | Accepted |

---

## 6. Staging-only checklist

Before deploying to staging (not production):

- [ ] Put TLS in front of the MCP server (reverse proxy or platform ingress). Do not serve bearer tokens over plain HTTP.
- [ ] Generate a strong bearer token (32+ characters) or create a credentials file with named credentials.
- [ ] Set `ZOVELI_REMOTE_MCP_TOKEN` or `ZOVELI_REMOTE_MCP_CREDENTIALS_FILE` in the staging environment.
- [ ] For non-loopback binds, ensure credentials are configured (startup refuses otherwise).
- [ ] Set `ZOVELI_REMOTE_MCP_ORIGINS` for remote/public binds to the expected client origins.
- [ ] Tune `ZOVELI_REMOTE_MCP_RATE_LIMIT_RPM` and `ZOVELI_REMOTE_MCP_RATE_LIMIT_BURST` for expected load.
- [ ] Keep `ZOVELI_MATH_MEMORIZE=0` (default) unless single-tenant proof memory is explicitly wanted.
- [ ] Verify `pnpm build` has been run (dist/ is gitignored).
- [ ] Run `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm release:check`, `pnpm plugin:check` — all green.
- [ ] Verify a real MCP client can connect, discover the 16 allowlisted tools, and call a tool successfully (covered by integration tests).
- [ ] Review `docs/guides/remote-mcp.md` "Before public exposure" and "Client-auth limitations" sections.
- [ ] Decide on OAuth before any paid or multi-tenant exposure. Static bearer tokens are not sufficient for per-user authorization.
- [ ] Do NOT create release tags, alter release assets, or modify the `v0.1.3` release folder.
- [ ] Do NOT deploy to production from this branch. All changes remain uncommitted pending explicit authorization.

---

## 7. Files changed

| File | Action |
|---|---|
| `packages/host/src/remote-mcp/server.ts` | Rewritten: dual-era support, header/origin/auth/rate-limit integration |
| `packages/host/src/remote-mcp/credentials.ts` | New: multi-credential, token buckets, usage records |
| `packages/host/src/remote-mcp/origin.ts` | New: Origin validation (DNS rebinding protection) |
| `packages/host/src/remote-mcp/usage.ts` | New: usage snapshot aggregation |
| `packages/host/src/remote-mcp/index.ts` | Updated: exports new modules |
| `scripts/remote-mcp-server.mjs` | Updated: credentials files, origins, rate limits, 32-char token, safe logging |
| `tests/unit/remote-mcp.test.ts` | Unchanged (18 existing tests, all pass) |
| `tests/integration/remote-mcp-integration.test.ts` | New: 37 integration tests |
| `docs/guides/remote-mcp.md` | Expanded: dual-era, auth, rate limits, client-auth limitations |
| `packages/config-audit/src/registry.ts` | Added 5 new env entries; raised token minLength to 32 |
| `package.json` | Added `@modelcontextprotocol/sdk@1.32.2` and `@modelcontextprotocol/client@2.4.0` devDependencies |

---

## 8. Conclusion

The remote MCP server has been hardened from a minimal 2025-era prototype to a
dual-era (2026-07-28 modern + legacy) implementation with strict header,
origin, authentication, and rate-limit enforcement. All 490 tests pass, typecheck
and lint are clean, and release/plugin checks are green. The server is ready for
staging review but must **not** be deployed to production, and the `v0.1.3`
release must remain untouched, pending explicit authorization.

Per-user OAuth is required before any paid or multi-tenant exposure; static
bearer tokens are suitable only for trusted or programmatic clients.
