#!/usr/bin/env bash
#
# Install a prebuilt Zoveli runtime. No Git, Node, pnpm, Python or compiler
# toolchain is required on the target machine.
#
#   curl -fsSL https://raw.githubusercontent.com/blessandy9104-hue/zoveli-ai/main/install/install-zoveli-runtime.sh | bash
#
# The archive is downloaded from the matching GitHub release and verified
# against its published SHA-256 checksum before extraction. Upgrades create
# and verify a backup of the existing vault under ~/.zoveli/backups.
set -euo pipefail

REPO="blessandy9104-hue/zoveli-ai"
BRANCH="${ZOVELI_BRANCH:-main}"
VERSION="${ZOVELI_VERSION:-}"
TARGET_DIR="${ZOVELI_HOME:-$HOME/.local/share/zoveli}"
ARCHIVE=""
ASSET_URL="${ZOVELI_RUNTIME_URL:-}"
ASSUME_YES=false
VERIFY=true
FORCE=false
SKIP_BACKUP=false
CHECK=false

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info() { printf '%b%s%b\n' "$GREEN" "$1" "$NC"; }
warn() { printf '%b%s%b\n' "$YELLOW" "$1" "$NC"; }
error() { printf '%b%s%b\n' "$RED" "$1" "$NC" >&2; }
last_line() { printf '%s\n' "$1" | tail -n 1 | tr -d '\r'; }

validate_url() {
  case "$1" in
    https://*) ;;
    *) error "Refusing non-HTTPS download URL: $1"; return 1 ;;
  esac
  rest=${1#https://}
  authority=${rest%%/*}
  case "$authority" in
    *@*) error 'Refusing download URL with embedded credentials.'; return 1 ;;
  esac
  host=${authority%%:*}
  if [ "$host" != "$authority" ] && [ "$authority" != "$host:443" ]; then
    error "Refusing download URL on a non-HTTPS port: $1"
    return 1
  fi
  host=$(printf '%s' "$host" | tr '[:upper:]' '[:lower:]')
  case "$host" in
    github.com|objects.githubusercontent.com|raw.githubusercontent.com|release-assets.githubusercontent.com|github-releases.githubusercontent.com) ;;
    *) error "Refusing download from unauthorized host: $host"; return 1 ;;
  esac
}

# Follow redirects by hand so a redirect cannot point at localhost, a
# link-local metadata service, or another machine on the user's network.
download() {
  url=$1
  out=$2
  hops=0
  while [ "$hops" -le 5 ]; do
    validate_url "$url" || return 1
    headers="$TMP_DIR/headers.$$.$hops"
    code=$(curl --proto '=https' --tlsv1.2 --max-redirs 0 -sS -o "$out" -D "$headers" -w '%{http_code}' "$url") || {
      error "Download failed: $url"
      rm -f "$headers"
      return 1
    }
    if [ "$code" = 301 ] || [ "$code" = 302 ] || [ "$code" = 303 ] || [ "$code" = 307 ] || [ "$code" = 308 ]; then
      location=$(awk 'tolower($1) == "location:" { sub(/\r$/, "", $2); print $2 }' "$headers" | tail -n 1)
      rm -f "$headers"
      if [ -z "$location" ]; then
        error "Redirect from $url had no Location header"
        return 1
      fi
      case "$location" in
        https://*) url="$location" ;;
        *) error "Refusing non-HTTPS redirect target: $location"; return 1 ;;
      esac
      hops=$((hops + 1))
      continue
    fi
    rm -f "$headers"
    if [ "$code" != 200 ]; then
      error "Download failed with HTTP $code: $url"
      return 1
    fi
    return 0
  done
  error "Too many redirects while downloading $url"
  return 1
}

download_text() {
  file="$TMP_DIR/download.$$.$RANDOM"
  download "$1" "$file" || return 1
  cat "$file"
  rm -f "$file"
}

compare_versions() {
  awk -v a="${1#v}" -v b="${2#v}" 'BEGIN {
    sub(/-.*/, "", a); sub(/-.*/, "", b);
    split(a, x, "."); split(b, y, ".");
    for (i = 1; i <= 3; i++) {
      if ((x[i] + 0) > (y[i] + 0)) { print 1; exit }
      if ((x[i] + 0) < (y[i] + 0)) { print -1; exit }
    }
    print 0;
  }'
}

