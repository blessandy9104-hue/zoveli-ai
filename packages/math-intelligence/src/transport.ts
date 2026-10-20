import { spawn, type ChildProcess } from 'node:child_process';
import { MATHCORE_MCP_COMMAND } from './constants.js';
import { commandParts, resolveMathcoreCommand } from './resolve.js';

/**
 * Persistent stdio JSON-RPC client for the `mathcore-mcp` server binary.
 *
 * Protocol (verified against the real server):
 *   -> {"jsonrpc":"2.0","id":N,"method":"tools/call",
 *       "params":{"name":"compute","arguments":{"request":"..."}}}\n
 *   <- {"jsonrpc":"2.0","id":N,"result":{"content":[{"type":"text","text":"..."}]}}\n
 *
 * One long-lived child process per client; requests multiplexed by id.
 * Every computation still goes through mathcore's own verification quorum —
 * this client transports, it never computes.
 *
 * Supervision rules (pool hardening):
 * - Death handlers are bound to their child, so a late exit from an old
 *   process can never clobber the replacement.
 * - A crash/failed spawn starts an exponential restart backoff: calls made
 *   inside the window fail fast with the last error instead of spawning a
 *   process per request (a storm while the install is broken).
 * - Any valid JSON-RPC reply clears the failure streak and cooldown.
 * - `status()` exposes pool counters for diagnostics (`mathcore_status`).
 */

const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_RESTART_BASE_MS = 500;
const DEFAULT_RESTART_MAX_MS = 30000;

interface PendingCall {
  resolve: (value: any) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface MathcoreClientOptions {
  /** First restart delay after a failure; doubles per consecutive failure. */
  restartBaseMs?: number;
  /** Upper bound for the restart backoff. */
  restartMaxMs?: number;
  /** Environment for the child (tests inject fake-server knobs). */
  env?: NodeJS.ProcessEnv;
}

export interface MathcoreStatus {
  command: string;
  running: boolean;
  pid: number | null;
  pending: number;
  spawns: number;
  restarts: number;
  lastError: string | null;
  lastExitCode: number | null;
  startedAt: string | null;
  /** Milliseconds until a restart is allowed after a failure (0 = ready). */
  retryInMs: number;
  timeoutMs: number;
}

export class MathcoreClient {
  private proc: ChildProcess | null = null;
  private buffer = '';
  private pending = new Map<number, PendingCall>();
  private nextId = 1;
  private spawns = 0;
  private restarts = 0;
  private failures = 0;
  private retryAt = 0;
  private startedAt: number | null = null;
  private lastError: string | null = null;
  private lastExitCode: number | null = null;

  constructor(
    private readonly command = resolveMathcoreCommand(),
    private readonly timeoutMs = defaultTimeout(process.env.MATHCORE_TIMEOUT_MS),
    private readonly options: MathcoreClientOptions = {}
  ) {}

  get running(): boolean {
    return !!this.proc && this.proc.exitCode === null;
  }

  status(): MathcoreStatus {
    return {
      command: this.command,
      running: this.running,
      pid: this.proc?.pid ?? null,
      pending: this.pending.size,
      spawns: this.spawns,
      restarts: this.restarts,
      lastError: this.lastError,
      lastExitCode: this.lastExitCode,
      startedAt: this.startedAt ? new Date(this.startedAt).toISOString() : null,
      retryInMs: this.running ? 0 : Math.max(0, this.retryAt - Date.now()),
      timeoutMs: this.timeoutMs,
    };
  }

