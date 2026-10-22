import type { ZoveliPlugin } from '@deepseek-ai/dsh-core';

function parseNames(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
}

function availableNames(base: readonly ZoveliPlugin[], optional: readonly ZoveliPlugin[]): string {
  return [...base, ...optional]
    .map((plugin) => plugin.name)
    .sort()
    .join(', ');
}

/**
 * Resolve the mount list from a base set plus opt-in plugins named in
 * `ZOVELI_PLUGINS`, minus plugins named in `ZOVELI_DISABLE_PLUGINS`. Unknown
 * names fail fast with the available list instead of silently starting with
 * the wrong surface. Pure: callers pass the sets.
 */
export function selectPlugins(
  env: Record<string, string | undefined>,
  base: readonly ZoveliPlugin[],
  optional: readonly ZoveliPlugin[]
): ZoveliPlugin[] {
  const requested = parseNames(env.ZOVELI_PLUGINS);
  const disabled = [...new Set(parseNames(env.ZOVELI_DISABLE_PLUGINS))];
  const known = new Map([...base, ...optional].map((plugin) => [plugin.name, plugin]));

  const unknownDisabled = disabled.filter((name) => !known.has(name));
  if (unknownDisabled.length > 0) {
    throw new Error(
      `unknown plugin(s) to disable: ${unknownDisabled.join(', ')}. ` +
        `Available: ${availableNames(base, optional) || '(none)'}.`
    );
  }

  const conflicts = [...new Set(requested)].filter((name) => disabled.includes(name));
  if (conflicts.length > 0) {
    throw new Error(
      `plugin(s) both requested and disabled: ${conflicts.join(', ')}. ` +
        'Remove one of ZOVELI_PLUGINS / ZOVELI_DISABLE_PLUGINS.'
    );
  }

  const disabledSet = new Set(disabled);
  const out = base.filter((plugin) => !disabledSet.has(plugin.name));
  if (requested.length === 0) return out;

  const byName = new Map(optional.map((plugin) => [plugin.name, plugin]));
  const unknown = [...new Set(requested)].filter((name) => !byName.has(name) && !known.has(name));
  if (unknown.length > 0) {
    const available = [...byName.keys()].sort();
    throw new Error(
      `unknown optional plugin(s): ${unknown.join(', ')}. ` +
        `Available: ${available.length > 0 ? available.join(', ') : '(none)'}. ` +
        'Scaffold one with: pnpm create:plugin <name> --mount'
    );
  }

  for (const name of new Set(requested)) {
    const plugin = byName.get(name);
    if (plugin && !out.some((existing) => existing.name === plugin.name)) out.push(plugin);
  }
  return out;
}

export type PluginTier = 'default' | 'optional';
export type PluginStatus = 'enabled' | 'opt-in' | 'disabled';

export interface PluginInventoryEntry {
  name: string;
  tier: PluginTier;
  status: PluginStatus;
  description?: string;
  apiVersion?: number;
}

export interface PluginInventory {
  plugins: PluginInventoryEntry[];
  enabled: number;
  disabled: number;
  optIn: number;
}

/**
 * Describe every known plugin and whether the current environment mounts it.
 * Validates the environment through `selectPlugins`, so a typo in either
 * plugin variable is reported instead of producing a misleading listing.
 */
export function pluginInventory(
  env: Record<string, string | undefined>,
  base: readonly ZoveliPlugin[],
  optional: readonly ZoveliPlugin[]
): PluginInventory {
  const enabled = new Set(selectPlugins(env, base, optional).map((plugin) => plugin.name));
  const disabled = new Set(parseNames(env.ZOVELI_DISABLE_PLUGINS));
  const plugins = [
    ...base.map((plugin) => ({ plugin, tier: 'default' as const })),
    ...optional.map((plugin) => ({ plugin, tier: 'optional' as const })),
  ].map(({ plugin, tier }): PluginInventoryEntry => ({
    name: plugin.name,
    tier,
    status: disabled.has(plugin.name) ? 'disabled' : enabled.has(plugin.name) ? 'enabled' : 'opt-in',
    description: plugin.description,
    apiVersion: plugin.apiVersion,
  }));
  return {
    plugins,
    enabled: plugins.filter((plugin) => plugin.status === 'enabled').length,
    disabled: plugins.filter((plugin) => plugin.status === 'disabled').length,
    optIn: plugins.filter((plugin) => plugin.status === 'opt-in').length,
  };
}
