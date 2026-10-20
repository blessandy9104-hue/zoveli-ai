import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MATHCORE_MCP_BINARY_NAME,
  commandParts,
  resolveMathcoreCommand,
  venvMathcoreCandidates,
} from '../../packages/math-intelligence/src/resolve';

const created: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'zoveli-mathcore-resolve-'));
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

describe('mathcore-mcp resolution', () => {
  it('honors MATHCORE_MCP_COMMAND verbatim (args included)', () => {
    const resolved = resolveMathcoreCommand({
      env: { MATHCORE_MCP_COMMAND: 'custom-mathserver --flag' },
      cwd: tempDir(),
      platform: process.platform,
    });
    expect(resolved).toBe('custom-mathserver --flag');
  });

  it('finds the executable inside a project virtualenv', () => {
    const base = tempDir();
    const platform = process.platform;
    const [candidate] = venvMathcoreCandidates(base, platform);
    mkdirSync(join(candidate, '..'), { recursive: true });
    writeFileSync(candidate, '');
    expect(resolveMathcoreCommand({ env: {}, cwd: base, platform })).toBe(candidate);
  });

  it('falls back to PATH (PATHEXT aware on Windows)', () => {
    const base = tempDir();
    const platform = process.platform;
    const ext = platform === 'win32' ? '.exe' : '';
    const bin = join(base, MATHCORE_MCP_BINARY_NAME + ext);
    writeFileSync(bin, '');
    const env: NodeJS.ProcessEnv =
      platform === 'win32' ? { PATH: base, PATHEXT: '.EXE' } : { PATH: base };
    const resolved = resolveMathcoreCommand({ env, cwd: tempDir(), platform });
    expect(resolved.toLowerCase()).toBe(bin.toLowerCase());
  });

  it('returns the bare binary name when nothing matches', () => {
    const empty = tempDir();
    const resolved = resolveMathcoreCommand({
      env: { PATH: empty },
      cwd: tempDir(),
      platform: process.platform,
    });
    expect(resolved).toBe(MATHCORE_MCP_BINARY_NAME);
  });

  it('keeps existing paths with spaces intact and splits command lines', () => {
    const base = tempDir();
    const dir = join(base, 'my tools');
    mkdirSync(dir, { recursive: true });
    const exe = join(dir, 'mathcore mcp.exe');
    writeFileSync(exe, '');
    expect(commandParts(exe)).toEqual({ command: exe, args: [] });
    expect(commandParts('python -m mathcore.mcp_server')).toEqual({
      command: 'python',
      args: ['-m', 'mathcore.mcp_server'],
    });
    expect(commandParts('')).toEqual({ command: MATHCORE_MCP_BINARY_NAME, args: [] });
  });

  it('unquotes double-quoted tokens for paths with spaces', () => {
    expect(commandParts('"C:\\Program Files\\Python311\\python.exe" -m mathcore.mcp_server')).toEqual({
      command: 'C:\\Program Files\\Python311\\python.exe',
      args: ['-m', 'mathcore.mcp_server'],
    });
    expect(commandParts('"/opt/my tools/mathcore-mcp"')).toEqual({
      command: '/opt/my tools/mathcore-mcp',
      args: [],
    });
  });
});
