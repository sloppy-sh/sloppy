import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  anchorProject,
  anchorsOf,
  loadRules,
  proseOf,
  refusal,
  withLine,
} from "../anchor-docs.mjs";
import { noteOf } from "../carry-docs.mjs";
import { gitIn, tempDir, write } from "./helpers.mjs";

const TOOL = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "anchor-docs.mjs",
);

const RULES = {
  doc_roots: ["design", "engine/notes"],
  code_roots: ["engine/"],
  vocabulary: [
    { dir: "engine/scan/", words: "\\bscanner\\b|\\bscanning\\b" },
    { dir: "engine/fold/", words: "\\bfolder\\b|\\bfolding\\b" },
    { dir: "engine/emit/", words: "\\bemitter\\b" },
    { dir: "engine/absent/", words: "\\bghost\\b" },
  ],
  path_rules: [{ match: "^engine/notes/(\\w+)\\.md$", dir: "engine/$1/" }],
};

function project() {
  const root = tempDir("anchor-docs-");
  write(root, "engine/scan/scan.c", "int scan;\n");
  write(root, "engine/fold/fold.c", "int fold;\n");
  write(root, "engine/emit/emit.c", "int emit;\n");
  write(
    root,
    "design/scanning.md",
    [
      "# Scanning words",
      "",
      "<!--",
      "Licence text.",
      "-->",
      "",
      "[Pull request](https://example.invalid/pr/1)",
      "",
      "<!-- toc -->",
      "",
      "-   [Reading words](#reading-words)",
      "",
      "<!-- tocstop -->",
      "",
      "## Reading words",
      "",
      "The scanner reads words. Scanning is fast, and the scanner never folds.",
      "The folder runs later; folding is once.",
      "",
      "```",
      "scanner scanner scanner folder folder",
      "```",
      "",
    ].join("\n"),
  );
  write(
    root,
    "design/meetings.md",
    "# How we meet\n\nWe meet weekly and the scanner of minutes is whoever is free.\n",
  );
  write(
    root,
    "engine/notes/emit.md",
    "# The emitter\n\nThe emitter writes bytes.\n",
  );
  write(
    root,
    "engine/notes/fold.md",
    "# Folding\n\nSee `engine/fold/` for the folder; folding folding folding.\n",
  );
  const git = gitIn(root);
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-q", "-m", "one");
  fs.writeFileSync(path.join(root, "rules.json"), JSON.stringify(RULES));
  return root;
}

const rulesIn = (root) => loadRules(path.join(root, "rules.json"));

describe("anchor-docs", () => {
  it("reads prose without code, comments, a table of contents or link targets", () => {
    const prose = proseOf(
      "# T\n<!--\nscanner\n-->\n<!-- toc -->\nscanner\n<!-- tocstop -->\n[x](scanner/a.md) scanner\n```\nscanner\n```\n",
    );
    assert.equal(prose.match(/scanner/g).length, 1);
  });

  it("anchors the folders a document's words reach the floor for, most used first", () => {
    const rules = rulesIn(project());
    const folders = new Set(["engine/scan", "engine/fold", "engine/emit"]);
    const text = "scanner scanner scanner folder folder folder folding emitter";
    assert.deepEqual(
      anchorsOf("design/x.md", text, rules, { named: new Set(), folders }),
      ["engine/fold", "engine/scan"],
    );
    assert.deepEqual(
      anchorsOf("design/x.md", text, rules, {
        named: new Set(["engine/fold"]),
        folders,
      }),
      ["engine/scan"],
    );
    assert.deepEqual(
      anchorsOf("design/x.md", "ghost ghost ghost", rules, {
        named: new Set(),
        folders,
      }),
      [],
    );
  });

  it("anchors the folder a document's own path names, ahead of its words", () => {
    const rules = { ...rulesIn(project()), maxAnchors: 1 };
    const folders = new Set(["engine/scan", "engine/emit"]);
    assert.deepEqual(
      anchorsOf("engine/notes/emit.md", "scanner scanner scanner", rules, {
        named: new Set(),
        folders,
      }),
      ["engine/emit"],
    );
  });

  it("places the line after the title, licence and link line, before the table of contents", () => {
    const text =
      "# T\n\n<!--\nL\n-->\n\n[Pull request](u)\n\n<!-- toc -->\n\n## A\n";
    const { text: after, added } = withLine(text, "Covers: a/");
    assert.equal(
      after,
      "# T\n\n<!--\nL\n-->\n\n[Pull request](u)\n\nCovers: a/\n\n<!-- toc -->\n\n## A\n",
    );
    assert.equal(refusal(text, after, added, ["a"], new Set(["a"])), undefined);
  });

  it("keeps the line a paragraph of its own where nothing separates it", () => {
    const { text } = withLine("# T\n[PR](u)\nOpening words.\n", "Covers: a/");
    assert.equal(text, "# T\n[PR](u)\n\nCovers: a/\n\nOpening words.\n");
  });

  it("refuses an edit that changes an original line or a folder that is not there", () => {
    const before = "# T\n\nwords\n";
    assert.match(
      refusal(
        before,
        "# T\n\nCovers: a/\n\nWORDS\n",
        [2, 3],
        ["a"],
        new Set(["a"]),
      ),
      /original line/,
    );
    assert.match(
      refusal(before, "# T\n\nCovers: a/\n\nwords\n", [2, 3], ["a"], new Set()),
      /not a folder/,
    );
  });

  it("anchors a project, leaving a document about no component alone", () => {
    const root = project();
    const byDoc = Object.fromEntries(
      anchorProject(root, rulesIn(root)).map((one) => [one.doc, one.anchors]),
    );
    assert.deepEqual(byDoc, {
      "design/meetings.md": [],
      "design/scanning.md": ["engine/scan"],
      "engine/notes/emit.md": ["engine/emit"],
      "engine/notes/fold.md": [],
    });
  });

  it("writes only without --dry-run, and the carry links the folder it names", () => {
    const root = project();
    const run = (...extra) =>
      execFileSync(
        "node",
        [TOOL, root, "--rules", path.join(root, "rules.json"), ...extra],
        { encoding: "utf8" },
      );
    const original = fs.readFileSync(
      path.join(root, "design/scanning.md"),
      "utf8",
    );
    assert.match(run("--dry-run"), /documents anchored: 2/);
    assert.equal(
      fs.readFileSync(path.join(root, "design/scanning.md"), "utf8"),
      original,
    );
    run();
    const after = fs.readFileSync(
      path.join(root, "design/scanning.md"),
      "utf8",
    );
    assert.match(after, /\n\nCovers: engine\/scan\/\n\n<!-- toc -->/);
    const files = new Set(["engine/scan/scan.c", "design/scanning.md"]);
    assert.deepEqual(noteOf("design/scanning.md", after, files).links, [
      "engine/scan",
    ]);
  });
});
