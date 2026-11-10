"""The figures analysis.ipynb and export_figures.py both draw, from the run records; README.md § "Reading the results"."""
import json
import zlib
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

BOOTSTRAP = 2000
SEED = 0

# figures.json holds Okabe-Ito's first six, then four of Tol's, all inside one lightness band; every
# figure pairs colour with a marker, so the closest pair under deuteranopia is never told apart by colour
# alone. The export hands the same file to a page.
_STYLE = json.loads((Path(__file__).resolve().parent / "figures.json").read_text())
PALETTE = _STYLE["palette"]
MARKERS = _STYLE["markers"]
CONDITION_ORDER = _STYLE["conditions"]
INPUT_CLASSES = ["input", "cache_write", "cache_read"]


def _shown_as():
    """A private subject's label by its name; README.md § "The export"."""
    shown = {}
    for file in (Path(__file__).resolve().parent / "subjects").glob("*.json"):
        subject = json.loads(file.read_text())
        if subject.get("private") is True:
            label = subject.get("label")
            shown[file.stem] = label if label and label != file.stem else "A private project"
    return shown


SHOWN_AS = _shown_as()


def read_jsonl(folder):
    rows = []
    for file in sorted(Path(folder).glob("*.jsonl")):
        for line in file.read_text().splitlines():
            if line.strip():
                row = json.loads(line)
                row["_file"] = file.name
                rows.append(row)
    return rows


def grades_by_run(grades):
    found = {}
    for g in grades:
        found.setdefault(g["run_id"], []).append(g)
    return found


def score_of(r, by_run):
    """lib/report.mjs scoreOf: a started run that did not finish ok scores 0."""
    if r["status"] != "ok":
        return 0.0
    run_grade = r.get("grade") or {}
    parts = []
    for grader in ("objective", "judge"):
        found = [g for g in by_run.get(r["run_id"], []) if g["grader"] == grader]
        s = found[-1]["score"] if found else run_grade.get(grader)
        if s is not None:
            parts.append(s)
    if parts:
        return float(np.mean(parts))
    return run_grade.get("score", np.nan)


def context_of(r):
    """export.mjs contextFor: from the iterations, else prompt tokens over turns, marked approx."""
    if r.get("context_final") is not None:
        return r["context_final"], r.get("context_mean", np.nan), False
    unknown = set(r.get("tokens_unknown", []))
    turns = r.get("turns", 0)
    if turns > 0 and not unknown & set(INPUT_CLASSES):
        per_call = sum(r.get("tokens", {}).get(c, 0) for c in INPUT_CLASSES) / turns
        return per_call, per_call, True
    return np.nan, np.nan, False


def stage_cost(stage):
    cost = stage.get("cost_usd", {})
    return cost.get("computed", cost.get("reported", np.nan))


def run_cost(r):
    """A run's cost over every stage it started, a handoff's stage A included; README.md § "Handoff tasks"."""
    stages = [s for s in (r.get("stage_a"), r) if s and s.get("sent")]
    if not stages:
        return stage_cost(r)
    return sum(stage_cost(s) for s in stages)


def runs_frame(records, grades):
    """One row per run the budget did not stop, with what the context figures read."""
    by_run = grades_by_run(grades)
    rows = []
    for r in records:
        if r["status"] == "budget":
            continue
        timing = r.get("timing", {})
        cost = r.get("cost_usd", {})
        final, mean, approx = context_of(r)
        turns = r.get("turns", 0)
        wall = timing.get("wall_ms", np.nan)
        stage_a = r.get("stage_a")
        first_wall = stage_a["timing"]["wall_ms"] if stage_a else 0
        rows.append({
            "subject": SHOWN_AS.get(r["subject"].get("name", "sloppy"), r["subject"].get("name", "sloppy")),
            "agent": f'{r["backend"]["kind"]} / {r["backend"]["model"]}',
            "model": r["backend"]["model"],
            "condition": r["condition"],
            "config": r.get("config") or "shipped",
            "task": r["task"]["id"],
            "rep": r["rep"],
            "score": score_of(r, by_run),
            "context_final": final,
            "context_mean": mean,
            "approx": approx,
            "wall_s": (wall + first_wall) / 1000,
            "answer_s": timing.get("answer_ms", np.nan) / 1000,
            "per_query_s": wall / turns / 1000 if turns > 0 else np.nan,
            "cost_usd": run_cost(r),
            "turns": turns,
            "subagents": r.get("subagents_spawned", 0),
        })
    return pd.DataFrame(rows)


def load(results):
    return runs_frame(read_jsonl(results), read_jsonl(Path(results) / "grades"))


def style(condition):
    """A condition's colour and marker, fixed by its place in CONDITION_ORDER whatever else ran."""
    i = CONDITION_ORDER.index(condition) if condition in CONDITION_ORDER else zlib.crc32(condition.encode())
    return PALETTE[i % len(PALETTE)], MARKERS[i % len(MARKERS)]


