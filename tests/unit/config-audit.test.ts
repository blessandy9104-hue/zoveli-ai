import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ENV_REGISTRY,
  OBSOLETE_ENV,
  auditEnv,
  auditVault,
  configAuditReport,
  vaultIssue,
  type AuditIssue,
} from '../../packages/config-audit/src/index';
import { CHAT_PROVIDER_ENV_KEYS } from '../../packages/host/src/chat';
import { MemoryStore, openDatabaseSync } from '../../packages/memory-store/src/index';

const created: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'zoveli-config-audit-'));
  created.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of created.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows may briefly hold a handle; best-effort cleanup.
    }
  }
});

function issueFor(issues: AuditIssue[], name: string): AuditIssue | undefined {
  return issues.find((i) => i.name === name);
}

describe('config audit: registry integrity', () => {
  it('has unique, well-formed names and provider keys matching the chat provider list', () => {
    const names = ENV_REGISTRY.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(name).toMatch(/^[A-Z][A-Z0-9_]*$/);
    }
    const chatSecretKeys = ENV_REGISTRY.filter((s) => s.group === 'Chat' && s.kind === 'secret').map(
      (s) => s.name
    );
    expect(chatSecretKeys).toEqual(['ZOVELI_API_KEY', ...CHAT_PROVIDER_ENV_KEYS]);
    expect(OBSOLETE_ENV.length).toBeGreaterThan(0);
  });
});

describe('config audit: environment drift', () => {
  it('suggests close matches for typo-ed variable names and ignores unrelated vars', () => {
    const issues = auditEnv({ ZOVELI_MEMORY_BRIF: '0', FOO_BAR: '1' });
    const typo = issueFor(issues, 'env ZOVELI_MEMORY_BRIF');
    expect(typo?.level).toBe('warn');
    expect(typo?.fix).toContain('ZOVELI_MEMORY_BRIEF');
    expect(issueFor(issues, 'env FOO_BAR')).toBeUndefined();
  });

  it('keeps a far-off tracked name without a suggestion', () => {
    const issues = auditEnv({ ZOVELI_ZZZZZZZZZZZ: '1' });
    const issue = issueFor(issues, 'env ZOVELI_ZZZZZZZZZZZ');
    expect(issue?.level).toBe('warn');
    expect(issue?.fix).not.toContain('did you mean');
  });

  it('flags removed variables as obsolete', () => {
    const issues = auditEnv({ TELEMETRY_ENABLED: '1' });
    const issue = issueFor(issues, 'env TELEMETRY_ENABLED');
    expect(issue?.level).toBe('warn');
    expect(issue?.detail).toContain('removed');
  });

  it('flags boolean vars that are not exactly 0 or 1', () => {
    const disableMode = issueFor(auditEnv({ ZOVELI_MEMORY_BRIEF: 'false' }), 'env ZOVELI_MEMORY_BRIEF');
    expect(disableMode?.detail).toMatch(/on unless the value is exactly "0"/);
    expect(issueFor(auditEnv({ ZOVELI_MEMORY_BRIEF: '0' }), 'env ZOVELI_MEMORY_BRIEF')).toBeUndefined();
    const enableMode = issueFor(auditEnv({ ZOVELI_AUTH_DEV_ECHO: 'true' }), 'env ZOVELI_AUTH_DEV_ECHO');
    expect(enableMode?.detail).toMatch(/off unless the value is exactly "1"/);
    expect(issueFor(auditEnv({ ZOVELI_AUTH_DEV_ECHO: '1' }), 'env ZOVELI_AUTH_DEV_ECHO')).toBeUndefined();
  });

  it('validates numbers, floats and ranges', () => {
    expect(issueFor(auditEnv({ ZOVELI_TEMPERATURE: 'hot' }), 'env ZOVELI_TEMPERATURE')?.detail).toMatch(
      /not a number/
    );
    expect(issueFor(auditEnv({ ZOVELI_TEMPERATURE: '5' }), 'env ZOVELI_TEMPERATURE')?.detail).toMatch(
      /maximum 2/
    );
    expect(issueFor(auditEnv({ ZOVELI_TEMPERATURE: '1.5' }), 'env ZOVELI_TEMPERATURE')).toBeUndefined();
    expect(issueFor(auditEnv({ MATHCORE_TIMEOUT_MS: 'abc' }), 'env MATHCORE_TIMEOUT_MS')?.detail).toMatch(
      /not a number/
    );
    expect(issueFor(auditEnv({ ZOVELI_DESKTOP_PORT: '99999' }), 'env ZOVELI_DESKTOP_PORT')?.detail).toMatch(
      /maximum 65535/
    );
  });

  it('validates URLs and protocols', () => {
    expect(issueFor(auditEnv({ ZOVELI_OLLAMA_URL: 'notaurl' }), 'env ZOVELI_OLLAMA_URL')?.detail).toMatch(
      /not a valid URL/
    );
    expect(issueFor(auditEnv({ ZOVELI_SMTP_URL: 'http://mail' }), 'env ZOVELI_SMTP_URL')?.detail).toMatch(
      /protocol/
    );
    expect(issueFor(auditEnv({ ZOVELI_OLLAMA_URL: 'http://localhost:11434' }), 'env ZOVELI_OLLAMA_URL')).toBeUndefined();
  });

  it('never accepts placeholder or too-short secrets', () => {
    expect(issueFor(auditEnv({ ZOVELI_API_TOKEN: 'changeme' }), 'env ZOVELI_API_TOKEN')?.detail).toMatch(
      /placeholder/
    );
    expect(issueFor(auditEnv({ ZOVELI_API_TOKEN: 'short' }), 'env ZOVELI_API_TOKEN')?.detail).toMatch(/16/);
    expect(issueFor(auditEnv({ ZOVELI_API_TOKEN: 'long-enough-token-123' }), 'env ZOVELI_API_TOKEN')).toBeUndefined();
  });

  it('validates enum values', () => {
    expect(issueFor(auditEnv({ ZOVELI_PERSONA: 'clown' }), 'env ZOVELI_PERSONA')?.detail).toMatch(/not recognized/);
    expect(issueFor(auditEnv({ ZOVELI_PERSONA: 'tutor' }), 'env ZOVELI_PERSONA')).toBeUndefined();
  });

  it('fails a configured math command that does not resolve', () => {
    const missing = auditEnv({ MATHCORE_MCP_COMMAND: 'no-such-binary-xyz' }, { commandResolves: () => false });
    const issue = issueFor(missing, 'env MATHCORE_MCP_COMMAND');
    expect(issue?.level).toBe('fail');
    expect(issue?.detail).toMatch(/does not resolve/);
    const ok = auditEnv({ MATHCORE_MCP_COMMAND: 'mathcore-mcp' }, { commandResolves: () => true });
    expect(issueFor(ok, 'env MATHCORE_MCP_COMMAND')).toBeUndefined();
  });

  it('validates path kinds with injectable filesystem facts', () => {
    const dir = tempDir();
    const asDir = (p: string) => p === dir;
    expect(
      issueFor(
        auditEnv({ ZOVELI_MEMORY_DB: dir }, { exists: () => true, isDirectory: asDir, isFile: () => false }),
        'env ZOVELI_MEMORY_DB'
      )?.detail
    ).toMatch(/directory/);
    expect(issueFor(auditEnv({ ZOVELI_MEMORY_DB: '~/.zoveli/memory.db' }), 'env ZOVELI_MEMORY_DB')?.detail).toMatch(
      /not expanded/
    );
    expect(
      issueFor(
        auditEnv({ ZOVELI_MEMORY_DB: join(dir, 'missing', 'memory.db') }, { exists: () => false }),
        'env ZOVELI_MEMORY_DB'
      )?.detail
    ).toMatch(/parent directory/);
    expect(
      issueFor(
        auditEnv(
          { ZOVELI_VAULT_PATH: join(dir, 'vault') },
          { exists: (p) => p === dir, writable: () => true }
        ),
        'env ZOVELI_VAULT_PATH'
      )
    ).toBeUndefined();
  });

  it('reports chat key precedence and ignored overrides', () => {
    const multi = auditEnv({ OPENAI_API_KEY: 'a', DEEPSEEK_API_KEY: 'b' });
    expect(issueFor(multi, 'env chat keys')?.detail).toMatch(/OPENAI_API_KEY/);
    const baseOnly = auditEnv({ ZOVELI_API_BASE: 'https://proxy/v1' });
    expect(issueFor(baseOnly, 'env ZOVELI_API_BASE')?.detail).toMatch(/ignored/);
    const none = auditEnv({});
    expect(issueFor(none, 'env chat provider')?.level).toBe('info');
  });

  it('counts recognized variables in the report', () => {
    const report = configAuditReport({ env: { ZOVELI_MEMORY_BRIEF: '0' }, dbPath: ':memory:' });
    expect(report.envSet).toBe(1);
    expect(report.ready).toBe(true);
  });
});

