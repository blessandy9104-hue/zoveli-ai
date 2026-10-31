/** Quote one Windows command-line argument without changing its bytes. */
export function quoteArg(value) {
  const text = String(value);
  if (text.includes('\0') || /[\r\n%]/.test(text)) {
    throw new Error('unsafe control character in argument');
  }
  if (!/[ \t"]/.test(text)) return text;
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
