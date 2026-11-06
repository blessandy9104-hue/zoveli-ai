#!/usr/bin/env node
/**
 * Audit every commit in a revision range without checking out the worktree.
 *
 * For each commit the script reads the files introduced or changed relative to
 * the first parent and validates them:
 *
 * - JavaScript/TypeScript parses with esbuild.
 * - JSON/JSONC parses with the TypeScript config parser.
 * - Python parses with `ast.parse` (one interpreter per commit).
 * - Text files contain no merge-conflict markers.
 * - `git diff-tree --check` reports whitespace problems as warnings.
 *
 * The default range is `HEAD`, so a clean run proves every commit reachable
 * from the current tip is syntactically sound and free of unresolved merges.
 * This is intentionally a fast static audit: running the full unit, Python,
 * and end-to-end suites for every historical commit would require a complete
 * dependency install and build per commit (hours for a 200-commit history).
 *
 * usage: node scripts/audit-history.mjs [--range REV] [--python PATH] [--json]
 *                                      [--no-whitespace] [--verbose]
 */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';
import ts from 'typescript';
import { parseArgs } from './lib/args.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.avif',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.zip', '.gz', '.tgz', '.tar', '.7z', '.dmg', '.exe', '.dll', '.so',
  '.dylib', '.node', '.wasm', '.pdf', '.mp3', '.mp4', '.mov',
]);
const SKIPPED_PREFIXES = ['node_modules/', 'dist/', 'coverage/', 'release/', 'playwright-report/'];

const PYTHON_CHECK = String.raw`
import ast, json, sys
try:
    items = json.load(sys.stdin)
except Exception as exc:
    print(json.dumps([{"path": "<stdin>", "message": "invalid audit payload: %s" % exc}]))
    sys.exit(1)
errors = []
for item in items:
    try:
        ast.parse(item["source"], filename=item["path"])
    except SyntaxError as exc:
        errors.append({
            "path": item["path"],
            "message": "%s (line %s)" % (exc.msg, exc.lineno),
        })
print(json.dumps(errors))
sys.exit(1 if errors else 0)
`;

function git(args, options = {}) {
  return spawnSync('git', args, {
    cwd: ROOT,
    encoding: options.encoding ?? 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    ...options,
  });
}

function gitOrThrow(args, options = {}) {
  const result = git(args, options);
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').toString().trim();
    throw new Error(`git ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`);
  }
  return result.stdout;
}

export function languageFor(path) {
  const lower = path.toLowerCase();
  if (lower.endsWith('.tsx')) return 'tsx';
  if (lower.endsWith('.ts') || lower.endsWith('.mts') || lower.endsWith('.cts')) return 'ts';
  if (lower.endsWith('.jsx')) return 'jsx';
  if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) return 'js';
  if (lower.endsWith('.json') || lower.endsWith('.jsonc')) return 'json';
  return null;
}

export function findConflictMarkers(source) {
  const lines = [];
  source.split(/\r?\n/).forEach((line, index) => {
    if (/^(<{7}|>{7})(?:\s|$)/.test(line)) lines.push(index + 1);
  });
  return lines;
}

export function checkSource(path, source) {
  if (findConflictMarkers(source).length > 0) {
    return 'merge-conflict marker';
  }
  const loader = languageFor(path);
  if (!loader) return null;

  if (loader === 'json') {
    const parsed = ts.parseConfigFileTextToJson(path, source);
    if (parsed.error) {
      return ts.flattenDiagnosticMessageText(parsed.error.messageText, ' ');
    }
    return null;
  }

  try {
    transformSync(source.replace(/^#![^\n]*\n?/, ''), {
      loader,
      sourcefile: path,
      logLevel: 'silent',
    });
  } catch (error) {
    const first = error?.errors?.[0];
    if (first) {
      return `${first.text}${first.location ? ` (line ${first.location.line})` : ''}`;
    }
    return error instanceof Error ? error.message : String(error);
  }
  return null;
}

function isBinary(buffer) {
  const sample = buffer.subarray(0, 8000);
  return sample.includes(0);
}