def ordered(conditions):
    present = set(conditions)
    return [c for c in CONDITION_ORDER if c in present] + sorted(present - set(CONDITION_ORDER))


def bootstrap_ci(values, stat=np.mean):
    values = np.asarray([v for v in values if not pd.isna(v)], dtype=float)
    if len(values) < 2:
        return (np.nan, np.nan)
    rng = np.random.default_rng(SEED)
    draws = [stat(rng.choice(values, len(values), replace=True)) for _ in range(BOOTSTRAP)]
    return tuple(np.percentile(draws, [2.5, 97.5]))


def panels(frame):
    """(label, rows) per subject and agent, so no figure averages across either."""
    if not len(frame):
        return []
    return [(f"{subject} · {agent}", g) for (subject, agent), g in frame.groupby(["subject", "agent"], sort=True)]


def grid(found, ncols=1, width=7.5, height=4.2):
    fig, axes = plt.subplots(len(found), ncols, figsize=(width, height * len(found)), squeeze=False)
    return fig, axes


def legend_below(ax, n):
    ax.legend(frameon=False, fontsize=8, ncol=min(3, max(1, n)), loc="upper center", bbox_to_anchor=(0.5, -0.16))


def context_curve(runs):
    drawn = runs.dropna(subset=["context_final", "score"]) if len(runs) else runs
    drawn = drawn[drawn["context_final"] > 0] if len(drawn) else drawn
    found = panels(drawn)
    if not found:
        return None
    fig, axes = grid(found, height=4.6)
    for ax, (label, g) in zip(axes[:, 0], found):
        edges = np.geomspace(g["context_final"].min(), g["context_final"].max() * 1.0001, 7)
        centres = np.sqrt(edges[:-1] * edges[1:])
        for c in ordered(g["condition"]):
            colour, mark = style(c)
            part = g[g["condition"] == c]
            exact, approx = part[~part["approx"]], part[part["approx"]]
            ax.scatter(exact["context_final"], exact["score"], color=colour, marker=mark, s=30, alpha=0.55, label=f"{c} (n={len(part)})")
            ax.scatter(approx["context_final"], approx["score"], facecolors="none", edgecolors=colour, marker=mark, s=30, alpha=0.7)
            which = np.clip(np.digitize(part["context_final"], edges) - 1, 0, len(centres) - 1)
            xs, ms, los, his = [], [], [], []
            for b in sorted(set(which)):
                scores = part["score"].to_numpy()[which == b]
                lo, hi = bootstrap_ci(scores)
                xs.append(centres[b]); ms.append(scores.mean()); los.append(lo); his.append(hi)
            ax.plot(xs, ms, color=colour, linewidth=2)
            ax.fill_between(xs, los, his, color=colour, alpha=0.12, linewidth=0)
        ax.set_xscale("log")
        ax.set_ylim(-0.05, 1.05)
        ax.set_xlabel("tokens in the prompt of the last model call (log)")
        ax.set_ylabel("score")
        ax.set_title(f"Score against context: {label}")
        legend_below(ax, g["condition"].nunique())
    fig.tight_layout()
    return fig


def best_and_mean(runs):
    drawn = runs.dropna(subset=["score"]) if len(runs) else runs
    found = panels(drawn)
    if not found:
        return None
    fig, axes = grid(found, width=9, height=4)
    for ax, (label, g) in zip(axes[:, 0], found):
        here = ordered(g["condition"])
        x = np.arange(len(here))
        for i, c in enumerate(here):
            colour, _ = style(c)
            part = g[g["condition"] == c]
            m = part["score"].mean()
            lo, hi = bootstrap_ci(part["score"])
            best = part.groupby("task")["score"].max().mean()
            err = None if np.isnan(lo) else [[m - lo], [hi - m]]
            ax.bar(x[i] - 0.2, m, 0.38, color=colour, yerr=err, capsize=3, label="mean, 95% interval" if i == 0 else None)
            ax.bar(x[i] + 0.2, best, 0.38, color=colour, alpha=0.45, hatch="//", edgecolor=colour, label="best repetition, averaged over tasks" if i == 0 else None)
            if len(part) < 2:
                ax.text(x[i] - 0.2, 0.02, "n=1", rotation=90, ha="center", va="bottom", fontsize=7)
        ax.set_xticks(x, here, rotation=20, ha="right")
        ax.set_ylim(0, 1.05)
        ax.set_ylabel("score")
        ax.set_title(f"Mean and best score by condition: {label}")
        ax.legend(frameon=False, fontsize=8, loc="lower right")
    fig.tight_layout()
    return fig


def _boxes(ax, g, column, here):
    data = [g[g["condition"] == c][column].dropna().to_numpy() for c in here]
    box = ax.boxplot([d if len(d) else [np.nan] for d in data], tick_labels=here, patch_artist=True)
    for patch, c in zip(box["boxes"], here):
        patch.set_facecolor(style(c)[0])
    for i, d in enumerate(data, 1):
        if len(d) < 2:
            ax.text(i, ax.get_ylim()[0], f"n={len(d)}", ha="center", va="bottom", fontsize=7)
    ax.tick_params(axis="x", rotation=20)


