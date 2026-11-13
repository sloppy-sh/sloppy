#!/bin/sh
# Builds the page a note is read in (web/) into web/dist/index.html, one file
# holding everything it draws with; web/README.md says what it is.
set -eu
here="$(cd "$(dirname "$0")/.." && pwd)"
root="$(cd "$here/../../.." && pwd)"
cd "$root"
pnpm install --frozen-lockfile
pnpm --filter "@sloppy/vr-web..." run build
echo "web/dist/index.html is built."
