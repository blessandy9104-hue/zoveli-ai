# Release runbook

Cut a release only from a green `main`. CI re-checks metadata and publishes the
Docker image, SBOM, prebuilt runtime archives, and GitHub release.

## 1. Prepare the version

1. Choose the next semantic version (`X.Y.Z`; pre-1.0 breaking changes still
   warrant a minor bump).
2. Update the version in **all** of these places:
   - root `package.json`
   - every `packages/*/package.json` and `apps/*/package.json`
     (the `@deepseek-ai/dsh-core` shim keeps its own contract version)
   - `packages/core/src/version.ts` (`ZOVELI_VERSION`)
3. Move `## [Unreleased]` content in `CHANGELOG.md` into a new
   `## [X.Y.Z] - YYYY-MM-DD` section and leave a fresh `## [Unreleased]`.

`pnpm release:check` catches any missed version or tsconfig reference, so run
it early and often:

```bash
pnpm install
pnpm release:check
```

## 2. Verify the build

```bash
pnpm run lint
pnpm run build
pnpm run typecheck
pnpm test
node apps/cli/dist/cli.js --version   # must print the new version
```

CI runs the same gate plus Docker, SBOM, e2e, and security scans. Do not tag
with any check red. For validating every commit behind the release, not just
`HEAD`, follow [history validation](history-validation.md). The Docker job also
boots the image and checks
`zoveli --version`, the plugin inventory (`zoveli plugins --json`), and
`mathcore ops`.

The Docker build fetches pnpm dependencies from the lockfile and installs
mathcore before copying app sources, so source-only changes reuse those
layers. Changing `pnpm-lock.yaml`, `pnpm-workspace.yaml`, or `mathcore/`
invalidates them.

The `Runtime Artifacts` workflow builds the portable archives on Linux, macOS,
and Windows, then runs the clean-install acceptance gate against each archive.
On Linux and macOS it also runs the primary installer acceptance
(`scripts/install-acceptance.sh`) against the same archive. On Windows it runs
`scripts/install-acceptance.ps1` twice: once with Windows PowerShell 5.1 and
once with PowerShell 7, with the child process pinned to the **Restricted**
execution policy. The Windows acceptance uses a path containing spaces and a
non-ASCII user profile, and covers install, doctor, idempotent rerun, PATH
opt-in, uninstall with vault preservation, purge, protected-directory refusal,
and Mark-of-the-Web unblocking.

The matrix also builds a native `windows-arm64` archive on the
`windows-11-arm` runner. That leg is non-blocking (`continue-on-error`), so a
toolchain regression cannot block an otherwise complete release; when it
succeeds, the ARM64 archive and checksum are attached. If it fails, no
`windows-arm64` asset is published, and the installer stops with a clear
message instead of falling back to the x64 archive. Do not treat a red ARM64
leg as a release blocker unless the plan is to announce ARM64 support for that
release, and do not announce it for a release without the asset. Real ARM64
client hardware remains untested even when the build is green. The unsigned
Inno Setup `.exe` remains x64-only and is skipped on the ARM64 runner. The
publish job still runs after an experimental-leg failure, but it refuses to
attach anything unless every required platform archive, checksum, `.dmg`, and
the x64 `.exe` is present; it logs whether the optional `windows-arm64` asset
was produced.

Locally, after building mathcore:

```bash
python -m pip install pyinstaller -e ./mathcore
node scripts/build-mathcore-runtime.mjs
node scripts/build-runtime.mjs
node scripts/smoke-runtime.mjs
pnpm run acceptance:runtime -- --archive release/zoveli-X.Y.Z-<platform>-<arch>.tar.gz
```

On Windows, after `node scripts/build-runtime.mjs`:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/install-acceptance.ps1 `
  -Archive release\zoveli-X.Y.Z-windows-x64.tar.gz -PowerShellPath powershell.exe
pwsh -NoProfile -File scripts/install-acceptance.ps1 `
  -Archive release\zoveli-X.Y.Z-windows-x64.tar.gz -PowerShellPath (Join-Path $PSHOME 'pwsh.exe')
