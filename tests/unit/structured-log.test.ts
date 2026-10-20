import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ZoveliHost } from '../../packages/host/src/host';
import {
  StructuredLogSink,
  resolveStructuredLog,
  rotateStructuredLog,
} from '../../packages/host/src/structured-log';

const created: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'zoveli-trace-log-'));
  created.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of created.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
});

function fakePlugin() {
  return {
    setup(ctx: any) {
      ctx.register('a-tools', [
        { name: 'ok', description: 'ok', execute: async () => 1 },
        {
          name: 'boom',
          description: 'boom',
          execute: async () => {
            throw new Error('upstream rejected sk-abcdefghijklmnopqrstuvwxyz');
          },
        },
      ]);
    },
  } as any;
}

describe('structured JSONL log', () => {
  it('is opt-in and clamps configuration from the environment', () => {
    expect(resolveStructuredLog({})).toBeNull();

    const clamped = resolveStructuredLog({
      ZOVELI_TRACE_LOG: 'logs/trace.jsonl',
      ZOVELI_TRACE_LOG_MAX_BYTES: '10',
      ZOVELI_TRACE_LOG_KEEP: '99',
    });
    expect(clamped?.file).toContain('trace.jsonl');
    expect(clamped?.maxBytes).toBe(1024);
    expect(clamped?.keep).toBe(20);

    const defaults = resolveStructuredLog({ ZOVELI_TRACE_LOG: 'logs/trace.jsonl' });
    expect(defaults?.maxBytes).toBe(5_000_000);
    expect(defaults?.keep).toBe(3);
  });

  it('appends one JSON object per line and rotates by size', () => {
    const file = join(tempDir(), 'tool-calls.jsonl');
    const sink = new StructuredLogSink({ file, maxBytes: 1024, keep: 2 });

    for (let index = 0; index < 40; index += 1) {
      sink.write({ index, pad: 'x'.repeat(90) });
    }

    const stats = sink.stats();
    expect(stats.written).toBe(40);
    expect(stats.rotations).toBeGreaterThan(0);
    expect(existsSync(file)).toBe(true);
    expect(existsSync(`${file}.1`)).toBe(true);
    expect(existsSync(`${file}.2`)).toBe(true);
    expect(existsSync(`${file}.3`)).toBe(false);

    const line = readFileSync(file, 'utf8').trim().split('\n').at(-1);
    expect(JSON.parse(line!)).toMatchObject({ index: 39 });
  });

  it('can truncate instead of keeping rotated backups', () => {
    const file = join(tempDir(), 'tool-calls.jsonl');
    const sink = new StructuredLogSink({ file, maxBytes: 1024, keep: 0 });
    for (let index = 0; index < 20; index += 1) {
      sink.write({ index, pad: 'x'.repeat(90) });
    }
    expect(sink.stats().rotations).toBeGreaterThan(0);
    expect(existsSync(`${file}.1`)).toBe(false);
    expect(existsSync(file)).toBe(true);
  });

  it('disables itself instead of throwing when the path is unwritable', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const dir = join(tempDir(), 'as-directory');
    mkdirSync(dir);
    const sink = new StructuredLogSink({ file: dir });

    expect(() => sink.write({ nope: true })).not.toThrow();
    sink.write({ again: true });

    expect(sink.stats().written).toBe(0);
    expect(sink.stats().lastError).toBeTruthy();
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('rotateStructuredLog shifts current and backup files', () => {
    const dir = tempDir();
    const file = join(dir, 'trace.jsonl');
    writeFileSync(file, 'current\n');
    writeFileSync(`${file}.1`, 'older\n');
    writeFileSync(`${file}.2`, 'oldest\n');

    rotateStructuredLog(file, 2);

    expect(existsSync(file)).toBe(false);
    expect(readFileSync(`${file}.1`, 'utf8')).toBe('current\n');
    expect(readFileSync(`${file}.2`, 'utf8')).toBe('older\n');
    expect(existsSync(`${file}.3`)).toBe(false);
  });
});

describe('host structured events', () => {
  it('writes redacted tool-call JSONL and emits tool/call', async () => {
    const file = join(tempDir(), 'events.jsonl');
    const sink = new StructuredLogSink({ file, maxBytes: 5000, keep: 1 });
    const host = new ZoveliHost({ eventLog: sink });
    const seen: any[] = [];
    host.ctx.on('tool/call', (event: any) => seen.push(event));
    host.mount([fakePlugin()]);

    await host.runTool('ok');
    await expect(host.runTool('boom')).rejects.toThrow('upstream rejected');

    const lines = readFileSync(file, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      schema: 'zoveli.tool_call.v1',
      seq: 1,
      tool: 'ok',
      ok: true,
      registration: 'a-tools',
    });
    expect(lines[1].ok).toBe(false);
    expect(lines[1].error).toContain('[REDACTED]');
    expect(seen).toHaveLength(2);
    expect(seen[1].tool).toBe('boom');
    expect(host.logStatus()).toMatchObject({ written: 2, rotations: 0, file });
  });

  it('creates a sink from ZOVELI_TRACE_LOG', async () => {
    const file = join(tempDir(), 'nested', 'env.jsonl');
    const previous = process.env.ZOVELI_TRACE_LOG;
    process.env.ZOVELI_TRACE_LOG = file;
    try {
      const host = new ZoveliHost();
      host.mount([fakePlugin()]);
      await host.runTool('ok');
      expect(host.logStatus()?.file).toBe(file);
      expect(existsSync(file)).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.ZOVELI_TRACE_LOG;
      else process.env.ZOVELI_TRACE_LOG = previous;
    }
  });
});
