#!/bin/sh
#
# Acceptance test for install/install-docker.sh.
#
# Runs the Docker fallback installer against a locally built browser-UI image
# and verifies help, fail-early behavior, clean install, health, idempotency,
# volume persistence, upgrade replacement, rollback, uninstall, and purge.
#
# The image must already exist locally:
#
#   docker build -t zoveli-web:acceptance .
#   sh scripts/docker-acceptance.sh --image zoveli-web:acceptance
#
# Used by the Installer Check workflow on native amd64 and arm64 runners.
set -eu

ROOT=$(CDPATH='' cd "$(dirname "$0")/.." && pwd)
INSTALLER="$ROOT/install/install-docker.sh"
DOCKER_BIN="${DOCKER_BIN:-docker}"
IMAGE="zoveli-web:acceptance"
NAME="zoveli-acceptance-$$"
PORT="18080"
VOLUME=""
KEEP=false
SANDBOX=""
SUCCESS=false

usage() {
  cat <<EOF
Usage: sh scripts/docker-acceptance.sh [options]
  --image <ref>   Local browser-UI image to test (default: $IMAGE)
  --name <name>   Container name prefix (default: zoveli-acceptance-\$\$)
  --port <port>   Host port to bind on 127.0.0.1 (default: 18080)
  --keep          Keep the temporary log directory after success
  -h, --help      Show this help
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --image)
      [ $# -ge 2 ] || { echo "--image requires a value" >&2; exit 2; }
      IMAGE=$2
      shift 2
      ;;
    --name)
      [ $# -ge 2 ] || { echo "--name requires a value" >&2; exit 2; }
      NAME=$2
      shift 2
      ;;
    --port)
      [ $# -ge 2 ] || { echo "--port requires a value" >&2; exit 2; }
      PORT=$2
      shift 2
      ;;
    --keep) KEEP=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[ -n "$VOLUME" ] || VOLUME="${NAME}-vol"
BLOCKER_NAME="${NAME}-blocker"
BLOCKER_PORT=$((PORT + 1))
if [ "$BLOCKER_PORT" -gt 65535 ]; then
  BLOCKER_PORT=$((PORT - 1))
fi

UPGRADE_IMAGE="${NAME}-upgrade:local"
BROKEN_HEALTH_IMAGE="${NAME}-broken-health:local"

pass() { printf '[pass] %s\n' "$1"; }
fail() { printf '[FAIL] %s\n' "$1" >&2; exit 1; }

