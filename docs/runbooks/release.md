# Release runbook

Cut a release only from a green `main`. The release workflow re-checks metadata
and publishes the Docker image, SBOM and GitHub release.

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
with any check red.

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
job (image push to GHCR, SBOM attachment, release notes).

## 4. Confirm

- CI/release workflow is green.
- `docker pull ghcr.io/blessandy9104-hue/zoveli-ai:X.Y.Z` works.
- Installer smoke (`Installer Check` workflow) passes.
- Update the release draft if release-drafter left stale entries.

## Hotfixes

Branch from the release tag, apply the smallest fix, bump `Z` in every version
surface, add a changelog section, repeat the gate, and tag `vX.Y.Z+1`. Never
force-push a release tag; publish a new patch release instead.
