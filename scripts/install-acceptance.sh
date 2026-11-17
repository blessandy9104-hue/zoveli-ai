#!/bin/sh
#
# Acceptance test for install/install.sh.
#
# Runs the primary installer against a local runtime archive in a throwaway
# HOME, then checks the doctor report, idempotency, upgrade metadata,
# uninstall, and vault preservation. Used by the Runtime Artifacts workflow.
#
#   sh scripts/install-acceptance.sh --archive release/zoveli-0.1.3-linux-x64.tar.gz
set -eu

ROOT=$(CDPATH='' cd "$(dirname "$0")/.." && pwd)
INSTALLER="$ROOT/install/install.sh"
RUNTIME_INSTALLER="$ROOT/install/install-zoveli-runtime.sh"
ARCHIVE=""
KEEP=false
SANDBOX=""
SUCCESS=false

usage() {
  cat <<EOF
Usage: sh scripts/install-acceptance.sh [options]
  --archive <file>  Runtime .tar.gz to install (default: newest under release/)
  --installer <f>   Primary installer to test (default: install/install.sh)
  --keep            Keep the temporary HOME after success
  -h, --help        Show this help
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --archive)
      [ $# -ge 2 ] || { echo "--archive requires a path" >&2; exit 2; }
      ARCHIVE=$2
      shift 2
      ;;
    --installer)
      [ $# -ge 2 ] || { echo "--installer requires a path" >&2; exit 2; }
      INSTALLER=$2
      shift 2
      ;;
    --keep) KEEP=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

pass() { printf '[pass] %s\n' "$1"; }
fail() { printf '[FAIL] %s\n' "$1" >&2; exit 1; }

cleanup() {
  if [ -n "$SANDBOX" ] && [ -d "$SANDBOX" ]; then
    if [ "$SUCCESS" = true ] && [ "$KEEP" != true ]; then
      rm -rf "$SANDBOX"
    else
      printf 'acceptance sandbox kept for debugging: %s\n' "$SANDBOX" >&2
    fi
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

[ -f "$INSTALLER" ] || fail "installer not found: $INSTALLER"
[ -f "$RUNTIME_INSTALLER" ] || fail "runtime installer not found: $RUNTIME_INSTALLER"

if [ -z "$ARCHIVE" ]; then
  for candidate in "$ROOT"/release/zoveli-*.tar.gz; do
    [ -f "$candidate" ] || continue
    ARCHIVE=$candidate
  done
fi
[ -n "$ARCHIVE" ] || fail "no runtime archive found; run pnpm run package:runtime or pass --archive"
[ -f "$ARCHIVE" ] || fail "archive not found: $ARCHIVE"
[ -f "$ARCHIVE.sha256" ] || fail "checksum not found: $ARCHIVE.sha256"

SANDBOX=$(mktemp -d "${TMPDIR:-/tmp}/zoveli-install-acceptance.XXXXXX")
HOME_DIR="$SANDBOX/home"
ZOVELI_HOME="$SANDBOX/runtime"
BIN_DIR="$HOME_DIR/.local/bin"
mkdir -p "$HOME_DIR" "$BIN_DIR"

export HOME="$HOME_DIR"
export XDG_BIN_HOME="$BIN_DIR"
export ZOVELI_HOME
export ZOVELI_RUNTIME_INSTALLER="$RUNTIME_INSTALLER"
export PATH="$BIN_DIR:$PATH"
export NO_COLOR=1
unset ZOVELI_VERSION ZOVELI_RUNTIME_URL ZOVELI_VAULT_PATH ZOVELI_MEMORY_DB 2>/dev/null || true

sh -n "$INSTALLER" || fail "install.sh has a syntax error"
pass "syntax"

sh "$INSTALLER" --help > "$SANDBOX/help.txt" 2>&1 || fail "install.sh --help failed"
grep -q -- '--uninstall' "$SANDBOX/help.txt" || fail "help does not mention --uninstall"
grep -q -- '--purge' "$SANDBOX/help.txt" || fail "help does not mention --purge"
pass "help"

sh "$INSTALLER" --check --archive "$ARCHIVE" --dir "$ZOVELI_HOME" > "$SANDBOX/check-before.txt" 2>&1 \
  || fail "install.sh --check failed before install"
grep -q 'Installed: none' "$SANDBOX/check-before.txt" || fail "--check did not report an empty install"
pass "check-before"

sh "$INSTALLER" --yes --archive "$ARCHIVE" --dir "$ZOVELI_HOME" > "$SANDBOX/install.txt" 2>&1 \
  || { cat "$SANDBOX/install.txt" >&2; fail "install failed"; }
[ -x "$ZOVELI_HOME/zoveli" ] || fail "launcher missing after install"
[ -f "$ZOVELI_HOME/runtime.json" ] || fail "runtime.json missing after install"
[ -f "$ZOVELI_HOME/install.json" ] || fail "install.json missing after install"
[ -L "$BIN_DIR/zoveli" ] || fail "PATH symlink missing after install"
VERSION=$("$ZOVELI_HOME/zoveli" --version | tail -n 1 | tr -d '\r')
case "$VERSION" in
  "zoveli "*) ;;
  *) fail "unexpected --version output: $VERSION" ;;
