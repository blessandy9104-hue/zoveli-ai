# Sovereign Install Guide

> **Zoveli is independently developed and distributed without paid Apple or
> Microsoft code-signing certificates.** Your operating system will warn you the
> first time you launch it. That warning is expected. This guide turns it into a
> known, one-time step.

Zoveli uses the **Sovereign Distribution** model: the source is open, the builds
run in public CI, and the binaries are unsigned. Integrity comes from published
SHA-256 checksums and GitHub build-provenance attestations, not from a
platform-issued identity. See [Why unsigned?](#why-unsigned) below.

## Before you install

1. Download only from the official
   [GitHub Releases page](https://github.com/blessandy9104-hue/zoveli-ai/releases).
2. Verify the download before bypassing any warning (see
   [Verify before you bypass](#verify-before-you-bypass)).
3. Use a per-user install. Zoveli does not need administrator access for normal
   use.
4. On a managed corporate device, check your IT policy first. SmartScreen,
   AppLocker, WDAC, and Gatekeeper can be enforced centrally, and bypassing them
   may violate policy.

## Windows 10 and 11 (SmartScreen)

The Windows installer is
`zoveli-0.1.3-windows-x64-setup.exe` (the version changes with each release).

1. Download the `.exe` from the official Releases page.
2. Double-click the installer.
3. If **Windows protected your PC** appears, click **More info**.
4. Confirm the app is **Zoveli** and the publisher is **Unknown publisher**.
   That is expected for an unsigned build.
5. Click **Run anyway**.
6. Finish the installer. Zoveli installs per user under
   `%LOCALAPPDATA%\Zoveli`; no administrator prompt is required.
7. Launch Zoveli from the Start menu or run `zoveli.cmd` from the install
   directory.

![Windows SmartScreen warning placeholder](./assets/windows-smartscreen.png)

> **No "Run anyway" button?** The device is probably managed by SmartScreen,
> AppLocker, or WDAC policy. Use the portable `.tar.gz` archive instead: extract
> it and run `zoveli.cmd`, or ask your IT administrator.

## macOS (Gatekeeper)

The official macOS installer is `zoveli-0.1.3-macos-arm64-setup.dmg` for Apple
Silicon (M-series) Macs. Intel Macs are not covered by the prebuilt macOS
artifacts yet; build from source using the
[onboarding guide](guides/onboarding.md).

1. Download the `.dmg` from the official Releases page.
2. Open the disk image and drag **Zoveli** into **Applications**.
3. Open **Applications**, then **Control-click** Zoveli and choose **Open**.
4. Click **Open** in the confirmation dialog.
5. If you already double-clicked and macOS blocked the app, open **System
   Settings → Privacy & Security**, scroll to the **Security** section, click
   **Open Anyway**, authenticate, then click **Open**.
6. If macOS says the app is damaged, verify the download first, then remove the
   quarantine flag for this app only:

   ```bash
   xattr -dr com.apple.quarantine /Applications/Zoveli.app
   open /Applications/Zoveli.app
   ```

7. Never disable Gatekeeper globally. Use the per-app **Open Anyway** flow or
   the quarantine command only for a download you have verified.

![macOS Gatekeeper warning placeholder](./assets/macos-gatekeeper.png)

## Verify before you bypass

Unsigned does not mean unverified. Compare the downloaded archive with its
published SHA-256 sidecar, and check the build-provenance attestation.

**macOS or Linux:**

```bash
shasum -a 256 zoveli-0.1.3-macos-arm64.tar.gz
cat zoveli-0.1.3-macos-arm64.tar.gz.sha256
```

**Windows PowerShell:**

```powershell
Get-FileHash .\zoveli-0.1.3-windows-x64.tar.gz -Algorithm SHA256
Get-Content .\zoveli-0.1.3-windows-x64.tar.gz.sha256
```

**Build provenance (optional, requires GitHub CLI):**

```bash
gh attestation verify zoveli-0.1.3-windows-x64-setup.exe \
  --repo blessandy9104-hue/zoveli-ai \
  --signer-workflow blessandy9104-hue/zoveli-ai/.github/workflows/runtime-artifacts.yml
```

The `.dmg` and `.exe` are built by the same public
`Runtime Artifacts` workflow and carry provenance attestations. The portable
`.tar.gz` archives also publish `.sha256` sidecars.

## Why unsigned?

Zoveli is a solo, independent open-source project. Paid Apple Developer Program
and Microsoft Authenticode certificates impose recurring fees, identity
requirements, and corporate gatekeepers on the release process. The Sovereign
Distribution model makes a different trade-off:

- **Independence:** no certificate authority can revoke the project's ability to
  ship, and no platform fee is passed to users.
- **Transparency:** the source is MIT licensed and every official build runs in
  public GitHub Actions.
- **Integrity without identity:** checksums and build-provenance attestations
  prove what was built and where. They do not prove a corporate identity, so the
  operating system asks you to make the final trust decision.

That first-launch warning is the visible cost of keeping Zoveli free and
independent. The steps above make it predictable.

## Troubleshooting

| Symptom | What to do |
| --- | --- |
| Windows shows "Windows protected your PC" | Click **More info**, then **Run anyway**. |
| Windows has no **Run anyway** button | The device is policy-managed. Use the portable `.tar.gz` or contact IT. |
| macOS says "cannot be opened because the developer cannot be verified" | **System Settings → Privacy & Security → Open Anyway**, or Control-click the app and choose **Open**. |
| macOS says the app is damaged | Verify the checksum, then remove the quarantine flag for `/Applications/Zoveli.app` only. |
| macOS blocks the app after an update | Repeat the first-launch **Open Anyway** step for the new version. |
| You are unsure whether a download is genuine | Delete it and download again from the official Releases page; verify the checksum and attestation. |

## Screenshot placeholders

The images in this guide are placeholders so the layout and steps are clear.
Replace them with current Windows 11 SmartScreen and macOS Gatekeeper
screenshots when available:

- `docs/assets/windows-smartscreen.png`
- `docs/assets/macos-gatekeeper.png`

_Last reviewed: 2026-11-06._
