import type * as http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { sessionEmailFromCookie } from '@zoveli/auth';

/**
 * Localhost web hardening. The server binds 127.0.0.1, but binding alone
 * does not stop DNS-rebinding pages or curious LAN processes that reach the
 * port — so every response carries hardening headers, non-loopback Host
 * headers are rejected, and optional bearer + rate limits guard the
 * tool-running and auth endpoints.
 */

export const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'same-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

/** Merge hardening headers into an outgoing header set. */
export function withSecurityHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { ...SECURITY_HEADERS, ...extra };
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '::ffff:127.0.0.1']);

/** Extra allowed Hosts from `ZOVELI_ALLOWED_HOSTS` (comma-separated, no port). */
export function extraAllowedHosts(): string[] {
  return (process.env.ZOVELI_ALLOWED_HOSTS || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

/** Reject DNS-rebinding and LAN Host headers; allow loopback + configured. */
export function isHostAllowed(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  const host = hostHeader.split(':')[0].trim().toLowerCase().replace(/^\[(.*)\]$/, '$1');
  if (LOOPBACK_HOSTS.has(host)) return true;
  return extraAllowedHosts().includes(host);
}

/** Sliding-window per-key rate limiter (in-memory, single process). */
export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number
  ) {}

  allow(key: string, now = Date.now()): boolean {
    const cutoff = now - this.windowMs;
    const recent = (this.hits.get(key) || []).filter((t) => t > cutoff);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    // Bound memory: drop idle keys opportunistically.
    if (this.hits.size > 10000) {
      for (const [k, v] of this.hits) {
        if (v.length === 0 || v[v.length - 1] <= cutoff) this.hits.delete(k);
      }
    }
    return true;
  }
}

function bearerConfigured(): boolean {
  return (process.env.ZOVELI_API_TOKEN || '').length >= 16;
}

function bearerMatches(req: http.IncomingMessage): boolean {
  const expected = process.env.ZOVELI_API_TOKEN || '';
  const got = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

/**
 * Optional bearer gate for tool-running routes. Off by default (preserves
 * no-account local UX); set `ZOVELI_API_TOKEN` (min 16 chars) to require
 * `Authorization: Bearer <token>` on POST /api/run and /api/chat.
 */
export function bearerAuthorized(req: http.IncomingMessage): boolean {
  if (!bearerConfigured()) return true;
  return bearerMatches(req);
}

/** True when `ZOVELI_AUTH_REQUIRED` asks the desktop UI/API to require login. */
export function authRequired(): boolean {
  return (process.env.ZOVELI_AUTH_REQUIRED || '').trim() === '1';
}

/**
 * Gate for chat/run. A configured bearer token wins; otherwise, when login
 * is required, a valid session cookie is mandatory. Default localhost use
 * stays account-free.
 */
export function apiRequestAuthorized(req: http.IncomingMessage): boolean {
  if (bearerConfigured()) return bearerMatches(req);
  if (authRequired()) return Boolean(sessionEmailFromCookie(req.headers.cookie));
  return true;
}

/** Cap for a single chat message (LLM-cost and memory bound). */
export const MAX_MESSAGE_LEN = 50_000;

/** Parse + validate POST /api/chat bodies. Throws with a client message. */
export function parseChatMessage(body: unknown): string {
  const message = String((body as Record<string, unknown> | null)?.message ?? '').trim();
  if (!message) throw new Error('missing message');
  if (message.length > MAX_MESSAGE_LEN) {
    throw new Error(`message too long (max ${MAX_MESSAGE_LEN} chars)`);
  }
  return message;
}

/** Parse + validate POST /api/run bodies. Throws with a client message. */
export function parseRunCall(body: unknown): { tool: string; args: Record<string, unknown> } {
  const tool = (body as Record<string, unknown> | null)?.tool;
  if (typeof tool !== 'string' || !tool) throw new Error('missing tool');
  const rawArgs = (body as Record<string, unknown>)?.args ?? {};
  if (typeof rawArgs !== 'object' || rawArgs === null || Array.isArray(rawArgs)) {
    throw new Error('args must be an object');
  }
  return { tool, args: rawArgs as Record<string, unknown> };
}

/** True when the request arrived over TLS directly or via a trusted proxy. */
export function isTlsRequest(req: http.IncomingMessage): boolean {
  const forwarded = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  const encrypted = (req.socket as { encrypted?: boolean } | undefined)?.encrypted === true;
  return encrypted || forwarded === 'https';
}

/**
 * HSTS value when the request arrived over TLS. Plain-localhost responses
 * omit it — pinning HSTS on http://127.0.0.1 would be wrong.
 */
export function hstsForRequest(req: http.IncomingMessage): Record<string, string> {
  if (isTlsRequest(req)) {
    return { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' };
  }
  return {};
}
