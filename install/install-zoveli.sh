#!/usr/bin/env bash
#
# Zoveli AI — opencode-style one-line installer (POSIX bash).
#
# Reference: https://github.com/opencode-ai/opencode/blob/main/install
# (canonical opencode installer: `curl -fsSL https://opencode.ai/install | bash`).
# Patterns copied: `set -euo pipefail`, uname OS/arch detection + allowlist,
# VERSION-style env override (-> ZOVELI_BRANCH/--branch), temp-dir download
# hygiene, colored print_message(), per-shell PATH hint, GITHUB_ACTIONS
# $GITHUB_PATH handling. NOT copied: binary tarball download, version API
# lookup, telemetry/analytics (Zoveli installer has none — privacy-preserving).
#
# What this installer does (source build, because Zoveli ships no prebuilt
# binary): clone (or reuse) the repo, create a Python venv, pip install the
# vendored ./mathcore, ensure Node 22 + pnpm 11.7.0, pnpm install + build.
# Idempotent via marker file `.zoveli-install-done` (like opencode's
# check_version early-exit).
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/blessandy9104-hue/zoveli-ai/<branch>/install/install-zoveli.sh | bash -s -- --yes
#   bash install/install-zoveli.sh [--yes] [--dir <path>] [--branch <branch>]
#
# Security: review before running curl|bash. This script only clones from the
# official repo URL below, never executes other remote code, never runs sudo
# without your explicit --yes consent, and sends no telemetry anywhere.
set -euo pipefail

APP="zoveli-ai"
REPO_URL="https://github.com/blessandy9104-hue/zoveli-ai.git"
DEFAULT_BRANCH="main"
DEFAULT_DIR="$HOME/zoveli-ai"
MARKER=".zoveli-install-done"
PNPM_VERSION="11.7.0"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
ORANGE='\033[38;2;255;140;0m'
NC='\033[0m' # No Color

ASSUME_YES=false
TARGET_DIR="$DEFAULT_DIR"
BRANCH="${ZOVELI_BRANCH:-$DEFAULT_BRANCH}"

print_message() {
  local level=$1
  local message=$2
  local color=""
  case $level in
    info) color="${GREEN}" ;;
    warning) color="${YELLOW}" ;;
    error) color="${RED}" ;;
  esac
  echo -e "${color}${message}${NC}"
}

usage() {
  cat <<EOF
Zoveli AI Installer (opencode-style)
Usage: install-zoveli.sh [options]
Options:
  -y, --yes            Non-interactive: assume yes for prompts (incl. sudo prereq installs)
      --dir <path>     Install directory (default: $DEFAULT_DIR)
      --branch <name>  Git branch to clone (default: $DEFAULT_BRANCH, or \$ZOVELI_BRANCH)
  -h, --help           Display this help message
Examples:
  curl -fsSL https://raw.githubusercontent.com/blessandy9104-hue/zoveli-ai/main/install/install-zoveli.sh | bash -s -- --yes
  bash install/install-zoveli.sh --yes --dir ~/zoveli-ai --branch main
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    -y|--yes) ASSUME_YES=true; shift ;;
    --dir) TARGET_DIR="${2:?--dir requires a path}"; shift 2 ;;
    --branch) BRANCH="${2:?--branch requires a name}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) print_message error "Unknown option: $1 (see --help)"; exit 1 ;;
  esac
done

# --- OS/arch detection (opencode pattern) ---
os=$(uname -s | tr '[:upper:]' '[:lower:]')
if [ "$os" = "darwin" ]; then os="mac"; fi
arch=$(uname -m)
if [ "$arch" = "aarch64" ]; then arch="arm64"; fi

case "$os-$arch" in
  linux-x86_64|linux-arm64|linux-i386|mac-x86_64|mac-arm64) ;;
  msys*|mingw*|cygwin*|windowsnt*)
    print_message warning "Windows detected in bash. For the best experience use the PowerShell installer:"
    print_message info "  irm https://raw.githubusercontent.com/blessandy9104-hue/zoveli-ai/$BRANCH/install/install-zoveli.ps1 | iex"
    print_message warning "Continuing with bash (Git Bash/WSL)..."
    ;;
  *)
    print_message error "Unsupported OS/Arch: $os/$arch"
    exit 1
    ;;
