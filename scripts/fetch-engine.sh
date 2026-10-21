#!/bin/bash
# Download the signed, notarized engine zips that build_and_ship.sh made and
# that useboing.com already serves, into engine/arm64 and engine/x64.
#
# Override the source with ENGINE_ARM64_URL / ENGINE_X64_URL to test other builds.
set -euo pipefail

BASE="https://ahtyzoadtakiveauvpjy.supabase.co/storage/v1/object/public/downloads"
ARM="${ENGINE_ARM64_URL:-$BASE/Boing.zip}"
X64="${ENGINE_X64_URL:-$BASE/Boing-intel.zip}"

cd "$(dirname "$0")/.."
for pair in "arm64 $ARM" "x64 $X64"; do
  set -- $pair
  arch=$1; url=$2
  mkdir -p "engine/$arch"
  echo "==> $arch engine: $url"
  curl -fL --retry 3 -o "engine/$arch/Boing.zip" "$url"

  # Refuse a zip that isn't a signed, notarized Boing.app: shipping one would
  # either fail notarization or put an engine Gatekeeper blocks on people's Macs.
  tmp=$(mktemp -d)
  ditto -x -k "engine/$arch/Boing.zip" "$tmp"
  [ -d "$tmp/Boing.app" ] || { echo "ERROR: $url has no Boing.app at its top level"; exit 1; }
  codesign --verify --deep --strict "$tmp/Boing.app"
  xcrun stapler validate "$tmp/Boing.app"
  bin="$tmp/Boing.app/Contents/MacOS/Boing"
  want=$([ "$arch" = arm64 ] && echo arm64 || echo x86_64)
  lipo -archs "$bin" | grep -qw "$want" || { echo "ERROR: the $arch engine is built for $(lipo -archs "$bin")"; exit 1; }
  rm -rf "$tmp"
  echo "    ok: signed, notarized, $want"
done
