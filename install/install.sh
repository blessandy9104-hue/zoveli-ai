#!/bin/sh
#
# Zoveli AI - primary Linux installer.
#
#   curl -fsSL https://raw.githubusercontent.com/blessandy9104-hue/zoveli-ai/main/install/install.sh | sh
#
# This script resolves the latest published release, then delegates the
# download/checksum/backup/rollback work to install-zoveli-runtime.sh. It adds
# an opt-in PATH link, records install metadata, runs `zoveli doctor`, and
# supports upgrades and uninstalls.
#
# Requirements: curl, tar, bash, and sha256sum or shasum (unless --no-verify).
# Use --archive to install a local .tar.gz without network access.
#
# Security: review before piping to a shell. This script downloads only from
# GitHub over HTTPS and never runs sudo or sends telemetry.
set -eu

REPO="blessandy9104-hue/zoveli-ai"
BRANCH="${ZOVELI_BRANCH:-main}"
VERSION=""
TARGET_DIR="${ZOVELI_HOME:-$HOME/.local/share/zoveli}"
ARCHIVE=""
ASSUME_YES=false
CHECK=false
FORCE=false
UNINSTALL=false
PURGE=false
SOURCE=false
ADD_TO_PATH=false
NO_VERIFY=false
DIR_SET=false

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  RED=$(printf '\033[0;31m')
  GREEN=$(printf '\033[0;32m')
  YELLOW=$(printf '\033[1;33m')
  NC=$(printf '\033[0m')
else
  RED=''
  GREEN=''
  YELLOW=''
  NC=''
fi

info() { printf '%s%s%s\n' "$GREEN" "$*" "$NC"; }
warn() { printf '%s%s%s\n' "$YELLOW" "$*" "$NC"; }
error() { printf '%s%s%s\n' "$RED" "$*" "$NC" >&2; }
die() { error "$*"; exit 1; }

usage() {
  cat <<EOF
Zoveli AI installer (Linux)
Usage: install.sh [options]

Install or upgrade Zoveli from the latest published release:
  --yes, -y          Non-interactive (required for non-interactive uninstall)
  --dir <path>       Install directory (default: \$HOME/.local/share/zoveli)
  --version <v>      Install a specific release (default: latest published)
  --archive <file>   Install a local .tar.gz instead of downloading
  --check            Report the installed and available versions, then exit
  --force            Reinstall even when the version is unchanged, or remove
                     a directory that does not look like a Zoveli install
  --uninstall        Remove the runtime and PATH link (keeps \$HOME/.zoveli)
  --purge            With --uninstall, also delete the vault and backups
  --source           Use the legacy source-build installer instead
  --add-to-path      Append the bin directory to \$HOME/.profile (opt-in)
  --no-verify        Skip SHA-256 verification (not recommended)
  -h, --help         Show this help

The vault and configuration under \$HOME/.zoveli survive upgrades and normal
uninstalls. --purge deletes them and cannot be undone.

Examples:
  curl -fsSL https://raw.githubusercontent.com/blessandy9104-hue/zoveli-ai/main/install/install.sh | sh
  curl -fsSL .../install.sh | sh -s -- --yes
  sh install.sh --check
  sh install.sh --uninstall
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    -y|--yes) ASSUME_YES=true; shift ;;
    --dir)
      [ $# -ge 2 ] || die "--dir requires a path"
      TARGET_DIR=$2
      DIR_SET=true
      shift 2
      ;;
    --version)
      [ $# -ge 2 ] || die "--version requires a value"
      VERSION=$2
      shift 2
      ;;
    --archive)
      [ $# -ge 2 ] || die "--archive requires a path"
      ARCHIVE=$2
      shift 2
      ;;
    --check) CHECK=true; shift ;;
    --force) FORCE=true; shift ;;
    --uninstall) UNINSTALL=true; shift ;;
    --purge) UNINSTALL=true; PURGE=true; shift ;;
    --source) SOURCE=true; shift ;;
    --add-to-path) ADD_TO_PATH=true; shift ;;
    --no-verify) NO_VERIFY=true; shift ;;
    -h|--help) usage; exit 0 ;;
    --) shift; break ;;
    *) die "Unknown option: $1 (see --help)" ;;
  esac
done

if [ "$UNINSTALL" = true ] && [ "$CHECK" = true ]; then
  die "--uninstall and --check cannot be combined"
fi
if [ "$SOURCE" = true ] && [ "$UNINSTALL" = true ]; then
  die "--source and --uninstall cannot be combined"
fi

