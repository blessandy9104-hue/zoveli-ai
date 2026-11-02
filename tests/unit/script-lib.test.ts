import { describe, expect, it } from 'vitest';
import { parseArgs } from '../../scripts/lib/args.mjs';
import { launcherInvocation, quoteArg, runSync, safeExecutablePath } from '../../scripts/lib/process.mjs';

function parse(argv: string[]) {
  return parseArgs(argv, {
    positional: 'name',
    defaults: { out: 'release', archive: true, maxSeconds: 600, keep: false },
    values: {
      '--out': { key: 'out', parse: (value: string) => `resolved:${value}` },
      '--max-seconds': { key: 'maxSeconds', parse: Number },
    },
    booleans: {
      '--no-archive': ['archive', false],
      '--keep': 'keep',
      '--help': 'help',
    },
  });
}

describe('script argument parser', () => {
  it('parses values, equals forms, negated flags and positionals', () => {
    expect(parse(['demo', '--out=dist', '--max-seconds', '30', '--no-archive', '--keep'])).toEqual({
      out: 'resolved:dist',
      archive: false,
      maxSeconds: 30,
      keep: true,
      name: 'demo',
    });
  });

  it('rejects unknown, duplicate, and malformed arguments', () => {
    expect(() => parse(['--watch'])).toThrow('unknown option: --watch');
    expect(() => parse(['one', 'two'])).toThrow('unexpected argument: two');
    expect(() => parse(['--out'])).toThrow('--out requires a value');
    expect(() => parse(['--out='])).toThrow('--out requires a value');
    expect(() => parse(['--keep=true'])).toThrow('option does not take a value: --keep');
  });
});

describe('script process helpers', () => {
  it('quotes Windows arguments without changing their bytes', () => {
    expect(quoteArg('plain')).toBe('plain');
    expect(quoteArg('two words')).toBe('"two words"');
    expect(quoteArg('say "hi"')).toBe('"say \\"hi\\""');
    expect(() => quoteArg('line\nbreak')).toThrow('unsafe control character');
  });

  it('rejects unsafe executable paths', () => {
    expect(safeExecutablePath('C:\\Zoveli\\zoveli.cmd')).toBe('C:\\Zoveli\\zoveli.cmd');
    expect(() => safeExecutablePath('')).toThrow('unsafe executable path');
    expect(() => safeExecutablePath('bad"\npath')).toThrow('unsafe executable path');
  });

  it('builds the cmd.exe launcher command on Windows and a direct command elsewhere', () => {
    expect(launcherInvocation('C:\\Program Files\\zoveli.cmd', ['--version'], 'win32')).toEqual({
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', '""C:\\Program Files\\zoveli.cmd" --version"'],
      windowsVerbatimArguments: true,
    });
    expect(launcherInvocation('/usr/local/bin/zoveli', ['--help'], 'linux')).toEqual({
      command: '/usr/local/bin/zoveli',
      args: ['--help'],
    });
  });
});

describe('script process runner', () => {
  const node = process.execPath;

  it('returns stdout and forwards stdin', () => {
    const out = runSync(node, ['-e', 'process.stdin.pipe(process.stdout)'], { input: 'hello' });
    expect(out).toBe('hello');
  });

  it('throws with stderr detail by default', () => {
    expect(() =>
      runSync(node, ['-e', 'process.stderr.write("bad"); process.exit(3)'])
    ).toThrow('exited with code 3: bad');
  });

  it('supports each failure detail mode', () => {
    const script = 'process.stdout.write("out"); process.stderr.write("err"); process.exit(2)';
    expect(() => runSync(node, ['-e', script], { errorDetail: 'none' })).toThrow(
      /exited with code 2$/
    );
    expect(() => runSync(node, ['-e', script], { errorDetail: 'output' })).toThrow(
      'exited with code 2\nouterr'
    );
    expect(() => runSync(node, ['-e', script], { errorDetail: 'sections' })).toThrow(
      'exited with code 2\n--- stdout ---\nout\n--- stderr ---\nerr'
    );
  });

  it('propagates spawn failures', () => {
    expect(() => runSync('zoveli-command-that-does-not-exist', [])).toThrow();
  });
});
