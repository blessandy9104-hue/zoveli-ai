import { randomInt, createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';

export interface OtpRecord {
  email: string;
  codeHash: string;
  expiresAt: number;
  attemptsLeft: number;
  requestedAt: number;
}

interface AuthStore {
  codes: Record<string, OtpRecord>;
  requests: Record<string, number[]>;
}

export const CODE_TTL_MS = 10 * 60 * 1000;
const CODE_LENGTH = 6;
const MAX_ATTEMPTS = 5;
const MAX_REQUESTS_PER_HOUR = 5;

function storePath(): string {
  const dir =
    process.env.ZOVELI_AUTH_DIR || join(homedir(), '.zoveli');
  try {
    mkdirSync(dir, { recursive: true });
    return join(dir, 'auth.json');
  } catch {
    return join(tmpdir(), 'zoveli-auth.json');
  }
}

function loadStore(): AuthStore {
  try {
    const raw = readFileSync(storePath(), 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return { codes: parsed.codes ?? {}, requests: parsed.requests ?? {} };
    }
  } catch {
    // missing or corrupt store starts empty
  }
  return { codes: {}, requests: {} };
}

function saveStore(store: AuthStore): void {
  try {
    writeFileSync(storePath(), JSON.stringify(store), 'utf-8');
  } catch {
    // best effort: auth still works in-memory for this process run
  }
}

export function normalizeEmail(email: string): string {
  const clean = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
    throw new Error('invalid email address');
  }
  return clean;
}

function hashCode(email: string, code: string): string {
  return createHash('sha256').update(`${email}:${code}`).digest('hex');
}

/**
 * Issue a one-time code. Returns the code (caller delivers it) plus
 * whether email delivery is configured.
 */
export function issueCode(rawEmail: string): { email: string; code: string } {
  const email = normalizeEmail(rawEmail);
  const now = Date.now();
  const store = loadStore();
  const recent = (store.requests[email] ?? []).filter((t) => now - t < 3600_000);
  if (process.env.ZOVELI_AUTH_DEV_ECHO !== '1' && recent.length >= MAX_REQUESTS_PER_HOUR) {
    throw new Error('too many codes requested; try again later');
  }
  recent.push(now);
  store.requests[email] = recent;
  const code = String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0');
  store.codes[email] = {
    email,
    codeHash: hashCode(email, code),
    expiresAt: now + CODE_TTL_MS,
    attemptsLeft: MAX_ATTEMPTS,
    requestedAt: now,
  };
  saveStore(store);
  return { email, code };
}

export type VerifyResult =
  | { ok: true; email: string }
  | { ok: false; reason: 'expired' | 'wrong-code' | 'no-code' | 'locked' };

/** Verify a code with constant-time comparison. Consumes the code on success. */
export function verifyCode(rawEmail: string, code: string): VerifyResult {
  let email: string;
  try {
    email = normalizeEmail(rawEmail);
  } catch {
    return { ok: false, reason: 'no-code' };
  }
  const store = loadStore();
  const rec = store.codes[email];
  if (!rec) return { ok: false, reason: 'no-code' };
  if (Date.now() > rec.expiresAt) {
    delete store.codes[email];
    saveStore(store);
    return { ok: false, reason: 'expired' };
  }
  if (rec.attemptsLeft <= 0) {
    delete store.codes[email];
    saveStore(store);
    return { ok: false, reason: 'locked' };
  }
  const candidate = hashCode(email, code.trim());
  const a = Buffer.from(candidate);
  const b = Buffer.from(rec.codeHash);
  const match = a.length === b.length && timingSafeEqual(a, b);
  if (!match) {
    rec.attemptsLeft -= 1;
    saveStore(store);
    return { ok: false, reason: rec.attemptsLeft <= 0 ? 'locked' : 'wrong-code' };
  }
  delete store.codes[email];
  saveStore(store);
  return { ok: true, email };
}



