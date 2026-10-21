#!/usr/bin/env node
/**
 * Validate the plugin ecosystem after `pnpm run build`.
 *
 * Loads every built workspace package, checks each exported plugin against the
 * authoring contract, mounts each one into a mock context, and validates the
 * tools it registers. Catches the failure modes that used to surface only at
 * runtime: stale contracts, typo-ed names, async setup in a sync host, empty
 * plugins and malformed tool shapes.
 *
 * Node >= 22, zero dependencies.
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHIM_PACKAGE = '@deepseek-ai/dsh-core';
const TOOL_NAME = /^[a-z][a-z0-9_-]{0,63}$/;

function fail(message) {
  console.error(`plugin check: ${message}`);
  process.exit(1);
}

function packages() {
  const dir = join(ROOT, 'packages');
  if (!existsSync(dir)) fail('packages/ not found');
  return readdirSync(dir)
    .sort()
    .map((name) => join(dir, name))
    .filter((entry) => statSync(entry).isDirectory() && existsSync(join(entry, 'package.json')))
    .map((entry) => ({
      dir: entry,
      manifest: JSON.parse(readFileSync(join(entry, 'package.json'), 'utf8')),
      source: join(entry, 'src', 'index.ts'),
      entry: join(entry, 'dist', 'index.js'),
    }));
}

function pluginExports(mod) {
  const out = [];
  const seen = new Set();
  for (const value of Object.values(mod)) {
    if (
      value &&
      typeof value === 'object' &&
      typeof value.name === 'string' &&
      typeof value.setup === 'function' &&
      !seen.has(value)
    ) {
      seen.add(value);
      out.push(value);
    }
  }
  return out;
}

function isToolLike(value) {
  return value && typeof value === 'object' && typeof value.name === 'string';
}

const baseDir = mkdtempSync(join(tmpdir(), 'zoveli-plugin-check-'));
process.env.NODE_ENV = 'test';
process.env.ZOVELI_MEMORY_DB = join(baseDir, 'memory.db');
process.env.ZOVELI_VAULT_PATH = join(baseDir, 'vault');
process.env.ZOVELI_SESSION_PATH = join(baseDir, 'sessions');
process.env.MATHCORE_AUDIT = join(baseDir, 'audit.jsonl');
process.env.ZOVELI_PROFILE = 'zoveli-plugin-check';

const errors = [];
const warnings = [];
const notes = [];
const pluginNames = new Map();
const toolOwners = new Map();
let pluginCount = 0;
let packageCount = 0;

try {
  const shimEntry = join(ROOT, 'packages', 'shim-dsh-core', 'dist', 'index.js');
  if (!existsSync(shimEntry)) fail('shim output missing; run pnpm run build first');
  const shim = await import(pathToFileURL(shimEntry).href);
  if (typeof shim.validatePlugin !== 'function' || !Number.isInteger(shim.PLUGIN_API_VERSION)) {
    fail('shim does not export validatePlugin + PLUGIN_API_VERSION; rebuild');
  }

  const hostEntry = join(ROOT, 'packages', 'host', 'dist', 'index.js');
  if (!existsSync(hostEntry)) fail('host output missing; run pnpm run build first');
  const { defaultPlugins } = await import(pathToFileURL(hostEntry).href);
  if (!Array.isArray(defaultPlugins)) fail('host does not export defaultPlugins; rebuild');
  const defaultOwners = new Set(defaultPlugins.map((plugin) => plugin.name));

  for (const pkg of packages()) {
    packageCount += 1;
    if (!existsSync(pkg.entry)) {
      errors.push(`${pkg.manifest.name}: missing ${relative(ROOT, pkg.entry)}; run pnpm run build`);
      continue;
    }

    let mod;
    try {
      mod = await import(pathToFileURL(pkg.entry).href);
    } catch (error) {
      errors.push(`${pkg.manifest.name}: failed to load (${error instanceof Error ? error.message : String(error)})`);
      continue;
    }

    const plugins = pluginExports(mod);
    if (plugins.length === 0) {
      const declaresPlugin = readFileSync(pkg.source, 'utf8').includes('definePlugin(');
      if (pkg.manifest.name !== SHIM_PACKAGE && declaresPlugin) {
        errors.push(`${pkg.manifest.name}: source declares definePlugin but the build exports no plugin`);
      } else {
        notes.push(`${pkg.manifest.name}: library (no plugin exports)`);
      }
      continue;
    }

    for (const plugin of plugins) {
      pluginCount += 1;
      for (const issue of shim.validatePlugin(plugin)) {
        errors.push(`${pkg.manifest.name}: ${issue.message}`);
      }

      const first = pluginNames.get(plugin.name);
      if (first) {
        errors.push(`plugin name "${plugin.name}" exported by both ${first} and ${pkg.manifest.name}`);
      } else {
        pluginNames.set(plugin.name, pkg.manifest.name);
      }

      const registrations = [];
      let contributions = 0;
      const ctx = {
        register(key, value) {
          contributions += 1;
          registrations.push(value);
          return value;
        },
        provide() {
          contributions += 1;
          return undefined;
        },
        on() {
          contributions += 1;
          return undefined;
        },
        get() {
          return undefined;
        },
        emit() {},
        config: {},
        plugins: [],
        log: { info() {}, warn() {}, error() {}, debug() {} },
      };

      let result;
      try {
        result = plugin.setup(ctx);
      } catch (error) {
        errors.push(`plugin "${plugin.name}" setup failed: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      if (result && typeof result.then === 'function') {
        errors.push(`plugin "${plugin.name}" setup() returned a Promise; setup must be synchronous`);
        continue;
      }
      if (contributions === 0) {
        errors.push(`plugin "${plugin.name}" contributes nothing (register/provide/on)`);
      }

      const localTools = new Set();
      for (const value of registrations) {
        const items = Array.isArray(value)
          ? value.filter(isToolLike)
          : isToolLike(value) && typeof value.execute === 'function'
            ? [value]
            : [];
        for (const tool of items) {
          const label = `plugin "${plugin.name}" tool "${tool.name}"`;
          if (!TOOL_NAME.test(tool.name)) {
            errors.push(`${label}: name must match ${TOOL_NAME}`);
          }
          if (localTools.has(tool.name)) {
            errors.push(`${label}: registered twice by the same plugin`);
          } else {
            const owner = toolOwners.get(tool.name);
            if (owner && owner !== plugin.name) {
              if (defaultOwners.has(owner) && defaultOwners.has(plugin.name)) {
                notes.push(
                  `${label}: shadowed by default plugin "${owner}" (first mounted wins)`
                );
              } else {
                errors.push(
                  `${label}: already registered by plugin "${owner}"; rename the tool or unmount one plugin`
                );
              }
            } else if (!owner) {
              toolOwners.set(tool.name, plugin.name);
            }
          }
          localTools.add(tool.name);
          if (typeof tool.description !== 'string' || tool.description.trim() === '') {
            warnings.push(`${label}: missing a description`);
          }
          if (tool.parameters !== undefined && (typeof tool.parameters !== 'object' || tool.parameters === null)) {
            errors.push(`${label}: parameters must be a JSON Schema object`);
          }
        }
      }
      if (localTools.size === 0) {
        notes.push(`plugin "${plugin.name}": service/event-only (no executable tools)`);
      }
    }
  }

  if (pluginCount === 0) errors.push('no plugins were discovered');

  const summary =
    `plugin check: ${errors.length === 0 ? 'ok' : 'failed'} ` +
    `(${packageCount} packages, ${pluginCount} plugins, ${toolOwners.size} unique tools, ` +
    `${warnings.length} warnings)`;
  if (errors.length > 0) {
    console.error(summary);
    for (const error of errors) console.error(`  error: ${error}`);
  } else {
    console.log(summary);
  }
  for (const warning of warnings) console.log(`  warning: ${warning}`);
  if (process.env.ZOVELI_PLUGIN_CHECK_VERBOSE === '1') {
    for (const note of notes) console.log(`  note: ${note}`);
  }
  if (errors.length > 0) process.exitCode = 1;
} finally {
  try {
    rmSync(baseDir, { recursive: true, force: true });
  } catch {
    // Windows may still hold the SQLite handle; best-effort cleanup.
  }
}