VERSION=${VERSION#v}

# Normalize an explicitly provided directory so comparisons and metadata use
# a stable absolute path. Keep $HOME and its ancestors protected.
case "$TARGET_DIR" in
  /*) ;;
  *) TARGET_DIR=$(pwd)/$TARGET_DIR ;;
esac
if [ -d "$TARGET_DIR" ]; then
  TARGET_DIR=$(CDPATH='' cd "$TARGET_DIR" && pwd -P) || die "Could not resolve install directory: $TARGET_DIR"
fi
HOME_REAL=$(CDPATH='' cd "$HOME" && pwd -P) || HOME_REAL=$HOME
case "$TARGET_DIR" in
  ""|"/"|"$HOME"|"$HOME/"|"$HOME_REAL"|"$HOME_REAL/") die "Refusing to use protected directory: $TARGET_DIR" ;;
esac
case "$HOME_REAL/" in
  "$TARGET_DIR"/*) die "Refusing to use a directory that contains \$HOME: $TARGET_DIR" ;;
esac

if [ "$SOURCE" = true ] && [ "$DIR_SET" = false ]; then
  TARGET_DIR="$HOME/zoveli-ai"
fi

BIN_DIR="${XDG_BIN_HOME:-$HOME/.local/bin}"

SCRIPT_DIR=""
case "$0" in
  */*)
    SCRIPT_DIR=$(CDPATH='' cd "$(dirname "$0")" 2>/dev/null && pwd) || SCRIPT_DIR=""
    ;;
esac

TMP_DIR=""
cleanup() {
  if [ -n "$TMP_DIR" ] && [ -d "$TMP_DIR" ]; then
    rm -rf "$TMP_DIR"
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1${2:+ - $2}"
}

detect_platform() {
  os=$(uname -s 2>/dev/null || printf 'unknown')
  arch=$(uname -m 2>/dev/null || printf 'unknown')
  case "$os" in
    Linux) PLATFORM=linux ;;
    Darwin)
      die "macOS installation is planned for Phase 3. For now use: https://github.com/$REPO/blob/main/install/install-zoveli-runtime.sh"
      ;;
    *)
      die "Unsupported operating system: $os. Windows users: use install/install-zoveli-runtime.ps1."
      ;;
  esac
  case "$arch" in
    x86_64|amd64) ARCH=x64 ;;
    aarch64|arm64) ARCH=arm64 ;;
    *) die "Unsupported architecture: $arch (supported: x86_64, aarch64)" ;;
  esac
}

resolve_latest_version() {
  url=$(curl --proto '=https' --tlsv1.2 -fsSL -o /dev/null -w '%{url_effective}' \
    "https://github.com/$REPO/releases/latest") || return 1
  case "$url" in
    "https://github.com/$REPO/releases/tag/v"*) printf '%s\n' "${url##*/v}" ;;
    *) return 1 ;;
  esac
}

archive_version() {
  basename "$1" | sed -n 's/^zoveli-\([0-9][0-9.]*\)-.*/\1/p'
}

installed_version() {
  if [ -f "$TARGET_DIR/runtime.json" ]; then
    sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$TARGET_DIR/runtime.json" | head -n 1
    return 0
  fi
  if [ -x "$TARGET_DIR/zoveli" ]; then
    text=$("$TARGET_DIR/zoveli" --version 2>/dev/null | tail -n 1 | tr -d '\r') || true
    case "$text" in
      "zoveli "*) printf '%s\n' "${text#zoveli }" ;;
    esac
  fi
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

json_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

write_metadata() {
  version=$1
  [ -n "$version" ] || return 0
  [ -d "$TARGET_DIR" ] || return 0
  installed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  tmp="$TARGET_DIR/.install.json.$$"
  {
    printf '{\n'
    printf '  "schema": 1,\n'
    printf '  "version": "%s",\n' "$(json_escape "$version")"
    printf '  "installedAt": "%s",\n' "$installed_at"
    printf '  "method": "%s",\n' "$INSTALL_METHOD"
    printf '  "dir": "%s",\n' "$(json_escape "$TARGET_DIR")"
    printf '  "installer": "install.sh"\n'
    printf '}\n'
  } > "$tmp"
  mv "$tmp" "$TARGET_DIR/install.json"
}

add_to_path_profile() {
  profile="$HOME/.profile"
  marker="# >>> zoveli installer >>>"
  if [ -f "$profile" ] && grep -F "$marker" "$profile" >/dev/null 2>&1; then
    info "PATH block already present in $profile"
    return 0
  fi
  {
    printf '\n%s\n' "$marker"
    printf 'case ":$PATH:" in\n'
    printf '  *":%s:"*) ;;\n' "$BIN_DIR"
    printf '  *) PATH="%s:$PATH" ;;\n' "$BIN_DIR"
    printf 'esac\n'
    printf 'export PATH\n'
    printf '# <<< zoveli installer <<<\n'
  } >> "$profile"
  info "Added $BIN_DIR to PATH in $profile"
  warn "Open a new shell or run: . $profile"
}

