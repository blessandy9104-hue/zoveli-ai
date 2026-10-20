import { test, expect } from '@playwright/test';
import { spawn, spawnSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';

const CLI = 'apps/cli/dist/cli.js';

// CLI e2e isolation: the math intelligence layer auto-memorizes VERIFIED
// proofs to $ZOVELI_MEMORY_DB (+ Markdown export). Point both at throwaway
// locations so runs never pollute the developer's home DB or the repo vault.
const CLI_TEST_ENV = {
  ZOVELI_MEMORY_DB: join(tmpdir(), 'zoveli-e2e-cli-memory.db'),
  ZOVELI_MEMORY_EXPORT: '0',
};

// mathcore-mcp comes from the vendored ./mathcore (pip install -e ./mathcore).
// Math-dependent tests skip cleanly when it is absent (and run for real
// where it is installed, e.g. local dev and CI's e2e job).
function hasMathcore(): boolean {
  const r = spawnSync('mathcore-mcp', ['--help'], { timeout: 15000 });
  return !r.error;
}
const HAS_MATHCORE = hasMathcore();

/**
 * Run the CLI once with scripted stdin, then close stdin and wait for
 * exit. Closing stdin up front removes every timing race: the batch pump
 * drains the scripted lines deterministically and the process must exit
 * on its own. Any hang or crash surfaces with full captured output.
 */
function runCliOnce(
  input: string,
  timeout = 60000
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const cli = spawn('node', [CLI], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...CLI_TEST_ENV },
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try {
        cli.kill('SIGKILL');
      } catch {
        // already gone
      }
      reject(
        new Error(
          `CLI timed out with input ${JSON.stringify(input)}\n--- stdout so far ---\n${stdout}\n--- stderr so far ---\n${stderr}`
        )
      );
    }, timeout);
    cli.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    cli.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    cli.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`CLI spawn error: ${e.message}`));
    });
    cli.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
    cli.stdin.write(input);
    cli.stdin.end();
  });
}

test.describe('CLI Application', () => {
  // Spawning node + booting 15 plugins is slow on loaded CI runners;
  // test.slow() triples the timeout. runCliOnce carries its own 60s
  // watchdog with full captured output, so failures stay diagnosable.
  test.slow();

  test('canary: spawn node and read piped stdout', async () => {
    const p = spawn('node', ['-e', "console.log('hello-child')"], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const out = await new Promise<string>((resolve, reject) => {
      let buf = '';
      const t = setTimeout(
        () => reject(new Error(`canary timeout; node=${process.version} platform=${process.platform} buf=${JSON.stringify(buf)}`)),
        20000
      );
      p.stdout.on('data', (d) => {
        buf += d.toString();
        if (buf.includes('hello-child')) {
          clearTimeout(t);
          resolve(buf);
        }
      });
      p.on('error', (e) => {
        clearTimeout(t);
        reject(new Error(`canary spawn error: ${e.message}`));
      });
    });
    expect(out).toContain('hello-child');
  });

  test('boots and lists tools', async () => {
    const run = await runCliOnce('/tools\n/quit\n');
    expect(run.code).toBe(0);
    expect(run.stdout).toContain('zoveli — local-first assistant');
    expect(run.stdout).toContain('mathcore_compute');
    expect(run.stdout).toContain('sysinfo_snapshot');
    // vault_graph sorts last: proves the full list printed.
    expect(run.stdout).toContain('vault_graph');
  });

  test('verified math over stdio', async () => {
    test.skip(!HAS_MATHCORE, 'mathcore-mcp not installed');
    const run = await runCliOnce('/math 2+2\n/quit\n');
    expect(run.code).toBe(0);
    expect(run.stdout).toContain('"value": "4"');
    expect(run.stdout).toContain('VERIFIED');
  });

  test('exits zero on /quit', async () => {
    const run = await runCliOnce('/quit\n');
    expect(run.code).toBe(0);
    expect(run.stdout).toContain('local-first assistant');
  });
});

test.describe('Web Application', () => {
  test('health endpoint reports tool count', async ({ request }) => {
    const res = await request.get('/health');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.tools).toBeGreaterThan(20);
    // Hardening headers ship on every response.
    const headers = res.headers();
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('SAMEORIGIN');
  });

  test('tools API lists mathcore tools', async ({ request }) => {
    const res = await request.get('/api/tools');
    const tools = await res.json();
    const names = tools.map((t: any) => t.name);
    expect(names).toContain('mathcore_compute');
    expect(names).toContain('sysinfo_snapshot');
  });

  test('run API executes a tool end-to-end', async ({ request }) => {
    const res = await request.post('/api/run', {
      data: { tool: 'sysinfo_snapshot', args: {} },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.result).toBeDefined();
  });

  test('run API validates bodies and reports unknown tools', async ({ request }) => {
    const missing = await request.post('/api/run', { data: { args: {} } });
    expect(missing.status()).toBe(400);
    const badArgs = await request.post('/api/run', {
      data: { tool: 'sysinfo_snapshot', args: [] },
    });
    expect(badArgs.status()).toBe(400);
    const unknown = await request.post('/api/run', {
      data: { tool: 'no_such_tool_xyz', args: {} },
    });
    expect(unknown.status()).toBe(200);
    const body = await unknown.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('unknown tool');
  });

  test('chat API verifies bare arithmetic', async ({ request }) => {
    test.skip(!HAS_MATHCORE, 'mathcore-mcp not installed');
    const res = await request.post('/api/chat', { data: { message: '2+2' } });
    const body = await res.json();
    expect(body.verified).toBe(true);
    expect(JSON.stringify(body.reply)).toContain('4');
  });

  test('chat API rejects oversized messages', async ({ request }) => {
    const res = await request.post('/api/chat', { data: { message: 'x'.repeat(60000) } });
    expect(res.status()).toBe(400);
  });

  test('UI sends a message and shows VERIFIED badge', async ({ page }) => {
    test.skip(!HAS_MATHCORE, 'mathcore-mcp not installed');
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('Zoveli');
    await page.fill('[data-testid="chat-input"]', '2+2');
    await page.click('[data-testid="send-button"]');
    // Timing-sensitive under parallel workers (Firefox especially): allow
    // extra time rather than flaking. CI also retries (retries: 2).
    await expect(page.locator('[data-testid="assistant-message"]').last()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="verification-badge"]').first()).toContainText(
      'VERIFIED'
    );
  });

  test('UI lists tools', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-testid="tools-list"]')).toContainText(
      'mathcore_compute'
    );
  });

  test('chat shows model source, links, and clears local history', async ({ page }) => {
    await page.goto('/');
    await page.fill('[data-testid="chat-input"]', '2+2');
    await page.click('[data-testid="send-button"]');
    const meta = page.locator('[data-testid="reply-meta"]').last();
    await expect(meta).toContainText('mathcore', { timeout: 15000 });
    await expect(meta).toContainText('stays on this machine');
    // User-echo linkifies safely without a model round-trip.
    await page.fill('[data-testid="chat-input"]', 'see https://example.com/x please');
    await page.click('[data-testid="send-button"]');
    const echo = page.locator('[data-testid="user-message"]').last();
    await expect(echo.locator('a[href="https://example.com/x"]')).toBeVisible();
    // History persists across reload, then clears on demand.
    await page.reload();
    await expect(page.locator('[data-testid="user-message"]').first()).toBeVisible();
    await page.click('[data-testid="chat-clear"]');
    await expect(page.locator('[data-testid="user-message"]')).toHaveCount(0);
  });

  test('theme switcher persists the chosen look, unicorn stays lazy', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-testid="app-root"]')).toHaveAttribute('data-theme', 'daylight');
    await expect(page.locator('[data-testid="theme-switcher"]')).toBeVisible();
    // No Unicorn runtime by default (zero external requests).
    expect(await page.evaluate(() => document.getElementById('us-sdk'))).toBeNull();
    await page.click('[data-testid="theme-option-midnight"]');
    await expect(page.locator('[data-testid="app-root"]')).toHaveAttribute('data-theme', 'midnight');
    await expect(page.locator('[data-testid="theme-option-midnight"]')).toHaveAttribute('aria-pressed', 'true');
    await page.reload();
    await expect(page.locator('[data-testid="app-root"]')).toHaveAttribute('data-theme', 'midnight');
    // Vendored Lenis is same-origin served.
    const lenis = await page.request.get('/vendor/lenis.min.js');
    expect(lenis.ok()).toBeTruthy();
  });
});

