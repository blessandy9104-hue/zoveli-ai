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
Locally, after building mathcore:

```bash
python -m pip install pyinstaller -e ./mathcore
node scripts/build-mathcore-runtime.mjs
node scripts/build-runtime.mjs
node scripts/smoke-runtime.mjs
pnpm run acceptance:runtime -- --archive release/zoveli-X.Y.Z-<platform>-<arch>.tar.gz
```

Do not publish unless the archive smoke and clean-install acceptance checks are
green. The acceptance report records install time, first-task time and the
core workflow results; the first task must stay under ten minutes. Archives are
checksummed and receive a GitHub build-provenance attestation.

`Runtime Artifacts` also builds a macOS `.dmg` and a Windows Inno Setup `.exe`
for every run. Pull-request and manual non-release runs publish unsigned
installers. Publishing a GitHub release signs every Mach-O binary, signs and
notarizes the `.dmg`, and Authenticode-signs the `.exe`; the job fails if the
required secrets are missing. Release signing secrets:

| Secret | Purpose |
|---|---|
| `APPLE_SIGNING_IDENTITY` | Developer ID Application identity |
| `APPLE_CERTIFICATE_P12_BASE64` | Base64 `.p12` containing the signing certificate |
| `APPLE_CERTIFICATE_PASSWORD` | Password for the `.p12` |
| `APPLE_ID` | Apple account for notarization |
| `APPLE_TEAM_ID` | Apple developer team ID |
| `APPLE_APP_PASSWORD` | App-specific password for notarization |
| `WINDOWS_CERTIFICATE_BASE64` | Base64 `.pfx` with the Authenticode certificate |
| `WINDOWS_CERTIFICATE_PASSWORD` | Password for the `.pfx` |

The scripts are `scripts/sign-macos.sh` and `scripts/sign-windows.ps1`;
`scripts/package-installers.mjs` builds the installers. The macOS script signs
Mach-O files and verifies them, then submits the disk image with
`xcrun notarytool`, staples the ticket, and validates it. The Windows script
signs with SHA-256 and an RFC 3161 timestamp, then runs `signtool verify /pa`.
Both are release-only, so PR builds can exercise the build without
certificates.

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
artifact jobs (verified `.tar.gz` archives plus `.sha256` sidecars, a signed
`.dmg`, and a signed `.exe`).

## 4. Confirm

- CI/release workflow is green.
- `docker pull ghcr.io/blessandy9104-hue/zoveli-ai:X.Y.Z` works.
- Installer smoke (`Installer Check` workflow) passes.
- `Runtime Artifacts` passes on Linux, macOS, and Windows, including
  clean-install acceptance.
- The release has `zoveli-X.Y.Z-{linux,macos,windows}-{x64,arm64}.tar.gz` and
  matching `.sha256` files where the runner supports that architecture, plus
  `zoveli-X.Y.Z-macos-<arch>-setup.dmg` and
  `zoveli-X.Y.Z-windows-<arch>-setup.exe`.
- `gh attestation verify <archive> --repo blessandy9104-hue/zoveli-ai
  --signer-workflow blessandy9104-hue/zoveli-ai/.github/workflows/runtime-artifacts.yml`
  finds a build-provenance attestation for each published archive and
  installer.
- The macOS disk image passes `codesign --verify --strict`, `stapler validate`,
  and Gatekeeper (`spctl -a -t open`). The Windows installer passes
  `signtool verify /pa`.
- `zoveli update --check` on the previous release reports the new version, and
  `zoveli update --yes` upgrades it while preserving the vault.
- The acceptance reports show every core workflow green and a first-task time
  under ten minutes.
- Download one archive on a clean machine (or clean container), run the
  portable installer, and verify `zoveli --version`, `zoveli health`, `/math`,
  `/remember` and `/recall`.
- Update the release draft if release-drafter left stale entries.

## Hotfixes

Branch from the release tag, apply the smallest fix, bump `Z` in every version
surface, add a changelog section, repeat the gate, and tag `vX.Y.Z+1`. Never
force-push a release tag; publish a new patch release instead.
