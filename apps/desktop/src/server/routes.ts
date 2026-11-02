import * as http from 'node:http';
import {
  chat,
  isLocalProvider,
  type ChatConfig,
  type ChatMessage,
  type ZoveliHost,
} from '@zoveli/host';
import {
  issueCode, verifyCode, mintSession, normalizeEmail,
  sessionEmailFromCookie, sessionCookie, clearSessionCookie,
  deliverCode,
} from '@zoveli/auth';
import { redactSecrets } from '@zoveli/secscan';
import { chatSetupReply } from './onboarding.js';
import { renderLoginPage } from './pages.js';
import {
  withSecurityHeaders,
  isHostAllowed,
  RateLimiter,
  apiRequestAuthorized,
  authRequired,
  parseChatMessage,
  parseRunCall,
  hstsForRequest,
  isTlsRequest,
} from './security.js';
import { ConversationHistoryStore, conversationKey } from './session-history.js';

export interface DesktopRequestOptions {
  host: ZoveliHost;
  chatCfg: ChatConfig | null;
  requestedModel: string;
  mathReady: boolean;
  homePage: string;
  baseSystem: string;
  lenisBundle: Buffer | null;
  origin: string;
}

// Test-mode escape hatch: the e2e suite runs 5 browser projects against
// one server, which would legitimately trip per-IP budgets (auth PROVEN to
// 429 the last project on CI). DEV_ECHO already marks test mode — it echoes
// OTP codes — so limits stay enforced everywhere else, including production.
function devEchoEnabled(): boolean {
  return process.env.ZOVELI_AUTH_DEV_ECHO === '1';
}

function rateLimitsEnabled(): boolean {
  return !devEchoEnabled();
}

function clientIp(req: http.IncomingMessage): string {
  return req.socket?.remoteAddress || 'unknown';
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, withSecurityHeaders({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(Buffer.byteLength(text)),
  }));
  res.end(text);
}

/** Shared 429 response so every rate-limited route stays identical. */
function rateLimited(res: http.ServerResponse): void {
  res.writeHead(429, withSecurityHeaders({
    'Content-Type': 'application/json; charset=utf-8',
    'Retry-After': '60',
  }));
  res.end(JSON.stringify({ ok: false, error: 'rate limited' }));
}