```

Do not publish unless the archive smoke and clean-install acceptance checks are
green. The acceptance report records install time, first-task time and the
core workflow results; the first task must stay under ten minutes. Archives are
checksummed and receive a GitHub build-provenance attestation.

`Runtime Artifacts` also builds an unsigned macOS `.dmg` and an unsigned Windows
Inno Setup `.exe` for every run. Official releases use the **Sovereign
Distribution** model: there are no Apple or Microsoft certificates and no
signing secrets. Gatekeeper and SmartScreen will warn on first launch, and users
are directed to [docs/INSTALL_GUIDE.md](../INSTALL_GUIDE.md) for the expected
steps.

`scripts/package-installers.mjs` builds both installers. The workflow attests
the `.dmg` and `.exe` with GitHub build provenance alongside the portable
archives. Do not add code-signing or notarization steps back to the release job
unless the distribution model changes.

## 3. Tag and publish

```bash
git add -A
git commit -m "chore(release): vX.Y.Z"
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin main --follow-tags
pnpm release:check --release --tag
gh release create vX.Y.Z --title "vX.Y.Z" --generate-notes
```

`--release` requires the changelog entry and a clean tree; `--tag` requires
`vX.Y.Z` to point at HEAD. Publishing the GitHub release triggers the release
job (image push to GHCR, SBOM attachment, release notes) and the runtime
artifact jobs (verified `.tar.gz` archives plus `.sha256` sidecars, and unsigned
`.dmg` / `.exe` installers).

## 4. Confirm

- CI/release workflow is green.
- `docker pull ghcr.io/blessandy9104-hue/zoveli-ai:X.Y.Z` works.
- `docker buildx imagetools inspect ghcr.io/blessandy9104-hue/zoveli-ai-web:X.Y.Z`
  lists both `linux/amd64` and `linux/arm64`, and an anonymous pull works after
  the package visibility is set to public.
- Installer smoke (`Installer Check` workflow) passes, including the Docker
  fallback acceptance on amd64 and arm64.
- `Runtime Artifacts` passes on Linux, macOS (arm64 and x64), and Windows,
  including clean-install acceptance and the primary installer acceptance
  (`scripts/install-acceptance.ps1` under Windows PowerShell 5.1 and PowerShell
  7 with Restricted execution policy).
- The Windows ARM64 build is either green and publishes
  `zoveli-X.Y.Z-windows-arm64.tar.gz`, or is documented as unavailable for this
  release; the installer must fail clearly on ARM64 when that asset is absent.
- The release has `zoveli-X.Y.Z-linux-x64.tar.gz`,
  `zoveli-X.Y.Z-windows-x64.tar.gz`, `zoveli-X.Y.Z-macos-arm64.tar.gz`, and
  `zoveli-X.Y.Z-macos-x64.tar.gz` with matching `.sha256` files, plus
  `zoveli-X.Y.Z-macos-arm64-setup.dmg`,
  `zoveli-X.Y.Z-macos-x64-setup.dmg`, and
  `zoveli-X.Y.Z-windows-x64-setup.exe`. If the ARM64 leg was green, add
  `zoveli-X.Y.Z-windows-arm64.tar.gz` and its `.sha256`.
- `gh attestation verify <archive> --repo blessandy9104-hue/zoveli-ai
  --signer-workflow blessandy9104-hue/zoveli-ai/.github/workflows/runtime-artifacts.yml`
  finds a build-provenance attestation for each published archive and
  installer.
- The macOS `.dmg` and Windows `.exe` are present and unsigned as expected;
  their GitHub build-provenance attestations verify. The first-launch steps in
  [docs/INSTALL_GUIDE.md](../INSTALL_GUIDE.md) match the published filenames.
- `zoveli update --check` on the previous release reports the new version, and
  `zoveli update --yes` upgrades it while preserving the vault.
- The acceptance reports show every core workflow green and a first-task time
  under ten minutes.
- After publishing and attaching assets, the `public-install-smoke` job in
  `Runtime Artifacts` automatically runs the public one-liner on a clean
  `windows-latest` runner under Windows PowerShell 5.1: install, `zoveli
  --version`, `zoveli doctor --json`, an idempotent rerun, uninstall with vault
  preservation, and purge. Treat that job as the automated release gate.
- Also run the public Windows one-liner manually on a clean Windows 10 and
  Windows 11 x64 VM (and Windows 11 ARM64 if the release published an ARM64
  asset) under the default execution policy, without administrator rights:
  ```powershell
  irm https://raw.githubusercontent.com/blessandy9104-hue/zoveli-ai/main/install/install.ps1 | iex
  ```
  Confirm `zoveli doctor` and `zoveli --version`, rerun the one-liner to confirm
  the same-version no-op, then `-Uninstall -Yes` and confirm the vault survives.
  This public-path check is a release gate, not just a locally built archive.
- Windows items that remain **untested** until hardware is available: real
  Windows 10/11 x64 client machines, Windows on ARM64 hardware, Windows builds
  older than 1809, corporate-managed devices with AppLocker/WDAC, and real
  SmartScreen/antivirus blocks. Record these in the release notes or README
  rather than implying they passed.
- Download one archive on a clean machine (or clean container), run the
  portable installer, and verify `zoveli --version`, `zoveli health`, `/math`,
  `/remember` and `/recall`.
- Update the release draft if release-drafter left stale entries.

## Hotfixes

Branch from the release tag, apply the smallest fix, bump `Z` in every version
surface, add a changelog section, repeat the gate, and tag `vX.Y.Z+1`. Never
force-push a release tag; publish a new patch release instead.
