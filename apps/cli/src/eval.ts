import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { parseFlags, type FlagDefinition } from './flags.js';

export const EVAL_FORMAT = 'zoveli-eval-v1';
export const EVAL_SUITE_FORMAT = 'zoveli-eval-suite-v1';
export const DEFAULT_MAX_DROP_PERCENT = 5;

export type ClaimVerdictName = 'MATCH' | 'MISMATCH' | 'UNVERIFIABLE' | 'UNCOMPARABLE';

export interface EvalCase {
  id: string;
  question: string;
  answer: string;
  /** Verdict the harness must produce; defaults to MATCH. */
  expect?: ClaimVerdictName;
}

export interface EvalSuite {
  name: string;
  description: string;
  cases: EvalCase[];
}

export interface EvalCaseResult {
  suite: string;
  id: string;
  question: string;
  answer: string;
  expect: ClaimVerdictName;
  verdict: ClaimVerdictName;
  verifier: string;
  detail: string;
  passed: boolean;
}

export interface EvalSuiteSummary {
  name: string;
  description: string;
  passed: number;
  total: number;
  score: number;
  cases: EvalCaseResult[];
}

export interface EvalReport {
  format: typeof EVAL_FORMAT;
  generatedOn: string;
  passed: number;
  total: number;
  /** Fraction in [0, 1]; multiply by 100 for the published percentage. */
  score: number;
  suites: EvalSuiteSummary[];
}

export interface EvalCaseOutcome {
  verdict: ClaimVerdictName;
  verifier: string;
  detail: string;
}

export type EvalCaseRunner = (
  testCase: EvalCase,
  suite: EvalSuite
) => Promise<EvalCaseOutcome> | EvalCaseOutcome;

export interface EvalDependencies {
  runner?: EvalCaseRunner;
  cwd?: string;
  now?: () => Date;
}

interface ParsedFlags {
  json: boolean;
  help: boolean;
  noSite: boolean;
  noGate: boolean;
  fixtures?: string;
  report?: string;
  baseline?: string;
  site?: string;
  maxDrop?: string;
}

const FLAGS = [
  { key: 'json', tokens: ['--json'] },
  { key: 'help', tokens: ['--help', '-h'] },
  { key: 'noSite', tokens: ['--no-site'] },
  { key: 'noGate', tokens: ['--no-gate'] },
  { key: 'fixtures', tokens: ['--fixtures'], takesValue: true },
  { key: 'report', tokens: ['--report'], takesValue: true },
  { key: 'baseline', tokens: ['--baseline'], takesValue: true },
  { key: 'site', tokens: ['--site'], takesValue: true },
  { key: 'maxDrop', tokens: ['--max-drop'], takesValue: true },
] as const satisfies readonly FlagDefinition<keyof ParsedFlags>[];

function usage(): string {
  return `zoveli evaluation harness
  zoveli eval [--fixtures DIR] [--report FILE] [--baseline FILE]
              [--site FILE | --no-site] [--no-gate] [--max-drop PERCENT] [--json]

Runs the checked-in GSM8K-mini, HumanEval-mini, and trusted-claim suites
through mathcore, writes a JSON report, publishes the score in
website/trust.html, and compares it with eval/baseline.json. A relative trust
score drop of 5% or more exits non-zero so CI blocks the change.

Every case records the verifier that decided it (math, code, knowledge).
Set MATHCORE_BIN to pin the mathcore executable; otherwise the command
falls back to "python -m mathcore".`;
}

const VERDICTS = new Set<ClaimVerdictName>([
  'MATCH',
  'MISMATCH',
  'UNVERIFIABLE',
  'UNCOMPARABLE',
]);

