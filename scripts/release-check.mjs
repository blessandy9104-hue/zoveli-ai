/**
 * Release consistency guard: `pnpm release:check [--release] [--tag] [--json]`.
 *
 * Default mode (safe on every PR): root/workspace versions agree, the runtime
 * version constant matches, and every workspace package is referenced by the
 * root tsconfig (and nothing stale is).
 *
 * `--release` additionally requires a CHANGELOG entry for the current version
 * and a clean working tree; `--tag` requires HEAD to carry `v<version>`.
 * `--allow-dirty` is an explicit escape hatch for local dry runs.
 *
 * Node >= 22, zero dependencies.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ROOT = resolve(SCRIPT_DIR, '..');
export const SHIM_PACKAGE = '@deepseek-ai/dsh-core';
export const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function workspacePackages(root = DEFAULT_ROOT) {
  const packages = [];
  for (const group of ['packages', 'apps']) {
    const groupDir = join(root, group);
    if (!existsSync(groupDir)) continue;
    for (const name of readdirSync(groupDir).sort()) {
      const dir = join(groupDir, name);
      const pkgPath = join(dir, 'package.json');
      if (!statSync(dir).isDirectory() || !existsSync(pkgPath)) continue;
      const pkg = readJson(pkgPath);
      packages.push({
        dir: `${group}/${name}`,
        name: pkg.name,
        version: pkg.version,
        private: pkg.private === true,
      });
    }
  }
  return packages;
}

export function tsconfigReferences(root = DEFAULT_ROOT) {
  const config = readJson(join(root, 'tsconfig.json'));
  return (config.references ?? []).map((entry) =>
    String(entry.path).replace(/^\.\//, '').replace(/\\/g, '/')
  );
}

export function versionConstant(root = DEFAULT_ROOT) {
  const file = join(root, 'packages/core/src/version.ts');
  if (!existsSync(file)) return null;
  const match = readFileSync(file, 'utf8').match(/ZOVELI_VERSION\s*=\s*['"]([^'"]+)['"]/);
  return match ? match[1] : null;
}

export function changelogHasVersion(markdown, version) {
  if (!markdown) return false;
  const escaped = String(version).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^##\\s+\\[?v?${escaped}\\]?(?:\\s|$)`, 'm').test(markdown);
}

export function validateRelease(input) {
  const errors = [];
  const warnings = [];
  const {
    rootVersion,
    packages,
    references,
    constant,
    changelog,
    release = false,
    dirty = false,
    allowDirty = false,
    requireTag = false,
    tagsAtHead = [],
  } = input;

  if (!SEMVER_PATTERN.test(String(rootVersion ?? ''))) {
    errors.push(`root version "${rootVersion}" is not semver`);
  }

  for (const pkg of packages) {
    if (pkg.name === SHIM_PACKAGE) continue;
    if (pkg.version !== rootVersion) {
      errors.push(`${pkg.dir} (${pkg.name}) version ${pkg.version} does not match root ${rootVersion}`);
    }
  }

  const expectedRefs = new Set(packages.map((pkg) => pkg.dir));
  const actualRefs = new Set(references);
  for (const ref of expectedRefs) {
    if (!actualRefs.has(ref)) errors.push(`tsconfig.json is missing a reference to ${ref}`);
  }
  for (const ref of actualRefs) {
    if (!expectedRefs.has(ref)) errors.push(`tsconfig.json references ${ref}, which is not a workspace package`);
  }

  if (constant === null) {
    errors.push('packages/core/src/version.ts does not export ZOVELI_VERSION');
  } else if (constant !== rootVersion) {
    errors.push(`ZOVELI_VERSION ${constant} does not match root ${rootVersion}`);
  }

  if (release) {
    if (!changelogHasVersion(changelog, rootVersion)) {
      errors.push(`CHANGELOG.md has no "## ${rootVersion}" entry`);
    }
    if (dirty && !allowDirty) {
      errors.push('working tree is dirty; commit before releasing (or pass --allow-dirty)');
    }
    if (requireTag && !tagsAtHead.includes(`v${rootVersion}`)) {
      errors.push(`HEAD is not tagged v${rootVersion}`);
    }
  }

  if (!changelog) warnings.push('CHANGELOG.md is missing (required with --release)');

  return { errors, warnings };
}

export function gitTagsAtHead(root = DEFAULT_ROOT) {
  try {
    return execFileSync('git', ['tag', '--points-at', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function gitDirty(root = DEFAULT_ROOT) {
  try {
    return (
      execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim().length > 0
    );
  } catch {
    return false;
  }
}

export function readChangelog(root = DEFAULT_ROOT) {
  const file = join(root, 'CHANGELOG.md');
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

export function releaseCheck(root = DEFAULT_ROOT, options = {}) {
  const rootVersion = readJson(join(root, 'package.json')).version;
  const packages = workspacePackages(root);
  const result = validateRelease({
    rootVersion,
    packages,
    references: tsconfigReferences(root),
    constant: versionConstant(root),
    changelog: readChangelog(root),
    release: options.release === true,
    dirty: options.release === true && options.allowDirty !== true ? gitDirty(root) : false,
    allowDirty: options.allowDirty === true,
    requireTag: options.tag === true,
    tagsAtHead: options.tag === true ? gitTagsAtHead(root) : [],
  });
  return {
    ok: result.errors.length === 0,
    version: rootVersion,
    packages: packages.length,
    errors: result.errors,
    warnings: result.warnings,
  };
}

function parseArgs(argv) {
  const options = { release: false, tag: false, json: false, allowDirty: false };
  for (const arg of argv) {
    if (arg === '--release') options.release = true;
    else if (arg === '--tag') options.tag = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--allow-dirty') options.allowDirty = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`unknown option "${arg}" (try --release, --tag, --json, --allow-dirty)`);
  }
  return options;
}

export function main(argv = process.argv.slice(2), root = DEFAULT_ROOT) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(`Usage: pnpm release:check [--release] [--tag] [--json] [--allow-dirty]

  --release       also require a CHANGELOG entry and a clean tree
  --tag           also require HEAD to be tagged v<version> (implies --release)
  --allow-dirty   skip the clean-tree gate during local dry runs
  --json          machine-readable output`);
    return 0;
  }
  if (options.tag) options.release = true;
  const result = releaseCheck(root, options);
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(
      result.ok
        ? `release check: ok (v${result.version}, ${result.packages} workspace packages)`
        : 'release check: failed'
    );
    for (const warning of result.warnings) console.log(`warn: ${warning}`);
    for (const error of result.errors) console.log(`error: ${error}`);
  }
  return result.ok ? 0 : 1;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    process.exitCode = main();
  } catch (e) {
    console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
