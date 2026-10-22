import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { FormatResult, FormatOptions, LintResult, CodeIssue } from './types';
import { LanguageDetector } from './detector';

const execFileAsync = promisify(execFile);

interface FormatInput {
  filePath: string;
  content?: string;
  language?: string;
  options?: FormatOptions;
}

interface LintInput {
  filePath: string;
  content?: string;
  language?: string;
  config?: Record<string, unknown>;
}

export class CodeFormatter {
  private ctx: any;
  private detector = new LanguageDetector();

  constructor(ctx: any) {
    this.ctx = ctx;
  }

  async format(input: FormatInput): Promise<FormatResult> {
    const { filePath } = input;
    let { content, language, options = {} } = input;
    if (!content) content = await fs.readFile(filePath, 'utf-8');
    if (!language || language === 'auto') language = this.detector.detect(filePath, content).language;

    const merged: Required<FormatOptions> = {
      indentSize: options.indentSize ?? 2,
      indentType: options.indentType ?? 'spaces',
      lineWidth: options.lineWidth ?? 100,
      singleQuote: options.singleQuote ?? false,
      trailingComma: options.trailingComma ?? 'es5',
      semi: options.semi ?? true,
      bracketSpacing: options.bracketSpacing ?? true,
      parser: options.parser ?? language,
    };

    // 1. Try native formatters (best-effort, sandboxed temp file)
    const native = await this.tryNativeFormatter(filePath, content, language, merged);
    if (native) return { formatted: native, changed: native !== content, language, optionsUsed: merged };

    // 2. Fallback: deterministic minimal formatter (workaround when tools missing)
    const fallback = this.fallbackFormat(content, merged);
    return { formatted: fallback, changed: fallback !== content, language, optionsUsed: merged };
  }

  async lint(input: LintInput): Promise<LintResult> {
    const { filePath } = input;
    let { content, language } = input;
    if (!content) content = await fs.readFile(filePath, 'utf-8');
    if (!language || language === 'auto') language = this.detector.detect(filePath, content).language;

    const issues: CodeIssue[] = [];
    issues.push(...this.universalChecks(filePath, content, language));
    issues.push(...await this.tryNativeLinter(filePath, content, language));

    const summary = {
      errors: issues.filter((i) => i.type === 'error').length,
      warnings: issues.filter((i) => i.type === 'warning').length,
      infos: issues.filter((i) => i.type === 'info').length,
      hints: issues.filter((i) => i.type === 'hint').length,
    };
    return { issues, summary, language, configUsed: input.config ? 'custom' : 'default' };
  }

  private fallbackFormat(content: string, opts: Required<FormatOptions>): string {
    const indent = opts.indentType === 'tabs' ? '\t' : ' '.repeat(opts.indentSize);
    return content
      .split('\n')
      .map((l) => l.replace(/\s+$/u, '')) // trim trailing WS
      .join('\n')
      .replace(/\t/g, indent)
      .replace(/[ \t]+$/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd() + '\n';
  }

  private async tryNativeFormatter(
    filePath: string, content: string, language: string, _opts: Required<FormatOptions>
  ): Promise<string | null> {
    try {
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'zoveli-fmt-'));
      const tmpFile = path.join(tmp, path.basename(filePath));
      await fs.writeFile(tmpFile, content, 'utf-8');

      const commands: Record<string, string[]> = {
        typescript: ['npx', '--no-install', 'prettier', '--parser', 'typescript', '--write', tmpFile],
        javascript: ['npx', '--no-install', 'prettier', '--parser', 'babel', '--write', tmpFile],
        json: ['npx', '--no-install', 'prettier', '--parser', 'json', '--write', tmpFile],
        markdown: ['npx', '--no-install', 'prettier', '--parser', 'markdown', '--write', tmpFile],
        python: ['black', '-q', tmpFile],
        rust: ['rustfmt', '--edition', '2021', tmpFile],
        go: ['gofmt', '-w', tmpFile],
      };
      const cmd = commands[language];
      if (!cmd) return null;

      const timeout = 15000;
      await execFileAsync(cmd[0], cmd.slice(1), { timeout });
      const out = await fs.readFile(tmpFile, 'utf-8');
      await fs.rm(tmp, { recursive: true, force: true });
      return out;
    } catch {
      return null; // tool missing / failed → fallback handles it
    }
  }

  private universalChecks(filePath: string, content: string, language: string): CodeIssue[] {
    const issues: CodeIssue[] = [];
    const lines = content.split('\n');
    lines.forEach((line, i) => {
      if (/\s+$/.test(line)) {
        issues.push({
          type: 'warning', severity: 'low', rule: 'no-trailing-spaces',
          message: 'Trailing whitespace', filePath,
          line: i + 1, column: line.length,
          suggestion: 'Remove trailing spaces',
        });
      }
      if (line.includes('\t') && language !== 'bash') {
        issues.push({
          type: 'info', severity: 'low', rule: 'no-tabs',
          message: 'Tab indentation (prefer spaces)', filePath,
          line: i + 1, column: line.indexOf('\t') + 1,
        });
      }
    });
    if (content.length > 0 && !content.endsWith('\n')) {
      issues.push({
        type: 'warning', severity: 'low', rule: 'eol-last',
        message: 'Missing newline at end of file', filePath,
        line: lines.length, column: lines[lines.length - 1].length + 1,
      });
    }
    return issues;
  }

  private async tryNativeLinter(filePath: string, content: string, language: string): Promise<CodeIssue[]> {
    // Best-effort: eslint for JS/TS via temp file. Others rely on LSP + heuristics.
    if (language !== 'typescript' && language !== 'javascript') return [];
    try {
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'zoveli-lint-'));
      const tmpFile = path.join(tmp, path.basename(filePath));
      await fs.writeFile(tmpFile, content, 'utf-8');
      const { stdout } = await execFileAsync(
        'npx', ['--no-install', 'eslint', '--format', 'json', '--no-eslintrc', tmpFile],
        { timeout: 20000 }
      ).catch((e: any) => ({ stdout: e.stdout ?? '[]' }));
      await fs.rm(tmp, { recursive: true, force: true });
      const parsed = JSON.parse(stdout || '[]');
      const out: CodeIssue[] = [];
      for (const file of parsed) {
        for (const m of file.messages ?? []) {
          out.push({
            type: m.severity === 2 ? 'error' : 'warning',
            severity: m.severity === 2 ? 'high' : 'medium',
            rule: m.ruleId ?? 'eslint',
            message: m.message, filePath,
            line: m.line ?? 1, column: m.column ?? 1,
            endLine: m.endLine, endColumn: m.endColumn,
            documentationUrl: m.ruleId ? `https://eslint.org/docs/rules/${m.ruleId}` : undefined,
          });
        }
      }
      return out;
    } catch {
      return [];
    }
  }
}


