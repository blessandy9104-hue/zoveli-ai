import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MODEL = 'llama3.2:3b';
const REPLY = 'Local mock reply: hello from the desktop.';

// This spec owns its desktop server and mock Ollama so the shared webServer
// keeps its offline/tools-only state for the other e2e tests.
let mock: Server;
let app: ChildProcess;
let appUrl: string;
let appOutput = '';
let workDir: string;
let chatRequests: Array<{ model?: string }> = [];

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>((resolve, reject) =>
    probe.close((error) => (error ? reject(error) : resolve()))
  );
  return port;
}

async function startMockOllama(): Promise<number> {
  mock = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/api/tags') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ models: [{ name: MODEL, model: MODEL }] }));
      return;
    }
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        try {
          chatRequests.push(JSON.parse(body));
        } catch {
          chatRequests.push({});
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            choices: [{ message: { role: 'assistant', content: REPLY } }],
          })
        );
      });
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{}');
  });
  await new Promise<void>((resolve) => mock.listen(0, '127.0.0.1', resolve));
  return (mock.address() as AddressInfo).port;
}

async function waitForHealth(url: string, timeoutMs = 45000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) return;
    } catch {
      // server is still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`desktop server did not become healthy at ${url}\n${appOutput}`);
}

test.beforeAll(async () => {
  const ollamaPort = await startMockOllama();
  const appPort = await freePort();
  appUrl = `http://127.0.0.1:${appPort}`;
  workDir = mkdtempSync(join(tmpdir(), 'zoveli-e2e-desktop-chat-'));

  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of [
    'OPENAI_API_KEY',
    'DEEPSEEK_API_KEY',
    'OPENROUTER_API_KEY',
    'GROQ_API_KEY',
    'TOGETHER_API_KEY',
    'ZOVELI_API_KEY',
    'ZOVELI_API_BASE',
    'ZOVELI_MODEL',
    'ZOVELI_OLLAMA_MODEL',
    'ZOVELI_OLLAMA_URL',
    'ZOVELI_AUTH_REQUIRED',
  ]) {
    delete env[key];
  }
  Object.assign(env, {
    PORT: String(appPort),
    NODE_ENV: 'test',
    ZOVELI_OLLAMA_URL: `http://127.0.0.1:${ollamaPort}`,
    ZOVELI_VAULT_PATH: join(workDir, 'vault'),
    ZOVELI_MEMORY_DB: join(workDir, 'memory.db'),
    ZOVELI_MEMORY_EXPORT: '0',
    ZOVELI_AUTH_DIR: join(workDir, 'auth'),
    MATHCORE_AUDIT: join(workDir, 'audit.jsonl'),
  });

  app = spawn(process.execPath, ['apps/desktop/dist/server/server.js'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  app.stdout?.on('data', (chunk) => {
    appOutput += chunk;
  });
  app.stderr?.on('data', (chunk) => {
    appOutput += chunk;
  });
  await waitForHealth(appUrl);
});

test.afterAll(async () => {
  app?.kill();
  if (mock) await new Promise<void>((resolve) => mock.close(() => resolve()));
  if (workDir) {
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {
      // Windows may still hold the SQLite file briefly
    }
  }
});

test('detects a local model and answers the first desktop message', async ({ page }) => {
  test.slow();
  await page.goto(appUrl);
  await expect(page.getByTestId('onboarding-status')).toContainText(
    `chat ready (${MODEL})`
  );

  await page.getByLabel('Message').fill('hello there');
  await page.getByTestId('send-button').click();
  await expect(page.getByTestId('assistant-message').last()).toContainText(REPLY);

  expect(chatRequests).toHaveLength(1);
  expect(chatRequests[0]?.model).toBe(MODEL);
});
