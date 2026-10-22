import { definePlugin } from '@deepseek-ai/dsh-core';
import * as fs from 'fs/promises';

interface ReviewFinding {
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: 'complexity' | 'duplication' | 'dead-code' | 'security' | 'style';
  filePath: string;
  line: number;
  message: string;
  suggestion: string;
}

export const zoveliCodeAnalysis = definePlugin({
  name: 'zoveli-code-analysis',
  description: 'AI-assisted code review with hotspots, duplication, and fix suggestions',

  setup(ctx) {
    async function reviewFile(filePath: string, content?: string): Promise<ReviewFinding[]> {
      if (!content) content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n');
      const findings: ReviewFinding[] = [];

      // complexity hotspots: long functions (heuristic: >60 lines without blank-line-separated defs)
      let fnStart = -1;
      let fnName = '';
      const fnHead = /^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)|^\s*def\s+(\w+)|^\s*fn\s+(\w+)/;
      lines.forEach((line, i) => {
        const m = line.match(fnHead);
        if (m) {
          if (fnStart >= 0 && i - fnStart > 60) {
            findings.push({
              severity: 'medium', category: 'complexity', filePath, line: fnStart + 1,
              message: `Function '${fnName}' spans ${i - fnStart} lines; consider splitting`,
              suggestion: 'Extract helpers; aim for <40 lines per function',
            });
          }
          fnStart = i; fnName = m[1] ?? m[2] ?? m[3] ?? 'anonymous';
        }
      });

      // duplication: identical non-trivial lines appearing 3+ times
      const counts = new Map<string, number[]>();
      lines.forEach((l, i) => {
        const t = l.trim();
        if (t.length > 20 && !t.startsWith('//') && !t.startsWith('#')) {
          const arr = counts.get(t) ?? [];
          arr.push(i + 1);
          counts.set(t, arr);
        }
      });
      for (const [text, locs] of counts) {
        if (locs.length >= 3) {
          findings.push({
            severity: 'low', category: 'duplication', filePath, line: locs[0],
            message: `Duplicated line ${locs.length}x: "${text.slice(0, 60)}"`,
            suggestion: 'Extract to a shared function/constant',
          });
          if (findings.length > 20) break;
        }
      }

      // dead code: unused local const/let (simple single-file heuristic)
      const decls = [...content.matchAll(/\b(?:const|let)\s+(\w+)\s*=/g)].map((m) => m[1]);
      for (const name of new Set(decls)) {
        const uses = (content.match(new RegExp(`\\b${name}\\b`, 'g')) ?? []).length;
        if (uses <= 1) {
          const lineNo = lines.findIndex((l) => l.includes(name)) + 1;
          findings.push({
            severity: 'low', category: 'dead-code', filePath, line: Math.max(1, lineNo),
            message: `'${name}' appears declared but never used`,
            suggestion: 'Remove or export it if intentional',
          });
        }
      }

      // hardcoded secrets
      const secretRe = /(api[_-]?key|secret|password|token)\s*[:=]\s*['"][^'"]{8,}['"]/i;
      lines.forEach((l, i) => {
        if (secretRe.test(l)) {
          findings.push({
            severity: 'critical', category: 'security', filePath, line: i + 1,
            message: 'Possible hardcoded secret',
            suggestion: 'Move to an env var or secret manager; rotate the exposed value',
          });
        }
      });

      return findings;
    }

    ctx.provide('codeAnalysis', { reviewFile });

    ctx.register('code-analysis-tools', [
      {
        name: 'code_review',
        description: 'Review a file for complexity, duplication, dead code, and secrets',
        parameters: {
          type: 'object',
          properties: {
            filePath: { type: 'string' },
            content: { type: 'string' },
          },
          required: ['filePath'],
        },
        async execute({ filePath, content }: { filePath: string; content?: string }) {
          return { findings: await reviewFile(filePath, content) };
        },
      },
    ]);
  },
});

export default zoveliCodeAnalysis;


