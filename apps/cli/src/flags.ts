export type FlagPrimitive = string | boolean | undefined;

export interface FlagDefinition<Key extends string> {
  /** Result property populated by this flag. */
  key: Key;
  /** Accepted spellings, e.g. `['--help', '-h']`. */
  tokens: readonly string[];
  /** Consume a value (supports both `--flag value` and `--flag=value`). */
  takesValue?: boolean;
}

export interface ParseFlagsOptions {
  /** Collect non-option arguments instead of rejecting them. */
  positional?: boolean;
}

/**
 * Parse a subcommand's argv with one shared loop.
 *
 * Unknown options, missing values and unexpected arguments throw an Error so
 * each command keeps its existing `error: ...` + exit-code-1 behavior.
 */
export function parseFlags<T extends { [K in keyof T]: FlagPrimitive }>(
  argv: readonly string[],
  defaults: T,
  definitions: readonly FlagDefinition<Extract<keyof T, string>>[],
  options: ParseFlagsOptions = {}
): T & { positional: string[] } {
  const result = { ...defaults, positional: [] } as T & { positional: string[] };
  const booleanFlags = new Map<string, FlagDefinition<Extract<keyof T, string>>>();
  const valueFlags = new Map<string, FlagDefinition<Extract<keyof T, string>>>();

  for (const definition of definitions) {
    for (const token of definition.tokens) {
      const target = definition.takesValue ? valueFlags : booleanFlags;
      if (booleanFlags.has(token) || valueFlags.has(token)) {
        throw new Error(`duplicate flag definition: ${token}`);
      }
      target.set(token, definition);
    }
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    let token = arg;
    let inlineValue: string | undefined;
    if (arg.startsWith('--')) {
      const equals = arg.indexOf('=');
      if (equals !== -1) {
        token = arg.slice(0, equals);
        inlineValue = arg.slice(equals + 1);
      }
    }

    const boolean = booleanFlags.get(token);
    if (boolean) {
      if (inlineValue !== undefined) throw new Error(`option does not take a value: ${token}`);
      (result as Record<string, FlagPrimitive>)[boolean.key] = true;
      continue;
    }

    const value = valueFlags.get(token);
    if (value) {
      const parsed = inlineValue ?? argv[i + 1];
      if (parsed === undefined || parsed === '' || parsed.startsWith('--')) {
        throw new Error(`${token} requires a value`);
      }
      if (inlineValue === undefined) i += 1;
      (result as Record<string, FlagPrimitive>)[value.key] = parsed;
      continue;
    }

    if (arg.startsWith('-')) throw new Error(`unknown option: ${arg}`);
    if (!options.positional) throw new Error(`unexpected argument: ${arg}`);
    result.positional.push(arg);
  }

  return result;
}
