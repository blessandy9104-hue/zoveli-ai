import { readFileSync } from 'node:fs';

/**
 * Multi-credential support for the remote MCP server.
 *
 * The server accepts either a single shorthand bearer token
 * (`ZOVELI_REMOTE_MCP_TOKEN`) or a named credentials file
 * (`ZOVELI_REMOTE_MCP_CREDENTIALS_FILE`). Each credential gets its own
 * token bucket for rate limiting and its own in-memory usage record, so one
 * client's consumption can never bleed into another's.
 *
 * Minimum token strength is 32 characters; shorter tokens are rejected at
 * startup so weak configuration fails closed instead of deploying silently.
 */

export const CREDENTIALS_FILE_ENV = 'ZOVELI_REMOTE_MCP_CREDENTIALS_FILE';
export const TOKEN_ENV = 'ZOVELI_REMOTE_MCP_TOKEN';

export const MIN_TOKEN_LENGTH = 32;
export const DEFAULT_REQUESTS_PER_MINUTE = 60;
export const DEFAULT_BURST = 10;

export interface Credential {
  /** Human-readable name for the credential (used in logs/metrics only). */
  name: string;
  /** Bearer token value. Never logged or echoed in responses. */
  token: string;
  /** Requests allowed per minute (sustained rate). */
  requestsPerMinute: number;
  /** Maximum burst above the sustained rate. */
  burst: number;
}

export interface UsageSnapshot {
  name: string;
  requests: number;
  blockedRequests: number;
  lastRequestAt: string | null;
}

class TokenBucket {
  private tokens: number;
  private lastRefill = Date.now();

  constructor(private ratePerMinute: number, private burst: number) {
    this.tokens = burst;
    this.lastRefill = Date.now();
  }

  /** Try to consume one token. Returns true if allowed, false if rate-limited. */
  tryConsume(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  private refill(): void {
    const now = Date.now();
    const elapsedMs = now - this.lastRefill;
    if (elapsedMs <= 0) return;
    const refill = (this.ratePerMinute / 60000) * elapsedMs;
    this.tokens = Math.min(this.burst, this.tokens + refill);
    this.lastRefill = now;
  }
}

interface CredentialState {
  credential: Credential;
  bucket: TokenBucket;
  usage: {
    requests: number;
    blockedRequests: number;
    lastRequestAt: string | null;
  };
}

/**
 * Parse the credentials file. Each entry may use `requestsPerMinute` and
 * `burst` overrides; missing values fall back to the defaults above.
 */
function parseCredentialsFile(text: string, label: string): Credential[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON array of credential objects.`);
  }
  const out: Credential[] = [];
  const seenNames = new Set<string>();
  const seenTokens = new Set<string>();
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`${label} entries must be objects.`);
    }
    const name = (entry as { name?: unknown }).name;
    const token = (entry as { token?: unknown }).token;
    if (typeof name !== 'string' || !name) {
      throw new Error(`${label} entry missing a non-empty "name" string.`);
    }
    if (typeof token !== 'string' || !token) {
      throw new Error(`${label} entry "${name}" missing a non-empty "token" string.`);
    }
    if (token.length < MIN_TOKEN_LENGTH) {
      throw new Error(
        `${label} entry "${name}" has a token shorter than ${MIN_TOKEN_LENGTH} characters. ` +
          'Use a stronger secret (32+ characters).',
      );
    }
    if (seenNames.has(name)) {
      throw new Error(`${label} contains duplicate credential name "${name}".`);
    }
    if (seenTokens.has(token)) {
      throw new Error(`${label} contains duplicate token values; each credential must be unique.`);
    }
    seenNames.add(name);
    seenTokens.add(token);
    const rpmRaw = (entry as { requestsPerMinute?: unknown }).requestsPerMinute;
    const burstRaw = (entry as { burst?: unknown }).burst;
    const requestsPerMinute =
      typeof rpmRaw === 'number' && Number.isFinite(rpmRaw) && rpmRaw > 0
        ? rpmRaw
        : DEFAULT_REQUESTS_PER_MINUTE;
    const burst =
      typeof burstRaw === 'number' && Number.isFinite(burstRaw) && burstRaw > 0
        ? burstRaw
        : DEFAULT_BURST;
    out.push({ name, token, requestsPerMinute, burst });
  }
  if (out.length === 0) {
    throw new Error(`${label} is empty. Add at least one credential entry.`);
  }
  return out;
}

/**
 * Resolve credentials from file or the single-token shorthand. File takes
 * precedence. Throws on weak/duplicate config so the server fails closed.
 */
export function resolveCredentials(
  env: NodeJS.ProcessEnv,
  readFile: (path: string) => string = (path: string) => readFileSync(path, 'utf8'),
): Credential[] {
  const file = (env[CREDENTIALS_FILE_ENV] || '').trim();
  if (file) {
    const label = `${CREDENTIALS_FILE_ENV} (${file})`;
    let text: string;
    try {
      text = readFile(file);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`cannot read ${label}: ${message}`);
    }
    return parseCredentialsFile(text, label);
  }
  const token = (env[TOKEN_ENV] || '').trim();
  if (!token) return [];
  if (token.length < MIN_TOKEN_LENGTH) {
    throw new Error(
      `${TOKEN_ENV} is ${token.length} characters; the minimum is ${MIN_TOKEN_LENGTH}. ` +
        'Set a stronger bearer token (or bind to loopback only, where no token is required).',
    );
  }
  return [
    {
      name: 'default',
      token,
      requestsPerMinute: DEFAULT_REQUESTS_PER_MINUTE,
      burst: DEFAULT_BURST,
    },
  ];
}

/**
 * Manages per-credential token buckets and usage snapshots. Lookup is by the
 * raw bearer token; state lives in memory only and resets on restart.
 */
export class CredentialManager {
  private byToken = new Map<string, CredentialState>();

  constructor(credentials: readonly Credential[]) {
    for (const c of credentials) {
      this.byToken.set(c.token, {
        credential: c,
        bucket: new TokenBucket(c.requestsPerMinute, c.burst),
        usage: { requests: 0, blockedRequests: 0, lastRequestAt: null },
      });
    }
  }

  /** Return true if the token is known to this manager. */
  hasToken(token: string): boolean {
    return this.byToken.has(token);
  }

  /**
   * Authorize a bearer token against the configured credentials. Returns the
   * credential name on success, or null when the token is unknown/absent.
   * Never logs the token value.
   */
  authorize(token: string | undefined): string | null {
    if (!token) return null;
    const state = this.byToken.get(token);
    if (!state) return null;
    return state.credential.name;
  }

  /** Try to consume one rate-limit token for the named credential. */
  tryConsume(name: string): boolean {
    const state = this.stateFor(name);
    if (!state) return false;
    const allowed = state.bucket.tryConsume();
    state.usage.requests += 1;
    state.usage.lastRequestAt = new Date().toISOString();
    if (!allowed) {
      state.usage.blockedRequests += 1;
    }
    return allowed;
  }

  /** Take a read-only snapshot of per-credential usage (no tokens exposed). */
  snapshots(): UsageSnapshot[] {
    const out: UsageSnapshot[] = [];
    for (const [, state] of this.byToken) {
      out.push({
        name: state.credential.name,
        requests: state.usage.requests,
        blockedRequests: state.usage.blockedRequests,
        lastRequestAt: state.usage.lastRequestAt,
      });
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }

  private stateFor(name: string): CredentialState | undefined {
    for (const state of this.byToken.values()) {
      if (state.credential.name === name) return state;
    }
    return undefined;
  }
}
