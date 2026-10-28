import * as fs from 'fs/promises';
import type { AnalysisResult, CodeMetrics, CodeIssue, CodeStructure } from './types';
import { LanguageDetector } from './detector';

interface AnalyzeInput {
  filePath: string;
  content?: string;
  language?: string;
  includeMetrics?: boolean;
  includeIssues?: boolean;
}

/**
 * Extract an import source without a backtracking-prone regex. Handles
 * `import x from 'm'`, `import 'm'`, and Python's `from m import x`.
 */
function parseImportSource(line: string): string | null {
  const trimmed = line.trimStart();
  if (trimmed.startsWith('import ')) {
    const rest = trimmed.slice('import '.length).trim();
    const fromIdx = rest.lastIndexOf(' from ');
    if (fromIdx !== -1) {
      const spec = rest.slice(fromIdx + ' from '.length).trim();
      if (spec.length >= 2 && (spec[0] === '"' || spec[0] === "'")) {
        const end = spec.indexOf(spec[0], 1);
        if (end > 0) return spec.slice(1, end);
      }
    }
    const token = rest.split(/\s+/, 1)[0] ?? '';
    const cleaned = token.replace(/^['"]|['"]$/g, '');
    return cleaned || null;
  }
  if (trimmed.startsWith('from ')) {
    const rest = trimmed.slice('from '.length).trim();
    return rest.split(/\s+/, 1)[0] || null;
  }
  return null;
}

export class CodeAnalyzer {
  private ctx: any;
  private detector = new LanguageDetector();

  constructor(ctx: any) {
    this.ctx = ctx;
  }

  async analyze(input: AnalyzeInput): Promise<AnalysisResult> {
    const { filePath } = input;
    let { content, language } = input;
    const { includeMetrics = true, includeIssues = true } = input;

    if (!content) {
      content = await fs.readFile(filePath, 'utf-8');
    }
    if (!language || language === 'auto') {
      language = this.detector.detect(filePath, content).language;
    }

    const lines = content.split('\n');
    const metrics = includeMetrics ? this.computeMetrics(lines, content) : undefined;
    const structure = this.extractStructure(lines, language);
    const issues = includeIssues ? await this.collectIssues(filePath, content, language) : [];

    return {
      language, filePath, metrics, issues, structure,
      dependencies: [],
      symbols: [
        ...structure.functions.map((f) => ({
          name: f.name, kind: 'function' as const,
          filePath, line: f.line, column: 1, signature: `${f.name}()`,
        })),
        ...structure.classes.map((c) => ({
          name: c.name, kind: 'class' as const,
          filePath, line: c.line, column: 1,
        })),
      ],
      complexity: {
        cyclomatic: metrics?.cyclomaticComplexity ?? 1,
        cognitive: metrics?.cognitiveComplexity ?? 0,
        functions: structure.functions.map((f) => ({ name: f.name, complexity: f.complexity })),
        hotspots: [],
      },
    };
  }

  private computeMetrics(lines: string[], content: string): CodeMetrics {
    let blank = 0;
    let comments = 0;
    for (const l of lines) {
      const t = l.trim();
      if (!t) blank++;
      else if (/^(\/\/|#|--|;|\*)/.test(t) || t.startsWith('/*') || t.startsWith('"""')) comments++;
    }
    // naive branch counting for cyclomatic complexity
    const branchRe = /\b(if|else\s+if|for|while|case|catch|&&|\|\||\?)\b/g;
    const matches = content.match(branchRe);
    const cyclomatic = 1 + (matches ? matches.length : 0);

    const loc = lines.length - blank;
    // simplified maintainability index (0-100)
    const mi = Math.max(0, Math.min(100, Math.round(171 - 5.2 * Math.log(Math.max(1, cyclomatic)) - 0.23 * Math.log(Math.max(1, loc)))));

    return {
      linesOfCode: loc,
      linesOfComments: comments,
      blankLines: blank,
      cyclomaticComplexity: cyclomatic,
      cognitiveComplexity: Math.round(cyclomatic * 0.8),
      maintainabilityIndex: mi,
      halsteadVolume: 0,
      halsteadDifficulty: 0,
      halsteadEffort: 0,
    };
  }

  private extractStructure(lines: string[], language: string): CodeStructure {
    const functions: CodeStructure['functions'] = [];
    const classes: CodeStructure['classes'] = [];
    const imports: CodeStructure['imports'] = [];
    const exports: CodeStructure['exports'] = [];

    const fnPatterns: Record<string, RegExp> = {
      typescript: /^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/,
      javascript: /^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/,
      python: /^\s*def\s+(\w+)\s*\(/,
      rust: /^\s*(?:pub\s+)?fn\s+(\w+)\s*\(/,
      go: /^\s*func\s+(?:\(\w+\s+[\w*]+\s*\)\s*)?(\w+)\s*\(/,
      java: /^\s*(?:public|private|protected)?\s*(?:static\s+)?\w+\s+(\w+)\s*\(/,
    };
    const classPatterns: Record<string, RegExp> = {
      typescript: /^\s*(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/,
      javascript: /^\s*(?:export\s+)?class\s+(\w+)/,
      python: /^\s*class\s+(\w+)/,
      rust: /^\s*(?:pub\s+)?struct\s+(\w+)|^\s*(?:pub\s+)?enum\s+(\w+)/,
      go: /^\s*type\s+(\w+)\s+(?:struct|interface)/,
      java: /^\s*(?:public\s+)?(?:abstract\s+)?class\s+(\w+)/,
    };

    const fnRe = fnPatterns[language];
    const classRe = classPatterns[language];

    lines.forEach((line, idx) => {
      const lineNo = idx + 1;
      if (fnRe) {
        const m = line.match(fnRe);
        if (m) {
          functions.push({
            name: m[1], line: lineNo, endLine: lineNo,
            parameters: [], isAsync: /\basync\b/.test(line),
            isGenerator: /\*/.test(line), decorators: [], complexity: 1,
          });
        }
      }
      // arrow / const fns for JS/TS
      if ((language === 'typescript' || language === 'javascript')) {
        const am = line.match(/^\s*(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?\(.*\)\s*=>/);
        if (am) {
          functions.push({
            name: am[1], line: lineNo, endLine: lineNo,
            parameters: [], isAsync: /\basync\b/.test(line),
            isGenerator: false, decorators: [], complexity: 1,
          });
        }
      }
      if (classRe) {
        const m = line.match(classRe);
        const name = m?.[1] ?? m?.[2];
        if (name) {
          classes.push({
            name, line: lineNo, endLine: lineNo,
            implements: [], methods: [], properties: [], decorators: [],
          });
        }
      }
      const impSource = parseImportSource(line);
      if (impSource) {
        imports.push({ source: impSource, specifiers: [], line: lineNo });
      }
      const exp = line.match(/^\s*export\s+(default\s+)?(function|class|const|interface|type)\s+(\w+)/);
      if (exp) {
        exports.push({ name: exp[3], type: exp[1] ? 'default' : 'named', line: lineNo, declarationType: exp[2] as any });
      }
    });

    return { functions, classes, interfaces: [], types: [], imports, exports };
  }

  private async collectIssues(filePath: string, content: string, language: string): Promise<CodeIssue[]> {
    const issues: CodeIssue[] = [];
    const lines = content.split('\n');

    // universal heuristics (workaround when linters unavailable)
    lines.forEach((line, idx) => {
      if (line.length > 120) {
        issues.push({
          type: 'info', severity: 'low', rule: 'max-line-length',
          message: `Line exceeds 120 characters (${line.length})`,
          filePath, line: idx + 1, column: 121,
          suggestion: 'Break into shorter lines',
        });
      }
      const todoMatch = line.match(/\b(TODO|FIXME)\b/);
      if (todoMatch) {
        issues.push({
          type: 'info', severity: 'low', rule: 'todo-comment',
          message: `${todoMatch[1]} marker found`,
          filePath, line: idx + 1, column: (todoMatch.index ?? 0) + 1,
        });
      }
      if (/\bconsole\.log\b/.test(line) && (language === 'typescript' || language === 'javascript')) {
        issues.push({
          type: 'warning', severity: 'medium', rule: 'no-console',
          message: 'Unexpected console.log',
          filePath, line: idx + 1, column: line.indexOf('console') + 1,
          suggestion: 'Use structured logger',
        });
      }
    });

    // try LSP diagnostics if available
    try {
      const lsp = this.ctx?.get?.('lsp');
      if (lsp?.diagnostics) {
        const diags = await lsp.diagnostics(filePath, content);
        for (const d of diags ?? []) {
          issues.push({
            type: d.severity === 1 ? 'error' : 'warning',
            severity: d.severity === 1 ? 'high' : 'medium',
            rule: d.code ?? 'lsp',
            message: d.message, filePath,
            line: (d.line ?? 0) + 1, column: (d.character ?? 0) + 1,
          });
        }
      }
    } catch {
      // LSP unavailable — heuristics above already provide baseline
    }

    return issues;
  }
}
