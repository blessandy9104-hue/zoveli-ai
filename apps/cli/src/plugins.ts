import { describePlugins, type PluginInventory } from '@zoveli/host';
import { parseFlags, type FlagDefinition } from './flags.js';

interface ParsedFlags {
  json: boolean;
  help: boolean;
}

const FLAGS = [
  { key: 'json', tokens: ['--json'] },
  { key: 'help', tokens: ['--help', '-h'] },
] as const satisfies readonly FlagDefinition<keyof ParsedFlags>[];

function usage(): string {
  return `zoveli plugin inventory
  zoveli plugins [--json]

Lists built-in (default) and optional plugins with their current mount status.
ZOVELI_PLUGINS adds optional plugins; ZOVELI_DISABLE_PLUGINS removes any
plugin by name. Unknown names fail startup instead of being ignored.`;
}

function compact(text: string | undefined): string {
  const value = (text ?? '').replace(/\s+/g, ' ').trim();
  return value.length > 88 ? `${value.slice(0, 85)}...` : value;
}

function printInventory(inventory: PluginInventory): void {
  const nameWidth = Math.max('NAME'.length, ...inventory.plugins.map((plugin) => plugin.name.length));
  const tierWidth = Math.max('TIER'.length, ...inventory.plugins.map((plugin) => plugin.tier.length));
  const statusWidth = Math.max('STATUS'.length, ...inventory.plugins.map((plugin) => plugin.status.length));
  console.log(
    `zoveli plugins: ${inventory.enabled} enabled, ${inventory.optIn} opt-in, ` +
      `${inventory.disabled} disabled (${inventory.plugins.length} total)\n`
  );
  console.log(
    `${'NAME'.padEnd(nameWidth)}  ${'TIER'.padEnd(tierWidth)}  ${'STATUS'.padEnd(statusWidth)}  DESCRIPTION`
  );
  for (const plugin of inventory.plugins) {
    console.log(
      `${plugin.name.padEnd(nameWidth)}  ${plugin.tier.padEnd(tierWidth)}  ` +
        `${plugin.status.padEnd(statusWidth)}  ${compact(plugin.description)}`
    );
  }
  const requested = (process.env.ZOVELI_PLUGINS ?? '').trim();
  const disabled = (process.env.ZOVELI_DISABLE_PLUGINS ?? '').trim();
  if (requested || disabled) {
    console.log('');
    if (requested) console.log(`ZOVELI_PLUGINS=${requested}`);
    if (disabled) console.log(`ZOVELI_DISABLE_PLUGINS=${disabled}`);
  }
}

export async function runPlugins(argv: string[]): Promise<number> {
  try {
    const flags = parseFlags<ParsedFlags>(argv, { json: false, help: false }, FLAGS);
    if (flags.help) {
      console.log(usage());
      return 0;
    }
    const inventory = describePlugins();
    if (flags.json) {
      console.log(JSON.stringify(inventory, null, 2));
    } else {
      printInventory(inventory);
    }
    return 0;
  } catch (e) {
    console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}
