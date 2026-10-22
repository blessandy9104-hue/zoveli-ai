import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { TestResult, TestSuite } from './types';
import { LanguageDetector } from './detector';

const execFileAsync = promisify(execFile);

interface RunInput {
  projectPath: string;
  language?: string;
  testPath?: string;
  args?: string[];
  timeoutMs?: number;
}

export class TestRunner {
  private ctx: any;
  private detector = new LanguageDetector();

  constructor(ctx: any) {
    this.ctx = ctx;
  }

  async run(input: RunInput): Promise<TestResult> {
    const { projectPath } = input;
    const args = input.args ?? [];
    const timeout = input.timeoutMs ?? 120000;

    let language = input.language;
    if (!language || language === 'auto') {
      language = await this.inferProjectLanguage(projectPath);
    }

    const started = Date.now();
    try {
      switch (language) {
        case 'typescript':
        case 'javascript':
          return await this.runNode(projectPath, input.testPath, args, timeout, started);
        case 'python':
          return await this.runPython(projectPath, input.testPath, args, timeout, started);
        case 'rust':
          return await this.runCargo(projectPath, args, timeout, started);
        case 'go':
          return await this.runGo(projectPath, input.testPath, args, timeout, started);
        default:
          return this.unsupported(language, started);
      }
    } catch (e) {
      const err: any = e;
      return {
        passed: 0, failed: 1, skipped: 0,
        duration: Date.now() - started,
        suites: [{ name: 'runner', duration: 0, tests: [{ name: 'setup', status: 'failed', duration: 0, error: err?.message ?? String(err) }] }],
      };
    }
  }

  private async inferProjectLanguage(projectPath: string): Promise<string> {
    try {
      const files = await fs.readdir(projectPath);
      if (files.includes('Cargo.toml')) return 'rust';
      if (files.includes('go.mod')) return 'go';
      if (files.includes('pyproject.toml') || files.includes('requirements.txt') || files.includes('pytest.ini')) return 'python';
      if (files.includes('package.json')) {
        const pkg = JSON.parse(await fs.readFile(path.join(projectPath, 'package.json'), 'utf-8'));
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (deps.typescript || files.some((f) => f.endsWith('.ts'))) return 'typescript';
        return 'javascript';
      }
    } catch { /* fall through */ }
    return 'unknown';
  }

  private async runNode(projectPath: string, testPath: string | undefined, args: string[], timeout: number, started: number): Promise<TestResult> {
    // Prefer vitest JSON reporter; fallback to npm test
    const vitestArgs = ['--no-install', 'vitest', 'run', '--reporter=json', ...(testPath ? [testPath] : []), ...args];
    try {
      const { stdout } = await execFileAsync('npx', vitestArgs, { cwd: projectPath, timeout, maxBuffer: 20 * 1024 * 1024 });
      return this.parseVitestJson(stdout, Date.now() - started);
    } catch (e) {
      const err: any = e;
      const out = err.stdout ?? '';
      if (out) {
        try { return this.parseVitestJson(out, Date.now() - started); } catch { /* fall through */ }
      }
      return {
        passed: 0, failed: 1, skipped: 0, duration: Date.now() - started,
        suites: [{ name: 'vitest', duration: 0, tests: [{ name: 'run', status: 'failed', duration: 0, error: (err.stderr ?? err.message ?? '').slice(0, 2000) }] }],
      };
    }
  }

