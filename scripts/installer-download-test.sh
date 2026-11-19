#!/usr/bin/env bash
# Regression test for the POSIX installer download path.
#
# Uses a stub curl, so it needs no network and never installs anything. It
# covers:
#   - two-argument download calls still work under `set -u`
#   - the archive meter is requested only on an interactive terminal
#   - piped installs and CI runs stay silent
#   - a CI run inside a real PTY is still silent
#
# Usage:
#   bash scripts/installer-download-test.sh

set -euo pipefail

repo_root=$(cd "$(dirname "$0")/.." && pwd)
installer="$repo_root/install/install-zoveli-runtime.sh"
failures=0

pass() { printf '[pass] %s\n' "$1"; }
fail() { printf '[fail] %s\n' "$1"; failures=$((failures + 1)); }

if [ ! -f "$installer" ]; then
  echo "installer not found: $installer" >&2
  exit 1
fi

# Source invariants: the progress argument must have a default so existing
# two-argument callers keep working under `set -u`.
if grep -q 'progress=\${3:-}' "$installer"; then
  pass 'download progress argument defaults when omitted'
else
  fail 'download progress argument is required; two-argument callers will break'
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

mkdir -p "$work/bin" "$work/home"
cat > "$work/bin/curl" <<'STUB'
#!/bin/sh
out=''
prev=''
for arg in "$@"; do
  if [ "$prev" = '-o' ]; then out=$arg; fi
  prev=$arg
done
if [ -n "${CURL_LOG:-}" ]; then
  printf '%s\n' "$*" >> "$CURL_LOG"
fi
if [ -n "$out" ] && [ "$out" != '/dev/null' ]; then
  : > "$out"
fi
printf '200'
STUB
chmod +x "$work/bin/curl"

run_installer() {
  log=$1
  shift
  : > "$log"
  env -u CI -u TERM HOME="$work/home" CURL_LOG="$log" PATH="$work/bin:$PATH" \
    bash "$installer" --yes --version 0.1.5 --dir "$work/install" "$@" \
    > "$work/stdout" 2> "$work/stderr" || true
  if grep -q 'unbound variable' "$work/stderr"; then
    fail 'installer hit an unbound variable in the download path'
  fi
}

# 1. Piped install: curl must not be asked for a meter.
run_installer "$work/piped.log"
if grep -q -- '--progress-bar' "$work/piped.log"; then
  fail 'piped install requested a curl progress meter'
else
  pass 'piped install does not request a curl progress meter'
fi
if [ -s "$work/piped.log" ]; then
  pass 'download still ran while piped'
else
  fail 'download did not run while piped'
fi

# 2. CI=1 with stderr on a terminal must also stay silent.
if command -v script >/dev/null 2>&1 && script --version 2>/dev/null | grep -qi util-linux; then
  : > "$work/ci.log"
  script -q -c "env CI=1 TERM=xterm-256color HOME='$work/home' CURL_LOG='$work/ci.log' PATH='$work/bin:$PATH' bash '$installer' --yes --version 0.1.5 --dir '$work/install-ci'" "$work/ci-session" > /dev/null 2>&1 || true
  if grep -q -- '--progress-bar' "$work/ci.log"; then
    fail 'CI run requested a curl progress meter'
  else
    pass 'CI run does not request a curl progress meter'
  fi

  # 3. A real terminal does get the meter.
  : > "$work/pty.log"
  script -q -c "env -u CI TERM=xterm-256color HOME='$work/home' CURL_LOG='$work/pty.log' PATH='$work/bin:$PATH' bash '$installer' --yes --version 0.1.5 --dir '$work/install-pty'" "$work/pty-session" > /dev/null 2>&1 || true
  if grep -q -- '--progress-bar' "$work/pty.log"; then
    pass 'interactive terminal requests the curl progress meter'
  else
    fail 'interactive terminal did not request the curl progress meter'
  fi
else
  echo '[skip] util-linux script not available; terminal cases skipped'
fi

if [ "$failures" -gt 0 ]; then
  echo "$failures check(s) failed." >&2
  exit 1
fi
echo 'All installer download checks passed.'