esac

confirm() {
  # $1 = prompt. Returns 0 on yes. Auto-yes when --yes.
  if [ "$ASSUME_YES" = true ]; then return 0; fi
  printf "%s [y/N] " "$1"
  read -r ans || true
  case "$ans" in
    [yY]|[yY][eE][sS]) return 0 ;;
    *) return 1 ;;
  esac
}

have() { command -v "$1" >/dev/null 2>&1; }

# --- Idempotency marker (opencode check_version pattern) ---
if [ -f "$TARGET_DIR/$MARKER" ] && [ -d "$TARGET_DIR/node_modules" ] && [ -d "$TARGET_DIR/apps/cli/dist" ]; then
  print_message info "Version in $TARGET_DIR ${YELLOW}already installed${GREEN} (marker $MARKER present) — skipping expensive steps."
  print_message info "Run: cd $TARGET_DIR && source .venv/bin/activate && pnpm start"
  exit 0
fi

print_message info "Installing ${ORANGE}Zoveli AI${GREEN} (branch: ${YELLOW}$BRANCH${GREEN}) into ${YELLOW}$TARGET_DIR${NC}"
if [ "$ASSUME_YES" != true ]; then
  print_message warning "Review this script before continuing: https://github.com/blessandy9104-hue/zoveli-ai/blob/$BRANCH/install/install-zoveli.sh"
  confirm "Continue with installation?" || { print_message error "Aborted by user."; exit 1; }
fi

# --- Preflight ---
missing=""
for cmd in git curl python3; do
  have "$cmd" || missing="$missing $cmd"
done
if ! have node; then missing="$missing node(>=22.16)"; fi
if ! have pnpm; then missing="$missing pnpm(@$PNPM_VERSION)"; fi

install_prereqs() {
  # Best-effort prereq install via native package manager. Only runs with
  # explicit consent (--yes or interactive yes). Never runs blind sudo.
  if [ -n "${ZOVELI_SKIP_PREREQ_INSTALL:-}" ]; then
    print_message warning "ZOVELI_SKIP_PREREQ_INSTALL set — skipping system package installs."
    return 0
  fi
  if have apt-get && have sudo; then
    print_message info "Installing system prerequisites via apt (requires sudo)..."
    sudo apt-get update && sudo apt-get install -y git curl python3 python3-venv python3-pip nodejs
  elif have brew; then
    print_message info "Installing system prerequisites via Homebrew..."
    brew install git curl python@3.11 node@22
  else
    return 1
  fi
}

if [ -n "$missing" ]; then
  print_message warning "Missing tools:$missing"
  if confirm "Attempt to install system prerequisites via package manager (may use sudo)?"; then
    install_prereqs || {
      print_message error "Could not auto-install prerequisites. Install manually, then re-run:"
      case "$os" in
        linux*) print_message info "  sudo apt install -y git curl python3 python3-venv python3-pip nodejs  # Debian/Ubuntu" ;;
        mac*) print_message info "  brew install git curl python@3.11 node@22  # macOS" ;;
      esac
      print_message info "  npm install -g pnpm@$PNPM_VERSION"
      exit 1
    }
  else
    print_message error "Cannot continue without:$missing"
    print_message info "Install them manually, then re-run with --yes to skip this prompt."
    exit 1
  fi
fi

# --- Clone or reuse checkout (temp-dir hygiene like opencode's opencodetmp) ---
if [ -d "$TARGET_DIR/.git" ] && [ -f "$TARGET_DIR/package.json" ]; then
  print_message info "Reusing existing checkout at $TARGET_DIR"
  (cd "$TARGET_DIR" && git fetch origin && git checkout "$BRANCH" && git pull --ff-only origin "$BRANCH") || {
    print_message warning "Could not fast-forward existing checkout; continuing with current files."
  }
