/**
 * Parse script arguments with one shared table.
 *
 * Value options accept both `--flag value` and `--flag=value`. Boolean options
 * can assign `true` by default or an explicit value via `[key, value]`, which
 * covers negated flags such as `--no-archive`.
 *
 * @param {readonly string[]} argv
 * @param {{
 *   defaults?: Record<string, unknown>,
 *   booleans?: Record<string, string | [string, boolean]>,
 *   values?: Record<string, string | { key: string, parse?: (raw: string) => unknown }>,
 *   positional?: string,
 * }} [spec]
 * @returns {Record<string, any>}
 */
export function parseArgs(argv, spec = {}) {
  const { defaults = {}, booleans = {}, values = {}, positional } = spec;
  const options = { ...defaults };
  const booleanFlags = new Map();
  const valueFlags = new Map();

  for (const [token, target] of Object.entries(booleans)) {
    if (booleanFlags.has(token) || valueFlags.has(token)) {
      throw new Error(`duplicate option definition: ${token}`);
    }
    const [key, assigned] = Array.isArray(target) ? target : [target, true];
    booleanFlags.set(token, { key, assigned });
  }
  for (const [token, target] of Object.entries(values)) {
    if (booleanFlags.has(token) || valueFlags.has(token)) {
      throw new Error(`duplicate option definition: ${token}`);
    }
    valueFlags.set(token, typeof target === 'string' ? { key: target } : target);
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    let token = arg;
    let inlineValue;
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
      options[boolean.key] = boolean.assigned;
      continue;
    }

    const value = valueFlags.get(token);
    if (value) {
      const raw = inlineValue ?? argv[i + 1];
      if (raw === undefined || raw === '' || raw.startsWith('--')) {
        throw new Error(`${token} requires a value`);
      }
      if (inlineValue === undefined) i += 1;
      options[value.key] = value.parse ? value.parse(raw) : raw;
      continue;
    }

    if (arg.startsWith('-')) throw new Error(`unknown option: ${arg}`);
    if (!positional) throw new Error(`unexpected argument: ${arg}`);
    if (options[positional] !== undefined) throw new Error(`unexpected argument: ${arg}`);
    options[positional] = arg;
  }

  return options;
}
