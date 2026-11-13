#!/bin/sh
# Every headless test here, against whichever Godot `GODOT` names (the macOS
# app where it is unset), with desks served by the desk app's own serving code
# (`examples/desk.rs` in the native shell's crate) for the tests that reach one.
# A script error leaves Godot running rather than failing it, so a test passes
# only by saying so, and --quit-after ends the rest.
set -u
GODOT="${GODOT:-/Applications/Godot.app/Contents/MacOS/Godot}"
cd "$(dirname "$0")/.."
tauri="$(pwd)/../native/src-tauri"

scratch="$(mktemp -d)"
desks=""
trap 'exec 2>/dev/null; for one in $desks; do kill "$one"; done; wait; rm -rf "$scratch"' EXIT

echo "Building the test desk…"
if ! (cd "$tauri" && cargo build --quiet --example desk) > "$scratch/desk-build.log" 2>&1; then
  cat "$scratch/desk-build.log"
  exit 1
fi
desk="$tauri/target/debug/examples/desk"

# serve <name> <code> [tags] [mute]: a desk serving one project called <name>,
# its second note carrying the tags named, showing <code>, or none where it is
# -, with no speech set up where it is mute; ended on exit.
# ticket <name> prints its ticket.
serve() {
  "$desk" "$1" "$2" "$scratch/$1-kept" "${3:-}" "${4:-}" > "$scratch/$1.json" 2> "$scratch/$1.err" &
  desks="$desks $!"
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    [ -s "$scratch/$1.json" ] && return
    sleep 1
  done
  echo "The desk $1 did not start:"
  cat "$scratch/$1.err"
  exit 1
}
ticket() {
  sed -n 's/.*"ticket":"\([^"]*\)".*/\1/p' "$scratch/$1.json"
}

serve garden 042917
# A second desk no test pairs with before views_test does.
serve orchard 318406 fruit,trees
# A desk showing no code.
serve shed -
# A desk with no speech set up.
serve barn 527361 "" mute
SLOPPY_DESK="$(ticket garden)"
SLOPPY_DESK_CODE=042917
SLOPPY_FRESH_DESK="$(ticket orchard)"
SLOPPY_FRESH_DESK_CODE=318406
SLOPPY_RESTING_DESK="$(ticket shed)"
SLOPPY_MUTE_DESK="$(ticket barn)"
SLOPPY_MUTE_DESK_CODE=527361
export SLOPPY_DESK SLOPPY_DESK_CODE SLOPPY_FRESH_DESK SLOPPY_FRESH_DESK_CODE SLOPPY_RESTING_DESK
export SLOPPY_MUTE_DESK SLOPPY_MUTE_DESK_CODE

# The first open of the project is what loads IrohLink; --script alone never
# does. Godot 4.7.2 crashes on quitting the first headless import of a project
# that loads a GDExtension, once the import is written; the second passes, so
# its answer is the one that counts.
if ! { "$GODOT" --headless --import --path . > "$scratch/import.log" 2>&1; } 2>/dev/null; then
  if ! "$GODOT" --headless --import --path . > "$scratch/import.log" 2>&1; then
    cat "$scratch/import.log"
    echo "The project did not import."
    exit 1
  fi
fi

failed=0
# link_test pairs on the code, so it runs before any other test has paired.
for test in tests/link_test.gd $(ls tests/*_test.gd | grep -v link_test); do
  name="$(basename "$test" .gd)"
  said="$("$GODOT" --headless --xr-mode off --max-fps 60 --quit-after 2000 --path . --script "res://$test" 2>&1)"
  if printf '%s\n' "$said" | grep -q "^$name: passed$"; then
    echo "$name: passed"
  else
    printf '%s\n' "$said" | grep -v "OpenXR-Loader"
    failed=1
  fi
done
exit "$failed"