  private ensureStarted(): void {
    if (this.running) return;
    const now = Date.now();
    if (now < this.retryAt) {
      const secs = Math.max(1, Math.ceil((this.retryAt - now) / 1000));
      const reason = this.lastError ? ` after a failure (${this.lastError})` : '';
      throw new Error(
        `${MATHCORE_MCP_COMMAND} is restarting${reason}; retrying in ~${secs}s.`
      );
    }
    const { command, args } = commandParts(this.command);
    let child: ChildProcess;
    try {
      child = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'inherit'],
        env: this.options.env ?? process.env,
      });
    } catch (e) {
      const err = this.describeStartFailure(
        e instanceof Error ? e : new Error(String(e)),
        command
      );
      this.recordFailure(err);
      throw err;
    }
    if (this.spawns > 0) this.restarts += 1;
    this.spawns += 1;
    this.proc = child;
    this.startedAt = Date.now();
    this.buffer = '';
    // Bind every handler to `child`: a stale event from a previous process
    // must never reject calls or clear the replacement in `this.proc`.
    child.stdout?.on('data', (chunk: Buffer) => {
      if (this.proc === child) this.onData(chunk);
    });
    child.on('error', (err) =>
      this.onDeath(child, this.describeStartFailure(err, command))
    );
    child.on('exit', (code) =>
      this.onDeath(
        child,
        new Error(`${MATHCORE_MCP_COMMAND} exited with code ${code ?? 'null'}`),
        code
      )
    );
  }

  private describeStartFailure(err: Error, command: string): Error {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return new Error(
        `${MATHCORE_MCP_COMMAND} was not found (tried "${command}"). ` +
          `Install the vendored engine with "python -m pip install -e ./mathcore" ` +
          `(activate .venv first), check it with "pnpm run doctor", or set ` +
          `MATHCORE_MCP_COMMAND to the full mathcore-mcp path.`
      );
    }
    return err;
  }

  private onData(chunk: Buffer): void {
    this.buffer += chunk.toString('utf-8');
    let nl: number;
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;
      let msg: any;
      try {
        msg = JSON.parse(line);
      } catch {
        continue; // ignore non-JSON chatter
      }
      // A reply (any id) proves the server is alive: clear crash backoff.
      this.failures = 0;
      this.retryAt = 0;
      const call = this.pending.get(msg.id);
      if (!call) continue;
      this.pending.delete(msg.id);
      clearTimeout(call.timer);
      if (msg.error) {
        call.reject(new Error(`mathcore error: ${msg.error.message ?? msg.error}`));
      } else {
        call.resolve(msg.result);
      }
    }
  }

  private recordFailure(err: Error): void {
    this.lastError = err.message;
    this.failures += 1;
    const base = this.options.restartBaseMs ?? DEFAULT_RESTART_BASE_MS;
    const max = this.options.restartMaxMs ?? DEFAULT_RESTART_MAX_MS;
    const delay = Math.min(max, base * 2 ** Math.min(this.failures - 1, 16));
    this.retryAt = Date.now() + delay;
  }

  private onDeath(child: ChildProcess, err: Error, exitCode?: number | null): void {
    if (this.proc !== child) return; // stale event from a replaced process
    this.proc = null;
    this.startedAt = null;
    if (exitCode !== undefined && exitCode !== null) this.lastExitCode = exitCode;
    this.recordFailure(err);
    this.rejectPending(err);
  }

  private rejectPending(err: Error): void {
    for (const [, call] of this.pending) {
      clearTimeout(call.timer);
      call.reject(err);
    }
    this.pending.clear();
  }

  call(method: string, params: any): Promise<any> {
    this.ensureStarted();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(`mathcore request timed out after ${this.timeoutMs}ms`)
        );
      }, this.timeoutMs);
      // Avoid leaking timers on process exit.
      if (typeof (timer as any)?.unref === 'function') (timer as any).unref();
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.proc?.stdin?.write(
          JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'
        );
      } catch (e) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  /** tools/list handshake — also serves as a liveness probe. */
  async listTools(): Promise<any[]> {
    const res = await this.call('tools/list', {});
    return res?.tools ?? [];
  }

  private static unwrap(result: any): string {
    const text = result?.content?.[0]?.text;
    if (typeof text !== 'string') {
      throw new Error('unexpected mathcore response shape');
    }
    return text;
  }

  /** Verified computation. Returns the human-readable verified text. */
  async compute(request: string): Promise<string> {
    const res = await this.call('tools/call', {
      name: 'compute',
      arguments: { request },
    });
    return MathcoreClient.unwrap(res);
  }

  /** Verdict on a proposed answer: MATCH | MISMATCH | ... (verbatim). */
  async checkAnswer(question: string, claimedAnswer: string): Promise<string> {
    const res = await this.call('tools/call', {
      name: 'check_answer',
      arguments: { question, claimed_answer: claimedAnswer },
    });
    return MathcoreClient.unwrap(res);
  }

  /** Stop the pool: fail in-flight calls, drop the cooldown, kill the child. */
  stop(): void {
    const child = this.proc;
    this.proc = null;
    this.startedAt = null;
    this.retryAt = 0;
    this.failures = 0;
    this.rejectPending(new Error(`${MATHCORE_MCP_COMMAND} client stopped`));
    try {
      child?.kill();
    } catch {
      // already gone
    }
  }
}

function defaultTimeout(raw: string | undefined): number {
  const parsed = parseInt(raw || String(DEFAULT_TIMEOUT_MS), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

/** Shared singleton used by the math tools. */
export const mathcore = new MathcoreClient();