/** Map request-parse failures to fixed, client-safe text (no exception text). */
function parseErrorMessage(e: unknown): string {
  return e instanceof Error && e.message === 'invalid JSON body'
    ? 'invalid JSON body'
    : 'invalid request body';
}

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c: Buffer) => {
      raw += c.toString('utf-8');
      if (raw.length > 1_000_000) {
        reject(new Error('body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

/** Build the request pipeline without owning the server lifecycle. */
export function createRequestHandler(options: DesktopRequestOptions): http.RequestListener {
  const {
    host,
    chatCfg,
    requestedModel,
    mathReady,
    homePage,
    baseSystem,
    lenisBundle,
    origin,
  } = options;
  // Per-IP sliding windows: auth endpoints are OTP-sensitive (tight),
  // tool-running routes are LLM-costly (generous but bounded).
  const authLimiter = new RateLimiter(30, 60_000);
  const apiLimiter = new RateLimiter(120, 60_000);
  // One bounded history per authenticated session; never shared by callers.
  const histories = new ConversationHistoryStore();

  const handler: http.RequestListener = async (req, res) => {
    try {
      const url = new URL(req.url || '/', origin);
      // DNS-rebinding guard: only loopback (or explicitly allowed) Hosts.
      if (!isHostAllowed(req.headers.host)) {
        json(res, 403, { ok: false, error: 'forbidden host' });
        return;
      }
      // HSTS behind TLS (direct or proxied); localhost stays plain http.
      const hsts = hstsForRequest(req);
      if (Object.keys(hsts).length > 0) {
        const origWriteHead = res.writeHead.bind(res);
        (res as unknown as { writeHead: (...args: never[]) => unknown }).writeHead = ((
          status: number,
          headers?: Record<string, string>
        ) => origWriteHead(status, { ...hsts, ...headers })) as never;
      }
      const publicPath =
        url.pathname === '/login' ||
        url.pathname === '/health' ||
        url.pathname.startsWith('/api/auth/') ||
        url.pathname === '/vendor/lenis.min.js';
      if (authRequired() && !publicPath) {
        const hasSession = Boolean(sessionEmailFromCookie(req.headers.cookie));
        const hasApiAccess = apiRequestAuthorized(req);
        if (!hasSession && !hasApiAccess) {
          if (req.method === 'GET' && url.pathname === '/') {
            res.writeHead(302, withSecurityHeaders({ Location: '/login' }));
            res.end();
            return;
          }
          json(res, 401, { ok: false, error: 'login required' });
          return;
        }
      }
      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, withSecurityHeaders({
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Length': String(Buffer.byteLength(homePage)),
        }));
        res.end(homePage);
        return;
      }


      if (req.method === 'GET' && url.pathname === '/health') {
        json(res, 200, { ok: true, tools: host.tools().length });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/tools') {
        json(
          res,
          200,
          host.tools().map((t) => ({
            name: t.name,
            description: t.description,
            plugin: t.plugin,
            inputSchema: t.parameters ?? { type: 'object', properties: {}, additionalProperties: false },
          }))
        );
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/onboarding') {
        json(res, 200, {
          ok: true,
          chat: {
            ready: !!chatCfg,
            provider: chatCfg?.provider || null,
            model: chatCfg?.model || null,
            requestedModel: requestedModel || null,
          },
          math: { ready: mathReady },
          tools: host.tools().length,
        });
        return;
      }
      // Vendored Lenis runtime (same origin, pinned; missing file → 404 and
      // pages fall back to native scroll via the window.Lenis guard).
      if (req.method === 'GET' && url.pathname === '/vendor/lenis.min.js') {
        if (!lenisBundle) {
          json(res, 404, { ok: false, error: 'not found' });
          return;
        }
        res.writeHead(200, withSecurityHeaders({
          'Content-Type': 'text/javascript; charset=utf-8',
          'Content-Length': String(lenisBundle.length),
          'Cache-Control': 'public, max-age=86400',
        }));
        res.end(lenisBundle);
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/run') {
        let tool: string;
        let args: Record<string, unknown>;
        try {
          ({ tool, args } = parseRunCall(await readBody(req)));
        } catch (e) {
          json(res, 400, { ok: false, error: parseErrorMessage(e) });
          return;
        }
        if (!apiRequestAuthorized(req)) {
          json(res, 401, { ok: false, error: 'unauthorized' });
          return;
        }
        if (rateLimitsEnabled() && !apiLimiter.allow(`run:${clientIp(req)}`)) {
          rateLimited(res);
          return;
        }
        if (!host.tools().some((t) => t.name === tool)) {
          json(res, 200, { ok: false, error: `unknown tool: ${tool.slice(0, 100)}` });
          return;
        }
        try {
          const result = await host.runTool(tool, args);
          json(res, 200, { ok: true, result });
        } catch {
          // Never echo exception internals (stack traces, paths) to clients.
          json(res, 200, { ok: false, error: 'tool execution failed' });
        }
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/chat') {
        let message: string;
        try {
          message = parseChatMessage(await readBody(req));
        } catch (e) {
          json(res, 400, { ok: false, error: parseErrorMessage(e) });
          return;
        }
        if (!apiRequestAuthorized(req)) {
          json(res, 401, { ok: false, error: 'unauthorized' });
          return;
        }
        if (rateLimitsEnabled() && !apiLimiter.allow(`chat:${clientIp(req)}`)) {
          rateLimited(res);
          return;
        }
        // Offline fast path: verified math without any model.
        if (/^[0-9\s+\-*/^().!%]+$/.test(message) && /\d/.test(message)) {
          try {
            const out = await host.runTool('mathcore_compute', { expression: message });
            json(res, 200, {
              ok: true,
              reply: typeof out === 'string' ? out : JSON.stringify(out),
              verified: true,
              model: 'mathcore',
              provider: 'local',
              local: true,
            });
          } catch {
            json(res, 200, { ok: false, error: 'math computation failed' });
          }
          return;
        }
        if (!chatCfg) {
          json(res, 200, {
            ok: true,
            verified: false,
            setup: true,
            reply: chatSetupReply(requestedModel),
          });
          return;
        }
        const historyKey = conversationKey(req);
        const next = await chat(
          host,
          chatCfg,
          baseSystem,
          histories.get(historyKey),
          message,
          () => {}
        );
        histories.set(historyKey, next);
        const last = [...next]
          .reverse()
          .find((m: ChatMessage) => m.role === 'assistant' && m.content);
        json(res, 200, {
          ok: true,
          verified: false,
          reply: last?.content ?? '(empty)',
          model: chatCfg.model,
          provider: chatCfg.provider || 'custom',
          local: isLocalProvider(chatCfg),
        });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/login') {
        const page = renderLoginPage();
        res.writeHead(200, withSecurityHeaders({
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Length': String(Buffer.byteLength(page)),
        }));
        res.end(page);
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/auth/request') {
        const body = await readBody(req);
        let email: string;
        try {
          email = normalizeEmail(String(body?.email ?? ''));
        } catch {
          json(res, 400, { ok: false, error: 'invalid email address' });
          return;
        }
        if (rateLimitsEnabled() && !authLimiter.allow(`auth:${clientIp(req)}`)) {
          rateLimited(res);
          return;
        }
        try {
          const { code } = issueCode(email);
          const delivery = await deliverCode(email, code);
          json(res, 200, {
            ok: true,
            emailed: delivery.delivered,
            // Test-only escape hatch: echo the code so e2e can complete the
            // flow without an SMTP server. Never enable in production.
            ...(devEchoEnabled() ? { devCode: code } : {}),
          });
        } catch (e) {
          const error =
            e instanceof Error && e.message === 'too many codes requested; try again later'
              ? 'too many codes requested; try again later'
              : 'could not send login code';
          json(res, 400, { ok: false, error });
        }
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/auth/verify') {
        const body = await readBody(req);
        let email: string;
        try {
          email = normalizeEmail(String(body?.email ?? ''));
        } catch {
          json(res, 400, { ok: false, error: 'invalid email address' });
          return;
        }
        if (rateLimitsEnabled() && !authLimiter.allow(`auth:${clientIp(req)}`)) {
          rateLimited(res);
          return;
        }
        const verdict = verifyCode(email, String(body?.code ?? ''));
        if (!verdict.ok) {
          json(res, 401, { ok: false, reason: verdict.reason });
          return;
        }
        const token = mintSession(verdict.email);
        res.writeHead(200, withSecurityHeaders({
          'Content-Type': 'application/json; charset=utf-8',
          'Set-Cookie': sessionCookie(token, isTlsRequest(req)),
        }));
        res.end(JSON.stringify({ ok: true, email: verdict.email }));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/auth/me') {
        json(res, 200, { email: sessionEmailFromCookie(req.headers.cookie) });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
        histories.clear(conversationKey(req));
        res.writeHead(200, withSecurityHeaders({
          'Content-Type': 'application/json; charset=utf-8',
          'Set-Cookie': clearSessionCookie(),
        }));
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      json(res, 404, { ok: false, error: 'not found' });
    } catch (e) {
      console.error('request failed:', redactSecrets(e instanceof Error ? e.message : String(e)));
      json(res, 500, { ok: false, error: 'internal server error' });
    }
  };
  return handler;
}
