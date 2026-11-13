#!/bin/sh
# Builds the web view plugin (android/plugins/sloppy_webview) with its own
# pinned Gradle, runs its unit tests, and puts its two libraries in
# addons/sloppy_webview/bin/, where the export plugin hands them to an Android
# export. Needs a JDK 17 (JAVA_HOME, or Homebrew's openjdk@17) and an Android
# SDK with NDK 29 (ANDROID_HOME, or ~/Library/Android/sdk).
set -eu
here="$(cd "$(dirname "$0")/.." && pwd)"
plugin="$here/android/plugins/sloppy_webview"
bin="$here/addons/sloppy_webview/bin"

if [ -z "${JAVA_HOME:-}" ] && [ -d /opt/homebrew/opt/openjdk@17 ]; then
  JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
fi
ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export JAVA_HOME ANDROID_HOME

cd "$plugin"
./gradlew --quiet --console=plain testDebugUnitTest assembleDebug assembleRelease
mkdir -p "$bin"
cp build/outputs/aar/sloppy_webview-debug.aar "$bin/"
cp build/outputs/aar/sloppy_webview-release.aar "$bin/"
echo "addons/sloppy_webview/bin/ holds the web view plugin."
