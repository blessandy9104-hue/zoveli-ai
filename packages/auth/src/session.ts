import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
export const COOKIE_NAME = 'zoveli_session';

interface SessionPayload {
  email: string;
  exp: number;
  nonce: string;
}

function secret(): string {
  if (process.env.ZOVELI_AUTH_SECRET && process.env.ZOVELI_AUTH_SECRET.length >= 16) {
    return process.env.ZOVELI_AUTH_SECRET;
  }
  // Persisted machine-local secret so sessions survive restarts.
  const dir = process.env.ZOVELI_AUTH_DIR || join(homedir(), '.zoveli');
  const file = join(dir, '.session-secret');
  try {
    return readFileSync(file, 'utf-8').trim();
  } catch {
    // fall through to generation
  }
  const fresh = randomBytes(32).toString('hex');
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, fresh, { mode: 0o600 });
  } catch {
    // best effort; sessions last for this process run
  }
  return fresh;
}

function b64url(data: string): string {
  return Buffer.from(data, 'utf-8').toString('base64url');
}

function unb64url(data: string): string {
  return Buffer.from(data, 'base64url').toString('utf-8');
}

/** Mint a signed session token for an email. */
export function mintSession(email: string, ttlMs = SESSION_TTL_MS): string {
  const payload: SessionPayload = {
    email,
    exp: Date.now() + ttlMs,
    nonce: randomBytes(8).toString('hex'),
  };
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

/** Verify a session token. Returns the email or null. */
export function verifySession(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  let expected: string;
  try {
    expected = createHmac('sha256', secret()).update(body).digest('base64url');
  } catch {
    return null;
  }
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let payload: SessionPayload;
  try {
    payload = JSON.parse(unb64url(body));
  } catch {
    return null;
  }
  if (!payload.email || typeof payload.exp !== 'number' || Date.now() > payload.exp) {
    return null;
  }
  return payload.email;
}

/** Parse the session email out of a Cookie header. */
export function sessionEmailFromCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader
    .split(';')
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${COOKIE_NAME}=`));
  if (!match) return null;
  let token: string;
  try {
    token = decodeURIComponent(match.slice(COOKIE_NAME.length + 1));
  } catch {
    return null;
  }
  return verifySession(token);
}

export function sessionCookie(token: string, secure = false): string {
  // 30 days, host-only, JS-inaccessible. The server sets Secure when the
  // request arrived over TLS; loopback HTTP keeps working without it.
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(
    SESSION_TTL_MS / 1000
  )}${secure ? '; Secure' : ''}`;
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}