else
  mkdir -p "$(dirname "$TARGET_DIR")"
  if [ -d "$TARGET_DIR" ] && [ -n "$(ls -A "$TARGET_DIR" 2>/dev/null)" ]; then
    print_message error "Target $TARGET_DIR exists and is not a Zoveli checkout. Use --dir <empty-or-new-path>."
    exit 1
  fi
  print_message info "Cloning $REPO_URL (branch $BRANCH)..."
  git clone --branch "$BRANCH" --depth 1 "$REPO_URL" "$TARGET_DIR"
fi
cd "$TARGET_DIR"

# --- Python venv + vendored mathcore ---
if [ ! -d ".venv" ]; then
  print_message info "Creating Python venv (.venv)..."
  python3 -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate
pip install --upgrade pip
print_message info "Installing vendored mathcore (verified-math backend)..."
if ! pip install -e ./mathcore; then
  print_message error "pip install ./mathcore failed (often z3-solver needs a C toolchain + cmake)."
  print_message info "One-line requirement — Debian/Ubuntu: sudo apt install -y build-essential cmake"
  print_message info "One-line requirement — Alpine:      apk add --no-cache --virtual .build-deps build-base cmake"
  print_message info "One-line requirement — macOS:       brew install cmake"
  print_message info "Re-run this script after installing; it resumes idempotently."
  exit 1
fi

# --- Node + pnpm (must match packageManager in package.json) ---
if ! have pnpm; then
  print_message info "Installing pnpm@$PNPM_VERSION..."
  if have corepack; then
    corepack enable && corepack prepare "pnpm@$PNPM_VERSION" --activate
  else
    npm install -g "pnpm@$PNPM_VERSION"
  fi
fi
if have node; then
  node_major=$(node -p "process.versions.node.split('.')[0]")
  node_minor=$(node -p "process.versions.node.split('.')[1]")
  # node:sqlite FTS5 (memory store) needs 22.16+; newer majors are fine.
  if [ "$node_major" -lt 22 ] || { [ "$node_major" -eq 22 ] && [ "$node_minor" -lt 16 ]; }; then
    print_message error "Node 22.16+ required (found $(node -v)). Upgrade Node, then re-run."
    exit 1
  fi
fi

print_message info "Installing JS dependencies (pnpm install)..."
pnpm install --frozen-lockfile --prod=false
print_message info "Building packages (pnpm run build)..."
pnpm run build

# --- Marker + final instructions (opencode add_to_path / GITHUB_PATH pattern) ---
date -u +"%Y-%m-%dT%H:%M:%SZ $APP $BRANCH" > "$MARKER"
print_message info "Zoveli AI installed successfully into $TARGET_DIR"

cat <<EOF

Run it:
  cd $TARGET_DIR && source .venv/bin/activate
  pnpm run doctor       # confirm Node/pnpm/python/mathcore/Ollama
  pnpm start            # CLI assistant (works fully offline, Windows/macOS/Linux)
  pnpm run desktop      # Electron desktop shell (dev mode)

Docker:
  docker compose -f docker/docker-compose.yml --profile cli up --build

Try in the CLI: /math solve x^2 - 5x + 6 = 0  ·  /sys  ·  /tools  ·  /help
Free offline chat (no keys): install Ollama (https://ollama.com), run 'ollama pull qwen3:4b'.
Or set any API key: OPENAI_API_KEY, DEEPSEEK_API_KEY, OPENROUTER_API_KEY, GROQ_API_KEY, TOGETHER_API_KEY.
EOF

if [ -n "${GITHUB_ACTIONS:-}" ] && [ "${GITHUB_ACTIONS}" = "true" ] && [ -n "${GITHUB_PATH:-}" ]; then
  echo "$TARGET_DIR" >> "$GITHUB_PATH"
  print_message info "Added $TARGET_DIR to \$GITHUB_PATH"
fi
