#!/bin/sh
#
# Zoveli AI - Docker fallback installer (browser UI).
#
#   curl -fsSL https://raw.githubusercontent.com/blessandy9104-hue/zoveli-ai/main/install/install-docker.sh | sh
#
# Runs the Zoveli browser UI in a local Docker container. The UI is served on
# 127.0.0.1 only, and the vault/audit data lives in a named Docker volume so it
# survives upgrades and normal uninstalls.
#
# Requirements: Docker Engine or Docker Desktop 20.10+. No Node, Python, Git,
# or Compose installation is needed on the host.
#
# Security: review before piping to a shell. This script pulls only the
# published image from ghcr.io over HTTPS, never runs sudo, and never writes
# provider keys to disk. Keys are forwarded to the container from the current
# environment and are never printed. Zoveli is bound to localhost; use an SSH
# tunnel for remote access.
set -eu

REPO="blessandy9104-hue/zoveli-ai"
SCRIPT_URL="https://raw.githubusercontent.com/$REPO/main/install/install-docker.sh"
IMAGE_REPO="ghcr.io/$REPO-web"
IMAGE=""
IMAGE_SET=false
VERSION="${ZOVELI_DOCKER_VERSION:-latest}"
NAME="${ZOVELI_DOCKER_NAME:-zoveli}"
PORT="${ZOVELI_DOCKER_PORT:-8080}"
if [ -n "${ZOVELI_DOCKER_PORT:-}" ]; then PORT_SET=true; else PORT_SET=false; fi
VOLUME=""
VOLUME_SET=false
ASSUME_YES=false
CHECK=false
FORCE=false
UNINSTALL=false
PURGE=false
WAIT_HEALTH=true
DOCKER_BIN="${DOCKER_BIN:-docker}"
SERVER_VERSION=""
IMAGE_ID=""

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
Zoveli AI installer (Docker fallback, browser UI)
Usage: install-docker.sh [options]

Runs the published Zoveli browser UI in Docker:
  --yes, -y          Non-interactive (required for non-interactive uninstall)
  --version <v>      Image tag or release version (default: latest)
  --image <ref>      Override the image reference (uses a local image if present)
  --port <port>      Host port on 127.0.0.1 (default: 8080; kept on upgrade)
  --name <name>      Container name (default: zoveli)
  --volume <name>    Data volume name (default: <name>-data; kept on upgrade)
  --check            Report the container, image, port, volume and health
  --force            Recreate the container even when the image is unchanged
  --uninstall        Stop and remove the container (keeps the data volume)
  --purge            With --uninstall, also delete the data volume
  --no-health-wait   Do not wait for the health check (not recommended)
  -h, --help         Show this help

The browser UI is available at http://127.0.0.1:<port>. The vault, sessions
and audit log live in the data volume and survive upgrades and normal
uninstalls. --purge deletes them and cannot be undone.

Provider keys are read from the current environment (for example
OPENAI_API_KEY) and passed to the container without being written to disk or
printed. Local Ollama is reached through host.docker.internal.

Examples:
  curl -fsSL $SCRIPT_URL | sh
  curl -fsSL .../install-docker.sh | sh -s -- --yes
  sh install-docker.sh --check
  sh install-docker.sh --uninstall
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    -y|--yes) ASSUME_YES=true; shift ;;
    --version)
      [ $# -ge 2 ] || die "--version requires a value"
      VERSION=$2
      shift 2
      ;;
    --image)
      [ $# -ge 2 ] || die "--image requires a value"
      IMAGE=$2
      IMAGE_SET=true
      shift 2
      ;;
    --port)
      [ $# -ge 2 ] || die "--port requires a value"
      PORT=$2
      PORT_SET=true
      shift 2
      ;;
    --name)
      [ $# -ge 2 ] || die "--name requires a value"
      NAME=$2
      shift 2
      ;;
    --volume)
      [ $# -ge 2 ] || die "--volume requires a value"
      VOLUME=$2
      VOLUME_SET=true
      shift 2
      ;;
    --check) CHECK=true; shift ;;
    --force) FORCE=true; shift ;;
    --uninstall) UNINSTALL=true; shift ;;
    --purge) UNINSTALL=true; PURGE=true; shift ;;
    --no-health-wait) WAIT_HEALTH=false; shift ;;
    -h|--help) usage; exit 0 ;;
    --) shift; break ;;
    *) die "Unknown option: $1 (see --help)" ;;
  esac