test.describe('Auth (email OTP, proton.me compatible)', () => {
  const email = `e2e-${Date.now()}@proton.me`;

  test('request + verify + me + logout over API', async ({ request }) => {
    const req = await request.post('/api/auth/request', { data: { email } });
    expect(req.ok()).toBeTruthy();
    const reqBody = await req.json();
    expect(reqBody.ok).toBe(true);
    expect(reqBody.devCode).toMatch(/^\d{6}$/);

    const bad = await request.post('/api/auth/verify', {
      data: { email, code: '000000' },
    });
    expect(bad.status()).toBe(401);

    const good = await request.post('/api/auth/verify', {
      data: { email, code: reqBody.devCode },
    });
    expect(good.ok()).toBeTruthy();
    const setCookie = good.headers()['set-cookie'] || '';
    expect(setCookie).toContain('zoveli_session=');

    const me = await request.get('/api/auth/me', {
      headers: { cookie: setCookie.split(';')[0] },
    });
    expect((await me.json()).email).toBe(email);

    const out = await request.post('/api/auth/logout', {
      headers: { cookie: setCookie.split(';')[0] },
    });
    expect(out.ok()).toBeTruthy();
  });

  test('login page completes signup with a proton.me address', async ({ page }) => {
    const addr = `ui-${Date.now()}@proton.me`;
    await page.goto('/login');
    await page.fill('[data-testid="login-email"]', addr);
    await page.click('[data-testid="login-send"]');
    await expect(page.locator('[data-testid="login-status"]')).toContainText(
      'Code sent'
    );

    // In test mode the server echoes the code via the API — standing in
    // for the email a real SMTP sink would deliver to the proton.me inbox.
    const codeRes = await page.request.post('/api/auth/request', {
      data: { email: addr },
    });
    const { devCode } = await codeRes.json();
    expect(devCode).toMatch(/^\d{6}$/);
    await page.fill('[data-testid="login-code"]', devCode);
    await page.click('[data-testid="login-verify"]');
    await expect(page.locator('[data-testid="login-status"]')).toContainText(
      `Signed in as ${addr}`
    );
  });

  test('rejects invalid email addresses', async ({ request }) => {
    const res = await request.post('/api/auth/request', {
      data: { email: 'not-an-email' },
    });
    expect(res.status()).toBe(400);
  });
});