ensure_link() {
  if [ ! -x "$TARGET_DIR/zoveli" ]; then
    warn "No launcher at $TARGET_DIR/zoveli; skipping PATH link."
    return 0
  fi
  if ! mkdir -p "$BIN_DIR" 2>/dev/null || [ ! -w "$BIN_DIR" ]; then
    warn "Could not create or write $BIN_DIR; run $TARGET_DIR/zoveli directly."
    return 0
  fi
  if [ -e "$BIN_DIR/zoveli" ] && [ ! -L "$BIN_DIR/zoveli" ]; then
    warn "Left existing $BIN_DIR/zoveli untouched; run $TARGET_DIR/zoveli directly."
    return 0
  fi
  if ! ln -sf "$TARGET_DIR/zoveli" "$BIN_DIR/zoveli"; then
    warn "Could not link $BIN_DIR/zoveli; run $TARGET_DIR/zoveli directly."
    return 0
  fi
  if ! "$BIN_DIR/zoveli" --version >/dev/null 2>&1; then
    warn "Linked $BIN_DIR/zoveli does not run; removed it."
    rm -f "$BIN_DIR/zoveli"
    return 0
  fi
  info "Linked $BIN_DIR/zoveli"
  case ":$PATH:" in
    *":$BIN_DIR:"*) ;;
    *)
      if [ "$ADD_TO_PATH" = true ]; then
        add_to_path_profile
      else
        warn "Add $BIN_DIR to PATH to run 'zoveli' from a new shell:"
        warn "  export PATH=\"$BIN_DIR:\$PATH\""
        warn "Or re-run with --add-to-path to append it to $HOME/.profile."
      fi
      ;;
  esac
}

DOCTOR_AVAILABLE=false

run_doctor() {
  if [ ! -x "$TARGET_DIR/zoveli" ]; then
    return 0
  fi
  help=$("$TARGET_DIR/zoveli" --help 2>/dev/null) || help=""
  case "$help" in
    *"zoveli doctor"*) DOCTOR_AVAILABLE=true ;;
    *)
      info "This runtime predates 'zoveli doctor'; diagnostics arrive in a newer release."
      return 0
      ;;
  esac
  if "$TARGET_DIR/zoveli" doctor --offline; then
    return 0
  fi
  warn "Installed, but 'zoveli doctor' reported problems."
  warn "Run '$TARGET_DIR/zoveli doctor' for the full report."
}

print_done() {
  version=$1
  printf '\nZoveli %s is ready.\n' "$version"
  if [ -x "$BIN_DIR/zoveli" ]; then
    printf 'Run:\n  %s\n' "$BIN_DIR/zoveli"
  else
    printf 'Run:\n  %s\n' "$TARGET_DIR/zoveli"
  fi
  if [ "$DOCTOR_AVAILABLE" = true ]; then
    printf 'Diagnose:\n  zoveli doctor\n'
  fi
  printf 'Upgrade:\n  re-run this installer (or: zoveli update)\n'
  printf 'Uninstall:\n  sh install.sh --uninstall\n'
}

check_release_asset() {
  url="https://github.com/$REPO/releases/download/v$VERSION/zoveli-$VERSION-$PLATFORM-$ARCH.tar.gz"
  if ! curl --proto '=https' --tlsv1.2 -fsSIL -o /dev/null "$url"; then
    die "Release v$VERSION does not publish a $PLATFORM-$ARCH archive. See https://github.com/$REPO/releases"
  fi
}

resolve_target_version() {
  if [ -z "$VERSION" ] && [ -n "$ARCHIVE" ]; then
    VERSION=$(archive_version "$ARCHIVE")
    [ -n "$VERSION" ] || die "Could not read the version from archive: $ARCHIVE"
  fi
  if [ -z "$VERSION" ]; then
    need_cmd curl "resolving the latest release needs curl"
    info "Resolving the latest Zoveli release..."
    VERSION=$(resolve_latest_version) || die "Could not resolve the latest release. Pass --version or --archive, or check your network."
  fi
}

