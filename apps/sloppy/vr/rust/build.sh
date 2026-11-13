#!/bin/sh
# Builds IrohLink for the editor on this Mac and for a Quest, and puts both
# libraries in bin/, where sloppy_iroh.gdextension names them. Android needs
# cargo-ndk and an NDK; ANDROID_NDK_HOME names one, or the newest under the SDK.
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
bin="$here/../bin"
mkdir -p "$bin"
cd "$here"

cargo build --release --target aarch64-apple-darwin
cp target/aarch64-apple-darwin/release/libsloppy_iroh.dylib "$bin/"
echo "bin/libsloppy_iroh.dylib is built."

if [ "${1:-}" = "--mac-only" ]; then exit 0; fi
if [ -z "${ANDROID_NDK_HOME:-}" ]; then
  ANDROID_NDK_HOME="$(ls -d "$HOME/Library/Android/sdk/ndk/"* 2>/dev/null | sort -V | tail -1)"
  export ANDROID_NDK_HOME
fi
cargo ndk -t arm64-v8a --platform 29 build --release
cp target/aarch64-linux-android/release/libsloppy_iroh.so "$bin/"
echo "bin/libsloppy_iroh.so is built."
