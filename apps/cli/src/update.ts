import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { ZOVELI_VERSION } from '@zoveli/core/version';
import { parseFlags, type FlagDefinition } from './flags.js';
import { safeFetch, safeFetchText } from './net.js';

const DEFAULT_REPO = 'blessandy9104-hue/zoveli-ai';
const MAX_UPDATE_BYTES = 512 * 1024 * 1024;

interface ParsedFlags {
  check: boolean;
  json: boolean;
  help: boolean;
  yes: boolean;
  dir?: string;
  repo?: string;
  api?: string;
  installer?: string;
}

const FLAGS = [
  { key: 'check', tokens: ['--check'] },
  { key: 'json', tokens: ['--json'] },
  { key: 'help', tokens: ['--help', '-h'] },
  { key: 'yes', tokens: ['--yes', '-y'] },
  { key: 'dir', tokens: ['--dir'], takesValue: true },
  { key: 'repo', tokens: ['--repo'], takesValue: true },
  { key: 'api', tokens: ['--api'], takesValue: true },
  { key: 'installer', tokens: ['--installer'], takesValue: true },
] as const satisfies readonly FlagDefinition<keyof ParsedFlags>[];

function usage(): string {
  return `zoveli updater
  zoveli update [--check] [--yes] [--json]
  zoveli update [--dir PATH] [--installer FILE] [--repo OWNER/NAME]

Checks the latest GitHub release, downloads the archive for this platform,
verifies its published SHA-256, and runs the unified runtime installer.
Redirects are followed manually and restricted to GitHub hosts, so an update
cannot be redirected to localhost or another machine on your network.

  --check       report whether an update exists without installing
  --yes, -y     install without prompting (required when stdin is not a TTY)
  --dir PATH    install directory passed to the runtime installer
  --installer   override the installer script path
  --repo        override the GitHub repository (OWNER/NAME)
  --api         override the release API URL
  --json        print structured output`;
}

export interface UpdateReleaseAsset {
  name: string;
  url: string;
  checksumUrl: string;
}

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  tag: string;
  updateAvailable: boolean;
  releaseUrl: string;
  asset: UpdateReleaseAsset | null;
}

export interface InstallerInvocation {
  command: string;
  args: string[];
  installerPath: string;
  archivePath: string;
  version: string;
}

export interface UpdateDependencies {
  fetchImpl?: typeof fetch;
  currentVersion?: string;
  apiUrl?: string;
  repo?: string;
  platform?: NodeJS.Platform;
  arch?: string;
  cwd?: string;
  installerPath?: string;
  runInstaller?: (invocation: InstallerInvocation) => number | Promise<number>;
  confirm?: (message: string) => boolean | Promise<boolean>;
  log?: (line: string) => void;
  errorLine?: (line: string) => void;
  now?: () => Date;
}

interface GitHubRelease {
  tag_name?: unknown;
  html_url?: unknown;
  assets?: unknown;
}

interface ParsedVersion {
  core: number[];
  prerelease: string[];
}

function parseVersion(raw: string): ParsedVersion {
  const value = raw.trim().replace(/^v/i, '');
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value);
  if (!match) throw new Error(`not a semantic version: ${raw}`);
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ? match[4].split('.') : [],
  };
}

/** Compare two semantic versions; returns -1, 0, or 1. */
export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] > b.core[index] ? 1 : -1;
  }
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0;
  if (a.prerelease.length === 0) return 1;
  if (b.prerelease.length === 0) return -1;
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const x = a.prerelease[index];
    const y = b.prerelease[index];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) return Number(x) > Number(y) ? 1 : -1;
    if (xn !== yn) return xn ? -1 : 1;
    return x > y ? 1 : -1;
  }
  return 0;
}

export function versionFromTag(tag: string): string {
  const value = tag.trim().replace(/^v/i, '');
  parseVersion(value);
  return value;
}

export function platformSlug(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') return 'windows';
  if (platform === 'darwin') return 'macos';
  if (platform === 'linux') return 'linux';
  throw new Error(`unsupported update platform: ${platform}`);
}

export function archiveName(
  version: string,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch
): string {
  if (arch !== 'x64' && arch !== 'arm64') {
    throw new Error(`unsupported update architecture: ${arch}`);
  }
  return `zoveli-${version}-${platformSlug(platform)}-${arch}.tar.gz`;
}

function installerName(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32'
    ? 'install-zoveli-runtime.ps1'
    : 'install-zoveli-runtime.sh';
}

function repoFrom(value: string | undefined): string {
  const repo = value || DEFAULT_REPO;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error(`invalid update repository: ${repo}`);
  }
  return repo;
}

function tagIsSafe(tag: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(tag);
}

function assetList(payload: GitHubRelease): { name: string; url: string }[] {
  if (!Array.isArray(payload.assets)) return [];
  const assets: { name: string; url: string }[] = [];
  for (const entry of payload.assets) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    if (typeof item.name === 'string' && typeof item.browser_download_url === 'string') {
      assets.push({ name: item.name, url: item.browser_download_url });
    }
  }
  return assets;
}

