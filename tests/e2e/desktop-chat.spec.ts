import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MODEL = 'llama3.2:3b';
const MISSING_MODEL = 'missing:1b';
const REPLY = 'Local mock reply: hello from the desktop.';

interface MockOllama {
  port: number;
  chatRequests: Array<{ model?: string }>;
  close: () => Promise<void>;
}

interface DesktopApp {
  url: string;
  close: () => void;
}

let mock: MockOllama;
let app: DesktopApp;
let workDir: string;

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>((resolve, reject) =>
    probe.close((error) => (error ? reject(error) : resolve()))
  );
  return port;
}

async function startMockOllama(models: string[]): Promise<MockOllama> {
  const chatRequests: Array<{ model?: string }> = [];
  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/api/tags') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          models: models.map((name) => ({ name, model: name })),
        })
      );
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
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as AddressInfo).port,
    chatRequests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function waitForHealth(
  url: string,
  output: () => string,
  timeoutMs = 45000
): Promise<void> {
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
  throw new Error(`desktop server did not become healthy at ${url}\n${output()}`);
}

function baseEnv(): NodeJS.ProcessEnv {
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
  return env;
}

async function startDesktop(env: NodeJS.ProcessEnv): Promise<DesktopApp> {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  let output = '';
  const child = spawn(process.execPath, ['apps/desktop/dist/server/server.js'], {
    env: { ...env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr?.on('data', (chunk) => {
    output += chunk;
  });
  await waitForHealth(url, () => output);
  return { url, close: () => child.kill() };
}

// This spec owns its desktop servers and mock Ollama so the shared webServer
// keeps its offline/tools-only state for the other e2e tests.
test.beforeAll(async () => {
  mock = await startMockOllama([MODEL]);
  workDir = mkdtempSync(join(tmpdir(), 'zoveli-e2e-desktop-chat-'));
  app = await startDesktop({
    ...baseEnv(),
    NODE_ENV: 'test',
    ZOVELI_OLLAMA_URL: `http://127.0.0.1:${mock.port}`,
    ZOVELI_VAULT_PATH: join(workDir, 'vault'),
    ZOVELI_MEMORY_DB: join(workDir, 'memory.db'),
    ZOVELI_MEMORY_EXPORT: '0',
    ZOVELI_AUTH_DIR: join(workDir, 'auth'),
    MATHCORE_AUDIT: join(workDir, 'audit.jsonl'),
  });
});

test.afterAll(async () => {
  app?.close();
  await mock?.close();
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
  await page.goto(app.url);
  await expect(page.getByTestId('onboarding-status')).toContainText(
    `chat ready (${MODEL})`
  );

  await page.getByLabel('Message').fill('hello there');
  await page.getByTestId('send-button').click();
  await expect(page.getByTestId('assistant-message').last()).toContainText(REPLY);

  expect(mock.chatRequests).toHaveLength(1);
  expect(mock.chatRequests[0]?.model).toBe(MODEL);
});

test('names a pinned model that is missing and sends no chat request', async ({ page }) => {
  test.slow();
  const pinnedMock = await startMockOllama([MODEL]);
  const pinnedWorkDir = mkdtempSync(join(tmpdir(), 'zoveli-e2e-desktop-pinned-'));
  let pinnedApp: DesktopApp | undefined;
  try {
    pinnedApp = await startDesktop({
      ...baseEnv(),
      NODE_ENV: 'test',
      ZOVELI_MODEL: MISSING_MODEL,
      ZOVELI_OLLAMA_URL: `http://127.0.0.1:${pinnedMock.port}`,
      ZOVELI_VAULT_PATH: join(pinnedWorkDir, 'vault'),
      ZOVELI_MEMORY_DB: join(pinnedWorkDir, 'memory.db'),
      ZOVELI_MEMORY_EXPORT: '0',
      ZOVELI_AUTH_DIR: join(pinnedWorkDir, 'auth'),
      MATHCORE_AUDIT: join(pinnedWorkDir, 'audit.jsonl'),
    });

    await page.goto(pinnedApp.url);
    await expect(page.getByTestId('onboarding-status')).toContainText('chat needs a model');
    await expect(page.getByTestId('onboarding')).toContainText(
      `ollama pull ${MISSING_MODEL}`
    );

    await page.getByLabel('Message').fill('hello there');
    await page.getByTestId('send-button').click();
    const reply = page.getByTestId('assistant-message').last();
    await expect(reply).toContainText(
      `The requested Ollama model "${MISSING_MODEL}" is not installed.`
    );
    await expect(reply).toContainText(`ollama pull ${MISSING_MODEL}`);
    expect(pinnedMock.chatRequests).toHaveLength(0);
  } finally {
    pinnedApp?.close();
    await pinnedMock.close();
    try {
      rmSync(pinnedWorkDir, { recursive: true, force: true });
    } catch {
      // Windows may still hold the SQLite file briefly
    }
  }
});
