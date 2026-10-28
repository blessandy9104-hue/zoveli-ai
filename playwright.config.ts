import { defineConfig, devices } from '@playwright/test';
import { tmpdir } from 'os';
import { join } from 'path';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['json', { outputFile: 'test-results/playwright-results.json' }],
    ['junit', { outputFile: 'test-results/playwright-junit.xml' }]
  ],
  use: {
    baseURL: process.env.ZOVELI_E2E_BASE_URL || 'http://127.0.0.1:3081',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 30000,
    navigationTimeout: 60000
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } }
  ],
  webServer: {
    command: 'node apps/desktop/dist/server/server.js',
    url: `http://127.0.0.1:${process.env.ZOVELI_E2E_PORT || '3081'}/health`,
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: process.env.ZOVELI_E2E_PORT || '3081',
      OPENAI_API_KEY: '',
      DEEPSEEK_API_KEY: '',
      OPENROUTER_API_KEY: '',
      GROQ_API_KEY: '',
      TOGETHER_API_KEY: '',
      ZOVELI_API_KEY: '',
      ZOVELI_API_BASE: '',
      ZOVELI_API_TOKEN: '',
      ZOVELI_AUTH_REQUIRED: '',
      ZOVELI_MODEL: '',
      ZOVELI_OLLAMA_URL: 'http://127.0.0.1:1',
      ZOVELI_OLLAMA_MODEL: '',
      ZOVELI_VAULT_PATH: './test-vault',
      ZOVELI_MEMORY_DB: join(tmpdir(), 'zoveli-e2e-web-memory.db'),
      ZOVELI_MEMORY_EXPORT: '0',
      // Leave MATHCORE_MCP_COMMAND unset: the resolver checks .venv first for
      // local dev, then PATH, which is where CI installs mathcore-mcp.
      MATHCORE_AUDIT: './test-audit.jsonl',
      ZOVELI_AUTH_DEV_ECHO: '1',
      ZOVELI_AUTH_DIR: './test-auth-data'
    }
  },
  expect: {
    toHaveScreenshot: { maxDiffPixels: 100, threshold: 0.2 }
  }
});
