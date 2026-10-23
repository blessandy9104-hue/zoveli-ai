import { definePlugin } from '@deepseek-ai/dsh-core';
import { issueCode, verifyCode, normalizeEmail } from './otp.js';
import { mintSession, verifySession } from './session.js';
import { deliverCode } from './deliver.js';

/**
 * zoveli-auth: passwordless email-OTP login.
 *
 * Why email codes instead of "Login with Proton": Proton offers no public
 * third-party OAuth — its SSO covers Proton's own apps only. Email codes
 * work with every inbox including @proton.me / @protonmail.com, store
 * nothing but a code hash, and need no partnership or API key.
 */
export const zoveliAuth = definePlugin({
  name: 'zoveli-auth',
  description: 'Passwordless email-OTP login (any inbox, incl. proton.me)',

  setup(ctx) {
    ctx.provide('auth', {
      issueCode,
      verifyCode,
      mintSession,
      verifySession,
      deliverCode,
    });

    ctx.register('auth-tools', [
      {
        name: 'auth_request_code',
        description: 'Send a login code to an email address (any provider incl. proton.me)',
        parameters: {
          type: 'object',
          properties: { email: { type: 'string' } },
          required: ['email'],
        },
        async execute({ email }: any) {
          const { code } = issueCode(email);
          const res = await deliverCode(email, code);
          return res.delivered
            ? { ok: true, emailed: true }
            : { ok: true, emailed: false, hint: 'dev mode: code printed to server console' };
        },
      },
      {
        name: 'auth_verify_code',
        description: 'Verify a login code and mint a session token',
        parameters: {
          type: 'object',
          properties: {
            email: { type: 'string' },
            code: { type: 'string' },
          },
          required: ['email', 'code'],
        },
        async execute({ email, code }: any) {
          const verdict = verifyCode(email, code);
          if (!verdict.ok) return verdict;
          return { ok: true, email: verdict.email, token: mintSession(verdict.email) };
        },
      },
    ]);
  },
});

export default zoveliAuth;
export { issueCode, verifyCode, normalizeEmail } from './otp.js';
export { mintSession, verifySession, sessionEmailFromCookie, sessionCookie, clearSessionCookie, COOKIE_NAME } from './session.js';
export { deliverCode } from './deliver.js';
