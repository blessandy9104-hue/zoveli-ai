import * as fs from 'node:fs';
import * as path from 'node:path';
import { openDatabaseSync, resolveDbPath, SCHEMA_VERSION } from '@zoveli/memory-store';
import {
  ENV_REGISTRY,
  OBSOLETE_ENV,
  isKnownEnvName,
  isTrackedEnvName,
  suggestEnvName,
  type EnvSpec,
} from './registry.js';

export type AuditLevel = 'ok' | 'info' | 'warn' | 'fail';

export interface AuditIssue {
  level: AuditLevel;
  name: string;
  detail: string;
  fix?: string;
}

export interface VaultAudit {
  dbPath: string;
  exists: boolean;
  userVersion: number | null;
  expectedVersion: number;
  drift: 'none' | 'fresh' | 'older' | 'newer' | 'unreadable';
  detail: string;
}

export interface AuditReport {
  ready: boolean;
  warnings: number;
  failures: number;
  envSet: number;
  issues: AuditIssue[];
  vault: VaultAudit;
}

export interface AuditEnvOptions {
  /** Inject command resolution (tests); defaults to a real PATH scan. */
  commandResolves?: (command: string) => boolean;
  exists?: (p: string) => boolean;
  isDirectory?: (p: string) => boolean;
  isFile?: (p: string) => boolean;
  writable?: (p: string) => boolean;
}

export interface AuditOptions extends AuditEnvOptions {
  env?: Record<string, string | undefined>;
  dbPath?: string;
}

const PROVIDER_KEY_ORDER = [
  'ZOVELI_API_KEY',
  'OPENAI_API_KEY',
  'DEEPSEEK_API_KEY',
  'OPENROUTER_API_KEY',
  'GROQ_API_KEY',
  'TOGETHER_API_KEY',
];

const PLACEHOLDER_SECRET = /^(changeme|change-me|your[-_]?key|your[-_]?token|placeholder|example|xxx+|todo|dummy)$/i;

function hasValue(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}

function splitCommandLine(command: string): string {
  const trimmed = command.trim();
  if (trimmed.startsWith('"')) {
    const end = trimmed.indexOf('"', 1);
    return end > 1 ? trimmed.slice(1, end) : trimmed.slice(1);
  }
  return trimmed.split(/\s+/)[0] ?? '';
}

function defaultCommandResolves(command: string): boolean {
  const trimmed = command.trim();
  if (trimmed && fs.existsSync(trimmed)) return true;
  const program = splitCommandLine(trimmed);
  if (!program) return false;
  if (program.includes('/') || program.includes('\\') || program.startsWith('.')) {
    return fs.existsSync(program);
  }
  const exts =
    process.platform === 'win32'
      ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
      : [''];
  for (const rawDir of (process.env.PATH || '').split(path.delimiter)) {
    const dir = rawDir.replace(/^"|"$/g, '');
    if (!dir) continue;
    for (const ext of exts) {
      if (fs.existsSync(path.join(dir, program + ext))) return true;
    }
  }
  return false;
}

