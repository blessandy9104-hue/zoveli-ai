#!/usr/bin/env bash
#
# Sign the portable macOS runtime and, optionally, a disk image, then submit
# the image for notarization and staple the ticket. Release-only: secrets are
# required. PR builds skip this script and publish unsigned artifacts.
#
# Required:
#   APPLE_SIGNING_IDENTITY       e.g. "Developer ID Application: Example (TEAMID)"
#   APPLE_CERTIFICATE_P12_BASE64 base64 of a .p12 containing the Developer ID
#   APPLE_CERTIFICATE_PASSWORD   password for the .p12
#
# Required with --notarize:
#   APPLE_ID, APPLE_TEAM_ID, APPLE_APP_PASSWORD
set -euo pipefail

RUNTIME=""
DMG=""
NOTARIZE=false

usage() {
  cat <<'EOF'
usage: sign-macos.sh --runtime DIR [--dmg FILE] [--notarize]
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --runtime) RUNTIME="${2:?--runtime requires a directory}"; shift 2 ;;
    --dmg) DMG="${2:?--dmg requires a file}"; shift 2 ;;
    --notarize) NOTARIZE=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[ -n "$RUNTIME" ] || { echo '--runtime is required' >&2; exit 2; }
[ -d "$RUNTIME" ] || { echo "runtime directory not found: $RUNTIME" >&2; exit 1; }
: "${APPLE_SIGNING_IDENTITY:?APPLE_SIGNING_IDENTITY is required}"
: "${APPLE_CERTIFICATE_P12_BASE64:?APPLE_CERTIFICATE_P12_BASE64 is required}"
: "${APPLE_CERTIFICATE_PASSWORD:?APPLE_CERTIFICATE_PASSWORD is required}"

TMP=$(mktemp -d "${TMPDIR:-/tmp}/zoveli-sign.XXXXXX")
KEYCHAIN="$TMP/zoveli-signing.keychain-db"
KEYCHAIN_PASSWORD=$(openssl rand -hex 24)
ORIGINAL_KEYCHAINS=()
while IFS= read -r keychain; do
  ORIGINAL_KEYCHAINS+=("$keychain")
done < <(security list-keychains -d user | tr -d '"')
ENTITLEMENTS="$TMP/entitlements.plist"

# The bundled Node runtime needs JIT and unsigned executable memory under the
# hardened runtime; the PyInstaller sidecar loads its own native libraries.
# Without these entitlements a signed runtime fails on first launch.
cat >"$ENTITLEMENTS" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.cs.disable-library-validation</key>
  <true/>
</dict>
</plist>
EOF

cleanup() {
  security delete-keychain "$KEYCHAIN" >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT INT TERM

printf '%s' "$APPLE_CERTIFICATE_P12_BASE64" | openssl base64 -d -A -out "$TMP/cert.p12"
security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
security set-keychain-settings -lut 21600 "$KEYCHAIN"
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
security import "$TMP/cert.p12" -k "$KEYCHAIN" -P "$APPLE_CERTIFICATE_PASSWORD" \
  -T /usr/bin/codesign -T /usr/bin/security
security set-key-partition-list -S apple-tool:,apple: -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN" >/dev/null
if [ "${#ORIGINAL_KEYCHAINS[@]}" -gt 0 ]; then
  security list-keychains -d user -s "$KEYCHAIN" "${ORIGINAL_KEYCHAINS[@]}"
else
  security list-keychains -d user -s "$KEYCHAIN"
fi

signed=0
while IFS= read -r -d '' file; do
  if file "$file" | grep -q 'Mach-O'; then
    codesign --force --options runtime --timestamp --entitlements "$ENTITLEMENTS" \
      --sign "$APPLE_SIGNING_IDENTITY" "$file"
    codesign --verify --strict --verbose=2 "$file"
    signed=$((signed + 1))
  fi
done < <(find "$RUNTIME" -type f -print0)

if [ "$signed" -eq 0 ]; then
  echo 'no Mach-O binaries were signed in the runtime' >&2
  exit 1
fi
echo "signed $signed Mach-O binaries in $RUNTIME"

if [ -n "$DMG" ]; then
  [ -f "$DMG" ] || { echo "disk image not found: $DMG" >&2; exit 1; }
  codesign --force --timestamp --sign "$APPLE_SIGNING_IDENTITY" "$DMG"
  codesign --verify --strict --verbose=2 "$DMG"
  echo "signed $DMG"
fi

if [ "$NOTARIZE" = true ]; then
  [ -n "$DMG" ] || { echo '--notarize needs --dmg' >&2; exit 2; }
  : "${APPLE_ID:?APPLE_ID is required for notarization}"
  : "${APPLE_TEAM_ID:?APPLE_TEAM_ID is required for notarization}"
  : "${APPLE_APP_PASSWORD:?APPLE_APP_PASSWORD is required for notarization}"
  xcrun notarytool submit "$DMG" \
    --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" \
    --password "$APPLE_APP_PASSWORD" --wait
  xcrun stapler staple "$DMG"
  xcrun stapler validate "$DMG"
  spctl -a -t open --context context:primary-signature -v "$DMG"
  echo "notarized and stapled $DMG"
fi
