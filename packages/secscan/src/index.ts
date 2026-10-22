import { definePlugin } from '@deepseek-ai/dsh-core';
import * as fs from 'fs/promises';
import * as path from 'path';

interface SecFinding {
  severity: 'critical' | 'high' | 'medium' | 'low';
  rule: string;
  filePath: string;
  line: number;
  message: string;
  remediation: string;
}

const PATTERNS: { rule: string; severity: SecFinding['severity']; re: RegExp; message: string; remediation: string }[] = [
  {
    rule: 'hardcoded-secret', severity: 'critical',
    re: /(api[_-]?key|secret|password|passwd|token)\s*[:=]\s*['"][^'"]{8,}['"]/i,
    message: 'Possible hardcoded secret', remediation: 'Move to an env var or secret manager; rotate value',
  },
  {
    rule: 'aws-key', severity: 'critical',
    re: /AKIA[0-9A-Z]{16}/,
    message: 'Possible AWS access key', remediation: 'Revoke key; use IAM roles',
  },
  {
    rule: 'private-key', severity: 'critical',
    re: /-----BEGIN (RSA |EC |DSA )?PRIVATE KEY-----/,
    message: 'Private key material in repo', remediation: 'Remove; use secret manager',
  },
  {
    rule: 'eval-use', severity: 'high',
    re: /\beval\s*\(/,
    message: 'eval() usage', remediation: 'Replace with safe parser (e.g. mathcore safe_expr)',
  },
  {
    rule: 'shell-injection', severity: 'high',
    re: /exec\s*\(.*\$\{|child_process.*\+.*req\.|shell:\s*true/,
    message: 'Possible shell injection sink', remediation: 'Use execFile with arg arrays; validate input',
  },
  {
    rule: 'http-url', severity: 'low',
    re: /http:\/\/(?!localhost|127\.0\.0\.1)[\w.-]+/,
    message: 'Plain HTTP URL (not HTTPS)', remediation: 'Use HTTPS',
  },
  {
    rule: 'docker-privileged', severity: 'high',
    re: /--privileged|privileged:\s*true/,
    message: 'Privileged container', remediation: 'Drop privileges; add specific capabilities',
  },
];

const REDACT_PATTERNS: RegExp[] = [
  // OpenAI-style keys, GitHub tokens, AWS keys, generic Bearer tokens.
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bBearer\s+[A-Za-z0-9\-._~+/=]{16,}/g,
  // Private key blocks (multiline).
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
  // Assigned secrets: api_key = "...", password: '...'.
  /\b(api[_-]?key|secret|passwd|password|client[_-]?secret)\s*[:=]\s*['"][^'"]+['"]/gi,
];

/**
 * Redact probable secrets from text destined for logs, errors, or telemetry.
 * Conservative by design: only well-shaped key material is masked, so
 * verified-math certificates and hashes pass through untouched.
 */
export function redactSecrets(text: string): string {
  let out = text;
  for (const re of REDACT_PATTERNS) {
    re.lastIndex = 0;
    out = out.replace(re, '[REDACTED]');
  }
  return out;
}

export const zoveliSecscan = definePlugin({  name: 'zoveli-secscan',
  description: 'Scan files for secrets and risky patterns',

  setup(ctx) {
    async function scanPath(target: string, maxFiles = 500): Promise<SecFinding[]> {
      const files = await collectFiles(target, maxFiles);
      const findings: SecFinding[] = [];
      for (const f of files) {
        let content: string;
        try { content = await fs.readFile(f, 'utf-8'); } catch { continue; }
        if (content.length > 2_000_000) continue; // skip huge files
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          for (const p of PATTERNS) {
            if (p.re.test(line)) {
              findings.push({
                severity: p.severity, rule: p.rule, filePath: f, line: i + 1,
                message: p.message, remediation: p.remediation,
              });
            }
          }
        });
        if (findings.length > 200) break;
      }
      return findings;
    }

    async function collectFiles(target: string, maxFiles: number): Promise<string[]> {
      const out: string[] = [];
      async function walk(d: string) {
        if (out.length >= maxFiles) return;
        const SKIP_DIRS = new Set(['node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'coverage', '.next', '.cache']);
        let entries;
        try { entries = await fs.readdir(d, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
          if (e.isDirectory() && SKIP_DIRS.has(e.name)) continue;
          const full = path.join(d, e.name);
          if (e.isDirectory()) await walk(full);
          else if (/^\.env(\.|$)/.test(e.name) || /\.(ts|js|py|go|rs|java|yml|yaml|json|env|sh|tf)$/i.test(e.name) || e.name === 'Dockerfile') {
            out.push(full);
          }
          if (out.length >= maxFiles) return;
        }
      }
      try {
        const stat = await fs.stat(target);
        if (stat.isFile()) return [target];
      } catch { return []; }
      await walk(target);
      return out;
    }

    ctx.provide('secscan', { scanPath });

    ctx.register('secscan-tools', [
      {
        name: 'security_scan',
        description: 'Scan a file or directory for secrets and risky patterns',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            maxFiles: { type: 'number' },
          },
          required: ['path'],
        },
        async execute({ path: p, maxFiles }: { path: string; maxFiles?: number }) {
          const findings = await scanPath(p, maxFiles ?? 500);
          return {
            findings,
            summary: {
              critical: findings.filter((f) => f.severity === 'critical').length,
              high: findings.filter((f) => f.severity === 'high').length,
              medium: findings.filter((f) => f.severity === 'medium').length,
              low: findings.filter((f) => f.severity === 'low').length,
            },
          };
        },
      },
    ]);
  },
});

export default zoveliSecscan;