function requireString(value: unknown, what: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${what} must be a non-empty string`);
  }
  return value.trim();
}

/** Parse one suite file. Kept separate so fixture errors name their source. */
export function parseEvalSuite(raw: string, source: string): EvalSuite {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${source}: invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(`${source}: suite must be a JSON object`);
  }
  const object = payload as Record<string, unknown>;
  const name = requireString(object.name ?? basename(source).replace(/\.json$/i, ''), `${source}: name`);
  const description =
    typeof object.description === 'string' && object.description.trim()
      ? object.description.trim()
      : name;
  const cases = object.cases;
  if (!Array.isArray(cases) || cases.length === 0) {
    throw new Error(`${source}: cases must be a non-empty array`);
  }
  const seen = new Set<string>();
  const parsed: EvalCase[] = cases.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`${source}: case ${index + 1} must be an object`);
    }
    const item = entry as Record<string, unknown>;
    const id = requireString(item.id, `${source}: case ${index + 1} id`);
    if (seen.has(id)) throw new Error(`${source}: duplicate case id ${JSON.stringify(id)}`);
    seen.add(id);
    const expectRaw = item.expect === undefined ? 'MATCH' : item.expect;
    const expect = requireString(expectRaw, `${source}: case ${id} expect`).toUpperCase();
    if (!VERDICTS.has(expect as ClaimVerdictName)) {
      throw new Error(`${source}: case ${id} has unknown expect ${JSON.stringify(expect)}`);
    }
    return {
      id,
      question: requireString(item.question, `${source}: case ${id} question`),
      answer: requireString(item.answer, `${source}: case ${id} answer`),
      expect: expect as ClaimVerdictName,
    };
  });
  return { name, description, cases: parsed };
}

export function loadEvalSuites(dir: string): EvalSuite[] {
  if (!existsSync(dir)) throw new Error(`eval fixtures directory does not exist: ${dir}`);
  const files = readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith('.json'))
    .sort();
  if (files.length === 0) throw new Error(`no eval suite files under ${dir}`);
  const suites: EvalSuite[] = [];
  const names = new Set<string>();
  for (const file of files) {
    const path = join(dir, file);
    const raw = readFileSync(path, 'utf8');
    let head: unknown;
    try {
      head = JSON.parse(raw);
    } catch (error) {
      throw new Error(
        `${path}: invalid JSON: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    if (!head || typeof head !== 'object' || Array.isArray(head)) {
      throw new Error(`${path}: suite must be a JSON object`);
    }
    const object = head as Record<string, unknown>;
    // baseline.json and report.json live beside the suites; only files with a
    // case list are fixtures.
    if (
      !Array.isArray(object.cases) ||
      (typeof object.format === 'string' && object.format !== EVAL_SUITE_FORMAT)
    ) {
      continue;
    }
    const suite = parseEvalSuite(raw, path);
    if (names.has(suite.name)) throw new Error(`duplicate eval suite name: ${suite.name}`);
    names.add(suite.name);
    suites.push(suite);
  }
  if (suites.length === 0) throw new Error(`no eval suite files under ${dir}`);
  return suites;
}

