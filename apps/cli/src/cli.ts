#!/usr/bin/env node

import { boot } from '@zoveli/host';
import { ZOVELI_VERSION } from '@zoveli/core';
import { isMaintenanceCommand, runMaintenanceCommand } from './maintenance.js';
import { runConfigCheck } from './config-check.js';
import { runHealth } from './health.js';

function printHelp(): void {
  console.log(`zoveli ${ZOVELI_VERSION} — local-first AI assistant

Usage:
  assistant                          start the interactive assistant
  assistant config-check [--json]    validate environment configuration
  assistant health [--offline]       runtime/config/vault/MCP health rollup
  assistant backup|verify|restore|migrate   vault maintenance
  assistant --version                print the version
  assistant --help                   show this help

Docs: docs/guides/cli.md · docs/guides/upgrading.md`);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === '--version' || argv[0] === '-v' || argv[0] === 'version') {
    console.log(`zoveli ${ZOVELI_VERSION}`);
    return;
  }
  if (argv[0] === '--help' || argv[0] === '-h' || argv[0] === 'help') {
    printHelp();
    return;
  }
  if (argv[0] === 'config-check') {
    process.exitCode = await runConfigCheck(argv.slice(1));
    return;
  }
  if (argv[0] === 'health') {
    process.exitCode = await runHealth(argv.slice(1));
    return;
  }
  if (isMaintenanceCommand(argv[0])) {
    process.exitCode = await runMaintenanceCommand(argv);
    return;
  }
  // SIGINT lifecycle is owned by the REPL (stops mathcore, closes readline).
  await boot();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