export async function fetchLatestRelease(
  repo: string,
  options: {
    fetchImpl?: typeof fetch;
    apiUrl?: string;
    platform?: NodeJS.Platform;
    arch?: string;
  } = {}
): Promise<UpdateInfo & { availableAssets: string[] }> {
  const apiUrl =
    options.apiUrl || `https://api.github.com/repos/${repoFrom(repo)}/releases/latest`;
  const response = await safeFetch(apiUrl, {
    fetchImpl: options.fetchImpl,
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (response.status !== 200) {
    throw new Error(`release lookup failed: HTTP ${response.status} from ${new URL(apiUrl).host}`);
  }
  let payload: GitHubRelease;
  try {
    payload = JSON.parse(new TextDecoder().decode(response.body)) as GitHubRelease;
  } catch {
    throw new Error('release lookup returned invalid JSON');
  }
  const tag = typeof payload.tag_name === 'string' ? payload.tag_name.trim() : '';
  if (!tag || !tagIsSafe(tag)) throw new Error('release lookup returned an invalid tag');
  const latestVersion = versionFromTag(tag);
  const assets = assetList(payload);
  const wanted = archiveName(latestVersion, options.platform, options.arch);
  const archive = assets.find((asset) => asset.name === wanted);
  const checksum = assets.find((asset) => asset.name === `${wanted}.sha256`);
  return {
    currentVersion: '',
    latestVersion,
    tag,
    updateAvailable: false,
    releaseUrl: typeof payload.html_url === 'string' ? payload.html_url : '',
    asset:
      archive && checksum
        ? { name: archive.name, url: archive.url, checksumUrl: checksum.url }
        : null,
    availableAssets: assets.map((asset) => asset.name),
  };
}

function findInstaller(cwd: string, name: string): string | null {
  const candidates = [
    process.env.ZOVELI_INSTALLER,
    join(cwd, 'install', name),
    join(dirname(process.argv[1] || ''), 'install', name),
    join(dirname(process.execPath), 'install', name),
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    const path = resolve(candidate);
    if (existsSync(path)) return path;
  }
  return null;
}

async function downloadInstaller(
  repo: string,
  tag: string,
  name: string,
  destination: string,
  fetchImpl?: typeof fetch
): Promise<string> {
  const url = `https://raw.githubusercontent.com/${repo}/${encodeURIComponent(tag)}/install/${name}`;
  const response = await safeFetch(url, { fetchImpl });
  if (response.status !== 200) {
    throw new Error(`could not download the installer: HTTP ${response.status}`);
  }
  writeFileSync(destination, response.body);
  return destination;
}

export function installerInvocation(options: {
  installerPath: string;
  archivePath: string;
  version: string;
  dir?: string;
  platform?: NodeJS.Platform;
}): InstallerInvocation {
  const platform = options.platform ?? process.platform;
  if (platform === 'win32') {
    const args = [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      options.installerPath,
      '-Yes',
      '-Archive',
      options.archivePath,
      '-Version',
      options.version,
    ];
    if (options.dir) args.push('-Dir', options.dir);
    return {
      command: 'powershell.exe',
      args,
      installerPath: options.installerPath,
      archivePath: options.archivePath,
      version: options.version,
    };
  }
  const args = [
    options.installerPath,
    '--yes',
    '--archive',
    options.archivePath,
    '--version',
    options.version,
  ];
  if (options.dir) args.push('--dir', options.dir);
  return {
    command: 'sh',
    args,
    installerPath: options.installerPath,
    archivePath: options.archivePath,
    version: options.version,
  };
}

function printInfo(info: UpdateInfo, log: (line: string) => void): void {
  if (info.updateAvailable) {
    log(
      `zoveli update: ${info.currentVersion} -> ${info.latestVersion} (${info.tag}) is available`
    );
    log(`release: ${info.releaseUrl}`);
    if (info.asset) log(`asset: ${info.asset.name}`);
  } else {
    log(`zoveli update: ${info.currentVersion} is up to date (latest ${info.latestVersion})`);
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function firstToken(text: string): string {
  return text.trim().split(/\s+/)[0]?.toLowerCase() || '';
}

export async function runUpdate(argv: string[], deps: UpdateDependencies = {}): Promise<number> {
  const log = deps.log ?? ((line: string) => console.log(line));
  const errorLine = deps.errorLine ?? ((line: string) => console.error(line));
  try {
    const flags = parseFlags<ParsedFlags>(
      argv,
      { check: false, json: false, help: false, yes: false },
      FLAGS
    );
    if (flags.help) {
      log(usage());
      return 0;
    }

    const cwd = resolve(deps.cwd ?? process.cwd());
    const repo = repoFrom(flags.repo ?? process.env.ZOVELI_UPDATE_REPO ?? deps.repo);
    const currentVersion = deps.currentVersion ?? ZOVELI_VERSION;
    const platform = deps.platform ?? process.platform;
    const arch = deps.arch ?? process.arch;
    const latest = await fetchLatestRelease(repo, {
      fetchImpl: deps.fetchImpl,
      apiUrl: flags.api ?? process.env.ZOVELI_UPDATE_API ?? deps.apiUrl,
      platform,
      arch,
    });
    const updateAvailable = compareVersions(latest.latestVersion, currentVersion) > 0;
    const info: UpdateInfo = {
      currentVersion,
      latestVersion: latest.latestVersion,
      tag: latest.tag,
      updateAvailable,
      releaseUrl: latest.releaseUrl,
      asset: latest.asset,
    };

    if (flags.check || !updateAvailable) {
      if (flags.json) {
        log(JSON.stringify(info, null, 2));
      } else {
        printInfo(info, log);
      }
      return 0;
    }

    if (!info.asset) {
      throw new Error(
        `release ${latest.tag} has no ${archiveName(
          latest.latestVersion,
          platform,
          arch
        )} asset (available: ${latest.availableAssets.join(', ') || 'none'})`
      );
    }

    if (!flags.yes) {
      if (deps.confirm) {
        if (!(await deps.confirm(`Install Zoveli ${latest.latestVersion}?`))) {
          log('update cancelled');
          return 0;
        }
      } else if (process.stdin.isTTY) {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        try {
          const answer = await rl.question(
            `Install Zoveli ${latest.latestVersion} over ${currentVersion}? [y/N] `
          );
          if (!/^(y|yes)$/i.test(answer.trim())) {
            log('update cancelled');
            return 0;
          }
        } finally {
          rl.close();
        }
      } else {
        throw new Error('refusing to update without --yes when stdin is not a TTY');
      }
    }

    const tempRoot = mkdtempSync(join(tmpdir(), 'zoveli-update-'));
    let installerExit = 0;
    try {
      const archivePath = join(tempRoot, info.asset.name);
      const archive = await safeFetch(info.asset.url, { fetchImpl: deps.fetchImpl });
      if (archive.status !== 200) {
        throw new Error(`archive download failed: HTTP ${archive.status}`);
      }
      if (archive.body.byteLength > MAX_UPDATE_BYTES) {
        throw new Error(`release archive is larger than ${MAX_UPDATE_BYTES} bytes`);
      }
      const digest = sha256(archive.body);

      const checksum = await safeFetchText(info.asset.checksumUrl, { fetchImpl: deps.fetchImpl });
      if (checksum.status !== 200) {
        throw new Error(`checksum download failed: HTTP ${checksum.status}`);
      }
      const expected = firstToken(checksum.text);
      if (!/^[0-9a-f]{64}$/.test(expected)) {
        throw new Error('release checksum file is malformed');
      }
      if (expected !== digest) {
        throw new Error('release archive failed SHA-256 verification');
      }

      mkdirSync(dirname(archivePath), { recursive: true });
      writeFileSync(archivePath, archive.body);
      writeFileSync(
        `${archivePath}.sha256`,
        `${digest}  ${info.asset.name}\n`
      );
      log(`verified ${info.asset.name} (sha256 ${digest})`);

      let installerPath =
        deps.installerPath ??
        (flags.installer ? resolve(cwd, flags.installer) : null) ??
        findInstaller(cwd, installerName(platform));
      if (installerPath) {
        installerPath = resolve(cwd, installerPath);
        if (!existsSync(installerPath)) {
          throw new Error(`installer not found: ${installerPath}`);
        }
      } else {
        installerPath = await downloadInstaller(
          repo,
          latest.tag,
          installerName(platform),
          join(tempRoot, installerName(platform)),
          deps.fetchImpl
        );
      }

      const invocation = installerInvocation({
        installerPath,
        archivePath,
        version: latest.latestVersion,
        dir: flags.dir,
        platform,
      });
      if (!flags.json) log(`running installer: ${invocation.installerPath}`);
      if (deps.runInstaller) {
        installerExit = await deps.runInstaller(invocation);
      } else {
        const result = spawnSync(invocation.command, invocation.args, {
          stdio: flags.json ? 'pipe' : 'inherit',
          encoding: 'utf8',
          windowsHide: true,
          cwd,
        });
        if (result.error) throw result.error;
        installerExit = result.status ?? 1;
        if (installerExit !== 0) {
          const detail = (result.stderr || result.stdout || '').trim();
          throw new Error(
            `installer exited with ${installerExit}${detail ? `: ${detail.slice(0, 500)}` : ''}`
          );
        }
      }
      if (installerExit !== 0) throw new Error(`installer exited with ${installerExit}`);

      if (flags.json) {
        log(JSON.stringify({ ...info, installed: true, installerExit }, null, 2));
      } else {
        log(`zoveli ${latest.latestVersion} installed; run zoveli --version to confirm`);
      }
      return 0;
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  } catch (error) {
    errorLine(`error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
