import { describe, expect, it } from 'vitest';
import {
  dmgCommand,
  innoSetupScript,
  installerBaseName,
} from '../../scripts/package-installers.mjs';

describe('installer packaging', () => {
  it('names platform installers predictably', () => {
    expect(installerBaseName('0.8.0', 'win32', 'x64')).toBe(
      'zoveli-0.8.0-windows-x64-setup'
    );
    expect(installerBaseName('0.8.0', 'darwin', 'arm64')).toBe(
      'zoveli-0.8.0-macos-arm64-setup'
    );
  });

  it('generates an Inno Setup script that installs the runtime per user', () => {
    const script = innoSetupScript({
      version: '0.8.0',
      arch: 'x64',
      runtimeDir: 'C:/repo/release/zoveli-0.8.0-windows-x64',
      outputDir: 'C:/repo/release',
    });
    expect(script).toContain('AppName=Zoveli');
    expect(script).toContain('AppVersion=0.8.0');
    expect(script).toContain('DefaultDirName={localappdata}\\Zoveli');
    expect(script).toContain('OutputBaseFilename=zoveli-0.8.0-windows-x64-setup');
    expect(script).toContain(
      'Source: "C:\\repo\\release\\zoveli-0.8.0-windows-x64\\*"'
    );
    expect(script).toContain('PrivilegesRequired=lowest');
  });

  it('generates a compressed macOS disk image command', () => {
    const command = dmgCommand({
      runtimeDir: '/repo/release/zoveli-0.8.0-macos-arm64',
      outputDir: '/repo/release',
      version: '0.8.0',
      arch: 'arm64',
    });
    expect(command.command).toBe('hdiutil');
    expect(command.args).toContain('UDZO');
    expect(command.output).toBe(
      '/repo/release/zoveli-0.8.0-macos-arm64-setup.dmg'
    );
  });
});
