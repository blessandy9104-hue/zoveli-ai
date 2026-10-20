import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Opt-in JSONL sink for structured tool-call events. The in-memory trace stays
 * bounded; when `ZOVELI_TRACE_LOG` is set, each event is also appended to a
 * rotating file (size-bounded) with the same redaction applied by the host.
 */

export const DEFAULT_LOG_MAX_BYTES = 5_000_000;
export const DEFAULT_LOG_KEEP = 3;
const MIN_LOG_MAX_BYTES = 1024;
const MAX_LOG_KEEP = 20;

export interface StructuredLogOptions {
  file: string;
  maxBytes?: number;
  keep?: number;
}

export interface StructuredLogStats {
  file: string;
  maxBytes: number;
  keep: number;
  written: number;
  rotations: number;
  lastError: string | null;
}

function intFromEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalize(options: StructuredLogOptions): Required<StructuredLogOptions> {
  return {
    file: path.resolve(options.file),
    maxBytes: Math.max(MIN_LOG_MAX_BYTES, options.maxBytes ?? DEFAULT_LOG_MAX_BYTES),
    keep: Math.max(0, Math.min(MAX_LOG_KEEP, options.keep ?? DEFAULT_LOG_KEEP)),
  };
}

/** Read the opt-in sink configuration from the environment. */
export function resolveStructuredLog(
  env: NodeJS.ProcessEnv = process.env
): StructuredLogOptions | null {
  const file = env.ZOVELI_TRACE_LOG?.trim();
  if (!file) return null;
  return {
    file,
    maxBytes: Math.max(
      MIN_LOG_MAX_BYTES,
      intFromEnv(env.ZOVELI_TRACE_LOG_MAX_BYTES, DEFAULT_LOG_MAX_BYTES)
    ),
    keep: Math.max(0, Math.min(MAX_LOG_KEEP, intFromEnv(env.ZOVELI_TRACE_LOG_KEEP, DEFAULT_LOG_KEEP))),
  };
}

export function needsRotation(file: string, incomingBytes: number, maxBytes: number): boolean {
  try {
    return fs.statSync(file).size + incomingBytes > maxBytes;
  } catch {
    return false;
  }
}

/**
 * Shift `file` -> `file.1`, `file.1` -> `file.2`, ... keeping `keep` backups.
 * `keep = 0` truncates instead of rotating, so the disk stays bounded.
 */
export function rotateStructuredLog(file: string, keep: number): void {
  if (keep <= 0) {
    fs.rmSync(file, { force: true });
    return;
  }
  fs.rmSync(`${file}.${keep}`, { force: true });
  for (let index = keep - 1; index >= 1; index -= 1) {
    const from = `${file}.${index}`;
    if (fs.existsSync(from)) fs.renameSync(from, `${file}.${index + 1}`);
  }
  if (fs.existsSync(file)) fs.renameSync(file, `${file}.1`);
}

export class StructuredLogSink {
  readonly options: Required<StructuredLogOptions>;
  private written = 0;
  private rotations = 0;
  private lastError: string | null = null;
  private disabled = false;

  constructor(options: StructuredLogOptions) {
    this.options = normalize(options);
  }

  /** Best-effort append; a broken sink disables itself and never throws. */
  write(event: Record<string, unknown>): void {
    if (this.disabled) return;
    let line: string;
    try {
      line = `${JSON.stringify(event)}\n`;
    } catch (e) {
      this.fail(e);
      return;
    }
    try {
      fs.mkdirSync(path.dirname(this.options.file), { recursive: true });
      const incoming = Buffer.byteLength(line, 'utf8');
      if (needsRotation(this.options.file, incoming, this.options.maxBytes)) {
        rotateStructuredLog(this.options.file, this.options.keep);
        this.rotations += 1;
      }
      fs.appendFileSync(this.options.file, line, 'utf8');
      this.written += 1;
    } catch (e) {
      this.fail(e);
    }
  }

  stats(): StructuredLogStats {
    return {
      file: this.options.file,
      maxBytes: this.options.maxBytes,
      keep: this.options.keep,
      written: this.written,
      rotations: this.rotations,
      lastError: this.lastError,
    };
  }

  private fail(error: unknown): void {
    this.disabled = true;
    this.lastError = error instanceof Error ? error.message : String(error);
    console.error(`[zoveli] structured log disabled: ${this.lastError}`);
  }
}
