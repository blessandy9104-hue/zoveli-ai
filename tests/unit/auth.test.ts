import { describe, it, expect } from 'vitest';
import { zoveliAuth } from '../../packages/auth/src/index';
import { issueCode, verifyCode } from '../../packages/auth/src/otp';
import {
  mintSession, verifySession, sessionEmailFromCookie, sessionCookie, COOKIE_NAME,
} from '../../packages/auth/src/session';
import { createMockContext } from '../setup';

const uniq = (tag: string) => `${tag}+${Date.now()}-${Math.random().toString(36).slice(2)}@proton.me`;

describe('zoveli auth plugin', () => {
  it('registers auth tools', () => {
    const ctx = createMockContext();
    zoveliAuth.setup(ctx);
    const call = ctx.register.mock.calls.find((c: any[]) => c[0] === 'auth-tools');
    expect(call).toBeDefined();
    const names = call[1].map((t: any) => t.name);
    expect(names).toContain('auth_request_code');
    expect(names).toContain('auth_verify_code');
  });

  it('provides auth api', () => {
    const ctx = createMockContext();
    zoveliAuth.setup(ctx);
    expect(ctx.provide).toHaveBeenCalledWith('auth', expect.any(Object));
  });
});

describe('email OTP (proton.me compatible)', () => {
  it('issues and verifies a code', () => {
    const email = uniq('roundtrip');
    const { code, email: back } = issueCode(email);
    expect(back).toBe(email);
    expect(code).toMatch(/^\d{6}$/);
    expect(verifyCode(email, code)).toEqual({ ok: true, email });
  });

  it('rejects wrong codes and locks after 5 attempts', () => {
    const email = uniq('lockout');
    const { code } = issueCode(email);
    const wrong = code === '000000' ? '000001' : '000000';
    for (let i = 0; i < 4; i++) {
      expect(verifyCode(email, wrong)).toEqual({ ok: false, reason: 'wrong-code' });
    }
    expect(verifyCode(email, wrong)).toEqual({ ok: false, reason: 'locked' });
    // even the right code no longer works after lockout
    expect(verifyCode(email, code).ok).toBe(false);
  });

  it('rejects unknown emails and bad input', () => {
    expect(verifyCode(uniq('ghost'), '123456')).toEqual({ ok: false, reason: 'no-code' });
    expect(verifyCode('not-an-email', '123456')).toEqual({ ok: false, reason: 'no-code' });
    expect(() => issueCode('not-an-email')).toThrow('invalid email');
  });

  it('skips per-email request throttling in dev echo mode', () => {
    const previous = process.env.ZOVELI_AUTH_DEV_ECHO;
    process.env.ZOVELI_AUTH_DEV_ECHO = '1';
    try {
      const email = uniq('devecho');
      for (let i = 0; i < 6; i++) {
        expect(() => issueCode(email)).not.toThrow();
      }
    } finally {
      if (previous === undefined) delete process.env.ZOVELI_AUTH_DEV_ECHO;
      else process.env.ZOVELI_AUTH_DEV_ECHO = previous;
    }
  });

  it('codes are single-use', () => {
    const email = uniq('singleuse');
    const { code } = issueCode(email);
    expect(verifyCode(email, code).ok).toBe(true);
    expect(verifyCode(email, code)).toEqual({ ok: false, reason: 'no-code' });
  });
});

describe('sessions', () => {
  it('mints and verifies tokens', () => {
    const token = mintSession('user@proton.me');
    expect(verifySession(token)).toBe('user@proton.me');
  });

  it('rejects tampered and malformed tokens', () => {
    const token = mintSession('user@proton.me');
    const [body] = token.split('.');
    expect(verifySession(`${body}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`)).toBeNull();
    expect(verifySession('garbage')).toBeNull();
    expect(verifySession('')).toBeNull();
  });

  it('reads email from cookie header', () => {
    const token = mintSession('user@proton.me');
    expect(sessionEmailFromCookie(`${COOKIE_NAME}=${encodeURIComponent(token)}`)).toBe(
      'user@proton.me'
    );
    expect(sessionEmailFromCookie(undefined)).toBeNull();
    expect(sessionEmailFromCookie('other=1')).toBeNull();
    expect(sessionEmailFromCookie(`${COOKIE_NAME}=%E0%A4%A`)).toBeNull();
  });

  it('adds Secure only when the server serves TLS', () => {
    const token = mintSession('user@proton.me');
    expect(sessionCookie(token)).not.toContain('Secure');
    expect(sessionCookie(token, true)).toContain('Secure');
  });
});


