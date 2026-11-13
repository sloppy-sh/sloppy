#!/bin/sh
# Puts the panels' theme packs into themes/, each at the commit this project is
# pinned to and with its licences beside it; themes/README.md names them.
set -eu
MATERIAL="TonyXdZ/godot-4-material-theme"
MATERIAL_AT="3e6e9f2f655c642d238cefbec14e592fdd17ac92"
THEMEY="wadlo/Themey"
THEMEY_AT="678c5574b3a9274437c0c1e0ac15395056b5fc5f"
FONTS="google/fonts"
FONTS_AT="15c1dd4d2cc8cbd363e2fa68c1b461d5519b17d0"
here="$(cd "$(dirname "$0")/.." && pwd)"
held="$(mktemp -d)"
trap 'rm -rf "$held"' EXIT

fetch() {
  mkdir -p "$held/$1"
  curl -fsSL "https://codeload.github.com/$2/tar.gz/$3" | tar -xz -C "$held/$1" --strip-components 1
}

# Each pack names its files from where it stood in its own project, and by ids
# only that project's import knew; here they are named from where they stand.
settle() {
  find "$1" -name '*.import' -delete
  find "$1" -name '*.tres' -exec sed -i.was -e "s#res://$2#res://themes/$3#g" -e 's# uid="uid://[a-z0-9]*"##g' {} +
  find "$1" -name '*.was' -delete
}

fetch material "$MATERIAL" "$MATERIAL_AT"
fetch themey "$THEMEY" "$THEMEY_AT"

for pack in material spacey clashy; do
  rm -rf "$here/themes/$pack"
done
mkdir -p "$here/themes"

cp -R "$held/material/theme" "$here/themes/material"
cp "$held/material/LICENSE" "$here/themes/material/LICENSE"
rm -f "$here/themes/material/build_theme.gd" "$here/themes/material/build_theme.gd.uid"
settle "$here/themes/material" "theme/" "material/"

for pack in spacey clashy; do
  cp -R "$held/themey/src/addons/Themey/themes/$pack" "$here/themes/$pack"
  cp "$held/themey/LICENSE" "$here/themes/$pack/LICENSE"
  cp "$held/themey/IMAGES_LICENSE" "$here/themes/$pack/IMAGES_LICENSE"
  settle "$here/themes/$pack" "addons/Themey/themes/" ""
done
mkdir -p "$here/themes/clashy/font/Acme"
curl -fsSL "https://raw.githubusercontent.com/$FONTS/$FONTS_AT/ofl/acme/OFL.txt" -o "$here/themes/clashy/font/Acme/OFL.txt"

echo "The panels' theme packs are in themes/."