done

if [ "$UNINSTALL" = true ] && [ "$CHECK" = true ]; then
  die "--uninstall and --check cannot be combined"
fi

VERSION=${VERSION#v}
[ -n "$VERSION" ] || die "--version requires a non-empty value"
case "$VERSION" in
  [A-Za-z0-9_]*) ;;
  *) die "Invalid version or image tag: $VERSION" ;;
esac
case "$VERSION" in
  *[!A-Za-z0-9._-]*) die "Invalid version or image tag: $VERSION" ;;
esac
case "$PORT" in
  ''|*[!0-9]*) die "--port must be a number" ;;
esac
[ "$PORT" -ge 1 ] && [ "$PORT" -le 65535 ] || die "--port must be between 1 and 65535"
case "$NAME" in
  ''|*[!A-Za-z0-9_.-]*) die "Invalid container name: $NAME" ;;
esac
if [ "$VOLUME_SET" = true ]; then
  case "$VOLUME" in
    ''|*[!A-Za-z0-9_.-]*) die "Invalid volume name: $VOLUME" ;;
  esac
fi
if [ -z "$IMAGE" ]; then
  IMAGE="$IMAGE_REPO:$VERSION"
fi

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1${2:+ - $2}"
}

require_docker() {
  need_cmd "$DOCKER_BIN" "install Docker Engine or Docker Desktop 20.10+"
  "$DOCKER_BIN" info >/dev/null 2>&1 \
    || die "Docker daemon is not reachable. Start Docker Desktop or the Docker service, then retry."
  SERVER_VERSION=$("$DOCKER_BIN" version --format '{{.Server.Version}}' 2>/dev/null || true)
  [ -n "$SERVER_VERSION" ] || die "Could not read the Docker server version."
  # Distribution packages append suffixes such as 20.10.24+dfsg1 or 24.0.7-1.
  major=${SERVER_VERSION%%.*}
  case "$major" in
    ''|*[!0-9]*) die "Unsupported Docker server version: $SERVER_VERSION (need 20.10+)." ;;
  esac
  case "$SERVER_VERSION" in
    *.*) rest=${SERVER_VERSION#*.}; minor=${rest%%.*} ;;
    *) minor=0 ;;
  esac
  case "$minor" in
    ''|*[!0-9]*) minor=0 ;;
  esac
  if [ "$major" -lt 20 ] || { [ "$major" -eq 20 ] && [ "$minor" -lt 10 ]; }; then
    die "Docker $SERVER_VERSION is too old; install Docker 20.10 or newer."
  fi
}

container_exists() {
  "$DOCKER_BIN" container inspect "$1" >/dev/null 2>&1
}

is_managed() {
  [ "$("$DOCKER_BIN" inspect -f '{{index .Config.Labels "org.zoveli.installer"}}' "$1" 2>/dev/null || true)" = "docker" ]
}

container_state() {
  "$DOCKER_BIN" inspect -f '{{.State.Status}}' "$1" 2>/dev/null || printf 'unknown'
}

container_health() {
  "$DOCKER_BIN" inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$1" 2>/dev/null || printf 'unknown'
}

container_image_id() {
  "$DOCKER_BIN" inspect -f '{{.Image}}' "$1" 2>/dev/null || true
}

container_image_ref() {
  "$DOCKER_BIN" inspect -f '{{.Config.Image}}' "$1" 2>/dev/null || true
}

container_port() {
  "$DOCKER_BIN" inspect \
    -f '{{range $p, $b := .HostConfig.PortBindings}}{{range $b}}{{.HostPort}}{{end}}{{end}}' \
    "$1" 2>/dev/null || true
}

container_volume() {
  "$DOCKER_BIN" inspect \
    -f '{{range .Mounts}}{{if eq .Destination "/app/data"}}{{.Name}}{{end}}{{end}}' \
    "$1" 2>/dev/null || true
}

