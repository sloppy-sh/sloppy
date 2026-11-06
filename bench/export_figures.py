"""Draws figures.FIGURES over a results folder as SVGs, and prints their manifest as one JSON line; export.mjs runs it."""
import json
import sys
from pathlib import Path

import matplotlib

matplotlib.use("svg")
import matplotlib.pyplot as plt  # noqa: E402

import figures  # noqa: E402

results, out = Path(sys.argv[1]), Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)
figures.configure()
runs = figures.load(results)
manifest = []
for fid, title, draw, caption in figures.FIGURES:
    fig = draw(runs)
    if fig is None:
        print(f"{fid}: nothing to draw", file=sys.stderr)
        continue
    fig.savefig(out / f"{fid}.svg", format="svg", metadata={"Date": None}, bbox_inches="tight")
    plt.close(fig)
    manifest.append({"id": fid, "title": title, "caption": caption, "file": f"{out.name}/{fid}.svg"})
print(json.dumps(manifest))
