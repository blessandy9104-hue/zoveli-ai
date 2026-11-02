import { spawnSync } from 'node:child_process';

/** Quote one Windows command-line argument without changing its bytes. */
export function quoteArg(value) {
  const text = String(value);
  if (text.includes('\0') || /[\r\n%]/.test(text)) {
    throw new Error('unsafe control character in argument');
  }
  // Quote when cmd.exe would otherwise treat the value as an operator.
  if (!/[ \t"&|<>^()]/.test(text)) return text;
  const escaped = text.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1');
  return `"${escaped}"`;
}

/** Reject executable paths that cannot be passed safely through cmd.exe. */
export function safeExecutablePath(value) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.includes('\0') ||
    /["\r\n%]/.test(value)
  ) {
    throw new Error('unsafe executable path');
  }
  return value;
}

/**
 * Build the command used to run a launcher, working around the Windows
 * cmd.exe quoting rules that a direct spawn would bypass.
 *
 * @param {string} launcher
 * @param {readonly string[]} args
 * @param {NodeJS.Platform} [platform]
 * @returns {{ command: string, args: string[], windowsVerbatimArguments?: true }}
 */
export function launcherInvocation(launcher, args, platform = process.platform) {
  if (platform !== 'win32') return { command: launcher, args: [...args] };
  const exe = safeExecutablePath(launcher);
  return {
    command: 'cmd.exe',
    args: [
      '/d',
      '/s',
      '/c',
      args.length ? `""${exe}" ${args.map(quoteArg).join(' ')}"` : `""${exe}""`,
    ],
    windowsVerbatimArguments: true,
  };
}

/**
 * Run a command synchronously and throw when it cannot start or exits non-zero.
 * `errorDetail` keeps each caller's established failure diagnostics:
 *
 * - `stderr` (default): append `: <stderr>`
 * - `output`: append stdout then stderr on a new line
 * - `sections`: append labelled stdout and stderr sections
 * - `none`: append nothing (for inherited stdio)
 *
 * @param {string} command
 * @param {readonly string[]} args
 * @param {import('node:child_process').SpawnSyncOptionsWithStringEncoding & {
 *   errorDetail?: 'stderr' | 'output' | 'sections' | 'none',
 * }} [options]
 * @returns {string}
 */
export function runSync(command, args, options = {}) {
  const { errorDetail = 'stderr', ...spawnOptions } = options;
  // `command` is either a literal or a path checked by safeExecutablePath, and
  // launcherInvocation quotes every argument cmd.exe could treat as an operator.
  const result = spawnSync(command, args, { encoding: 'utf8', ...spawnOptions });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const stdout = result.stdout || '';
    const stderr = result.stderr || '';
    let detail = '';
    if (errorDetail === 'stderr') {
      detail = `: ${stderr}`;
    } else if (errorDetail === 'output') {
      detail = `\n${stdout}${stderr}`;
    } else if (errorDetail === 'sections') {
      detail = `\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`;
    }
    throw new Error(`${command} ${args.join(' ')} exited with code ${result.status}${detail}`);
  }
  return result.stdout;
}
