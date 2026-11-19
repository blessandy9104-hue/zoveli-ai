import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  archiveName,
  compareVersions,
  createDownloadProgress,
  installerInvocation,
  runUpdate,
  versionFromTag,
  type InstallerInvocation,
} from '../../apps/cli/src/update';

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'zoveli-update-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

class FakeStderr {
  readonly chunks: string[] = [];
  isTTY: boolean;

  constructor(isTTY: boolean) {
    this.isTTY = isTTY;
  }

  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return true;
  }

  get text(): string {
    return this.chunks.join('');
  }
}

describe('update versions', () => {
  it('compares semantic versions, prereleases, and leading v tags', () => {
    expect(compareVersions('v0.8.0', '0.7.9')).toBe(1);
    expect(compareVersions('0.8.0', 'v0.8.0')).toBe(0);
    expect(compareVersions('0.8.0-beta.1', '0.8.0')).toBe(-1);
    expect(compareVersions('0.8.0', '0.8.0-beta.2')).toBe(1);
    expect(compareVersions('0.8.0-rc.1', '0.8.0-rc.2')).toBe(-1);
    expect(versionFromTag('v0.8.0')).toBe('0.8.0');
    expect(() => versionFromTag('release-latest')).toThrow(/semantic version/);
  });

  it('builds platform-specific archive names', () => {
    expect(archiveName('0.8.0', 'win32', 'x64')).toBe('zoveli-0.8.0-windows-x64.tar.gz');
    expect(archiveName('0.8.0', 'darwin', 'arm64')).toBe('zoveli-0.8.0-macos-arm64.tar.gz');
    expect(archiveName('0.8.0', 'linux', 'x64')).toBe('zoveli-0.8.0-linux-x64.tar.gz');
    expect(() => archiveName('0.8.0', 'linux', 'ia32')).toThrow(/architecture/);
  });

  it('passes a local archive to the unified installers', () => {
    const win = installerInvocation({
      installerPath: 'C:\\tmp\\install-zoveli-runtime.ps1',
      archivePath: 'C:\\tmp\\zoveli.tar.gz',
      version: '0.8.0',
      platform: 'win32',
    });
    expect(win.command).toBe('powershell.exe');
    expect(win.args).toContain('-Archive');
    expect(win.args).toContain('C:\\tmp\\zoveli.tar.gz');
    expect(win.args).toContain('-Yes');

    const posix = installerInvocation({
      installerPath: '/tmp/install-zoveli-runtime.sh',
      archivePath: '/tmp/zoveli.tar.gz',
      version: '0.8.0',
      platform: 'linux',
    });
    expect(posix.command).toBe('sh');
    expect(posix.args).toContain('--archive');
    expect(posix.args).toContain('--yes');
  });
});

describe('download progress', () => {
  it('renders percent and rate, then clears the line', () => {
    let now = 0;
    const chunks: string[] = [];
    const stream = {
      isTTY: true,
      write: (chunk: string) => {
        chunks.push(chunk);
        return true;
      },
    };
    const progress = createDownloadProgress({
      stream,
      label: 'zoveli.tar.gz',
      totalBytes: 100 * 1024 * 1024,
      enabled: true,
      now: () => now,
      intervalMs: 200,
    });
    progress.update(10 * 1024 * 1024);
    now = 1000;
    progress.update(50 * 1024 * 1024);
    now = 2000;
    progress.update(99 * 1024 * 1024);
    now = 2001;
    progress.update(99 * 1024 * 1024, true);
    progress.done();
    expect(chunks[0]).toContain('10%');
    expect(chunks[0]).toContain('10.0 MB');
    expect(chunks.some((chunk) => chunk.includes('50%'))).toBe(true);
    expect(chunks.some((chunk) => chunk.includes('100%'))).toBe(true);
    expect(chunks.at(-1)).toMatch(/^\r\s{78}\r$/);
    expect(chunks.join('')).not.toContain('\n');
  });

  it('renders bytes without a percentage and stays silent when disabled', () => {
    const chunks: string[] = [];
    const unknown = createDownloadProgress({
      stream: {
        write: (chunk: string) => {
          chunks.push(chunk);
          return true;
        },
      },
      label: 'zoveli.tar.gz',
      totalBytes: 0,
      enabled: true,
      now: () => 0,
    });
    unknown.update(1024);
    unknown.done();
    expect(chunks[0]).toContain('Downloading zoveli.tar.gz');
    expect(chunks[0]).not.toContain('%');

    const silent: string[] = [];
    const disabled = createDownloadProgress({
      stream: {
        write: (chunk: string) => {
          silent.push(chunk);
          return true;
        },
      },
      label: 'zoveli.tar.gz',
      totalBytes: 1024,
      enabled: false,
      now: () => 0,
    });
    disabled.update(512);
    disabled.done();
    expect(silent).toEqual([]);
  });
});

