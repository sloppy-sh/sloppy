#!/usr/bin/env bash
# Renders analysis.ipynb over results/ to results/analysis.html; --test runs it over mock records instead;
# --figures <results> <folder> draws the exported SVGs there and prints their manifest.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -x .venv/bin/python ]; then
  python3 -m venv .venv
fi
.venv/bin/pip install --quiet --disable-pip-version-check -r requirements.txt

if [ "${1:-}" = "--figures" ]; then
  exec .venv/bin/python export_figures.py "$2" "$3"
fi

if [ "${1:-}" = "--test" ]; then
  exec .venv/bin/python notebook_test.py
fi

.venv/bin/jupyter nbconvert --execute --to html analysis.ipynb --output-dir results --output analysis.html
echo "results/analysis.html"
