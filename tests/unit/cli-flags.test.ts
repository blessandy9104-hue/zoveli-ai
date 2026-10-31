import { describe, expect, it } from 'vitest';
import { parseFlags, type FlagDefinition } from '../../apps/cli/src/flags';

interface Flags {
  json: boolean;
  help: boolean;
  db?: string;
}

const DEFINITIONS = [
  { key: 'json', tokens: ['--json'] },
  { key: 'help', tokens: ['--help', '-h'] },
  { key: 'db', tokens: ['--db'], takesValue: true },
] as const satisfies readonly FlagDefinition<keyof Flags>[];

function parse(argv: string[], positional = false) {
  return parseFlags<Flags>(argv, { json: false, help: false }, DEFINITIONS, { positional });
}

describe('CLI flag parser', () => {
  it('parses boolean flags, aliases, and both value forms', () => {
    expect(parse(['--json', '-h', '--db=/tmp/a.db'])).toEqual({
      json: true,
      help: true,
      db: '/tmp/a.db',
      positional: [],
    });
    expect(parse(['--db', '/tmp/b.db']).db).toBe('/tmp/b.db');
    expect(parse([])).toEqual({ json: false, help: false, positional: [] });
  });

  it('collects positional arguments only when the command allows them', () => {
    expect(parse(['one', 'two'], true).positional).toEqual(['one', 'two']);
    expect(() => parse(['one'])).toThrow('unexpected argument: one');
  });

  it('rejects malformed and unknown flags', () => {
    expect(() => parse(['--watch'])).toThrow('unknown option: --watch');
    expect(() => parse(['--json=true'])).toThrow('option does not take a value: --json');
    expect(() => parse(['--db'])).toThrow('--db requires a value');
    expect(() => parse(['--db', '--json'])).toThrow('--db requires a value');
    expect(() => parse(['--db='])).toThrow('--db requires a value');
  });

  it('rejects duplicate flag definitions', () => {
    const duplicate = [
      { key: 'json', tokens: ['--json'] },
      { key: 'help', tokens: ['--json'] },
    ] as const satisfies readonly FlagDefinition<keyof Flags>[];
    expect(() => parseFlags<Flags>(['--json'], { json: false, help: false }, duplicate)).toThrow(
      'duplicate flag definition: --json'
    );
  });
});