function shouldSkip(path, buffer) {
  if (SKIPPED_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;
  const dot = path.lastIndexOf('.');
  const extension = dot === -1 ? '' : path.slice(dot).toLowerCase();
  if (BINARY_EXTENSIONS.has(extension)) return true;
  return isBinary(buffer) || buffer.length > MAX_FILE_BYTES;
}

function listCommits(range, all) {
  const args = all
    ? ['rev-list', '--reverse', '--all']
    : ['rev-list', '--reverse', range];
  return gitOrThrow(args).trim().split(/\r?\n/).filter(Boolean);
}

function commitInfo(sha) {
  const format = ['%H', '%P', '%an', '%ae', '%aI', '%cI', '%B'].join('%x00');
  const fields = gitOrThrow(['show', '-s', `--format=${format}`, sha]).split('\0');
  return {
    sha: fields[0],
    parents: (fields[1] || '').split(/\s+/).filter(Boolean),
    author: { name: fields[2], email: fields[3] },
    authoredAt: fields[4],
    committedAt: fields[5],
    message: (fields[6] || '').trim(),
  };
}

function firstParentDiff(sha) {
  return gitOrThrow(['rev-list', '--parents', '-n', '1', sha]).trim().split(/\s+/);
}

function changedFiles(sha) {
  const [, firstParent] = firstParentDiff(sha);
  const args = firstParent
    ? ['diff-tree', '-r', '--no-commit-id', '--name-only', '--diff-filter=d', '-z', firstParent, sha]
    : ['diff-tree', '-r', '--root', '--no-commit-id', '--name-only', '--diff-filter=d', '-z', sha];
  return gitOrThrow(args).split('\0').filter(Boolean);
}

function readBlob(sha, path) {
  return gitOrThrow(['show', `${sha}:${path}`], { encoding: 'buffer' });
}

function whitespaceProblems(sha) {
  const [, firstParent] = firstParentDiff(sha);
  const args = firstParent
    ? ['diff-tree', '--check', '-r', '--no-commit-id', firstParent, sha]
    : ['diff-tree', '--check', '-r', '--root', '--no-commit-id', sha];
  const result = git(args);
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
  return output ? output.split(/\r?\n/) : [];
}

function checkPython(python, files) {
  if (files.length === 0) return [];
  const payload = JSON.stringify(files);
  const result = spawnSync(python, ['-c', PYTHON_CHECK], {
    cwd: ROOT,
    input: payload,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) {
    return [{ path: '<python>', message: `could not run ${python}: ${result.error.message}` }];
  }
  try {
    return JSON.parse(result.stdout || '[]');
  } catch {
    return [{
      path: '<python>',
      message: (result.stderr || result.stdout || 'python audit failed').trim(),
    }];
  }
}

export function auditRange({ range = 'HEAD', all = false, python = 'python', whitespace = true, verbose = false } = {}) {
  const commits = listCommits(range, all);
  const errors = [];
  const warnings = [];

  for (const sha of commits) {
    const info = commitInfo(sha);
    const subject = info.message.split(/\r?\n/)[0] || '(no subject)';
    if (!info.message) {
      errors.push({ sha, path: '<commit>', message: 'empty commit message' });
    }
    if (/^(fixup|squash)!|^WIP\b/i.test(subject)) {
      warnings.push({ sha, path: '<commit>', message: `work-in-progress subject: ${subject}` });
    }

    const pythonFiles = [];
    for (const path of changedFiles(sha)) {
      const buffer = readBlob(sha, path);
      if (shouldSkip(path, buffer)) continue;
      const source = buffer.toString('utf8');
      const problem = checkSource(path, source);
      if (problem) {
        errors.push({ sha, path, message: problem });
      }
      if (path.endsWith('.py')) {
        pythonFiles.push({ path, source });
      }
    }

    for (const problem of checkPython(python, pythonFiles)) {
      errors.push({ sha, path: problem.path, message: problem.message });
    }

    if (whitespace) {
      for (const line of whitespaceProblems(sha)) {
        warnings.push({ sha, path: '<diff>', message: line });
      }
    }

    if (verbose) {
      const mark = errors.some((error) => error.sha === sha) ? 'FAIL' : 'ok';
      console.log(`${mark} ${sha.slice(0, 8)} ${subject}`);
    }
  }

  return { commits: commits.length, errors, warnings };
}

function formatProblem(problem) {
  return `${problem.sha.slice(0, 8)} ${problem.path}: ${problem.message}`;
}

function main() {
  const options = parseArgs(process.argv.slice(2), {
    defaults: { range: 'HEAD', python: 'python' },
    values: {
      '--range': { key: 'range' },
      '--python': { key: 'python' },
    },
    booleans: {
      '--all': 'all',
      '--json': 'json',
      '--no-whitespace': ['whitespace', false],
      '--verbose': 'verbose',
      '--help': 'help',
    },
  });
  if (options.help) {
    console.log('usage: node scripts/audit-history.mjs [--range REV] [--all] [--python PATH] [--json] [--no-whitespace] [--verbose]');
    return;
  }

  const report = auditRange(options);
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`commit audit: ${report.commits} commits, ${report.errors.length} errors, ${report.warnings.length} warnings`);
    for (const error of report.errors) console.error(`error ${formatProblem(error)}`);
    for (const warning of report.warnings) console.warn(`warning ${formatProblem(warning)}`);
  }
  if (report.errors.length > 0) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
