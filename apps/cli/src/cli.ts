#!/usr/bin/env node

import { boot } from '@zoveli/host';
import { isMaintenanceCommand, runMaintenanceCommand } from './maintenance.js';
import { runConfigCheck } from './config-check.js';

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === 'config-check') {
    process.exitCode = await runConfigCheck(argv.slice(1));
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
