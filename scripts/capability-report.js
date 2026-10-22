#!/usr/bin/env node
/**
 * Generate a capability awareness report (markdown to stdout).
 *
 * Usage:
 *   pnpm run build
 *   node scripts/capability-report.js > capability-report.md
 */
const { CapabilityScanner } = require('../packages/capability/dist/scanner.js');
const { CapabilityRegistry } = require('../packages/capability/dist/registry.js');
const { CapabilityAdaptation } = require('../packages/capability/dist/adaptation.js');
const { ZoveliHost, defaultPlugins } = require('../packages/host/dist/index.js');

async function main() {
  const host = new ZoveliHost();
  host.mount(defaultPlugins);
  const ctx = host.ctx;
  const scanner = new CapabilityScanner(ctx);
  const registry = new CapabilityRegistry(ctx);
  const adaptation = new CapabilityAdaptation(ctx, scanner, registry);

  const caps = await scanner.scanAll();
  for (const cap of caps) registry.register(cap);

  const report = await adaptation.generateReport('markdown', true);
  console.log(typeof report === 'string' ? report : JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error('report failed:', e.message);
  process.exit(1);
});