export async function evaluateSuites(
  suites: readonly EvalSuite[],
  runner: EvalCaseRunner,
  now: () => Date = () => new Date()
): Promise<EvalReport> {
  const summaries: EvalSuiteSummary[] = [];
  let passed = 0;
  let total = 0;

  for (const suite of suites) {
    const results: EvalCaseResult[] = [];
    let suitePassed = 0;
    for (const testCase of suite.cases) {
      let outcome: EvalCaseOutcome;
      try {
        outcome = await runner(testCase, suite);
      } catch (error) {
        outcome = {
          verdict: 'UNVERIFIABLE',
          verifier: 'harness',
          detail: `runner failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
      if (!VERDICTS.has(outcome.verdict)) {
        outcome = {
          verdict: 'UNVERIFIABLE',
          verifier: outcome.verifier || 'harness',
          detail: `unknown verdict ${JSON.stringify(outcome.verdict)}`,
        };
      }
      const expect = testCase.expect ?? 'MATCH';
      const ok = outcome.verdict === expect;
      if (ok) suitePassed += 1;
      results.push({
        suite: suite.name,
        id: testCase.id,
        question: testCase.question,
        answer: testCase.answer,
        expect,
        verdict: outcome.verdict,
        verifier: outcome.verifier,
        detail: outcome.detail,
        passed: ok,
      });
    }
    passed += suitePassed;
    total += suite.cases.length;
    summaries.push({
      name: suite.name,
      description: suite.description,
      passed: suitePassed,
      total: suite.cases.length,
      score: suite.cases.length === 0 ? 0 : suitePassed / suite.cases.length,
      cases: results,
    });
  }

  return {
    format: EVAL_FORMAT,
    generatedOn: now().toISOString().slice(0, 10),
    passed,
    total,
    score: total === 0 ? 0 : passed / total,
    suites: summaries,
  };
}

interface MathcoreCandidate {
  command: string;
  prefix: string[];
}

function mathcoreCandidates(): MathcoreCandidate[] {
  const pinned = process.env.MATHCORE_BIN;
  if (pinned) return [{ command: pinned, prefix: [] }];
  return [
    { command: 'mathcore', prefix: [] },
    { command: process.env.PYTHON || 'python', prefix: ['-m', 'mathcore'] },
    { command: 'python3', prefix: ['-m', 'mathcore'] },
    { command: 'py', prefix: ['-3', '-m', 'mathcore'] },
  ];
}

function parseVerdict(stdout: string): EvalCaseOutcome | null {
  const start = stdout.indexOf('{');
  if (start < 0) return null;
  try {
    const payload = JSON.parse(stdout.slice(start)) as Record<string, unknown>;
    const verdict = String(payload.verdict || '').toUpperCase() as ClaimVerdictName;
    if (!VERDICTS.has(verdict)) return null;
    return {
      verdict,
      verifier: typeof payload.verifier === 'string' && payload.verifier ? payload.verifier : 'math',
      detail: typeof payload.detail === 'string' ? payload.detail : '',
    };
  } catch {
    return null;
  }
}

/**
 * Run one claim through the real mathcore CLI. The caller owns the temporary
 * audit log so an eval run never appends to the user's trust history.
 */
export function createMathcoreRunner(options: {
  auditPath: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}): EvalCaseRunner {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const env = { ...process.env, ...options.env };
  return (testCase) => {
    let lastError = '';
    for (const candidate of mathcoreCandidates()) {
      const result = spawnSync(
        candidate.command,
        [
          ...candidate.prefix,
          '--json',
          '--audit',
          options.auditPath,
          'check',
          testCase.question,
          testCase.answer,
        ],
        { encoding: 'utf8', timeout: timeoutMs, windowsHide: true, env }
      );
      if (result.error) {
        const code = (result.error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT' || code === 'EACCES') {
          lastError = `${candidate.command}: ${result.error.message}`;
          continue;
        }
        throw result.error;
      }
      const outcome = parseVerdict(result.stdout || '');
      if (outcome) return outcome;
      lastError =
        (result.stderr || result.stdout || `exit ${result.status ?? 'unknown'}`).trim().slice(0, 500) ||
        'mathcore returned no JSON verdict';
      // A found executable that fails is a real error, not a reason to try
      // another interpreter; surface it instead of silently rerouting.
      throw new Error(`mathcore check failed for ${testCase.id}: ${lastError}`);
    }
    throw new Error(`mathcore is not available (${lastError || 'no candidate command'})`);
  };
}

export interface TrustGate {
  blocked: boolean;
  baselineScore: number;
  currentScore: number;
  /** Relative drop as a fraction (0.05 = 5%). */
  drop: number;
  maxDrop: number;
  reason: string;
}

export function checkTrustGate(
  baselineScore: number,
  currentScore: number,
  maxDropPercent = DEFAULT_MAX_DROP_PERCENT
): TrustGate {
  const maxDrop = Math.min(1, Math.max(0, maxDropPercent / 100));
  const base = Number.isFinite(baselineScore) ? Math.max(0, baselineScore) : 0;
  const current = Number.isFinite(currentScore) ? Math.max(0, currentScore) : 0;
  const drop = base > 0 ? Math.max(0, (base - current) / base) : 0;
  // Guard against floating-point noise at the exact 5% boundary.
  const blocked = base > 0 && drop + 1e-12 >= maxDrop;
  const reason = blocked
    ? `trust score dropped ${(drop * 100).toFixed(1)}% (baseline ${(base * 100).toFixed(1)}%, now ${(current * 100).toFixed(1)}%); limit is ${(maxDrop * 100).toFixed(1)}%`
    : `trust score ${(current * 100).toFixed(1)}% vs baseline ${(base * 100).toFixed(1)}%`;
  return { blocked, baselineScore: base, currentScore: current, drop, maxDrop, reason };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function percent(score: number): string {
  return `${(score * 100).toFixed(1)}%`;
}

export function renderTrustSection(report: EvalReport): string {
  const rows = report.suites
    .map(
      (suite) =>
        `    <tr><td>${escapeHtml(suite.name)}</td><td>${suite.passed}/${suite.total}</td><td>${percent(
          suite.score
        )}</td></tr>`
    )
    .join('\n');
  return `<!-- EVAL:START -->
<section id="public-trust-score">
  <h2>Public trust score</h2>
  <p><strong>${percent(report.score)}</strong> — ${report.passed} of ${report.total} checks matched on ${escapeHtml(
    report.generatedOn
  )}.</p>
  <table>
    <tr><th>Suite</th><th>Matched</th><th>Score</th></tr>
${rows}
  </table>
  <p>Generated by <code>zoveli eval</code> from the checked-in GSM8K-mini, HumanEval-mini, and trusted-claim fixtures. Every verdict names the verifier that decided it; a relative drop of 5% or more blocks CI.</p>
</section>
<!-- EVAL:END -->`;
}

/** Replace the generated block in trust.html. Markers must already exist. */
export function updateTrustPage(report: EvalReport, sitePath: string): boolean {
  const html = readFileSync(sitePath, 'utf8');
  const block = renderTrustSection(report);
  const pattern = /<!-- EVAL:START -->[\s\S]*?<!-- EVAL:END -->/;
  if (!pattern.test(html)) {
    throw new Error(`${sitePath}: missing <!-- EVAL:START --> / <!-- EVAL:END --> markers`);
  }
  const next = html.replace(pattern, block);
  if (next === html) return false;
  writeFileSync(sitePath, next);
  return true;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function readBaseline(path: string): number {
  let payload: unknown;
  try {
    payload = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(
      `${path}: cannot read baseline: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const score = (payload as { score?: unknown } | null)?.score;
  if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 1) {
    throw new Error(`${path}: baseline score must be a number between 0 and 1`);
  }
  return score;
}

export async function runEval(argv: string[], deps: EvalDependencies = {}): Promise<number> {
  try {
    const flags = parseFlags<ParsedFlags>(
      argv,
      { json: false, help: false, noSite: false, noGate: false },
      FLAGS,
      { positional: true }
    );
    if (flags.help) {
      console.log(usage());
      return 0;
    }
    if (flags.positional.length > 0) {
      throw new Error(`unexpected argument: ${flags.positional[0]}`);
    }

    const cwd = resolve(deps.cwd ?? process.cwd());
    const fixtureDir = resolve(cwd, flags.fixtures ?? 'eval');
    const reportPath = resolve(cwd, flags.report ?? 'eval/report.json');
    const baselinePath = resolve(cwd, flags.baseline ?? 'eval/baseline.json');
    const sitePath = resolve(cwd, flags.site ?? 'website/trust.html');
    const suites = loadEvalSuites(fixtureDir);

    const tempDir = mkdtempSync(join(tmpdir(), 'zoveli-eval-'));
    let report: EvalReport;
    try {
      const runner =
        deps.runner ??
        createMathcoreRunner({
          auditPath: join(tempDir, 'audit.jsonl'),
          env: existsSync(join(cwd, 'trusted_kb'))
            ? { MATHCORE_TRUSTED_KB: join(cwd, 'trusted_kb') }
            : {},
        });
      report = await evaluateSuites(suites, runner, deps.now);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }

    writeJson(reportPath, report);

    let siteUpdated = false;
    if (!flags.noSite) {
      if (existsSync(sitePath)) {
        siteUpdated = updateTrustPage(report, sitePath);
      } else if (flags.site) {
        throw new Error(`trust page does not exist: ${sitePath}`);
      }
    }

    let gate: TrustGate | null = null;
    if (!flags.noGate) {
      const explicitBaseline = flags.baseline !== undefined;
      if (existsSync(baselinePath)) {
        const parsed = parseFloat(flags.maxDrop ?? String(DEFAULT_MAX_DROP_PERCENT));
        if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
          throw new Error('--max-drop must be between 0 and 100');
        }
        gate = checkTrustGate(readBaseline(baselinePath), report.score, parsed);
      } else if (explicitBaseline) {
        throw new Error(`baseline file does not exist: ${baselinePath}`);
      }
    }

    if (flags.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(
        `zoveli eval: ${report.passed}/${report.total} (${percent(report.score)}) trust score`
      );
      for (const suite of report.suites) {
        console.log(`  ${suite.name.padEnd(18)} ${suite.passed}/${suite.total}  ${percent(suite.score)}`);
      }
      console.log(`report: ${reportPath}`);
      if (!flags.noSite) {
        console.log(
          siteUpdated ? `site: ${sitePath} updated` : `site: ${sitePath} already current`
        );
      }
      if (gate) console.log(gate.reason);
    }

    if (gate?.blocked) {
      console.error(`error: ${gate.reason}`);
      return 1;
    }
    return 0;
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