function defaultWritable(p: string): boolean {
  try {
    fs.accessSync(p, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function specIssue(spec: EnvSpec, detail: string, fix?: string): AuditIssue {
  return { level: 'warn', name: `env ${spec.name}`, detail, fix };
}

function checkNumber(spec: EnvSpec, value: string): AuditIssue | undefined {
  const numeric = spec.parse === 'float' ? Number(value) : /^[+-]?\d+$/.test(value.trim()) ? parseInt(value, 10) : NaN;
  if (!Number.isFinite(numeric)) {
    return specIssue(
      spec,
      `value is not a number — Zoveli falls back to ${spec.default ?? 'the default'}`,
      `set a numeric value or remove ${spec.name}`
    );
  }
  if (spec.min !== undefined && numeric < spec.min) {
    return specIssue(spec, `value ${numeric} is below the minimum ${spec.min}`, `use at least ${spec.min} or remove ${spec.name}`);
  }
  if (spec.max !== undefined && numeric > spec.max) {
    return specIssue(spec, `value ${numeric} is above the maximum ${spec.max}`, `use at most ${spec.max} or remove ${spec.name}`);
  }
  return undefined;
}

function checkBoolean01(spec: EnvSpec, value: string): AuditIssue | undefined {
  if (value === '0' || value === '1') return undefined;
  const detail =
    spec.toggle === 'disable'
      ? `value "${value}" has no effect; the feature is on unless the value is exactly "0"`
      : `value "${value}" has no effect; the feature is off unless the value is exactly "1"`;
  return specIssue(spec, detail, `set "${spec.toggle === 'disable' ? '0' : '1'}" to toggle, or remove ${spec.name}`);
}

function checkUrl(spec: EnvSpec, value: string): AuditIssue | undefined {
  try {
    const parsed = new URL(value);
    const protocols = spec.protocols ?? ['http:', 'https:'];
    if (!protocols.includes(parsed.protocol)) {
      return specIssue(spec, `protocol "${parsed.protocol}" is not supported`, `use ${protocols.join(' or ')}`);
    }
  } catch {
    return specIssue(spec, 'not a valid URL', `use a full URL such as ${spec.default ?? 'http://host:port'}`);
  }
  return undefined;
}

function checkPath(
  spec: EnvSpec,
  value: string,
  opts: Required<Pick<AuditEnvOptions, 'exists' | 'isDirectory' | 'isFile' | 'writable'>>
): AuditIssue | undefined {
  if (value.trim().startsWith('~')) {
    return specIssue(
      spec,
      'the "~" is not expanded by Zoveli; it would create a literal "~" directory',
      'use an absolute path (e.g. %USERPROFILE%\\... on Windows or $HOME/... on macOS/Linux)'
    );
  }
  const resolved = path.resolve(value);
  if (opts.exists(resolved)) {
    if (spec.kind === 'path-file' && opts.isDirectory(resolved)) {
      return specIssue(spec, 'points to a directory, but a file path is expected', 'point at a file path');
    }
    if (spec.kind === 'path-dir' && opts.isFile(resolved)) {
      return specIssue(spec, 'points to a file, but a directory path is expected', 'point at a directory path');
    }
    return undefined;
  }
  const parent = path.dirname(resolved);
  if (!opts.exists(parent)) {
    return specIssue(
      spec,
      `neither the path nor its parent directory (${parent}) exists`,
      'create the parent directory or fix the path'
    );
  }
  if (!opts.writable(parent)) {
    return specIssue(spec, `parent directory (${parent}) is not writable`, 'choose a writable location');
  }
  return undefined;
}

function checkSecret(spec: EnvSpec, value: string): AuditIssue | undefined {
  if (PLACEHOLDER_SECRET.test(value.trim())) {
    return specIssue(spec, 'looks like a placeholder value', 'replace it with the real value or remove the variable');
  }
  if (spec.minLength !== undefined && value.length < spec.minLength) {
    return specIssue(
      spec,
      `value has ${value.length} characters but ${spec.minLength}+ are required; it is ignored`,
      `use a value of at least ${spec.minLength} characters, or remove ${spec.name}`
    );
  }
  return undefined;
}

function checkEnum(spec: EnvSpec, value: string): AuditIssue | undefined {
  if (spec.values?.includes(value)) return undefined;
  return specIssue(spec, `value "${value}" is not recognized (silently ignored)`, `use one of: ${spec.values?.join(', ')}`);
}

function checkCommand(
  spec: EnvSpec,
  value: string,
  resolves: (command: string) => boolean
): AuditIssue | undefined {
  if (resolves(value)) return undefined;
  return {
    level: 'fail',
    name: `env ${spec.name}`,
    detail: `"${splitCommandLine(value)}" does not resolve — math tools will fail to start`,
    fix: 'fix the path/command, or unset it to use .venv/PATH auto-detection; verify with: mathcore "2+2"',
  };
}

export function auditEnv(
  env: Record<string, string | undefined> = process.env,
  options: AuditEnvOptions = {}
): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const exists = options.exists ?? fs.existsSync;
  const isDirectory = options.isDirectory ?? ((p: string) => fs.statSync(p).isDirectory());
  const isFile = options.isFile ?? ((p: string) => fs.statSync(p).isFile());
  const writable = options.writable ?? defaultWritable;
  const commandResolves = options.commandResolves ?? defaultCommandResolves;

  for (const spec of ENV_REGISTRY) {
    const value = env[spec.name];
    if (!hasValue(value)) continue;
    let issue: AuditIssue | undefined;
    switch (spec.kind) {
      case 'number':
        issue = checkNumber(spec, value);
        break;
      case 'boolean01':
        issue = checkBoolean01(spec, value);
        break;
      case 'url':
        issue = checkUrl(spec, value);
        break;
      case 'path-file':
      case 'path-dir':
        issue = checkPath(spec, value, { exists, isDirectory, isFile, writable });
        break;
      case 'secret':
        issue = checkSecret(spec, value);
        break;
      case 'enum':
        issue = checkEnum(spec, value);
        break;
      case 'command':
        issue = checkCommand(spec, value, commandResolves);
        break;
      default:
        break;
    }
    if (issue) issues.push(issue);
  }

  const activeProviderKeys = PROVIDER_KEY_ORDER.filter((key) => hasValue(env[key]));
  if (activeProviderKeys.length > 1) {
    issues.push({
      level: 'info',
      name: 'env chat keys',
      detail: `multiple chat API keys set — "${activeProviderKeys[0]}" wins (precedence order)`,
      fix: `remove the keys you do not want to use: ${activeProviderKeys.slice(1).join(', ')}`,
    });
  }
  if (hasValue(env.ZOVELI_API_BASE) && activeProviderKeys.length === 0) {
    issues.push({
      level: 'warn',
      name: 'env ZOVELI_API_BASE',
      detail: 'ignored: no chat API key is set',
      fix: 'set ZOVELI_API_KEY or a provider key, or remove ZOVELI_API_BASE',
    });
  }
  if (activeProviderKeys.length === 0) {
    issues.push({
      level: 'info',
      name: 'env chat provider',
      detail: 'no chat API key set — the free local Ollama server is probed at start-up',
      fix: 'optional: set any provider API key, or install Ollama (https://ollama.com)',
    });
  }

  for (const name of Object.keys(env)) {
    if (!hasValue(env[name]) || isKnownEnvName(name)) continue;
    const obsolete = OBSOLETE_ENV.find((o) => o.name === name);
    if (obsolete) {
      issues.push({
        level: 'warn',
        name: `env ${name}`,
        detail: obsolete.detail,
        fix: 'remove it from your environment',
      });
      continue;
    }
    if (!isTrackedEnvName(name)) continue;
    const suggestion = suggestEnvName(name);
    issues.push({
      level: 'warn',
      name: `env ${name}`,
      detail: 'not recognized by this Zoveli version (silently ignored)',
      fix: suggestion
        ? `did you mean ${suggestion}? otherwise remove it or check docs/guides/cli.md`
        : 'remove it or check docs/guides/cli.md for the supported variables',
    });
  }

  return issues;
}

export function auditVault(dbPath: string = resolveDbPath()): VaultAudit {
  const expectedVersion = SCHEMA_VERSION;
  if (dbPath === ':memory:') {
    return {
      dbPath,
      exists: false,
      userVersion: null,
      expectedVersion,
      drift: 'fresh',
      detail: 'in-memory database; nothing to migrate',
    };
  }
  if (!fs.existsSync(dbPath)) {
    return {
      dbPath,
      exists: false,
      userVersion: null,
      expectedVersion,
      drift: 'fresh',
      detail: 'database not created yet; it is created on first write',
    };
  }
  let userVersion: number | null = null;
  try {
    const db = openDatabaseSync(dbPath, { readOnly: true });
    try {
      const row = db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined;
      userVersion = Number(row?.user_version ?? 0);
    } finally {
      db.close();
    }
  } catch (e) {
    return {
      dbPath,
      exists: true,
      userVersion: null,
      expectedVersion,
      drift: 'unreadable',
      detail: e instanceof Error ? e.message : String(e),
    };
  }
  if (userVersion === expectedVersion) {
    return { dbPath, exists: true, userVersion, expectedVersion, drift: 'none', detail: `schema v${userVersion} is current` };
  }
  if (userVersion < expectedVersion) {
    return {
      dbPath,
      exists: true,
      userVersion,
      expectedVersion,
      drift: 'older',
      detail: `schema v${userVersion} is older than v${expectedVersion}; it will be migrated automatically on next start`,
    };
  }
  return {
    dbPath,
    exists: true,
    userVersion,
    expectedVersion,
    drift: 'newer',
    detail: `schema v${userVersion} is newer than supported v${expectedVersion}`,
  };
}

export function vaultIssue(vault: VaultAudit): AuditIssue {
  switch (vault.drift) {
    case 'none':
      return { level: 'ok', name: 'vault schema', detail: `${vault.detail} (${vault.dbPath})` };
    case 'fresh':
      return { level: 'ok', name: 'vault schema', detail: vault.detail };
    case 'older':
      return {
        level: 'warn',
        name: 'vault schema',
        detail: vault.detail,
        fix: 'back up first: pnpm vault:backup',
      };
    case 'newer':
      return {
        level: 'fail',
        name: 'vault schema',
        detail: `${vault.detail}; downgrades are not supported`,
        fix: 'upgrade Zoveli, or restore an older backup: pnpm vault:restore <dir> --force',
      };
    case 'unreadable':
      return {
        level: 'fail',
        name: 'vault schema',
        detail: `could not read the database: ${vault.detail}`,
        fix: 'verify your backups: pnpm vault:verify <dir>; see docs/runbooks/vault-corruption.md',
      };
  }
}

export function configAuditReport(options: AuditOptions = {}): AuditReport {
  const env = options.env ?? process.env;
  const issues = auditEnv(env, options);
  const vault = auditVault(options.dbPath ?? resolveDbPath());
  issues.push(vaultIssue(vault));
  const warnings = issues.filter((i) => i.level === 'warn').length;
  const failures = issues.filter((i) => i.level === 'fail').length;
  const envSet = ENV_REGISTRY.filter((spec) => hasValue(env[spec.name])).length;
  return { ready: failures === 0, warnings, failures, envSet, issues, vault };
}

export { ENV_REGISTRY, OBSOLETE_ENV, isKnownEnvName, isTrackedEnvName, suggestEnvName } from './registry.js';
export type { EnvKind, EnvSpec } from './registry.js';
