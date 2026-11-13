#!/bin/sh
# Puts the palette's glyphs into icons/, from the Lucide release this project is
# pinned to, with its licence beside them; icons/README.md names them.
set -eu
RELEASE="1.72.0"
GLYPHS="arrow-left blend bookmark bookmark-minus chevron-down chevron-right chevron-up circle eye folder-open git-branch hand heading image layout-panel-top link log-out message-square monitor moon network palette pen-line plus rows-3 sparkles spline square sun sun-dim telescope type undo-2 unfold-horizontal unplug zoom-in"
here="$(cd "$(dirname "$0")/.." && pwd)"
held="$(mktemp -d)"
trap 'rm -rf "$held"' EXIT
curl -fsSL "https://registry.npmjs.org/lucide-static/-/lucide-static-$RELEASE.tgz" | tar -xz -C "$held"
find "$here/icons" -type f ! -name README.md -delete 2>/dev/null || true
mkdir -p "$here/icons"
cp "$held/package/LICENSE" "$here/icons/LICENSE"
for glyph in $GLYPHS; do
  cp "$held/package/icons/$glyph.svg" "$here/icons/$glyph.svg"
  # Read as words and drawn at the size each row needs, so kept as they are.
  printf '[remap]\n\nimporter="keep"\n' > "$here/icons/$glyph.svg.import"
done
echo "Lucide $RELEASE's glyphs are in icons/."