image_id() {
  "$DOCKER_BIN" image inspect -f '{{.Id}}' "$1" 2>/dev/null || true
}

image_version() {
  value=$("$DOCKER_BIN" image inspect \
    -f '{{index .Config.Labels "org.opencontainers.image.version"}}' "$1" 2>/dev/null || true)
  case "$value" in
    ''|'<no value>') printf '%s\n' "${2-$VERSION}" ;;
    *) printf '%s\n' "$value" ;;
  esac
}

resolve_image() {
  if [ "$IMAGE_SET" = true ] && [ -n "$(image_id "$IMAGE")" ]; then
    info "Using local image $IMAGE"
  else
    info "Pulling $IMAGE"
    if ! "$DOCKER_BIN" pull "$IMAGE"; then
      die "Could not pull $IMAGE. Check --version ($VERSION), your network, and 'docker login ghcr.io' if the image is private."
    fi
  fi
  IMAGE_ID=$(image_id "$IMAGE")
  [ -n "$IMAGE_ID" ] || die "Could not inspect image $IMAGE after pulling it."
}

container_matches() {
  [ "$(container_image_id "$NAME")" = "$IMAGE_ID" ] || return 1
  [ "$(container_port "$NAME")" = "$PORT" ] || return 1
  [ "$(container_volume "$NAME")" = "$VOLUME" ] || return 1
}

run_container() {
  set -- run -d \
    --name "$NAME" \
    --restart unless-stopped \
    --init \
    -p "127.0.0.1:$PORT:3080" \
    -v "$VOLUME:/app/data" \
    --add-host host.docker.internal:host-gateway \
    --label org.zoveli.installer=docker \
    --label "org.zoveli.version=$VERSION" \
    -e HOST=0.0.0.0 \
    -e PORT=3080 \
    -e "ZOVELI_OLLAMA_URL=${ZOVELI_OLLAMA_URL:-http://host.docker.internal:11434}"

  # Forward optional provider and runtime settings from the environment. The
  # values are never written to disk or printed by this script.
  for var in \
    ZOVELI_PROVIDER ZOVELI_MODEL ZOVELI_API_KEY ZOVELI_API_BASE ZOVELI_API_TOKEN \
    ZOVELI_MAX_TOKENS ZOVELI_OLLAMA_MODEL ZOVELI_AUTH_REQUIRED ZOVELI_ALLOWED_HOSTS \
    ANTHROPIC_API_KEY OPENAI_API_KEY DEEPSEEK_API_KEY OPENROUTER_API_KEY GROQ_API_KEY \
    TOGETHER_API_KEY MATHCORE_VERIFIERS MATHCORE_TRUSTED_KB; do
    if env | grep -q "^${var}="; then
      set -- "$@" -e "$var"
    fi
  done

  set -- "$@" "$IMAGE"
  "$DOCKER_BIN" "$@"
}

wait_healthy() {
  if [ "$WAIT_HEALTH" != true ]; then
    return 0
  fi
  waited=0
  while [ "$waited" -lt 120 ]; do
    [ "$(container_state "$NAME")" = "running" ] || return 1
    status=$(container_health "$NAME")
    case "$status" in
      healthy) return 0 ;;
      unhealthy) return 1 ;;
      none)
        if "$DOCKER_BIN" exec "$NAME" node -e \
          "fetch('http://127.0.0.1:3080/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))" \
          >/dev/null 2>&1; then
          return 0
        fi
        ;;
    esac
    sleep 2
    waited=$((waited + 2))
  done
  return 1
}

print_logs() {
  if container_exists "$NAME"; then
    "$DOCKER_BIN" logs --tail 40 "$NAME" >&2 || true
  fi
}

rollback() {
  error "The new container did not become healthy."
  print_logs
  "$DOCKER_BIN" rm -f "$NAME" >/dev/null 2>&1 || true
  if container_exists "${NAME}-previous"; then
    "$DOCKER_BIN" rename "${NAME}-previous" "$NAME" || die "Upgrade failed and the previous container could not be restored."
    "$DOCKER_BIN" start "$NAME" >/dev/null 2>&1 \
      || die "Upgrade failed and the previous container could not be restarted."
    if wait_healthy; then
      warn "Rolled back to the previous container."
    else
      warn "Rolled back to the previous container, but it is not healthy yet."
    fi
  fi
  die "Upgrade failed."
}

