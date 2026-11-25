# Vendored dependencies

## `zoveli-intelligence-0.1.1.tgz`

Packed release artifact of
[`blessandy9104-hue/zoveli-intelligence`](https://github.com/blessandy9104-hue/zoveli-intelligence)
tag `v0.1.1`, attached to the
[v0.1.1 release](https://github.com/blessandy9104-hue/zoveli-intelligence/releases/tag/v0.1.1).

It is vendored because pnpm 11 does not persist integrity for remote tarball
dependencies, which makes `--frozen-lockfile` installs fail. A `file:` tarball
records `sha512` integrity in `pnpm-lock.yaml` and installs offline. The
tarball contains the built `dist/`, so no build script runs at install time.

v0.1.1 adds a `default` export condition so the CommonJS-built Zoveli adapter
can `require()` the ESM package on Node 22.16+ (Node's `require(esm)` support).

Update procedure:

1. Pack the new release in the intelligence repo: `npm pack`.
2. Replace the tarball here with the new versioned artifact.
3. Update the `file:` specifier in `packages/intelligence-plugin/package.json`.
4. Run `pnpm install` to refresh the lockfile integrity.
