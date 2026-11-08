#!/usr/bin/env node
/**
 * Package a portable runtime directory as a distributable installer.
 *
 * - macOS: a compressed UDZO disk image.
 * - Windows: an Inno Setup installer (requires ISCC.exe).
 *
 * Official Zoveli installers are unsigned by design under the Sovereign
 * Distribution model. See docs/INSTALL_GUIDE.md for the first-launch guidance
 * users receive for Gatekeeper and SmartScreen.
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './lib/args.mjs';
import { runSync } from './lib/process.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function installerBaseName(version, platform = process.platform, arch = process.arch) {
  const slug = platform === 'win32' ? 'windows' : platform === 'darwin' ? 'macos' : platform;
  return `zoveli-${version}-${slug}-${arch}-setup`;
}

export function innoSetupScript({ version, arch, runtimeDir, outputDir, appId }) {
  const base = installerBaseName(version, 'win32', arch);
  const source = runtimeDir.replace(/\//g, '\\');
  const output = outputDir.replace(/\//g, '\\');
  return `[Setup]
AppId=${appId || '{{6B2B4B4E-6B0F-4C74-9C2B-2E8B0C63B3A1}'}
AppName=Zoveli
AppVersion=${version}
DefaultDirName={localappdata}\\Zoveli
DefaultGroupName=Zoveli
DisableProgramGroupPage=yes
OutputDir=${output}
OutputBaseFilename=${base}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
UninstallDisplayIcon={app}\\zoveli.cmd

[Files]
Source: "${source}\\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{userprograms}\\Zoveli"; Filename: "{app}\\zoveli.cmd"

[Run]
Filename: "{app}\\zoveli.cmd"; Description: "Launch Zoveli"; Flags: nowait postinstall skipifsilent
`;
}

export function dmgCommand({ runtimeDir, outputDir, version, arch }) {
  const base = installerBaseName(version, 'darwin', arch);
  // hdiutil only runs on macOS; always build POSIX paths so the command is
  // identical when generated from another host (for example in tests).
  const output = posix.join(outputDir.replace(/\\/g, '/'), `${base}.dmg`);
  return {
    command: 'hdiutil',
    args: [
      'create',
      '-volname',
      `Zoveli ${version}`,
      '-srcfolder',
      runtimeDir,
      '-ov',
      '-format',
      'UDZO',
      output,
    ],
    output,
  };
}

export function findRuntime(outDir, platform, arch) {
  const candidates = readdirSync(outDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('zoveli-'))
    .map((entry) => entry.name)
    .filter((name) => name.includes(`-${platform}-${arch}`))
    .map((name) => {
      const m = name.match(/zoveli-([\d.]+(?:-[\da-z.-]+)?)-/);
      if (!m) return null;
      const version = m[1];
      // Validate semver-ish version: MAJOR.MINOR.PATCH with optional prerelease
      if (!/^\d+\.\d+\.\d+(?:-[\da-z.-]+)?$/.test(version)) return null;
      return { name, version };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const pa = a.version.split('-')[0].split('.').map(Number);
      const pb = b.version.split('-')[0].split('.').map(Number);
      for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const x = pa[i] || 0;
        const y = pb[i] || 0;
        if (x !== y) return x - y;
      }
      // Same core version: prerelease sorts before release
      const aPre = a.version.includes('-') ? a.version.split('-')[1] : '';
      const bPre = b.version.includes('-') ? b.version.split('-')[1] : '';
      if (aPre && !bPre) return -1; // prerelease before release
      if (!aPre && bPre) return 1;
      if (aPre && bPre) {
        const paPre = aPre.split('.').map((p) => isNaN(Number(p)) ? p : Number(p));
        const pbPre = bPre.split('.').map((p) => isNaN(Number(p)) ? p : Number(p));
        for (let i = 0; i < Math.max(paPre.length, pbPre.length); i++) {
          const x = paPre[i] || '';
          const y = pbPre[i] || '';
          if (typeof x === 'string' && typeof y === 'string') {
            if (x < y) return -1;
            if (x > y) return 1;
          } else if (typeof x === 'number' && typeof y === 'number') {
            if (x < y) return -1;
            if (x > y) return 1;
          } else {
            // number sorts before string
            return typeof x === 'number' ? -1 : 1;
          }
        }
      }
      return 0;
    });
  return candidates.length > 0 ? join(outDir, candidates[candidates.length - 1].name) : null;
}

function findIscc() {
  const candidates = [
    process.env.INNO_SETUP_COMPILER,
    'C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe',
    'C:\\Program Files\\Inno Setup 6\\ISCC.exe',
    join(process.env.LOCALAPPDATA || '', 'Programs', 'Inno Setup 6', 'ISCC.exe'),
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) || 'ISCC.exe';
}

function main() {
  const options = parseArgs(process.argv.slice(2), {
    values: {
      '--runtime': { key: 'runtime', parse: resolve },
      '--out': { key: 'out', parse: resolve },
      '--version': { key: 'version' },
      '--arch': { key: 'arch' },
    },
    booleans: { '--help': 'help' },
  });
  if (options.help) {
    console.log(
      'usage: node scripts/package-installers.mjs [--runtime DIR] [--out DIR] [--version V] [--arch ARCH]'
    );
    return;
  }

  const outDir = options.out || join(ROOT, 'release');
  const arch = options.arch || process.arch;
  if (process.platform === 'win32') {
    const runtimeDir =
      options.runtime || findRuntime(outDir, 'windows', arch);
    if (!runtimeDir || !existsSync(runtimeDir)) throw new Error('Windows runtime directory not found');
    const manifest = JSON.parse(
      readFileSync(join(runtimeDir, 'runtime.json'), 'utf8')
    );
    const version = options.version || manifest.version;
    if (!version) throw new Error('runtime.json has no version');
    const temp = mkdtempSync(join(tmpdir(), 'zoveli-iss-'));
    try {
      const script = join(temp, 'zoveli.iss');
      writeFileSync(
        script,
        innoSetupScript({ version, arch, runtimeDir, outputDir: outDir })
      );
      const iscc = findIscc();
      runSync(iscc, [script], { cwd: ROOT });
      const exe = join(outDir, `${installerBaseName(version, 'win32', arch)}.exe`);
      if (!existsSync(exe)) throw new Error(`Inno Setup did not produce ${exe}`);
      console.log(exe);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
    return;
  }

  if (process.platform === 'darwin') {
    const runtimeDir =
      options.runtime || findRuntime(outDir, 'macos', arch);
    if (!runtimeDir || !existsSync(runtimeDir)) throw new Error('macOS runtime directory not found');
    const manifest = JSON.parse(
      readFileSync(join(runtimeDir, 'runtime.json'), 'utf8')
    );
    const version = options.version || manifest.version;
    if (!version) throw new Error('runtime.json has no version');
    const command = dmgCommand({ runtimeDir, outputDir: outDir, version, arch });
    runSync(command.command, command.args, { cwd: ROOT });
    if (!existsSync(command.output)) throw new Error(`hdiutil did not produce ${command.output}`);
    console.log(command.output);
    return;
  }

  throw new Error(`installer packaging is not supported on ${process.platform}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}