  private parseVitestJson(stdout: string, duration: number): TestResult {
    const suites: TestSuite[] = [];
    let passed = 0, failed = 0, skipped = 0;
    // vitest JSON reporter emits one JSON object per line for newer versions; handle both array and NDJSON
    const lines = stdout.split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        const files = obj.testResults ?? obj.files ?? [];
        for (const f of files) {
          const cases = (f.assertionResults ?? f.tests ?? []).map((t: any) => {
            const status = (t.status === 'passed' ? 'passed' : t.status === 'skipped' || t.status === 'todo' ? 'skipped' : 'failed') as 'passed' | 'failed' | 'skipped';
            if (status === 'passed') passed++; else if (status === 'skipped') skipped++; else failed++;
            return { name: t.title ?? t.name ?? 'test', status, duration: t.duration ?? 0, error: t.failureMessages?.join('\n').slice(0, 2000) };
          });
          suites.push({ name: f.name ?? 'suite', tests: cases, duration: 0 });
        }
      } catch { /* ignore non-JSON lines */ }
    }
    if (suites.length === 0) {
      suites.push({ name: 'vitest', duration, tests: [{ name: 'run', status: failed > 0 ? 'failed' : 'passed', duration }] });
    }
    return { passed, failed, skipped, duration, suites };
  }

  private async runPython(projectPath: string, testPath: string | undefined, args: string[], timeout: number, started: number): Promise<TestResult> {
    const pyArgs = ['-m', 'pytest', '-q', ...(testPath ? [testPath] : []), ...args];
    for (const py of ['python', 'python3']) {
      try {
        const { stdout } = await execFileAsync(py, pyArgs, { cwd: projectPath, timeout, maxBuffer: 20 * 1024 * 1024 });
        return this.parsePytest(stdout, Date.now() - started);
      } catch (e) {
        const err: any = e;
        const out = (err.stdout ?? '') as string;
        if (/passed|failed|error/i.test(out)) return this.parsePytest(out, Date.now() - started);
        if (err.code === 'ENOENT') continue; // try next python
        return {
          passed: 0, failed: 1, skipped: 0, duration: Date.now() - started,
          suites: [{ name: 'pytest', duration: 0, tests: [{ name: 'run', status: 'failed', duration: 0, error: String(err.message).slice(0, 2000) }] }],
        };
      }
    }
    return this.unsupported('python (no interpreter)', started);
  }

  private parsePytest(stdout: string, duration: number): TestResult {
    const m = stdout.match(/(\d+)\s+passed(?:,\s*(\d+)\s+skipped)?(?:,\s*(\d+)\s+failed)?/i)
      ?? stdout.match(/(\d+)\s+failed(?:,\s*(\d+)\s+passed)?/i);
    let passed = 0, failed = 0, skipped = 0;
    if (m) {
      // heuristic: numbers in order seen
      const nums = [...stdout.matchAll(/(\d+)\s+(passed|failed|skipped|error)/gi)];
      for (const [, n, kind] of nums) {
        if (/passed/i.test(kind)) passed = parseInt(n, 10);
        else if (/failed|error/i.test(kind)) failed = parseInt(n, 10);
        else if (/skipped/i.test(kind)) skipped = parseInt(n, 10);
      }
    }
    return { passed, failed, skipped, duration, suites: [{ name: 'pytest', duration, tests: [] }] };
  }

  private async runCargo(projectPath: string, args: string[], timeout: number, started: number): Promise<TestResult> {
    try {
      const { stdout } = await execFileAsync('cargo', ['test', '--', ...args], { cwd: projectPath, timeout, maxBuffer: 20 * 1024 * 1024 });
      const m = stdout.match(/test result:\s+ok\.\s+(\d+)\s+passed.*?(\d+)\s+failed/i);
      const passed = m ? parseInt(m[1], 10) : 0;
      const failed = m ? parseInt(m[2], 10) : 0;
      return { passed, failed, skipped: 0, duration: Date.now() - started, suites: [{ name: 'cargo test', duration: 0, tests: [] }] };
    } catch (e) {
      const err: any = e;
      return {
        passed: 0, failed: 1, skipped: 0, duration: Date.now() - started,
        suites: [{ name: 'cargo test', duration: 0, tests: [{ name: 'run', status: 'failed', duration: 0, error: String(err.message).slice(0, 2000) }] }],
      };
    }
  }

  private async runGo(projectPath: string, testPath: string | undefined, args: string[], timeout: number, started: number): Promise<TestResult> {
    try {
      const { stdout } = await execFileAsync('go', ['test', './...', ...(testPath ? [testPath] : []), ...args], { cwd: projectPath, timeout, maxBuffer: 20 * 1024 * 1024 });
      const ok = (stdout.match(/^ok\s+/gm) ?? []).length;
      const fail = (stdout.match(/^FAIL/gm) ?? []).length;
      return { passed: ok, failed: fail, skipped: 0, duration: Date.now() - started, suites: [{ name: 'go test', duration: 0, tests: [] }] };
    } catch (e) {
      const err: any = e;
      return {
        passed: 0, failed: 1, skipped: 0, duration: Date.now() - started,
        suites: [{ name: 'go test', duration: 0, tests: [{ name: 'run', status: 'failed', duration: 0, error: String(err.message).slice(0, 2000) }] }],
      };
    }
  }

  private unsupported(language: string, started: number): TestResult {
    return {
      passed: 0, failed: 0, skipped: 0, duration: Date.now() - started,
      suites: [{ name: language, duration: 0, tests: [{ name: 'run', status: 'skipped', duration: 0, error: `No test runner for language: ${language}` }] }],
    };
  }
}
