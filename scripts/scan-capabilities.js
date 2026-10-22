#!/usr/bin/env node
/**
 * Scan all Zoveli capabilities and print JSON.
 *
 * Usage:
 *   pnpm run build
 *   node scripts/scan-capabilities.js
 */
const { CapabilityScanner } = require('../packages/capability/dist/scanner.js');
const { ZoveliHost, defaultPlugins } = require('../packages/host/dist/index.js');

async function main() {
  const host = new ZoveliHost();
  host.mount(defaultPlugins);
  const scanner = new CapabilityScanner(host.ctx);
  const caps = await scanner.scanAll();
  console.log(
    JSON.stringify(
      caps.map((c) => ({
        name: c.name,
        displayName: c.displayName,
        category: c.category,
        status: c.status,
        priority: c.priority,
        provides: c.provides,
        plugin: c.metadata.pluginId || c.metadata.mcpServer || null,
      })),
      null,
      2
    )
  );
  const available = caps.filter((c) => c.status === 'available').length;
  console.error(`\n${available}/${caps.length} capabilities available`);
}

main().catch((e) => {
  console.error('scan failed:', e.message);
  process.exit(1);
});