cleanup() {
  "$DOCKER_BIN" rm -f "$NAME" "${NAME}-previous" "$BLOCKER_NAME" >/dev/null 2>&1 || true
  "$DOCKER_BIN" volume rm "$VOLUME" "${NAME}-data" >/dev/null 2>&1 || true
  "$DOCKER_BIN" rmi -f "$UPGRADE_IMAGE" "$BROKEN_HEALTH_IMAGE" \
    >/dev/null 2>&1 || true
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
SANDBOX=$(mktemp -d "${TMPDIR:-/tmp}/zoveli-docker-acceptance.XXXXXX")

sh -n "$INSTALLER" || fail "install-docker.sh has a syntax error"
pass "syntax"

sh "$INSTALLER" --help > "$SANDBOX/help.txt" 2>&1 || fail "install-docker.sh --help failed"
grep -q -- '--uninstall' "$SANDBOX/help.txt" || fail "help does not mention --uninstall"
grep -q -- '--purge' "$SANDBOX/help.txt" || fail "help does not mention --purge"
grep -q -- '--check' "$SANDBOX/help.txt" || fail "help does not mention --check"
pass "help"

if DOCKER_BIN="$SANDBOX/no-such-docker" sh "$INSTALLER" --check \
  > "$SANDBOX/missing-docker.txt" 2>&1; then
  fail "installer did not fail when Docker was missing"
fi
grep -q 'Missing required command' "$SANDBOX/missing-docker.txt" \
  || fail "missing-Docker error was unclear"
pass "missing-docker-fails-early"

command -v "$DOCKER_BIN" >/dev/null 2>&1 || fail "Docker command not found: $DOCKER_BIN"
"$DOCKER_BIN" info >/dev/null 2>&1 || fail "Docker daemon is not reachable"
"$DOCKER_BIN" image inspect "$IMAGE" >/dev/null 2>&1 \
  || fail "image not found: $IMAGE (build it with: docker build -t $IMAGE .)"

sh "$INSTALLER" --check --name "$NAME" \
  > "$SANDBOX/check-before.txt" 2>&1 || fail "installer --check failed before install"
grep -q "(not installed)" "$SANDBOX/check-before.txt" \
  || fail "--check did not report an empty install"
pass "check-before"

sh "$INSTALLER" --yes --image "$IMAGE" --name "$NAME" --volume "$VOLUME" --port "$PORT" \
  > "$SANDBOX/install.txt" 2>&1 \
  || { cat "$SANDBOX/install.txt" >&2; fail "clean install failed"; }
grep -q "http://127.0.0.1:$PORT" "$SANDBOX/install.txt" || fail "install did not print the URL"
[ "$("$DOCKER_BIN" inspect -f '{{index .Config.Labels "org.zoveli.installer"}}' "$NAME")" = "docker" ] \
  || fail "container is missing the installer label"
[ "$("$DOCKER_BIN" inspect -f '{{range .Mounts}}{{if eq .Destination "/app/data"}}{{.Name}}{{end}}{{end}}' "$NAME")" = "$VOLUME" ] \
  || fail "container is not using the expected data volume"
[ "$("$DOCKER_BIN" inspect -f '{{range $p, $b := .HostConfig.PortBindings}}{{range $b}}{{.HostPort}}{{end}}{{end}}' "$NAME")" = "$PORT" ] \
  || fail "container is not publishing the expected host port"
"$DOCKER_BIN" exec "$NAME" node -e \
  "fetch('http://127.0.0.1:3080/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))" \
  || fail "health endpoint is not OK"
pass "clean-install-healthy"

sh "$INSTALLER" --check --name "$NAME" > "$SANDBOX/check-after.txt" 2>&1 \
  || fail "installer --check failed after install"
grep -q 'Installed: Zoveli' "$SANDBOX/check-after.txt" || fail "--check did not report an install"
grep -q 'healthy' "$SANDBOX/check-after.txt" || fail "--check did not report healthy state"
pass "check-after"

container_before=$("$DOCKER_BIN" inspect -f '{{.Id}}' "$NAME")
sh "$INSTALLER" --yes --image "$IMAGE" --name "$NAME" --volume "$VOLUME" --port "$PORT" \
  > "$SANDBOX/reinstall.txt" 2>&1 \
  || { cat "$SANDBOX/reinstall.txt" >&2; fail "second install failed"; }
grep -q 'already installed' "$SANDBOX/reinstall.txt" || fail "second install was not idempotent"
[ "$("$DOCKER_BIN" inspect -f '{{.Id}}' "$NAME")" = "$container_before" ] \
  || fail "idempotent rerun replaced the container"
pass "idempotent-second-run"

"$DOCKER_BIN" exec "$NAME" sh -c 'printf keep > /app/data/acceptance-marker' \
  || fail "could not write a marker into the data volume"

"$DOCKER_BIN" commit "$NAME" "$UPGRADE_IMAGE" >/dev/null \
  || fail "could not create the upgrade test image"
# Deliberately omit --port and --volume: an upgrade must inherit them from the
# existing container instead of silently moving to the defaults.
sh "$INSTALLER" --yes --image "$UPGRADE_IMAGE" --name "$NAME" \
  > "$SANDBOX/upgrade.txt" 2>&1 \
  || { cat "$SANDBOX/upgrade.txt" >&2; fail "upgrade replacement failed"; }
grep -q 'Upgraded Zoveli' "$SANDBOX/upgrade.txt" || fail "upgrade did not report replacement"
[ "$("$DOCKER_BIN" inspect -f '{{.Image}}' "$NAME")" = "$("$DOCKER_BIN" image inspect -f '{{.Id}}' "$UPGRADE_IMAGE")" ] \
  || fail "upgrade did not switch to the new image"
[ "$("$DOCKER_BIN" inspect -f '{{range .Mounts}}{{if eq .Destination "/app/data"}}{{.Name}}{{end}}{{end}}' "$NAME")" = "$VOLUME" ] \
  || fail "upgrade did not keep the existing data volume"
[ "$("$DOCKER_BIN" inspect -f '{{range $p, $b := .HostConfig.PortBindings}}{{range $b}}{{.HostPort}}{{end}}{{end}}' "$NAME")" = "$PORT" ] \
  || fail "upgrade did not keep the existing host port"
"$DOCKER_BIN" exec "$NAME" test -f /app/data/acceptance-marker \
  || fail "upgrade lost the data volume contents"
if "$DOCKER_BIN" container inspect "${NAME}-previous" >/dev/null 2>&1; then
  fail "upgrade left the previous container behind"
fi
pass "upgrade-replaces-and-keeps-data"

"$DOCKER_BIN" commit --change 'CMD ["node", "-e", "process.exit(1)"]' "$NAME" "$BROKEN_HEALTH_IMAGE" \
  >/dev/null || fail "could not create the unhealthy test image"
if sh "$INSTALLER" --yes --image "$BROKEN_HEALTH_IMAGE" --name "$NAME" --volume "$VOLUME" --port "$PORT" \
  > "$SANDBOX/rollback.txt" 2>&1; then
  fail "installer accepted a container that never becomes healthy"
fi
grep -q 'Rolled back' "$SANDBOX/rollback.txt" || fail "unhealthy upgrade did not roll back"
[ "$("$DOCKER_BIN" inspect -f '{{.State.Status}}' "$NAME")" = "running" ] \
  || fail "rollback left the previous container stopped"
"$DOCKER_BIN" exec "$NAME" node -e \
  "fetch('http://127.0.0.1:3080/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))" \
  || fail "rollback container is not healthy"
"$DOCKER_BIN" exec "$NAME" test -f /app/data/acceptance-marker \
  || fail "rollback lost the data volume contents"
pass "unhealthy-upgrade-rolls-back"

# Occupy the target port so `docker run` itself fails. The previous container
# uses a different port, so it must be renamed back and started successfully.
"$DOCKER_BIN" run -d --name "$BLOCKER_NAME" -p "127.0.0.1:$BLOCKER_PORT:3080" "$IMAGE" \
  >/dev/null || fail "could not start the port blocker"
if sh "$INSTALLER" --yes --image "$IMAGE" --name "$NAME" --volume "$VOLUME" --port "$BLOCKER_PORT" \
  > "$SANDBOX/run-failure.txt" 2>&1; then
  fail "installer accepted a host port that is already in use"
fi
grep -q 'previous container was restored' "$SANDBOX/run-failure.txt" \
  || fail "start failure did not restore the previous container"
"$DOCKER_BIN" rm -f "$BLOCKER_NAME" >/dev/null 2>&1 || true
[ "$("$DOCKER_BIN" inspect -f '{{.State.Status}}' "$NAME")" = "running" ] \
  || fail "start failure left the previous container stopped"
"$DOCKER_BIN" exec "$NAME" node -e \
  "fetch('http://127.0.0.1:3080/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))" \
  || fail "restored container is not healthy"
pass "start-failure-restores-previous"

if sh "$INSTALLER" --uninstall --name "$NAME" </dev/null \
  > "$SANDBOX/uninstall-refused.txt" 2>&1; then
  fail "uninstall succeeded without --yes on a non-interactive stdin"
fi
grep -q 'Refusing to continue without --yes' "$SANDBOX/uninstall-refused.txt" \
  || fail "uninstall refusal was unclear"
[ "$("$DOCKER_BIN" inspect -f '{{.State.Status}}' "$NAME")" = "running" ] \
  || fail "refused uninstall still stopped the container"
pass "uninstall-requires-confirmation"

# Omit --volume here: the installer must derive the real volume from the
# container so that --purge deletes the correct one.
sh "$INSTALLER" --uninstall --yes --name "$NAME" > "$SANDBOX/uninstall.txt" 2>&1 \
  || { cat "$SANDBOX/uninstall.txt" >&2; fail "uninstall failed"; }
if "$DOCKER_BIN" container inspect "$NAME" >/dev/null 2>&1; then
  fail "uninstall left the container behind"
fi
"$DOCKER_BIN" volume inspect "$VOLUME" >/dev/null 2>&1 \
  || fail "uninstall deleted the data volume without --purge"
pass "uninstall-preserves-volume"

sh "$INSTALLER" --yes --image "$IMAGE" --name "$NAME" --volume "$VOLUME" --port "$PORT" \
  > "$SANDBOX/reinstall-after-uninstall.txt" 2>&1 \
  || { cat "$SANDBOX/reinstall-after-uninstall.txt" >&2; fail "reinstall after uninstall failed"; }
"$DOCKER_BIN" exec "$NAME" test -f /app/data/acceptance-marker \
  || fail "reinstall did not preserve the data volume contents"
pass "reinstall-keeps-data"

sh "$INSTALLER" --uninstall --yes --purge --name "$NAME" > "$SANDBOX/purge.txt" 2>&1 \
  || { cat "$SANDBOX/purge.txt" >&2; fail "purge failed"; }
if "$DOCKER_BIN" container inspect "$NAME" >/dev/null 2>&1; then
  fail "purge left the container behind"
fi
if "$DOCKER_BIN" volume inspect "$VOLUME" >/dev/null 2>&1; then
  fail "purge left the data volume behind"
fi
pass "purge-removes-container-and-volume"

# With no container left, --purge must still resolve the default volume name.
"$DOCKER_BIN" volume create "${NAME}-data" >/dev/null \
  || fail "could not create the default-name volume"
sh "$INSTALLER" --uninstall --yes --purge --name "$NAME" \
  > "$SANDBOX/purge-default.txt" 2>&1 \
  || { cat "$SANDBOX/purge-default.txt" >&2; fail "default-volume purge failed"; }
if "$DOCKER_BIN" volume inspect "${NAME}-data" >/dev/null 2>&1; then
  fail "purge did not remove the default data volume without a container"
fi
pass "purge-default-volume-without-container"

SUCCESS=true
printf 'docker acceptance: PASS\n'