def time_per_query(runs):
    found = panels(runs)
    if not found or runs[["per_query_s", "answer_s"]].isna().all().all():
        return None
    fig, axes = grid(found, ncols=2, width=12, height=4)
    for row, (label, g) in zip(axes, found):
        here = ordered(g["condition"])
        _boxes(row[0], g, "per_query_s", here)
        row[0].set_ylabel("seconds per model turn")
        row[0].set_title(f"Wall time per turn: {label}")
        _boxes(row[1], g, "answer_s", here)
        row[1].set_ylabel("seconds")
        row[1].set_title(f"Time to the answer: {label}")
    fig.tight_layout()
    return fig


def cost_against_context(runs):
    drawn = runs.dropna(subset=["context_final", "cost_usd"]) if len(runs) else runs
    drawn = drawn[drawn["context_final"] > 0] if len(drawn) else drawn
    found = panels(drawn)
    if not found:
        return None
    fig, axes = grid(found, height=4.6)
    for ax, (label, g) in zip(axes[:, 0], found):
        for c in ordered(g["condition"]):
            colour, mark = style(c)
            part = g[g["condition"] == c]
            exact, approx = part[~part["approx"]], part[part["approx"]]
            ax.scatter(exact["context_final"], exact["cost_usd"], color=colour, marker=mark, s=30, alpha=0.7, label=f"{c} (n={len(part)})")
            ax.scatter(approx["context_final"], approx["cost_usd"], facecolors="none", edgecolors=colour, marker=mark, s=30, alpha=0.8)
        ax.set_xscale("log")
        ax.set_xlabel("tokens in the prompt of the last model call (log)")
        ax.set_ylabel("USD per run")
        ax.set_title(f"Cost against context: {label}")
        legend_below(ax, g["condition"].nunique())
    fig.tight_layout()
    return fig


def model_tier(runs):
    drawn = runs.dropna(subset=["score"]) if len(runs) else runs
    subjects = [(s, g) for s, g in drawn.groupby("subject", sort=True) if g["agent"].nunique() > 1] if len(drawn) else []
    if not subjects:
        return None
    fig, axes = grid(subjects, width=9, height=4.4)
    for ax, (subject, g) in zip(axes[:, 0], subjects):
        here = ordered(g["condition"])
        x = np.arange(len(here))
        for i, (agent, a) in enumerate(g.groupby("agent", sort=True)):
            means, los, his = [], [], []
            for c in here:
                scores = a[a["condition"] == c]["score"]
                lo, hi = bootstrap_ci(scores)
                means.append(scores.mean() if len(scores) else np.nan)
                los.append(lo); his.append(hi)
            means, los, his = map(np.array, (means, los, his))
            err = np.vstack([means - los, his - means])
            ax.errorbar(x + (i - 0.5) * 0.08, means, yerr=np.where(np.isnan(err), 0, err), color=PALETTE[i % len(PALETTE)],
                        marker=MARKERS[i % len(MARKERS)], markersize=7, linewidth=2, capsize=3, label=agent)
        ax.set_xticks(x, here, rotation=20, ha="right")
        ax.set_ylim(0, 1.05)
        ax.set_ylabel("mean score")
        ax.set_title(f"Score by condition, one line per model: {subject}")
        ax.legend(frameon=False, fontsize=8)
    fig.tight_layout()
    return fig


FIGURES = [
    ("context-curve", "Performance against context length", context_curve,
     "Each point is one run: the prompt size of its last model call against its score, the condition by colour and marker; "
     "the lines are each condition's mean score in six log-spaced bands of context, with a 95% bootstrap band. Hollow points "
     "come from records that did not keep their calls, approximated as prompt tokens over turns. One panel per subject and model."),
    ("best-and-mean", "Best and mean score per condition", best_and_mean,
     "Solid bars are each condition's mean score over its runs with a 95% bootstrap interval; hatched bars take the best "
     "repetition of each task and average those over tasks. One panel per subject and model."),
    ("time-per-query", "Time per query", time_per_query,
     "Left, the runner's wall time divided by the run's model turns; right, seconds from the start of the run to the start "
     "of its answer, by condition. One row per subject and model."),
    ("cost-context", "Cost against context", cost_against_context,
     "Each point is one run: the prompt size of its last model call against what the run cost, condition by colour and "
     "marker; hollow points are approximated. One panel per subject and model."),
    ("model-tier", "Score by condition across models", model_tier,
     "Mean score by condition with one line per model, wherever more than one model ran on a subject, so a small model with "
     "the notes can be read against a large model without them."),
]


def configure():
    plt.rcParams.update({
        "figure.dpi": 110,
        "axes.spines.top": False,
        "axes.spines.right": False,
        "axes.grid": True,
        "grid.color": "#e6e6e6",
        "grid.linewidth": 0.6,
        "svg.fonttype": "none",
        "svg.hashsalt": "sloppy-bench",
    })