esac
pass "clean-install ($VERSION)"

"$BIN_DIR/zoveli" --version >/dev/null 2>&1 || fail "linked launcher does not run"
pass "path-link"

"$ZOVELI_HOME/zoveli" doctor --json > "$SANDBOX/doctor.json" 2> "$SANDBOX/doctor.err" \
  || { cat "$SANDBOX/doctor.err" >&2; cat "$SANDBOX/doctor.json" >&2; fail "doctor reported a blocking problem"; }
node -e '
const fs = require("node:fs");
const report = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (report.install.mode !== "runtime") throw new Error(`expected runtime install, got ${report.install.mode}`);
if (report.status === "fail") {
  const failed = report.checks.filter((check) => check.level === "fail");
  throw new Error(`doctor failed: ${JSON.stringify(failed)}`);
}
const ids = new Set(report.checks.map((check) => check.id));
for (const id of ["runtime", "install", "config", "vault", "mathcore-command", "mathcore-probe"]) {
  if (!ids.has(id)) throw new Error(`doctor is missing the ${id} check`);
}
const probe = report.checks.find((check) => check.id === "mathcore-probe");
if (probe.level !== "ok") throw new Error(`mathcore probe was ${probe.level}`);
' "$SANDBOX/doctor.json" || fail "doctor JSON assertions failed"
pass "doctor"

sh "$INSTALLER" --yes --archive "$ARCHIVE" --dir "$ZOVELI_HOME" > "$SANDBOX/reinstall.txt" 2>&1 \
  || { cat "$SANDBOX/reinstall.txt" >&2; fail "second install failed"; }
grep -q 'already installed' "$SANDBOX/reinstall.txt" || fail "second install was not idempotent"
pass "idempotent-second-run"

mkdir -p "$HOME_DIR/.zoveli"
printf 'keep me\n' > "$HOME_DIR/.zoveli/acceptance-marker"
sh "$INSTALLER" --uninstall --yes --dir "$ZOVELI_HOME" > "$SANDBOX/uninstall.txt" 2>&1 \
  || { cat "$SANDBOX/uninstall.txt" >&2; fail "uninstall failed"; }
[ ! -e "$ZOVELI_HOME" ] || fail "uninstall left the runtime behind"
[ ! -e "$BIN_DIR/zoveli" ] || fail "uninstall left the PATH link behind"
[ -f "$HOME_DIR/.zoveli/acceptance-marker" ] || fail "uninstall deleted the vault"
pass "uninstall-preserves-vault"

sh "$INSTALLER" --uninstall --yes --purge --dir "$ZOVELI_HOME" > "$SANDBOX/purge.txt" 2>&1 \
  || { cat "$SANDBOX/purge.txt" >&2; fail "purge failed"; }
[ ! -e "$HOME_DIR/.zoveli" ] || fail "purge left the state directory behind"
pass "purge-removes-vault"

if sh "$INSTALLER" --yes --archive "$ARCHIVE" --dir / > "$SANDBOX/protected.txt" 2>&1; then
  fail "installer accepted the filesystem root as the install directory"
fi
grep -q 'Refusing to use protected directory' "$SANDBOX/protected.txt" || fail "protected-directory error was unclear"
pass "protected-directory-refused"

SUCCESS=true
printf 'install acceptance: PASS\n'
