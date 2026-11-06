import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  checkTrustGate,
  evaluateSuites,
  loadEvalSuites,
  parseEvalSuite,
  renderTrustSection,
  runEval,
  updateTrustPage,
  type EvalSuite,
} from '../../apps/cli/src/eval';

const SUITE: EvalSuite = {
  name: 'demo',
  description: 'demo suite',
  cases: [
    { id: 'one', question: 'what is 2+2', answer: '4' },
    { id: 'two', question: 'what is 3+3', answer: '6' },
  ],
};

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'zoveli-eval-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('eval fixture parsing', () => {
  it('loads the checked-in suites and every case', () => {
    const suites = loadEvalSuites(join(process.cwd(), 'eval'));
    expect(suites.map((suite) => suite.name)).toEqual([
      'gsm8k-mini',
      'humaneval-mini',
      'simple_claims',
    ]);
    expect(suites.reduce((sum, suite) => sum + suite.cases.length, 0)).toBe(23);
  });

  it('rejects duplicate ids and unknown expected verdicts', () => {
    const duplicate = JSON.stringify({
      name: 'bad',
      cases: [
        { id: 'same', question: 'a', answer: 'b' },
        { id: 'same', question: 'c', answer: 'd' },
      ],
    });
    expect(() => parseEvalSuite(duplicate, 'bad.json')).toThrow(/duplicate case id/);

    const unknown = JSON.stringify({
      name: 'bad',
      cases: [{ id: 'one', question: 'a', answer: 'b', expect: 'MAYBE' }],
    });
    expect(() => parseEvalSuite(unknown, 'bad.json')).toThrow(/unknown expect/);
    expect(() => parseEvalSuite('{', 'bad.json')).toThrow(/invalid JSON/);
  });
});

describe('eval scoring', () => {
  it('records the verifier and computes a per-suite and total score', async () => {
    const report = await evaluateSuites(
      [SUITE],
      (testCase) =>
        testCase.id === 'one'
          ? { verdict: 'MATCH', verifier: 'math', detail: 'agrees' }
          : { verdict: 'MISMATCH', verifier: 'knowledge', detail: 'differs' },
      () => new Date('2026-11-05T12:00:00Z')
    );
    expect(report.format).toBe('zoveli-eval-v1');
    expect(report.generatedOn).toBe('2026-11-05');
    expect(report.passed).toBe(1);
    expect(report.total).toBe(2);
    expect(report.score).toBe(0.5);
    expect(report.suites[0].cases[0].verifier).toBe('math');
    expect(report.suites[0].cases[1].verifier).toBe('knowledge');
    expect(report.suites[0].cases[1].passed).toBe(false);
  });

  it('honours an explicit expectation and treats runner failures as unverifiable', async () => {
    const suite: EvalSuite = {
      name: 'negative',
      description: 'negative',
      cases: [{ id: 'unknown', question: 'q', answer: 'a', expect: 'UNVERIFIABLE' }],
    };
    const report = await evaluateSuites([suite], () => {
      throw new Error('mathcore missing');
    });
    expect(report.score).toBe(1);
    expect(report.suites[0].cases[0].verdict).toBe('UNVERIFIABLE');
    expect(report.suites[0].cases[0].verifier).toBe('harness');
  });

  it('blocks a relative drop at or above five percent', () => {
    expect(checkTrustGate(1, 0.951).blocked).toBe(false);
    expect(checkTrustGate(1, 0.95).blocked).toBe(true);
    expect(checkTrustGate(0.8, 0.76).blocked).toBe(true);
    expect(checkTrustGate(0.8, 0.761).blocked).toBe(false);
    expect(checkTrustGate(0, 0).blocked).toBe(false);
    expect(checkTrustGate(1, 0.9, 11).blocked).toBe(false);
  });
});

describe('trust page output', () => {
  it('renders a public score block and escapes fixture names', () => {
    const block = renderTrustSection({
      format: 'zoveli-eval-v1',
      generatedOn: '2026-11-05',
      passed: 2,
      total: 3,
      score: 2 / 3,
      suites: [
        {
          name: '<script>',
          description: 'x',
          passed: 2,
          total: 3,
          score: 2 / 3,
          cases: [],
        },
      ],
    });
    expect(block).toContain('<!-- EVAL:START -->');
    expect(block).toContain('66.7%');
    expect(block).toContain('&lt;script&gt;');
    expect(block).not.toContain('<script>');
  });

  it('replaces only the marked block and reports whether it changed', () => {
    const dir = tempDir();
    const site = join(dir, 'trust.html');
    writeFileSync(site, '<h1>Trust</h1>\n<!-- EVAL:START -->\nold\n<!-- EVAL:END -->\n<p>tail</p>\n');
    const report = {
      format: 'zoveli-eval-v1' as const,
      generatedOn: '2026-11-05',
      passed: 1,
      total: 1,
      score: 1,
      suites: [],
    };
    expect(updateTrustPage(report, site)).toBe(true);
    const html = readFileSync(site, 'utf8');
    expect(html).toContain('100.0%');
    expect(html).not.toContain('\nold\n');
    expect(html).toContain('<p>tail</p>');
    expect(updateTrustPage(report, site)).toBe(false);
  });

  it('fails closed when the markers are missing', () => {
    const dir = tempDir();
    const site = join(dir, 'trust.html');
    writeFileSync(site, '<h1>no markers</h1>');
    expect(() =>
      updateTrustPage(
        {
          format: 'zoveli-eval-v1',
          generatedOn: '2026-11-05',
          passed: 0,
          total: 0,
          score: 0,
          suites: [],
        },
        site
      )
    ).toThrow(/missing/);
  });
});

describe('zoveli eval command', () => {
  function fixture(root: string): string {
    const fixtures = join(root, 'eval');
    mkdirSync(fixtures, { recursive: true });
    writeFileSync(
      join(fixtures, 'suite.json'),
      JSON.stringify({
        name: 'suite',
        cases: [{ id: 'one', question: 'what is 2+2', answer: '4' }],
      })
    );
    return fixtures;
  }

  it('writes a report and exits zero when above the baseline', async () => {
    const root = tempDir();
    fixture(root);
    writeFileSync(join(root, 'eval', 'baseline.json'), JSON.stringify({ score: 1 }));
    const exit = await runEval(['--no-site'], {
      cwd: root,
      now: () => new Date('2026-11-05T00:00:00Z'),
      runner: () => ({ verdict: 'MATCH', verifier: 'math', detail: 'agrees' }),
    });
    expect(exit).toBe(0);
    const report = JSON.parse(readFileSync(join(root, 'eval', 'report.json'), 'utf8'));
    expect(report.passed).toBe(1);
    expect(report.total).toBe(1);
    expect(report.score).toBe(1);
  });

  it('returns one when the trust score drops by five percent or more', async () => {
    const root = tempDir();
    fixture(root);
    writeFileSync(join(root, 'eval', 'baseline.json'), JSON.stringify({ score: 1 }));
    const exit = await runEval(['--no-site'], {
      cwd: root,
      runner: () => ({ verdict: 'MISMATCH', verifier: 'math', detail: 'differs' }),
    });
    expect(exit).toBe(1);
  });
});
