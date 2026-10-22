#!/usr/bin/env node

import { ZOVELI_VERSION } from '@zoveli/core/version';

function printHelp(): void {
  console.log(`zoveli ${ZOVELI_VERSION} — local-first AI assistant

Usage:
  zoveli                          start the interactive assistant
  zoveli config-check [--json]    validate environment configuration
  zoveli health [--offline]       runtime/config/vault/MCP health rollup
  zoveli plugins [--json]         list plugin inventory and mount status
  zoveli recovery-check           prove backup/restore works in isolation
  zoveli backup|verify|restore|migrate   vault maintenance
  zoveli --version                print the version
  zoveli --help                   show this help

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
  // Command modules load lazily: --version/--help never import the host, and
  // each subcommand pays only for the graph it needs.
  if (argv[0] === 'config-check') {
    const { runConfigCheck } = await import('./config-check.js');
    process.exitCode = await runConfigCheck(argv.slice(1));
    return;
  }
  if (argv[0] === 'health') {
    const { runHealth } = await import('./health.js');
    process.exitCode = await runHealth(argv.slice(1));
    return;
  }
  if (argv[0] === 'plugins') {
    const { runPlugins } = await import('./plugins.js');
    process.exitCode = await runPlugins(argv.slice(1));
    return;
  }
  if (argv[0] === 'recovery-check') {
    const { runRecoveryCheck } = await import('./recovery-check.js');
    process.exitCode = await runRecoveryCheck(argv.slice(1));
    return;
  }
  const maintenance = await import('./maintenance.js');
  if (maintenance.isMaintenanceCommand(argv[0])) {
    process.exitCode = await maintenance.runMaintenanceCommand(argv);
    return;
  }
  // Unknown first tokens used to fall through and open the REPL, which made
  // typos look like a successful launch. Usage errors are exit code 2.
  if (argv.length > 0) {
    const first = argv[0];
    console.error(
      first.startsWith('-')
        ? `zoveli: unknown option '${first}' (run zoveli --help)`
        : `zoveli: unknown command '${first}' (run zoveli --help)`
    );
    process.exitCode = 2;
    return;
  }
  const { boot } = await import('@zoveli/host');
  // SIGINT lifecycle is owned by the REPL (stops mathcore, closes readline).
  await boot();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