print_done() {
  version=$(image_version "$IMAGE")
  printf '\nZoveli %s is running at http://127.0.0.1:%s\n' "$version" "$PORT"
  printf 'Container:\n  %s\n' "$NAME"
  printf 'Data volume:\n  %s (kept on uninstall)\n' "$VOLUME"
  printf 'Check:\n  curl -fsSL %s | sh -s -- --check\n' "$SCRIPT_URL"
  printf 'Upgrade:\n  re-run this installer\n'
  printf 'Uninstall:\n  curl -fsSL %s | sh -s -- --uninstall --yes\n' "$SCRIPT_URL"
}

report() {
  printf 'Docker: %s\n' "$SERVER_VERSION"
  if ! container_exists "$NAME"; then
    printf 'Container: %s (not installed)\n' "$NAME"
    printf 'URL: http://127.0.0.1:%s\n' "$PORT"
    return 0
  fi
  if ! is_managed "$NAME"; then
    warn "Container $NAME exists but is not managed by this installer."
    printf 'State: %s\n' "$(container_state "$NAME")"
    return 0
  fi

  state=$(container_state "$NAME")
  health=$(container_health "$NAME")
  case "$health" in
    none|unknown) printf 'Container: %s (%s)\n' "$NAME" "$state" ;;
    *) printf 'Container: %s (%s, %s)\n' "$NAME" "$state" "$health" ;;
  esac

  installed_image_id=$(container_image_id "$NAME")
  installed_version=$(image_version "$installed_image_id" "")
  if [ -z "$installed_version" ]; then
    installed_version=$("$DOCKER_BIN" inspect \
      -f '{{index .Config.Labels "org.zoveli.version"}}' "$NAME" 2>/dev/null || true)
  fi
  case "$installed_version" in
    ''|'<no value>') installed_version=unknown ;;
  esac
  installed_port=$(container_port "$NAME")
  printf 'Installed: Zoveli %s\n' "$installed_version"
  printf 'Image: %s\n' "$(container_image_ref "$NAME")"
  printf 'Host port: %s\n' "$installed_port"
  printf 'URL: http://127.0.0.1:%s\n' "$installed_port"
  printf 'Data volume: %s\n' "$(container_volume "$NAME")"
}

confirm() {
  message=$1
  if [ "$ASSUME_YES" = true ]; then
    return 0
  fi
  if [ -t 0 ]; then
    printf '%s [y/N] ' "$message"
    read -r answer || answer=""
    case "$answer" in
      [yY]|[yY][eE][sS]) return 0 ;;
      *) die "Aborted." ;;
    esac
  fi
  die "Refusing to continue without --yes when stdin is not a terminal."
}

uninstall() {
  [ -n "$VOLUME" ] || VOLUME="$NAME-data"
  installed_volume=$VOLUME

  if container_exists "$NAME"; then
    if ! is_managed "$NAME"; then
      die "Container $NAME exists but is not managed by this installer; refusing to remove it."
    fi
    container_data_volume=$(container_volume "$NAME")
    if [ -n "$container_data_volume" ]; then
      installed_volume=$container_data_volume
    fi
    confirm "Remove the Zoveli container '$NAME'? The data volume '$installed_volume' is preserved."
    "$DOCKER_BIN" rm -f "$NAME" >/dev/null || die "Could not remove container $NAME."
    info "Removed container $NAME"
  else
    info "No Zoveli Docker container named $NAME."
  fi

  if container_exists "${NAME}-previous" && is_managed "${NAME}-previous"; then
    "$DOCKER_BIN" rm -f "${NAME}-previous" >/dev/null 2>&1 || true
  fi

  if [ "$PURGE" = true ]; then
    if "$DOCKER_BIN" volume inspect "$installed_volume" >/dev/null 2>&1; then
      confirm "Delete the Zoveli data volume '$installed_volume'? This cannot be undone."
      "$DOCKER_BIN" volume rm "$installed_volume" >/dev/null \
        || die "Could not remove volume $installed_volume; stop any container using it first."
      info "Purged data volume $installed_volume"
    else
      info "No data volume named $installed_volume."
    fi
  else
    info "Preserved data volume $installed_volume."
    info "Use --purge to delete it as well."
  fi
}