installed_version() {
  launcher="$TARGET_DIR/zoveli"
  if [ -x "$launcher" ]; then
    text=$("$launcher" --version 2>/dev/null | tail -n 1 | tr -d '\r') || true
    case "$text" in
      "zoveli "*) printf '%s\n' "${text#zoveli }"; return ;;
    esac
  fi
  if [ -f "$TARGET_DIR/runtime.json" ]; then
    sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$TARGET_DIR/runtime.json" | head -n 1
  fi
}

usage() {
  cat <<EOF
Zoveli AI runtime installer
Usage: install-zoveli-runtime.sh [options]
Options:
  -y, --yes            Non-interactive
      --dir <path>     Install directory (default: $TARGET_DIR)
      --version <v>    Release version (default: current main package.json)
      --archive <file> Install a local .tar.gz instead of downloading
      --url <url>      Override the runtime archive URL
      --no-verify      Skip SHA-256 verification (not recommended)
      --force          Replace a non-Zoveli directory
      --skip-backup    Do not back up an existing install (not recommended)
      --check          Report the installed and target versions, then exit
  -h, --help           Show this help
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    -y|--yes) ASSUME_YES=true; shift ;;
    --dir) TARGET_DIR="${2:?--dir requires a path}"; shift 2 ;;
    --version) VERSION="${2:?--version requires a value}"; shift 2 ;;
    --archive) ARCHIVE="${2:?--archive requires a path}"; shift 2 ;;
    --url) ASSET_URL="${2:?--url requires a value}"; shift 2 ;;
    --no-verify) VERIFY=false; shift ;;
    --force) FORCE=true; shift ;;
    --skip-backup) SKIP_BACKUP=true; shift ;;
    --check) CHECK=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) error "Unknown option: $1"; usage; exit 1 ;;
  esac
done

case "$(uname -s)" in
  Linux) os=linux ;;
  Darwin) os=macos ;;
  *) error "Unsupported operating system: $(uname -s)"; exit 1 ;;
esac

case "$(uname -m)" in
  x86_64|amd64) arch=x64 ;;
  arm64|aarch64) arch=arm64 ;;
  *) error "Unsupported architecture: $(uname -m)"; exit 1 ;;
esac

case "$TARGET_DIR" in
  ""|"/"|"$HOME") error "Refusing to install into protected directory: $TARGET_DIR"; exit 1 ;;
esac

TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/zoveli-install.XXXXXX")
STAGE=""
cleanup() {
  rm -rf "$TMP_DIR"
  if [ -n "$STAGE" ]; then rm -rf "$STAGE"; fi
}
trap cleanup EXIT INT TERM

VERSION="${VERSION#v}"
if [ -z "$VERSION" ] && [ -n "$ARCHIVE" ]; then
  VERSION=$(basename "$ARCHIVE" | sed -n 's/^zoveli-\([0-9][0-9.]*\)-.*/\1/p')
fi
if [ -z "$ARCHIVE" ] && [ -z "$VERSION" ]; then
  info "Resolving the current Zoveli version..."
  VERSION=$(download_text "https://raw.githubusercontent.com/$REPO/$BRANCH/package.json" \
    | sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' | head -n 1)
  if [ -z "$VERSION" ]; then error "Could not resolve Zoveli version."; exit 1; fi
fi
if [ -z "$ARCHIVE" ] && [ -z "$ASSET_URL" ]; then
  ASSET_URL="https://github.com/$REPO/releases/download/v$VERSION/zoveli-$VERSION-$os-$arch.tar.gz"
fi

INSTALL_VERB="Install"
INSTALLED_VERSION=$(installed_version || true)
if [ -n "$INSTALLED_VERSION" ] && [ -n "$VERSION" ]; then
  comparison=$(compare_versions "$INSTALLED_VERSION" "$VERSION")
  if [ "$CHECK" = true ]; then
    if [ "$comparison" = -1 ]; then
      info "Update available: Zoveli $INSTALLED_VERSION -> $VERSION"
    elif [ "$comparison" = 1 ]; then
      info "Installed Zoveli $INSTALLED_VERSION is newer than requested $VERSION"
    else
      info "Zoveli $INSTALLED_VERSION is already installed in $TARGET_DIR"
    fi
    exit 0
  fi
  if [ "$comparison" = -1 ]; then
    info "Upgrading Zoveli $INSTALLED_VERSION -> $VERSION"
    INSTALL_VERB="Upgrade"
  elif [ "$comparison" = 1 ]; then
    warn "Downgrading Zoveli $INSTALLED_VERSION -> $VERSION"
    INSTALL_VERB="Downgrade"
  else
    warn "Zoveli $INSTALLED_VERSION is already installed in $TARGET_DIR."
  fi
elif [ "$CHECK" = true ]; then
  if [ -n "$VERSION" ]; then
    info "No Zoveli runtime in $TARGET_DIR; target $VERSION is available"
  else
    info "No Zoveli runtime in $TARGET_DIR and no version was selected"
  fi
  exit 0
fi

if [ "$ASSUME_YES" != true ] && [ -t 0 ]; then
  if [ "$INSTALL_VERB" = "Install" ]; then
    printf 'Install Zoveli into %s? [y/N] ' "$TARGET_DIR"
  else
    printf '%s Zoveli in %s? [y/N] ' "$INSTALL_VERB" "$TARGET_DIR"
  fi
  read -r answer || true
  case "$answer" in
    [yY]|[yY][eE][sS]) ;;
    *) error "Aborted."; exit 1 ;;
  esac
