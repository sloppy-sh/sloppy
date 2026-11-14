#!/bin/sh
# Puts the Godot OpenXR Vendors plugin into addons/, at the release this project
# is pinned to, which is made for Godot 4.6 and later.
set -eu
RELEASE="5.2.0-stable"
here="$(cd "$(dirname "$0")/.." && pwd)"
held="$(mktemp -d)"
trap 'rm -rf "$held"' EXIT
curl -fsSL -o "$held/addon.zip" \
  "https://github.com/GodotVR/godot_openxr_vendors/releases/download/$RELEASE/godotopenxrvendorsaddon.zip"
unzip -q "$held/addon.zip" -d "$held"
rm -rf "$here/addons/godotopenxrvendors"
mkdir -p "$here/addons"
cp -R "$held/asset/addons/godotopenxrvendors" "$here/addons/"
echo "OpenXR Vendors $RELEASE is in addons/godotopenxrvendors."