describe('zoveli update', () => {
  function releaseResponse(assetName: string): Response {
    return new Response(
      JSON.stringify({
        tag_name: 'v0.8.0',
        html_url: 'https://github.com/blessandy9104-hue/zoveli-ai/releases/tag/v0.8.0',
        assets: [
          {
            name: assetName,
            browser_download_url: `https://github.com/blessandy9104-hue/zoveli-ai/releases/download/v0.8.0/${assetName}`,
          },
          {
            name: `${assetName}.sha256`,
            browser_download_url: `https://github.com/blessandy9104-hue/zoveli-ai/releases/download/v0.8.0/${assetName}.sha256`,
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  it('checks for an update without downloading assets', async () => {
    const fetchMock = vi.fn(async () =>
      releaseResponse('zoveli-0.8.0-windows-x64.tar.gz')
    );
    const exit = await runUpdate(['--check', '--json'], {
      currentVersion: '0.7.0',
      platform: 'win32',
      arch: 'x64',
      fetchImpl: fetchMock as unknown as typeof fetch,
      log: () => {},
    });
    expect(exit).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports the current version as up to date', async () => {
    const fetchMock = vi.fn(async () =>
      releaseResponse('zoveli-0.8.0-windows-x64.tar.gz')
    );
    const lines: string[] = [];
    const exit = await runUpdate([], {
      currentVersion: '0.8.0',
      platform: 'win32',
      arch: 'x64',
      fetchImpl: fetchMock as unknown as typeof fetch,
      log: (line) => lines.push(line),
    });
    expect(exit).toBe(0);
    expect(lines.join('\n')).toMatch(/up to date/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('verifies the archive and invokes the installer with --yes', async () => {
    const dir = tempDir();
    const installer = join(dir, 'install-zoveli-runtime.ps1');
    writeFileSync(installer, '# fake installer\n');
    const assetName = 'zoveli-0.8.0-windows-x64.tar.gz';
    const bytes = new TextEncoder().encode('fake archive');
    const digest = createHash('sha256').update(bytes).digest('hex');
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      calls.push(url);
      if (url.includes('/releases/latest')) return releaseResponse(assetName);
      if (url.endsWith('.sha256')) return new Response(`${digest}  ${assetName}\n`);
      return new Response(bytes, { status: 200 });
    });
    let invocation: InstallerInvocation | undefined;
    const exit = await runUpdate(['--yes', '--json'], {
      currentVersion: '0.7.0',
      platform: 'win32',
      arch: 'x64',
      cwd: dir,
      installerPath: installer,
      fetchImpl: fetchMock as unknown as typeof fetch,
      runInstaller: (value) => {
        invocation = value;
        return 0;
      },
      log: () => {},
    });
    expect(exit).toBe(0);
    expect(invocation?.installerPath).toBe(installer);
    expect(invocation?.version).toBe('0.8.0');
    expect(invocation?.archivePath).toContain(assetName);
    expect(calls.some((url) => url.includes('/releases/download/'))).toBe(true);
  });

  it('gives archive downloads a longer deadline than release metadata', async () => {
    const dir = tempDir();
    const installer = join(dir, 'install-zoveli-runtime.ps1');
    writeFileSync(installer, '# fake installer\n');
    const assetName = 'zoveli-0.8.0-windows-x64.tar.gz';
    const bytes = new TextEncoder().encode('fake archive');
    const digest = createHash('sha256').update(bytes).digest('hex');
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/releases/latest')) return releaseResponse(assetName);
      if (url.endsWith('.sha256')) return new Response(`${digest}  ${assetName}\n`);
      return new Response(bytes, { status: 200 });
    });
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    const exit = await runUpdate(['--yes'], {
      currentVersion: '0.7.0',
      platform: 'win32',
      arch: 'x64',
      cwd: dir,
      installerPath: installer,
      fetchImpl: fetchMock as unknown as typeof fetch,
      runInstaller: () => 0,
      log: () => {},
    });
    expect(exit).toBe(0);
    const deadlines = timeoutSpy.mock.calls.map(([milliseconds]) => milliseconds);
    expect(deadlines).toContain(30_000);
    expect(deadlines).toContain(15 * 60_000);
  });

  it('rejects a checksum mismatch before invoking the installer', async () => {
    const dir = tempDir();
    const installer = join(dir, 'install-zoveli-runtime.ps1');
    writeFileSync(installer, '# fake installer\n');
    const assetName = 'zoveli-0.8.0-windows-x64.tar.gz';
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/releases/latest')) return releaseResponse(assetName);
      if (url.endsWith('.sha256')) return new Response(`${'0'.repeat(64)}  ${assetName}\n`);
      return new Response('tampered', { status: 200 });
    });
    const runInstaller = vi.fn();
    const errors: string[] = [];
    const exit = await runUpdate(['--yes'], {
      currentVersion: '0.7.0',
      platform: 'win32',
      arch: 'x64',
      cwd: dir,
      installerPath: installer,
      fetchImpl: fetchMock as unknown as typeof fetch,
      runInstaller,
      errorLine: (line) => errors.push(line),
      log: () => {},
    });
    expect(exit).toBe(1);
    expect(runInstaller).not.toHaveBeenCalled();
    expect(errors.join('\n')).toMatch(/SHA-256 verification/);
  });

  it('writes archive progress to stderr on an interactive terminal', async () => {
    const dir = tempDir();
    const installer = join(dir, 'install-zoveli-runtime.ps1');
    writeFileSync(installer, '# fake installer\n');
    const assetName = 'zoveli-0.8.0-windows-x64.tar.gz';
    const bytes = new TextEncoder().encode('fake archive');
    const digest = createHash('sha256').update(bytes).digest('hex');
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/releases/latest')) return releaseResponse(assetName);
      if (url.endsWith('.sha256')) return new Response(`${digest}  ${assetName}\n`);
      return new Response(bytes, {
        status: 200,
        headers: { 'content-length': String(bytes.length) },
      });
    });
    vi.stubEnv('CI', '');
    vi.stubEnv('TERM', '');
    const stderr = new FakeStderr(true);
    const exit = await runUpdate(['--yes'], {
      currentVersion: '0.7.0',
      platform: 'win32',
      arch: 'x64',
      cwd: dir,
      installerPath: installer,
      fetchImpl: fetchMock as unknown as typeof fetch,
      runInstaller: () => 0,
      log: () => {},
      stderr,
    });
    expect(exit).toBe(0);
    expect(stderr.text).toContain('\rDownloading ');
    expect(stderr.text).toContain('100%');
    expect(stderr.text).toMatch(/\r\s{78}\r$/);
  });

  it('keeps stderr clean when piped or in CI', async () => {
    async function run(stderr: FakeStderr, ci: string): Promise<string> {
      const dir = tempDir();
      const installer = join(dir, 'install-zoveli-runtime.ps1');
      writeFileSync(installer, '# fake installer\n');
      const assetName = 'zoveli-0.8.0-windows-x64.tar.gz';
      const bytes = new TextEncoder().encode('fake archive');
      const digest = createHash('sha256').update(bytes).digest('hex');
      const fetchMock = vi.fn(async (url: string) => {
        if (url.includes('/releases/latest')) return releaseResponse(assetName);
        if (url.endsWith('.sha256')) return new Response(`${digest}  ${assetName}\n`);
        return new Response(bytes, { status: 200 });
      });
      vi.stubEnv('CI', ci);
      vi.stubEnv('TERM', '');
      const exit = await runUpdate(['--yes'], {
        currentVersion: '0.7.0',
        platform: 'win32',
        arch: 'x64',
        cwd: dir,
        installerPath: installer,
        fetchImpl: fetchMock as unknown as typeof fetch,
        runInstaller: () => 0,
        log: () => {},
        stderr,
      });
      expect(exit).toBe(0);
      return stderr.text;
    }

    expect(await run(new FakeStderr(false), '')).toBe('');
    expect(await run(new FakeStderr(true), '1')).toBe('');
  });
});
