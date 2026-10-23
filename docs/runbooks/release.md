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
with any check red. The Docker job also boots the image and checks
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
checksummed and receive a GitHub build-provenance attestation, but are not yet
code-signed or notarized.

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
artifact jobs (verified `.tar.gz` archives plus `.sha256` sidecars).

## 4. Confirm

- CI/release workflow is green.
- `docker pull ghcr.io/blessandy9104-hue/zoveli-ai:X.Y.Z` works.
- Installer smoke (`Installer Check` workflow) passes.
- `Runtime Artifacts` passes on Linux, macOS, and Windows, including
  clean-install acceptance.
- The release has `zoveli-X.Y.Z-{linux,macos,windows}-{x64,arm64}.tar.gz` and
  matching `.sha256` files where the runner supports that architecture.
- `gh attestation verify <archive> --repo blessandy9104-hue/zoveli-ai
  --signer-workflow blessandy9104-hue/zoveli-ai/.github/workflows/runtime-artifacts.yml`
  finds a build-provenance attestation for each published archive.
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
