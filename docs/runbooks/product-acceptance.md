# Runbook: product acceptance on a clean runtime

This is the release gate that answers one question: can a new user install
Zoveli into an empty home, launch it, and complete the core local workflows
without a toolchain or debugging session?

It exercises the packaged archive and the real installers, not the source tree.

## What it proves

- The published archive extracts and the installer verifies its SHA-256.
- A mismatched checksum is refused and leaves no runtime behind.
- The launcher reports the expected version and help text.
- On Linux and macOS, the installer creates `~/.local/bin/zoveli` and the
  linked command runs the bundled runtime.
- On Windows, the default install leaves the user `PATH` untouched; adding it
  is opt-in via `-AddToPath`.
- `/math 2+2` returns `VERIFIED` with `4` using the bundled mathcore.
- `/remember <fact>` and `/recall <query>` work with no chat model.
- The first-run banner prints the exact chat fix, and a plain message explains
  the tools-only fallback without failing.
- A loopback mock Ollama is detected with a non-default installed model, and the
  first chat reply is served locally.
- A pinned model that is not installed is named in the banner with its exact
  `ollama pull` command, and no chat request is sent.
- `/sys` returns a host snapshot and `/caps` reports every capability available.
- `/health` reports `ok` or `warn`, never `fail`; `config-check` is ready.
- The installed tool surface contains the core math, memory and system tools.
- `zoveli plugins --json` reports the full surface and honors
  `ZOVELI_DISABLE_PLUGINS`.
- `recovery-check` proves backup/checksum/restore against synthetic data
  without touching the installed vault.
- `backup` produces a checksum-verified backup, and `restore` puts the note back.
- A synthetic upgrade that fails its installed version check is rolled back:
  the previous runtime still launches, the pre-upgrade backup exists, and no
  staging directories remain.
- Re-running the installer upgrades in place, creates a verified pre-upgrade
  backup, and keeps the note.
- The first task completes inside the 10-minute budget.

## Run it

From a release archive:

```bash
pnpm run package:runtime
pnpm run acceptance:runtime -- --archive release/zoveli-0.1.2-linux-x64.tar.gz
```

Or let the script pick the newest archive under `release/`:

```bash
pnpm run acceptance:runtime
```

Against an existing install, skipping installation and upgrade checks:

```bash
pnpm run acceptance:runtime -- --dir "$HOME/.local/share/zoveli"
```

Useful flags:

| Flag | Meaning |
| --- | --- |
| `--archive FILE` | Archive to install and verify |
| `--dir DIR` | Test an existing runtime instead of installing |
| `--report FILE` | Write the JSON report (CI uploads it) |
| `--max-seconds N` | First-task budget; default `600` |
| `--keep` | Keep the isolated home and install for inspection |

The run uses an isolated home directory, clears chat/API keys, points Ollama
at an unused port for the tools-only check, then starts a loopback mock Ollama
to prove model detection, the first chat, and the missing pinned-model
guidance. Mathcore pre-warm is disabled so results are deterministic. It does
not touch your real `~/.zoveli` data.

## Reading the result

```text
product acceptance: PASS (install 812ms, first task 6120ms, total 14820ms)
runtime 0.1.2 windows-x64; 58 tools; 15/15 capabilities; 21 checks
report: acceptance-windows-latest.json
```

On failure the command exits non-zero, prints the failing check with captured
output, and keeps the sandbox path so the isolated home, vault and backup can
be inspected.

## CI

`Runtime Artifacts` builds the archive for Linux, Windows and macOS, then runs
this script against that archive on each runner. The JSON report is uploaded
with the runtime artifacts. A release is not publishable when this job fails.

## Limits

This is a clean-home proof on hosted runners, not physical hardware. It covers
the CLI product path. Desktop UI and browser flows are covered by the
Playwright e2e job, and signed installers remain separate release work.
