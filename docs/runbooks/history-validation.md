# History validation runbook

How Zoveli proves that every commit, not just `HEAD`, is structurally sound,
and how the end-to-end suite is exercised. Run this before a release or after
rewriting a branch.

## Scope

`scripts/audit-history.mjs` walks every commit reachable from the requested
revision (default `HEAD`) and validates the files each commit changed relative
to its first parent, without checking out the worktree:

| Check | Tool | Result |
|---|---|---|
| JavaScript, TypeScript, JSX, TSX parse | esbuild `transformSync` | error |
| JSON and JSONC parse | TypeScript config parser | error |
| Python parses | `ast.parse` in one interpreter per commit | error |
| Unresolved merge-conflict markers | line scan for `<<<<<<<` / `>>>>>>>` | error |
| Empty commit message | commit metadata | error |
| `fixup!` / `squash!` / `WIP` subjects | commit metadata | warning |
| Whitespace errors | `git diff-tree --check` | warning |

Binary files, files over 2 MiB, and generated directories (`node_modules/`,
`dist/`, `coverage/`, `release/`, `playwright-report/`) are skipped. Deleted
files are excluded with `--diff-filter=d`.

The audit is intentionally static. Installing dependencies, building, and
running the full unit, Python, and browser suites for each of ~200 historical
commits would take hours and would mostly test unsupported historical
toolchains. Instead:

- **Per commit:** syntax, JSON, Python AST, conflict markers, and whitespace.
- **At `HEAD`:** the complete unit, integration, Python, lint, typecheck,
  build, and end-to-end suites described below and in CI.

This split is recorded here so the claim is precise: every commit is
syntactically valid and conflict-free; the current tip is fully tested.

## Run the audit

```bash
node scripts/audit-history.mjs                 # every commit reachable from HEAD
node scripts/audit-history.mjs --verbose       # one status line per commit
node scripts/audit-history.mjs --json          # machine-readable report
node scripts/audit-history.mjs --range v0.8.0..HEAD
node scripts/audit-history.mjs --all           # every ref, including branches
node scripts/audit-history.mjs --no-whitespace # errors only
node scripts/audit-history.mjs --python python3
```

Exit code is `0` when there are no errors; warnings never fail the run. Use
`--range` for a release branch or `--all` to include work-in-progress branches.
The script needs `git`, Node, the workspace dependencies (`esbuild` and
`typescript`), and a Python 3 interpreter.

### Latest recorded result

On 2026-11-05, `node scripts/audit-history.mjs` audited **204 commits** from the
first commit (`56b66a8`) through the v0.8 branch tip and reported:

- **0 errors** — every JavaScript/TypeScript/JSON/Python file parsed and no
  commit contained unresolved conflict markers.
- **342 warnings** — historical whitespace only, concentrated in the first
  commit and legacy files. They do not fail the audit and are left in place so
  history stays immutable.

Re-run the command for the current counts; the numbers move as commits land.

## End-to-end tests

Playwright drives the built desktop server and the CLI. The same command CI
uses is:

```bash
pnpm install --frozen-lockfile
pnpm run build
pnpm exec playwright test
```

`playwright.config.ts` starts `node apps/desktop/dist/server/server.js` on
`http://127.0.0.1:3081` and waits for `/health`, then runs Chromium, Firefox,
and WebKit with one worker and no parallelism. Failure artifacts (trace,
screenshot, video) land in `test-results/`; the HTML report is written to
`playwright-report/`.

Local prerequisites:

- Python 3.11 with `mathcore` installed (`python -m pip install -e "./mathcore[test]"`).
- Playwright browsers (`pnpm exec playwright install --with-deps` on Linux; on
  Windows/macOS install the browsers without `--with-deps`).
- Port 3081 free, or set `ZOVELI_E2E_PORT` and `ZOVELI_E2E_BASE_URL`
  consistently.

CI runs the suite in the pinned `mcr.microsoft.com/playwright:v1.65.0-noble`
container after unit and integration tests. The container tag must match the
`@playwright/test` version in `package.json`.

## Full gate at HEAD

Run these before tagging or merging a large change:

```bash
pnpm run lint
pnpm run typecheck
pnpm test
python -m pytest mathcore/tests -q          # with PYTHONPATH=mathcore/src on Windows
pnpm run build
node scripts/audit-history.mjs
pnpm exec playwright test
```

The Windows CI job runs the unit suite with Node 22 even when local Node is
newer, so a green local run on Node 24 is not a substitute for CI.

## When the audit fails

1. Read the reported `sha`, `path`, and message.
2. If the commit is on a branch you own and has not been shared, fix the commit
   or rebase the branch and re-run.
3. If the commit is already on `main` or a release tag, do not rewrite public
   history. Add a follow-up fix, document the exception, and, for a real defect,
   cut a patch release.
4. Conflict markers in a historical commit are an error because the commit
   cannot have been valid at the time; investigate before trusting that range.
5. Python parse failures usually mean the audit ran with a Python version older
   than the syntax used. Re-run with the version from `.python-version` or CI.

## Limitations

- The audit does not execute tests, install dependencies, or build artifacts per
  commit. A commit that is syntactically valid can still be semantically broken;
  CI and release acceptance cover the tip.
- Whitespace warnings are advisory and allowed to remain.
- Unsigned installer builds are exercised in the release workflow on macOS and
  Windows runners. Physical Gatekeeper and SmartScreen first-launch behavior is
  documented in `docs/INSTALL_GUIDE.md` but is not automated in CI.
- Bash scripts are not parsed by this audit; CI's installer and shell checks
  cover them.
