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
 */

interface PendingCall {
  resolve: (value: any) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class MathcoreClient {
  private proc: ChildProcess | null = null;
  private buffer = '';
  private pending = new Map<number, PendingCall>();
  private nextId = 1;
  private startError: Error | null = null;

  constructor(
    private readonly command = resolveMathcoreCommand(),
    private readonly timeoutMs = parseInt(
      process.env.MATHCORE_TIMEOUT_MS || '120000',
      10
    )
  ) {}

  get running(): boolean {
    return !!this.proc && this.proc.exitCode === null;
  }

  private ensureStarted(): void {
    if (this.running) return;
    if (this.startError && !this.proc) throw this.startError;
    const { command, args } = commandParts(this.command);
    try {
      this.proc = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'inherit'],
      });
    } catch (e) {
      this.startError =
        e instanceof Error ? e : new Error(`failed to spawn ${command}`);
      throw new Error(
        `${MATHCORE_MCP_COMMAND} server is not available (${this.startError.message}). ` +
          `Install the vendored engine with "python -m pip install -e ./mathcore" ` +
          `(activate .venv first), check it with "pnpm run doctor", or set ` +
          `MATHCORE_MCP_COMMAND to the full mathcore-mcp path.`
      );
    }
    this.buffer = '';
    this.proc.stdout?.on('data', (chunk: Buffer) => this.onData(chunk));
    this.proc.on('error', (err) => this.onDeath(this.describeStartFailure(err, command)));
    this.proc.on('exit', (code) =>
      this.onDeath(new Error(`${MATHCORE_MCP_COMMAND} exited with code ${code}`))
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

  private onDeath(err: Error): void {
    for (const [, call] of this.pending) {
      clearTimeout(call.timer);
      call.reject(err);
    }
    this.pending.clear();
    this.proc = null;
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

  stop(): void {
    try {
      this.proc?.kill();
    } catch {
      // already gone
    }
    this.proc = null;
  }
}

/** Shared singleton used by the math tools. */
export const mathcore = new MathcoreClient();