main() {
  require_docker

  if [ "$CHECK" = true ]; then
    report
    return 0
  fi

  if [ "$UNINSTALL" = true ]; then
    uninstall
    return 0
  fi

  # Re-running the one-liner must keep an existing install's port and volume.
  # Explicit --port/--volume flags still override; a fresh install gets the
  # defaults.
  if container_exists "$NAME" && is_managed "$NAME"; then
    if [ "$VOLUME_SET" != true ]; then
      existing_volume=$(container_volume "$NAME")
      if [ -n "$existing_volume" ]; then
        VOLUME=$existing_volume
      fi
    fi
    if [ "$PORT_SET" != true ]; then
      existing_port=$(container_port "$NAME")
      if [ -n "$existing_port" ]; then
        PORT=$existing_port
      fi
    fi
  fi
  [ -n "$VOLUME" ] || VOLUME="$NAME-data"
  case "$VOLUME" in
    *[!A-Za-z0-9_.-]*) die "Invalid volume name: $VOLUME" ;;
  esac

  resolve_image

  if container_exists "$NAME"; then
    if ! is_managed "$NAME"; then
      die "Container $NAME exists but is not managed by this installer. Choose another --name or remove it first."
    fi

    if [ "$FORCE" != true ] && container_matches; then
      if [ "$(container_state "$NAME")" = "running" ]; then
        info "Zoveli Docker container '$NAME' is already installed."
        print_done
        return 0
      fi
      info "Starting existing Zoveli container '$NAME'"
      "$DOCKER_BIN" start "$NAME" >/dev/null || die "Could not start container $NAME."
      if wait_healthy; then
        print_done
        return 0
      fi
      error "The existing container did not become healthy."
      print_logs
      die "Container $NAME is not healthy. Check the logs above."
    fi

    info "Replacing Zoveli container '$NAME'"
    if container_exists "${NAME}-previous"; then
      if is_managed "${NAME}-previous"; then
        "$DOCKER_BIN" rm -f "${NAME}-previous" >/dev/null 2>&1 \
          || die "Could not remove the previous container ${NAME}-previous."
      else
        die "Container ${NAME}-previous exists but is not managed by this installer."
      fi
    fi
    "$DOCKER_BIN" stop "$NAME" >/dev/null 2>&1 || true
    if ! "$DOCKER_BIN" rename "$NAME" "${NAME}-previous"; then
      "$DOCKER_BIN" start "$NAME" >/dev/null 2>&1 || true
      die "Could not prepare the existing container for replacement."
    fi
    if ! run_container; then
      "$DOCKER_BIN" rm -f "$NAME" >/dev/null 2>&1 || true
      if "$DOCKER_BIN" rename "${NAME}-previous" "$NAME" >/dev/null 2>&1; then
        "$DOCKER_BIN" start "$NAME" >/dev/null 2>&1 || true
        die "Could not start the new container. The previous container was restored."
      fi
      die "Could not start the new container, and the previous container could not be restored; it remains as ${NAME}-previous."
    fi
    if wait_healthy; then
      "$DOCKER_BIN" rm -f "${NAME}-previous" >/dev/null 2>&1 || true
      info "Upgraded Zoveli in container '$NAME'"
      print_done
      return 0
    fi
    rollback
  fi

  info "Installing Zoveli in Docker container '$NAME'"
  if ! run_container; then
    "$DOCKER_BIN" rm -f "$NAME" >/dev/null 2>&1 || true
    die "Could not start container $NAME. Check whether port $PORT is already in use."
  fi
  if ! wait_healthy; then
    error "The container did not become healthy."
    print_logs
    "$DOCKER_BIN" rm -f "$NAME" >/dev/null 2>&1 || true
    die "Installation failed; the container was removed."
  fi
  print_done
}

main "$@"
