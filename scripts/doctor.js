#!/usr/bin/env node
/**
 * Zoveli doctor: check the local toolchain and optional dependencies.
 *
 * Usage: pnpm run doctor [-- --json]
 *
 * Hard requirements (exit 1 when missing): Node.js >= 22, pnpm.
 * Soft requirements (warnings only): git, Python >= 3.11, an importable
 * mathcore package, the mathcore-mcp executable, Ollama. Anything optional
 * prints how to fix it and never fails the run.
 */
const { execFileSync, execSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const JSON_OUT = process.argv.includes('--json');
const results = [];
function ok(name, detail) {
  results.push({ level: 'ok', name, detail });
}
function warn(name, detail, fix) {
  results.push({ level: 'warn', name, detail, fix });
}
function fail(name, detail, fix) {
  results.push({ level: 'fail', name, detail, fix });
}

function run(bin, args, options = {}) {
  return execFileSync(bin, args, { stdio: 'pipe', timeout: 20000, ...options }).toString();
}

// Shell-based: on Windows pnpm/git are .cmd/.ps1 shims that execFile cannot run.
function cmdExists(cmd) {
  try {
    execSync(`${cmd} --version`, { stdio: 'pipe', timeout: 20000 });
    return true;
  } catch {
    return false;
  }
}

// Node.js (hard requirement: node:sqlite needs >= 22)
const major = parseInt(process.versions.node.split('.')[0], 10);
if (major >= 22) ok(`Node.js ${process.versions.node}`, 'meets >= 22 floor (node:sqlite, FTS5)');
else fail(`Node.js ${process.versions.node}`, 'below the >= 22 floor', 'install Node 22 LTS (see README) and re-run');

// pnpm (hard requirement: workspace installs)
if (cmdExists('pnpm')) ok('pnpm', 'available');
else fail('pnpm', 'not on PATH', 'npm install -g pnpm@11.7.0');

// git (needed for clones and version stamps; warn only)
if (cmdExists('git')) ok('git', 'available');
else warn('git', 'not on PATH', 'install git to clone and version the repo');

// Python >= 3.11 (only needed for the vendored verified-math backend).
// Candidates are the launcher first (Windows), then the common names.
const projectVenv = process.env.VIRTUAL_ENV || path.join(process.cwd(), '.venv');
const projectVenvPython =
  process.platform === 'win32'
    ? path.join(projectVenv, 'Scripts', 'python.exe')
    : path.join(projectVenv, 'bin', 'python');
const pythonCandidates = [
  ...(fs.existsSync(projectVenvPython) ? [{ bin: projectVenvPython, args: [], projectVenv: true }] : []),
  { bin: 'py', args: ['-3'] },
  { bin: 'python', args: [] },
  { bin: 'python3', args: [] },
];
let python = null;
for (const candidate of pythonCandidates) {
  const env = candidate.projectVenv
    ? { ...process.env, PYTHONPATH: [path.join(process.cwd(), 'mathcore', 'src'), process.env.PYTHONPATH].filter(Boolean).join(path.delimiter) }
    : undefined;
  try {
    const out = run(candidate.bin, [...candidate.args, '--version'], env ? { env } : {});
    const m = out.match(/Python (\d+)\.(\d+)/);
    if (m && (parseInt(m[1], 10) > 3 || (m[1] === '3' && parseInt(m[2], 10) >= 11))) {
      python = { ...candidate, version: m[0] };
      break;
    }
  } catch {
    // try next binary
  }
}
const pythonHint = 'install Python 3.11+ (winget install Python.Python.3.11 / brew install python@3.11)';
if (python) ok(`Python ${python.version}`, `${python.bin} meets >= 3.11 floor for mathcore`);
else warn('Python 3.11+', 'missing or too old', `${pythonHint}, then: python -m pip install -e ./mathcore`);

// mathcore package importable in that interpreter (version check).
let mathcoreVersion = null;
if (python) {
  try {
    mathcoreVersion = run(python.bin, [
      ...python.args,
      '-c',
      'import mathcore; print(mathcore.__version__)',
    ], python.projectVenv ? { cwd: process.cwd() } : {}).trim();
    ok(`mathcore ${mathcoreVersion}`, `importable from ${python.bin} (verified-math engine)`);
  } catch {
    warn(
      'mathcore package',
      `not importable from ${python.bin}`,
      'from the repo root, activate your venv and run: python -m pip install -e ./mathcore'
    );
  }
} else {
  warn('mathcore package', 'skipped (no Python 3.11+ interpreter found)', pythonHint);
}

// mathcore-mcp executable: same resolution order as the app
// (MATHCORE_MCP_COMMAND -> <cwd>/.venv -> PATH).
function resolveMathcoreMcp() {
  const explicit = process.env.MATHCORE_MCP_COMMAND;
  if (explicit) return { command: explicit, source: 'MATHCORE_MCP_COMMAND' };
  const venvCandidates =
    process.platform === 'win32'
      ? [path.join(process.cwd(), '.venv', 'Scripts', 'mathcore-mcp.exe')]
      : [path.join(process.cwd(), '.venv', 'bin', 'mathcore-mcp')];
  for (const candidate of venvCandidates) {
    if (fs.existsSync(candidate)) return { command: candidate, source: 'project .venv' };
  }
  const exts =
    process.platform === 'win32'
      ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
      : [''];
  for (const rawDir of (process.env.PATH || '').split(path.delimiter)) {
    const dir = rawDir.replace(/^"|"$/g, '');
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, 'mathcore-mcp' + ext);
      if (fs.existsSync(candidate)) return { command: candidate, source: 'PATH' };
    }
  }
  return null;
}

const mathcoreMcp = resolveMathcoreMcp();
if (mathcoreMcp) {
  ok('mathcore-mcp', `resolved from ${mathcoreMcp.source}: ${mathcoreMcp.command}`);
} else {
  warn(
    'mathcore-mcp',
    'not found (math tools withhold results until it is installed)',
    'activate .venv (python -m pip install -e ./mathcore) or set MATHCORE_MCP_COMMAND to the full mathcore-mcp path; verify with: mathcore "2+2"'
  );
}

// Ollama (optional: free local chat; tools work without any model)
const ollamaProbeBase = (process.env.ZOVELI_OLLAMA_URL || 'http://localhost:11434').replace(/\/+$/, '');

function probeOllama() {
  return new Promise((resolve) => {
    const req = http.get(`${ollamaProbeBase}/api/tags`, { timeout: 2000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function main() {
  if (await probeOllama()) ok('Ollama', 'local model server answers (free offline chat)');
  else warn('Ollama', 'not answering — chat needs a key or Ollama', 'install from https://ollama.com, then: ollama pull qwen3:4b');

  let failures = 0;
  let warnings = 0;
  for (const r of results) {
    if (r.level === 'fail') failures += 1;
    if (r.level === 'warn') warnings += 1;
  }

  if (JSON_OUT) {
    console.log(
      JSON.stringify(
        {
          ready: failures === 0,
          warnings,
          failures,
          checks: results,
        },
        null,
        2
      )
    );
  } else {
    for (const r of results) {
      const tag = r.level === 'ok' ? 'ok  ' : r.level === 'warn' ? 'warn' : 'FAIL';
      console.log(`[${tag}] ${r.name} — ${r.detail}`);
      if (r.fix) console.log(`       fix: ${r.fix}`);
    }
    console.log(`\ndoctor: ${failures === 0 ? 'ready' : 'NOT ready'} (${warnings} warning${warnings === 1 ? '' : 's'}, ${failures} blocking)`);
  }
  process.exit(failures === 0 ? 0 : 1);
}

main();