fi

if [ -z "$ARCHIVE" ]; then
  ARCHIVE="$TMP_DIR/zoveli.tar.gz"
  info "Downloading $ASSET_URL"
  download "$ASSET_URL" "$ARCHIVE"
  download "$ASSET_URL.sha256" "$ARCHIVE.sha256"
else
  if [ ! -f "$ARCHIVE" ]; then error "Archive not found: $ARCHIVE"; exit 1; fi
  ARCHIVE=$(cd "$(dirname "$ARCHIVE")" && pwd)/$(basename "$ARCHIVE")
fi

if [ "$VERIFY" = true ]; then
  if [ ! -f "$ARCHIVE.sha256" ]; then
    error "Checksum file not found: $ARCHIVE.sha256"
    error "Re-run with --no-verify only if you trust this archive."
    exit 1
  fi
  expected=$(awk '{print $1}' "$ARCHIVE.sha256")
  if command -v sha256sum >/dev/null 2>&1; then
    actual=$(sha256sum "$ARCHIVE" | awk '{print $1}')
  else
    actual=$(shasum -a 256 "$ARCHIVE" | awk '{print $1}')
  fi
  if [ "$expected" != "$actual" ]; then
    error "SHA-256 verification failed for $ARCHIVE"
    exit 1
  fi
  info "Checksum verified."
fi

mkdir -p "$TMP_DIR/extract"
tar -xzf "$ARCHIVE" -C "$TMP_DIR/extract"
SRC=$(find "$TMP_DIR/extract" -mindepth 1 -maxdepth 1 -type d | head -n 1)
if [ -z "$SRC" ] || [ ! -f "$SRC/runtime.json" ] || [ ! -x "$SRC/zoveli" ]; then
  error "Archive does not contain a valid Zoveli runtime."
  exit 1
fi

if [ -d "$TARGET_DIR" ] && [ -n "$(ls -A "$TARGET_DIR" 2>/dev/null)" ]; then
  if [ ! -f "$TARGET_DIR/runtime.json" ] && [ "$FORCE" != true ]; then
    error "$TARGET_DIR is not a Zoveli runtime; use --dir or --force."
    exit 1
  fi
fi

STAGE_PARENT=$(dirname "$TARGET_DIR")
mkdir -p "$STAGE_PARENT"
STAGE=$(mktemp -d "$STAGE_PARENT/.zoveli-stage-XXXXXX")
cp -R "$SRC/." "$STAGE/"
chmod +x "$STAGE/zoveli" "$STAGE/node" "$STAGE/mathcore/mathcore-mcp"

if ! preflight=$("$STAGE/zoveli" --version 2>&1); then
  error "New runtime failed its preflight check; the existing runtime was not changed."
  printf '%s\n' "$preflight" >&2
  exit 1
fi
preflight=$(last_line "$preflight")
case "$preflight" in
  zoveli\ *) ;;
  *)
    error "New runtime reported an unexpected version; the existing runtime was not changed."
    printf '%s\n' "$preflight" >&2
    exit 1
    ;;
esac
info "New runtime preflight: $preflight"

