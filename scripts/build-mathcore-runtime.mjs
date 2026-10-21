#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const options = {
    out: join(ROOT, 'release'),
    python: process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out') options.out = resolve(argv[++i]);
    else if (arg === '--python') options.python = argv[++i];
    else if (arg === '--help') options.help = true;
    else throw new Error(`unknown option: ${arg}`);
  }
  return options;
}

function platformSlug(platform = process.platform) {
  if (platform === 'win32') return 'windows';
  if (platform === 'darwin') return 'macos';
  return 'linux';
}

function run(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with code ${result.status}`);
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('usage: node scripts/build-mathcore-runtime.mjs [--out DIR] [--python PATH]');
    return;
  }

  const env = {
    ...process.env,
    PYTHONPATH: [join(ROOT, 'mathcore', 'src'), process.env.PYTHONPATH]
      .filter(Boolean)
      .join(process.platform === 'win32' ? ';' : ':'),
  };

  const check = spawnSync(
    options.python,
    ['-c', 'import PyInstaller, mathcore; print("pyinstaller runtime ready")'],
    { cwd: ROOT, encoding: 'utf8', env }
  );
  if (check.status !== 0) {
    throw new Error(
      `PyInstaller and mathcore must be importable by ${options.python}; ` +
        `run "${options.python} -m pip install pyinstaller -e ./mathcore"`
    );
  }

  const slug = platformSlug();
  const outDir = join(options.out, `mathcore-${slug}-${process.arch}`);
  const workDir = join(ROOT, '.tmp', `mathcore-build-${process.pid}`);

  rmSync(outDir, { recursive: true, force: true });
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  mkdirSync(workDir, { recursive: true });
  const entry = join(workDir, 'mathcore_entry.py');
  writeFileSync(
    entry,
    'from mathcore.mcp_server import main\n\nif __name__ == "__main__":\n    raise SystemExit(main())\n'
  );

  try {
    run(
      options.python,
      [
        '-m',
        'PyInstaller',
        '--noconfirm',
        '--clean',
        '--onedir',
        '--name',
        'mathcore-mcp',
        '--collect-all',
        'z3',
        '--paths',
        join(ROOT, 'mathcore', 'src'),
        '--distpath',
        outDir,
        '--workpath',
        join(workDir, 'work'),
        '--specpath',
        workDir,
        entry,
      ],
      env
    );

    const binary = join(
      outDir,
      'mathcore-mcp',
      process.platform === 'win32' ? 'mathcore-mcp.exe' : 'mathcore-mcp'
    );
    if (!existsSync(binary)) {
      throw new Error(`PyInstaller finished without the expected binary: ${binary}`);
    }
    console.log(binary);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
