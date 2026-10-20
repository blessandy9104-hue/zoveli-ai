import { configAuditReport } from '@zoveli/config-audit';
import { chatConfigFromEnv } from '@zoveli/host';
import { resolveMathcoreCommand } from '@zoveli/math-intelligence';
import { exportEnabled, resolveDbPath, resolveVaultPath } from '@zoveli/memory-store';

interface ParsedFlags {
  json: boolean;
  help: boolean;
  db?: string;
}

function parseFlags(argv: string[]): ParsedFlags {
  const flags: ParsedFlags = { json: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') flags.json = true;
    else if (arg === '--help' || arg === '-h') flags.help = true;
    else if (arg.startsWith('--db=')) flags.db = arg.slice('--db='.length);
    else if (arg === '--db') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error('--db requires a value');
      flags.db = value;
      i += 1;
    } else if (arg.startsWith('-')) {
      throw new Error(`unknown option: ${arg}`);
    } else {
      throw new Error(`unexpected argument: ${arg}`);
    }
  }
  return flags;
}

function usage(): string {
  return `zoveli config drift check
  assistant config-check [--db PATH] [--json]

Reports environment variables and vault schema that drifted from what this
Zoveli version expects — typos, values that are silently ignored, removed
variables, and a vault schema that is older or newer than supported.
Secrets are never printed. Exit code 1 when a blocking problem is found.`;
}

/** Base URLs can embed credentials (e.g. a proxy userinfo); never echo them. */
function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) {
      parsed.username = '***';
      parsed.password = '***';
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

export async function runConfigCheck(argv: string[]): Promise<number> {
  try {
    const flags = parseFlags(argv);
    if (flags.help) {
      console.log(usage());
      return 0;
    }
    const dbPath = flags.db ?? resolveDbPath();
    const report = configAuditReport({ env: process.env, dbPath });

    const chat = chatConfigFromEnv();
    const effective = {
      chat: chat
        ? { provider: chat.provider ?? 'custom', model: chat.model, baseUrl: redactUrl(chat.baseUrl) }
        : null,
      memory: { dbPath, vaultPath: resolveVaultPath(), markdownMirror: exportEnabled() },
      math: { command: resolveMathcoreCommand() },
    };

    if (flags.json) {
      console.log(
        JSON.stringify(
          {
            ready: report.ready,
            warnings: report.warnings,
            failures: report.failures,
            issues: report.issues,
            vault: report.vault,
            effective,
          },
          null,
          2
        )
      );
    } else {
      for (const issue of report.issues) {
        const tag = issue.level === 'ok' ? 'ok  ' : issue.level === 'info' ? 'info' : issue.level === 'warn' ? 'warn' : 'FAIL';
        console.log(`[${tag}] ${issue.name} — ${issue.detail}`);
        if (issue.fix) console.log(`       fix: ${issue.fix}`);
      }
      console.log('');
      console.log(
        `chat: ${
          effective.chat
            ? `${effective.chat.provider} (model=${effective.chat.model}, base=${effective.chat.baseUrl})`
            : 'none — tools-only unless local Ollama answers'
        }`
      );
      console.log(
        `memory: db=${effective.memory.dbPath}; mirror=${effective.memory.markdownMirror ? 'on' : 'off'}; vault=${effective.memory.vaultPath}`
      );
      console.log(`math: ${effective.math.command}`);
      console.log(
        `\nconfig: ${report.ready ? 'ready' : 'NOT ready'} (${report.warnings} warning${report.warnings === 1 ? '' : 's'}, ${report.failures} blocking)`
      );
    }
    return report.ready ? 0 : 1;
  } catch (e) {
    console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}