if [ -f "$TARGET_DIR/runtime.json" ]; then
  if [ "$SKIP_BACKUP" = true ]; then
    warn "Skipping the pre-upgrade backup (--skip-backup)."
  elif [ ! -x "$TARGET_DIR/zoveli" ]; then
    error "Existing runtime has no executable zoveli; create a manual backup or use --skip-backup."
    exit 1
  else
    BACKUP_DIR="$HOME/.zoveli/backups/pre-upgrade-$(date -u +%Y%m%d-%H%M%S)-$$"
    info "Backing up existing data to $BACKUP_DIR ..."
    if ! "$TARGET_DIR/zoveli" backup --out "$BACKUP_DIR" --json > "$TMP_DIR/backup.json"; then
      cat "$TMP_DIR/backup.json" >&2 || true
      error "Pre-upgrade backup failed; the existing runtime was not changed."
      exit 1
    fi
    if ! "$TARGET_DIR/zoveli" verify "$BACKUP_DIR" --json > "$TMP_DIR/verify.json"; then
      cat "$TMP_DIR/verify.json" >&2 || true
      error "Pre-upgrade backup failed verification; the existing runtime was not changed."
      exit 1
    fi
    info "Backup verified: $BACKUP_DIR"
  fi
fi

PREVIOUS="${TARGET_DIR%/}.zoveli-previous-$$"
OLD_MOVED=false
NEW_MOVED=false

rollback() {
  if [ "$NEW_MOVED" = true ] && [ -e "$TARGET_DIR" ]; then
    rm -rf "$TARGET_DIR"
  fi
  if [ "$OLD_MOVED" = true ] && [ -e "$PREVIOUS" ]; then
    if ! mv "$PREVIOUS" "$TARGET_DIR"; then
      error "Automatic rollback failed. The previous runtime is at: $PREVIOUS"
      return 1
    fi
  fi
  return 0
}

install_failed() {
  reason=$1
  if rollback; then
    if [ "$OLD_MOVED" = true ]; then
      error "$reason; the previous runtime was restored."
    else
      error "$reason; no runtime was left installed."
    fi
  else
    error "$reason and automatic rollback failed. The previous runtime is at: $PREVIOUS"
  fi
  exit 1
}

if [ -d "$TARGET_DIR" ] && [ -n "$(ls -A "$TARGET_DIR" 2>/dev/null)" ]; then
  if ! mv "$TARGET_DIR" "$PREVIOUS"; then
    error "Could not move the existing runtime aside; nothing was changed."
    exit 1
  fi
  OLD_MOVED=true
else
  rm -rf "$TARGET_DIR"
fi

if ! mv "$STAGE" "$TARGET_DIR"; then
  install_failed "Could not install the new runtime"
fi
NEW_MOVED=true

if ! installed=$("$TARGET_DIR/zoveli" --version 2>&1); then
  printf '%s\n' "$installed" >&2
  install_failed "New runtime failed its installed version check"
fi
installed=$(last_line "$installed")
case "$installed" in
  zoveli\ *) ;;
  *)
    printf '%s\n' "$installed" >&2
    install_failed "New runtime reported an unexpected version"
    ;;
esac

if [ "$OLD_MOVED" = true ] && [ -e "$PREVIOUS" ]; then
  rm -rf "$PREVIOUS"
fi
info "Installed $installed into $TARGET_DIR"

BIN_DIR="${XDG_BIN_HOME:-$HOME/.local/bin}"
if mkdir -p "$BIN_DIR" 2>/dev/null && [ -w "$BIN_DIR" ]; then
  if [ -e "$BIN_DIR/zoveli" ] && [ ! -L "$BIN_DIR/zoveli" ]; then
    warn "Left existing $BIN_DIR/zoveli untouched; run $TARGET_DIR/zoveli directly."
  else
    ln -sf "$TARGET_DIR/zoveli" "$BIN_DIR/zoveli"
    if "$BIN_DIR/zoveli" --version >/dev/null 2>&1; then
      info "Linked $BIN_DIR/zoveli"
      case ":$PATH:" in
        *":$BIN_DIR:"*) ;;
        *)
          warn "Add $BIN_DIR to PATH to run 'zoveli' from a new shell:"
          warn "  export PATH=\"$BIN_DIR:\$PATH\""
          ;;
      esac
    else
      warn "Linked $BIN_DIR/zoveli does not run; removed it. Use $TARGET_DIR/zoveli directly."
      rm -f "$BIN_DIR/zoveli"
    fi
  fi
else
  warn "Could not link into $BIN_DIR; run $TARGET_DIR/zoveli directly."
fi

printf '\nRun:\n  %s/zoveli\n' "$TARGET_DIR"
