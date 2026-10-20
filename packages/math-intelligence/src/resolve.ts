import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Where the `mathcore-mcp` binary is looked up, in order:
 *   1. MATHCORE_MCP_COMMAND (explicit override; may include args)
 *   2. <cwd>/.venv/Scripts/mathcore-mcp.exe (Windows) or .venv/bin/mathcore-mcp
 *   3. PATH (honoring PATHEXT on Windows)
 *   4. the bare name (spawn fails with an actionable error at call time)
 *
 * Keeping the lookup here means the transport, the MCP registration and the
 * doctor all agree on the same executable.
 */
export const MATHCORE_MCP_BINARY_NAME = 'mathcore-mcp';

export interface ResolveMathcoreOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  platform?: NodeJS.Platform;
  pathExt?: string;
}

function isFile(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function pathExtensions(platform: NodeJS.Platform, pathExt: string | undefined): string[] {
  if (platform !== 'win32') return [''];
  const exts = (pathExt || '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .map((ext) => ext.trim())
    .filter(Boolean);
  return exts.length > 0 ? exts : ['.EXE', '.CMD', '.BAT'];
}

function findOnPath(name: string, options: ResolveMathcoreOptions): string | undefined {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const pathVar = env.PATH ?? env.Path ?? '';
  for (const rawDir of pathVar.split(path.delimiter)) {
    const dir = rawDir.replace(/^"|"$/g, '');
    if (!dir) continue;
    for (const ext of pathExtensions(platform, options.pathExt ?? env.PATHEXT)) {
      const candidate = path.join(dir, name + ext);
      if (isFile(candidate)) return candidate;
    }
  }
  return undefined;
}

/** Candidate locations of the console script inside a project virtualenv. */
export function venvMathcoreCandidates(
  cwd: string,
  platform: NodeJS.Platform = process.platform
): string[] {
  if (platform === 'win32') {
    return [path.join(cwd, '.venv', 'Scripts', `${MATHCORE_MCP_BINARY_NAME}.exe`)];
  }
  return [path.join(cwd, '.venv', 'bin', MATHCORE_MCP_BINARY_NAME)];
}

export function resolveMathcoreCommand(options: ResolveMathcoreOptions = {}): string {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const platform = options.platform ?? process.platform;

  const explicit = env.MATHCORE_MCP_COMMAND?.trim();
  if (explicit) return explicit;

  for (const candidate of venvMathcoreCandidates(cwd, platform)) {
    if (isFile(candidate)) return candidate;
  }
  return findOnPath(MATHCORE_MCP_BINARY_NAME, options) ?? MATHCORE_MCP_BINARY_NAME;
}

/**
 * True when the resolved command (or its executable) exists on this machine.
 * Used to skip speculative warmups instead of triggering a failed spawn.
 */
export function mathcoreCommandAvailable(options: ResolveMathcoreOptions = {}): boolean {
  const { command } = commandParts(resolveMathcoreCommand(options));
  if (isFile(command)) return true;
  if (/[\\/]/.test(command) || /^[A-Za-z]:/.test(command)) return false;
  return !!findOnPath(command, options);
}

/** Whitespace split that honors double-quoted segments (paths with spaces). */
export function splitCommandLine(commandLine: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quoted = false;
  for (const ch of commandLine) {
    if (ch === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && /\s/.test(ch)) {
      if (current) {
        parts.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }
  if (current) parts.push(current);
  return parts;
}

/**
 * Split a command line into a spawnable command + argv. An existing file path
 * (even with spaces) is never split; otherwise whitespace separates tokens so
 * `python -m mathcore.mcp_server` works as MATHCORE_MCP_COMMAND, and
 * double-quoted tokens keep paths like `"C:\Program Files\...\python.exe"` whole.
 */
export function commandParts(commandLine: string): { command: string; args: string[] } {
  const trimmed = (commandLine ?? '').trim();
  if (!trimmed) return { command: MATHCORE_MCP_BINARY_NAME, args: [] };
  if (isFile(trimmed)) return { command: trimmed, args: [] };
  const parts = splitCommandLine(trimmed);
  if (parts.length === 0) return { command: MATHCORE_MCP_BINARY_NAME, args: [] };
  if (parts.length === 1) return { command: parts[0], args: [] };
  return { command: parts[0], args: parts.slice(1) };
}