preflight_runtime() {
  need_cmd uname "detecting the platform needs uname"
  need_cmd tar "extracting the runtime archive needs tar"
  need_cmd bash "the runtime installer is written for bash"
  if [ -z "$ARCHIVE" ]; then
    need_cmd curl "downloading the runtime needs curl"
  fi
  if [ "$NO_VERIFY" != true ]; then
    if ! command -v sha256sum >/dev/null 2>&1 && ! command -v shasum >/dev/null 2>&1; then
      die "Missing checksum tool: install sha256sum or shasum, or pass --no-verify."
    fi
  fi
  if [ -n "$ARCHIVE" ]; then
    [ -f "$ARCHIVE" ] || die "Archive not found: $ARCHIVE"
    ARCHIVE=$(CDPATH='' cd "$(dirname "$ARCHIVE")" && pwd)/$(basename "$ARCHIVE") || die "Could not resolve archive path: $ARCHIVE"
    if [ "$NO_VERIFY" != true ] && [ ! -f "$ARCHIVE.sha256" ]; then
      die "Checksum file not found: $ARCHIVE.sha256 (use --no-verify only if you trust this archive)"
    fi
  fi
}

run_runtime_installer() {
  installer="${ZOVELI_RUNTIME_INSTALLER:-}"
  if [ -z "$installer" ] && [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/install-zoveli-runtime.sh" ]; then
    installer="$SCRIPT_DIR/install-zoveli-runtime.sh"
  fi
  if [ -z "$installer" ]; then
    TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/zoveli-install.XXXXXX")
    installer="$TMP_DIR/install-zoveli-runtime.sh"
    info "Downloading the Zoveli runtime installer..."
    curl --proto '=https' --tlsv1.2 -fsSL \
      "https://raw.githubusercontent.com/$REPO/$BRANCH/install/install-zoveli-runtime.sh" \
      -o "$installer" || die "Could not download the runtime installer."
    chmod +x "$installer"
  fi
  [ -f "$installer" ] || die "Runtime installer not found: $installer"

  set -- --dir "$TARGET_DIR"
  if [ -n "$VERSION" ]; then set -- "$@" --version "$VERSION"; fi
  if [ -n "$ARCHIVE" ]; then set -- "$@" --archive "$ARCHIVE"; fi
  if [ "$FORCE" = true ]; then set -- "$@" --force; fi
  if [ "$NO_VERIFY" = true ]; then set -- "$@" --no-verify; fi
  if [ "$ASSUME_YES" = true ]; then set -- "$@" --yes; fi

  if [ -n "$INSTALLED" ]; then
    comparison=$(compare_versions "$INSTALLED" "$VERSION")
    if [ "$comparison" = -1 ]; then
      info "Upgrading Zoveli $INSTALLED -> $VERSION"
    elif [ "$comparison" = 1 ]; then
      warn "Downgrading Zoveli $INSTALLED -> $VERSION"
    fi
  else
    info "Installing Zoveli $VERSION into $TARGET_DIR"
  fi
  bash "$installer" "$@"
}

run_source_installer() {
  INSTALL_METHOD=source
  installer="${ZOVELI_SOURCE_INSTALLER:-}"
  if [ -z "$installer" ] && [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/install-zoveli.sh" ]; then
    installer="$SCRIPT_DIR/install-zoveli.sh"
  fi
  if [ -z "$installer" ]; then
    TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/zoveli-install.XXXXXX")
    installer="$TMP_DIR/install-zoveli.sh"
    need_cmd curl "downloading the source installer needs curl"
    info "Downloading the Zoveli source installer..."
    curl --proto '=https' --tlsv1.2 -fsSL \
      "https://raw.githubusercontent.com/$REPO/$BRANCH/install/install-zoveli.sh" \
      -o "$installer" || die "Could not download the source installer."
  fi
  [ -f "$installer" ] || die "Source installer not found: $installer"
  set -- --dir "$TARGET_DIR" --branch "$BRANCH"
  if [ "$ASSUME_YES" = true ]; then set -- "$@" --yes; fi
  info "Building Zoveli from source in $TARGET_DIR (legacy path)..."
  bash "$installer" "$@"
  write_metadata "$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$TARGET_DIR/package.json" 2>/dev/null | head -n 1)"
  printf '\nSource install complete: %s\n' "$TARGET_DIR"
  printf 'Run:\n  cd %s && pnpm start\n' "$TARGET_DIR"
  printf 'For the portable one-command install, run install.sh without --source.\n'
}

remove_link() {
  link="$BIN_DIR/zoveli"
  if [ -L "$link" ]; then
    target=$(readlink "$link" 2>/dev/null || true)
    case "$target" in
      "$TARGET_DIR/zoveli"|"$TARGET_DIR/zoveli.cmd")
        rm -f "$link"
        info "Removed $link"
        ;;
      *)
        warn "Left $link (it points to $target)"
        ;;
    esac
  elif [ -e "$link" ]; then
    warn "Left $link (it is not a symlink)"
  fi
}

