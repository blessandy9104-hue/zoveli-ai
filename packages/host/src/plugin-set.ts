import type { ZoveliPlugin } from '@deepseek-ai/dsh-core';

/**
 * Resolve the mount list from a base set plus opt-in plugins named in
 * `ZOVELI_PLUGINS`. Unknown names fail fast with the available list instead
 * of silently starting without the plugin. Pure: callers pass the sets.
 */
export function selectPlugins(
  env: Record<string, string | undefined>,
  base: readonly ZoveliPlugin[],
  optional: readonly ZoveliPlugin[]
): ZoveliPlugin[] {
  const requested = (env.ZOVELI_PLUGINS ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  if (requested.length === 0) return [...base];

  const byName = new Map(optional.map((plugin) => [plugin.name, plugin]));
  const unknown = [...new Set(requested)].filter((name) => !byName.has(name));
  if (unknown.length > 0) {
    const available = [...byName.keys()].sort();
    throw new Error(
      `unknown optional plugin(s): ${unknown.join(', ')}. ` +
        `Available: ${available.length > 0 ? available.join(', ') : '(none)'}. ` +
        'Scaffold one with: pnpm create:plugin <name> --mount'
    );
  }

  const out = [...base];
  for (const name of new Set(requested)) {
    const plugin = byName.get(name)!;
    if (!out.some((existing) => existing.name === plugin.name)) out.push(plugin);
  }
  return out;
}
