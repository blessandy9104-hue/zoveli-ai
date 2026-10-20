import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  MathcoreClient,
  type MathcoreClientOptions,
} from '../../packages/math-intelligence/src/transport';
import { mathcoreTools } from '../../packages/math-intelligence/src/tools';

const SERVER = path.join(__dirname, '..', 'fixtures', 'fake-mcp-server.mjs');
const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    try {
      cleanup();
    } catch {
      // best-effort cleanup
    }
  }
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'zoveli-mcp-pool-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function clientFor(
  env: NodeJS.ProcessEnv = {},
  options: MathcoreClientOptions = {}
): MathcoreClient {
  const client = new MathcoreClient(
    `"${process.execPath}" "${SERVER}"`,
    3000,
    {
      restartBaseMs: 60,
      restartMaxMs: 60,
      env: { ...process.env, ...env },
      ...options,
    }
  );
  cleanups.push(() => client.stop());
  return client;
}

function readLog(file: string): string[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await sleep(10);
  }
  throw new Error('condition was not met in time');
}

describe('mathcore MCP pool', () => {
  it('keeps one child process across sequential calls', async () => {
    const log = path.join(tempDir(), 'spawns.log');
    const client = clientFor({ FAKE_MCP_LOG: log });

    await expect(client.compute('1+1')).resolves.toBe('fake:compute:1+1');
    await expect(client.compute('2+2')).resolves.toBe('fake:compute:2+2');

    const status = client.status();
    expect(status.running).toBe(true);
    expect(status.spawns).toBe(1);
    expect(status.pending).toBe(0);
    expect(status.startedAt).toBeTruthy();
    expect(readLog(log)).toHaveLength(1);
    expect(status.pid).toBe(Number(readLog(log)[0]));
  });

  it('multiplexes concurrent calls over one process', async () => {
    const log = path.join(tempDir(), 'spawns.log');
    const client = clientFor({ FAKE_MCP_LOG: log, FAKE_MCP_DELAY_MS: '120' });

    const results = await Promise.all([
      client.compute('a'),
      client.compute('b'),
      client.compute('c'),
    ]);

    expect(results).toEqual([
      'fake:compute:a',
      'fake:compute:b',
      'fake:compute:c',
    ]);
    expect(readLog(log)).toHaveLength(1);
    expect(client.status().pending).toBe(0);
    expect(client.status().spawns).toBe(1);
  });

  it('restarts after a crash, backing off instead of spawning per call', async () => {
    const log = path.join(tempDir(), 'spawns.log');
    const client = clientFor(
      { FAKE_MCP_LOG: log, FAKE_MCP_CRASH_ON: 'boom' },
      { restartBaseMs: 300, restartMaxMs: 300 }
    );

    await expect(client.compute('boom')).rejects.toThrow(/exited with code 7/);
    expect(client.status().running).toBe(false);
    expect(client.status().lastExitCode).toBe(7);
    expect(readLog(log)).toHaveLength(1);

    const startedAt = Date.now();
    await expect(client.compute('1+1')).rejects.toThrow(/restarting.*retrying/i);
    expect(Date.now() - startedAt).toBeLessThan(250);
    expect(readLog(log)).toHaveLength(1);

    await sleep(350);
    await expect(client.compute('1+1')).resolves.toBe('fake:compute:1+1');

    const status = client.status();
    expect(status.running).toBe(true);
    expect(status.spawns).toBe(2);
    expect(status.restarts).toBe(1);
    expect(readLog(log)).toHaveLength(2);
  });

  it('ignores a stale exit event from a replaced process', async () => {
    const client = clientFor();
    await client.compute('1+1');
    const first = (client as any).proc;
    expect(first).toBeTruthy();

    first.kill();
    await waitFor(() => !client.status().running);
    await sleep(80);
    await expect(client.compute('2+2')).resolves.toBe('fake:compute:2+2');
    expect(client.status().spawns).toBe(2);

    (client as any).onDeath(first, new Error('stale exit'), 12345);
    const status = client.status();
    expect(status.running).toBe(true);
    expect(status.lastExitCode).not.toBe(12345);
    expect(status.lastError).not.toBe('stale exit');

    await expect(client.compute('3+3')).resolves.toBe('fake:compute:3+3');
    expect(client.status().spawns).toBe(2);
  });

  it('stops gracefully and rejects in-flight calls', async () => {
    const client = clientFor({ FAKE_MCP_DELAY_MS: '500' });
    const pending = client.compute('slow');
    await sleep(60);
    expect(client.status().pending).toBe(1);

    client.stop();
    await expect(pending).rejects.toThrow(/stopped/);
    expect(client.status().running).toBe(false);
    expect(client.status().pending).toBe(0);
  });

  it('reports a missing binary actionably and backs off instead of respawning per call', async () => {
    const client = new MathcoreClient('zoveli-definitely-missing-mathcore-binary', 500, {
      restartBaseMs: 300,
      restartMaxMs: 300,
    });
    cleanups.push(() => client.stop());

    await expect(client.compute('1+1')).rejects.toThrow(/was not found/);
    expect(client.status().spawns).toBe(1);
    expect(client.status().lastError).toMatch(/was not found/);
    expect(client.status().lastError).toMatch(/pnpm run doctor/);

    await expect(client.compute('1+1')).rejects.toThrow(/restarting.*retrying/i);
    expect(client.status().spawns).toBe(1);

    await sleep(350);
    await expect(client.compute('1+1')).rejects.toThrow(/was not found/);
    expect(client.status().spawns).toBe(2);
  });

  it('warms up without throwing and reuses the started pool', async () => {
    const log = path.join(tempDir(), 'spawns.log');
    const client = clientFor({ FAKE_MCP_LOG: log });

    await expect(client.warmup()).resolves.toBe(true);
    expect(client.status().running).toBe(true);
    expect(client.status().spawns).toBe(1);

    await expect(client.warmup()).resolves.toBe(true);
    expect(client.status().spawns).toBe(1);
    expect(readLog(log)).toHaveLength(1);

    await expect(client.compute('1+1')).resolves.toBe('fake:compute:1+1');
    expect(client.status().spawns).toBe(1);
  });

  it('reports a failed warmup instead of throwing', async () => {
    const client = new MathcoreClient('zoveli-definitely-missing-mathcore-binary', 500, {
      restartBaseMs: 60,
      restartMaxMs: 60,
      env: { ...process.env, PATH: tempDir() },
    });
    cleanups.push(() => client.stop());

    await expect(client.warmup()).resolves.toBe(false);
    expect(client.status().running).toBe(false);
    expect(client.status().lastError).toMatch(/was not found/);
  });

  it('exposes pool status through the mathcore_status tool', async () => {
    const tool = mathcoreTools.find((t) => t.name === 'mathcore_status');
    expect(tool).toBeDefined();

    const status = await tool!.execute({});
    expect(status).toMatchObject({ running: false, pending: 0, spawns: 0 });
    expect(typeof status.command).toBe('string');
    expect(status.retryInMs).toBe(0);
  });
});
