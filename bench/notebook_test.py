"""Executes analysis.ipynb, and export_figures.py, over mock records of two subjects in a temporary results folder, and over an empty one."""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import nbformat
from nbconvert.preprocessors import ExecutePreprocessor

BENCH = Path(__file__).resolve().parent


def node(*args, env):
    subprocess.run(["node", "bench.mjs", *args], cwd=BENCH, env=env, check=True)


def export(results, out):
    done = subprocess.run([sys.executable, "export_figures.py", str(results), str(out)], cwd=BENCH, check=True,
                          capture_output=True, text=True)
    manifest = json.loads(done.stdout.strip().splitlines()[-1])
    for figure in manifest:
        svg = out.parent / figure["file"]
        if not svg.exists() or "<svg" not in svg.read_text()[:500]:
            sys.exit(f"export_figures.py listed {figure['file']} and did not draw it.")
    return manifest


def execute(results):
    nb = nbformat.read(BENCH / "analysis.ipynb", as_version=4)
    os.environ["BENCH_RESULTS"] = str(results)
    ExecutePreprocessor(timeout=600, kernel_name="python3").preprocess(nb, {"metadata": {"path": str(BENCH)}})
    errors = [o for c in nb.cells if c.cell_type == "code" for o in c.get("outputs", []) if o.get("output_type") == "error"]
    if errors:
        sys.exit(f"The notebook raised over {results}: {errors[0]['ename']}: {errors[0]['evalue']}")
    figures = sum(1 for c in nb.cells if c.cell_type == "code" for o in c.get("outputs", []) if "image/png" in o.get("data", {}))
    text = json.dumps([o for c in nb.cells if c.cell_type == "code" for o in c.get("outputs", [])], ensure_ascii=False)
    return figures, text


def make_subject(root):
    """A throwaway project with documents, a container and two commits, and a subject file for it."""
    for rel, text in {
        "AI.md": "# Rules\nThe ref identifies a note.\n",
        "docs/ARCHITECTURE.md": "# Architecture\n",
        ".sloppy/graph.json": "{}\n",
        ".mcp.json": "{}\n",
        "README.md": "# Subject\n",
        "src/a.js": "export const a = 1;\n",
    }.items():
        (root / rel).parent.mkdir(parents=True, exist_ok=True)
        (root / rel).write_text(text)
    git = ["git", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "-c", "user.name=t", "-c", "user.email=t@t"]
    subprocess.run([*git, "init", "-q", "-b", "main"], cwd=root, check=True)
    subprocess.run([*git, "add", "-A"], cwd=root, check=True)
    subprocess.run([*git, "commit", "-q", "-m", "one"], cwd=root, check=True)
    return {
        "path": str(root),
        "default_pack": "example",
        "sloppy_cli": str(BENCH.parent / "packages/ts/cli/dist/sloppy.mjs"),
        "docs": ["docs", "AI.md"],
        "container": ".sloppy",
        "mcp_file": ".mcp.json",
        "context_links": ["AI.md"],
        "pointed": ["AI.md"],
        "dump": ["AI.md", "docs/ARCHITECTURE.md"],
    }


with tempfile.TemporaryDirectory(prefix="sloppy-bench-nb-") as tmp:
    results = Path(tmp) / "results"
    work = Path(tmp) / "work"
    env = {**os.environ, "SLOPPY_BENCH_WORK": str(work)}
    project = Path(tmp) / "project"
    project.mkdir()
    config = json.dumps(make_subject(project))
    first, second = Path(tmp) / "first.json", Path(tmp) / "second.json"
    first.write_text(config)
    second.write_text(config)
    for name, seed in (("shipped", "1"), ("quiet", "2")):
        node("run", "--backend", "mock", "--subject", str(first), "--conditions", "bare,mcp,nodocs,agents,mcp+agents",
             "--reps", "2", "--seed", seed, "--budget-usd", "5", "--config", name, "--out", str(results), env=env)
    node("run", "--backend", "mock", "--subject", str(second), "--conditions", "bare,mcp,nodocs",
         "--reps", "2", "--seed", "3", "--budget-usd", "5", "--out", str(results), env=env)
    node("judge", "--judge-backend", "mock", "--out", str(results), env=env)
    figures, text = execute(results)
    print(f"mock results: the notebook ran and drew {figures} figures")
    if figures < 12:
        sys.exit(f"Expected at least 12 figures over mock records, drew {figures}.")
    for subject in ("first", "second"):
        if f"{subject} · mock" not in text:
            sys.exit(f"No panel of the notebook names the subject {subject}.")
    for part in ("Sent: model", "Timeline:", "Transcript: 2 events", "Answer:"):
        if part not in text:
            sys.exit(f"show_run did not print {part!r} for the latest mock run.")

    manifest = export(results, Path(tmp) / "export" / "figures")
    drawn = sorted(f["id"] for f in manifest)
    print(f"mock results: export_figures.py drew {drawn}")
    if drawn != ["best-and-mean", "context-curve", "cost-context", "time-per-query"]:
        sys.exit(f"Expected the four single-model figures over mock records, drew {drawn}.")

    empty = Path(tmp) / "empty"
    empty.mkdir()
    figures, _ = execute(empty)
    print(f"no results: the notebook ran and drew {figures} figures")
    manifest = export(empty, Path(tmp) / "export-empty" / "figures")
    print(f"no results: export_figures.py drew {len(manifest)} figures")
    if manifest:
        sys.exit("export_figures.py drew a figure over no records.")