describe('config audit: vault schema drift', () => {
  it('reports a fresh database as healthy', () => {
    const base = tempDir();
    const vault = auditVault(join(base, 'memory.db'));
    expect(vault.drift).toBe('fresh');
    expect(vaultIssue(vault).level).toBe('ok');
  });

  it('accepts a current schema and warns on an older one', () => {
    const base = tempDir();
    const current = join(base, 'current.db');
    const store = new MemoryStore(current, join(base, 'vault'));
    store.close();
    expect(auditVault(current).drift).toBe('none');

    const older = join(base, 'older.db');
    const raw = openDatabaseSync(older);
    raw.close();
    const status = auditVault(older);
    expect(status.drift).toBe('older');
    expect(status.userVersion).toBe(0);
    const issue = vaultIssue(status);
    expect(issue.level).toBe('warn');
    expect(issue.fix).toContain('vault:backup');
  });

  it('fails on a newer schema and makes the report not ready', () => {
    const base = tempDir();
    const future = join(base, 'future.db');
    const raw = openDatabaseSync(future);
    raw.exec('PRAGMA user_version = 99');
    raw.close();
    const report = configAuditReport({ env: {}, dbPath: future });
    expect(report.vault.drift).toBe('newer');
    expect(report.ready).toBe(false);
    expect(report.failures).toBe(1);
    const issue = report.issues.find((i) => i.name === 'vault schema');
    expect(issue?.level).toBe('fail');
    expect(issue?.fix).toContain('vault:restore');
  });

  it('fails on an unreadable database file', () => {
    const base = tempDir();
    const bogus = join(base, 'memory.db');
    writeFileSync(bogus, 'this is not a sqlite database');
    const status = auditVault(bogus);
    expect(status.drift).toBe('unreadable');
    expect(vaultIssue(status).level).toBe('fail');
  });
});