purge_state() {
  state="$HOME/.zoveli"
  if [ ! -e "$state" ]; then
    info "No state directory at $state."
    return 0
  fi
  if [ "$ASSUME_YES" != true ]; then
    if [ -t 0 ]; then
      printf 'Delete the vault, backups and configuration under %s? This cannot be undone. [y/N] ' "$state"
      read -r answer || answer=""
      case "$answer" in
        [yY]|[yY][eE][sS]) ;;
        *) die "Aborted." ;;
      esac
    else
      die "Refusing to purge $state without --yes when stdin is not a terminal."
    fi
  fi
  rm -rf "$state"
  info "Purged $state"
}

uninstall() {
  if [ -e "$TARGET_DIR" ]; then
    if [ ! -f "$TARGET_DIR/runtime.json" ] && [ ! -f "$TARGET_DIR/install.json" ] && [ ! -f "$TARGET_DIR/package.json" ]; then
      if [ "$FORCE" != true ]; then
        die "Refusing to remove $TARGET_DIR: it does not look like a Zoveli install (use --force)."
      fi
    fi
    if [ "$ASSUME_YES" != true ]; then
      if [ -t 0 ]; then
        printf 'Remove Zoveli from %s? The vault under %s is preserved. [y/N] ' "$TARGET_DIR" "$HOME/.zoveli"
        read -r answer || answer=""
        case "$answer" in
          [yY]|[yY][eE][sS]) ;;
          *) die "Aborted." ;;
        esac
      else
        die "Refusing to uninstall without --yes when stdin is not a terminal."
      fi
    fi
    rm -rf "$TARGET_DIR"
    info "Removed $TARGET_DIR"
  else
    info "No Zoveli runtime found at $TARGET_DIR."
  fi
  remove_link

  if [ "$PURGE" = true ]; then
    purge_state
  else
    info "Preserved vault and state under $HOME/.zoveli."
    info "Use --purge to delete them as well."
  fi
}

main() {
  if [ "$UNINSTALL" = true ]; then
    uninstall
    return 0
  fi

  detect_platform

  if [ "$CHECK" = true ]; then
    if [ -n "$ARCHIVE" ] && [ ! -f "$ARCHIVE" ]; then
      die "Archive not found: $ARCHIVE"
    fi
    if [ -z "$ARCHIVE" ] && [ -z "$VERSION" ]; then
      need_cmd curl "resolving the latest release needs curl"
      VERSION=$(resolve_latest_version) || die "Could not resolve the latest release."
    fi
    if [ -z "$VERSION" ] && [ -n "$ARCHIVE" ]; then
      VERSION=$(archive_version "$ARCHIVE")
    fi
    installed=$(installed_version || true)
    printf 'Install directory: %s\n' "$TARGET_DIR"
    if [ -n "$installed" ]; then
      printf 'Installed: Zoveli %s\n' "$installed"
    else
      printf 'Installed: none\n'
    fi
    if [ -n "$VERSION" ]; then
      printf 'Target: Zoveli %s\n' "$VERSION"
    else
      printf 'Target: unknown\n'
    fi
    printf 'State: %s\n' "$HOME/.zoveli"
    if [ -n "$installed" ] && [ -n "$VERSION" ]; then
      comparison=$(compare_versions "$installed" "$VERSION")
      case "$comparison" in
        -1) info "Update available: Zoveli $installed -> $VERSION" ;;
        1) info "Installed Zoveli $installed is newer than target $VERSION" ;;
        *) info "Zoveli $installed is up to date" ;;
      esac
    fi
    return 0
  fi

  if [ "$SOURCE" = true ]; then
    need_cmd bash "the source installer is written for bash"
    run_source_installer
    return 0
  fi

  preflight_runtime
  resolve_target_version
  if [ "$NO_VERIFY" != true ] && [ -z "$ARCHIVE" ] && [ "$ARCH" = arm64 ]; then
    check_release_asset
  fi

  INSTALLED=$(installed_version || true)
  INSTALL_METHOD=runtime

  if [ -n "$INSTALLED" ] && [ "$INSTALLED" = "$VERSION" ] && [ "$FORCE" != true ]; then
    info "Zoveli $INSTALLED is already installed in $TARGET_DIR."
    write_metadata "$INSTALLED"
    ensure_link
    run_doctor
    print_done "$INSTALLED"
    return 0
  fi

  run_runtime_installer
  write_metadata "$VERSION"
  ensure_link
  run_doctor
  print_done "$VERSION"
}

main "$@"
