import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  applySetup,
  assertIsolated,
  changedFiles,
  cleanVariants,
  headOf,
  listedPaths,
  prepareVariant,
  resetVariant,
  resolveSha,
} from "../lib/subject.mjs";
import { BENCH_DIR, loadSubject } from "../lib/config.mjs";
import {
  makeSubject,
  makeDocSiteSubject,
  DOC_SITE_CONFIG,
  tempDir,
  testSubject,
} from "./helpers.mjs";

const SUBJECT = testSubject();
const DOC_SITE = testSubject(DOC_SITE_CONFIG, "doc-site");

const tracked = (dir) =>
  execFileSync("git", ["ls-files"], { cwd: dir })
    .toString()
    .split("\n")
    .filter(Boolean)
    .sort();
const commits = (dir) =>
  execFileSync("git", ["log", "--format=%s"], { cwd: dir })
    .toString()
    .split("\n")
    .filter(Boolean);

test("nodocs removes exactly the documents, the container, the harness and every symlink to AI.md", () => {
  const subject = makeSubject();
  const workRoot = tempDir();
  const sha = resolveSha(subject);
  const v = prepareVariant(subject, "nodocs", sha, { workRoot, subject: SUBJECT });
  assert.deepEqual([...v.removed].sort(), [
    ".mcp.json",
    ".rules",
    ".sloppy",
    "AI.md",
    "CLAUDE.md",
    "CONTRIBUTING.md",
    "DESIGN.md",
    "PRODUCT.md",
    "bench",
    "docs",
    "pkg/AGENTS.md",
  ]);
  assert.deepEqual(tracked(v.dir), [
    "LINK.md",
    "README.md",
    "src/a.js",
    "src/b.js",
  ]);
});

test("full removes only the harness", () => {
  const subject = makeSubject();
  const v = prepareVariant(subject, "full", "HEAD", { workRoot: tempDir(), subject: SUBJECT });
  assert.deepEqual(v.removed, ["bench"]);
  assert.ok(fs.existsSync(path.join(v.dir, "AI.md")));
  assert.equal(fs.readlinkSync(path.join(v.dir, "CLAUDE.md")), "AI.md");
  assert.ok(fs.existsSync(path.join(v.dir, ".sloppy/graph.json")));
});

test("a variant carries no history and no way back to the subject", () => {
  const subject = makeSubject();
  const v = prepareVariant(subject, "full", "HEAD", { workRoot: tempDir(), subject: SUBJECT });
  assert.deepEqual(commits(v.dir), ["Snapshot"]);
  assert.equal(execFileSync("git", ["remote"], { cwd: v.dir }).toString(), "");
  assert.ok(fs.statSync(path.join(v.dir, ".git")).isDirectory());
});

test("the variant is the tree of the sha asked for, not of the subject's HEAD", () => {
  const subject = makeSubject();
  const first = resolveSha(subject, "HEAD~1");
  const v = prepareVariant(subject, "full", first, { workRoot: tempDir(), subject: SUBJECT });
  assert.equal(v.sha, first);
  assert.ok(!fs.existsSync(path.join(v.dir, "src/b.js")));
});

test("preparing again reuses the variant and returns it to its snapshot", () => {
  const subject = makeSubject();
  const workRoot = tempDir();
  const a = prepareVariant(subject, "nodocs", "HEAD", { workRoot, subject: SUBJECT });
  fs.writeFileSync(path.join(a.dir, "src/a.js"), "changed\n");
  fs.writeFileSync(path.join(a.dir, "new.txt"), "new\n");
  assert.deepEqual(changedFiles(a.dir, headOf(a.dir)), ["new.txt", "src/a.js"]);
  const b = prepareVariant(subject, "nodocs", "HEAD", { workRoot, subject: SUBJECT });
  assert.equal(b.dir, a.dir);
  assert.equal(b.snapshot, a.snapshot);
  assert.equal(
    fs.readFileSync(path.join(b.dir, "src/a.js"), "utf8"),
    "export const a = 1;\n",
  );
  assert.ok(!fs.existsSync(path.join(b.dir, "new.txt")));
  fs.writeFileSync(path.join(b.dir, "src/a.js"), "again\n");
  resetVariant(b.dir);
  assert.deepEqual(changedFiles(b.dir, b.snapshot), []);
});

test("cleaning removes the prepared variants and nothing else", () => {
  const subject = makeSubject();
  const workRoot = tempDir();
  prepareVariant(subject, "full", "HEAD", { workRoot, subject: SUBJECT });
  prepareVariant(subject, "nodocs", "HEAD", { workRoot, subject: SUBJECT });
  fs.mkdirSync(path.join(workRoot, "keep"));
  assert.equal(cleanVariants({ workRoot }).length, 2);
  assert.deepEqual(fs.readdirSync(workRoot), ["keep"]);
});

test("variants are refused under a folder an agent would read context from", () => {
  const parent = tempDir();
  fs.writeFileSync(path.join(parent, "CLAUDE.md"), "x");
  assert.throws(
    () => assertIsolated(path.join(parent, "work")),
    /SLOPPY_BENCH_WORK/,
  );
  assert.doesNotThrow(() => assertIsolated(tempDir()));
});

test("a planted change lands as a commit, so it reads as history and not as a pending edit", () => {
  const subject = makeSubject();
  const v = prepareVariant(subject, "full", "HEAD", { workRoot: tempDir(), subject: SUBJECT });
  const patch = [
    "--- a/src/a.js",
    "+++ b/src/a.js",
    "@@ -1 +1 @@",
    "-export const a = 1;",
    "+export const a = 3;",
    "",
  ].join("\n");
  applySetup(v.dir, { patch, message: "Update" });
  assert.deepEqual(commits(v.dir), ["Update", "Snapshot"]);
  assert.deepEqual(changedFiles(v.dir, headOf(v.dir)), []);
  assert.deepEqual(changedFiles(v.dir, v.snapshot), ["src/a.js"]);
  resetVariant(v.dir);
  assert.deepEqual(commits(v.dir), ["Snapshot"]);
});

test("a reset leaves nothing an earlier run wrote, ignored files included", () => {
  const subject = makeSubject();
  const v = prepareVariant(subject, "full", "HEAD", { workRoot: tempDir(), subject: SUBJECT });
  fs.appendFileSync(
    path.join(v.dir, ".git", "info", "exclude"),
    "dist/\n*.log\n",
  );
  fs.mkdirSync(path.join(v.dir, "dist"));
  fs.writeFileSync(path.join(v.dir, "dist", "answer.txt"), "left behind\n");
  fs.writeFileSync(path.join(v.dir, "notes.log"), "left behind\n");
  assert.deepEqual(changedFiles(v.dir, headOf(v.dir)), []);
  resetVariant(v.dir);
  assert.ok(!fs.existsSync(path.join(v.dir, "dist")));
  assert.ok(!fs.existsSync(path.join(v.dir, "notes.log")));
});

test("notes-only removes the documents and every symlink to AI.md, and keeps the container", () => {
  const subject = makeSubject();
  const workRoot = tempDir();
  const sha = resolveSha(subject);
  const v = prepareVariant(subject, "notes-only", sha, { workRoot, subject: SUBJECT });
  assert.deepEqual([...v.removed].sort(), [
    ".mcp.json",
    ".rules",
    "AI.md",
    "CLAUDE.md",
    "CONTRIBUTING.md",
    "DESIGN.md",
    "PRODUCT.md",
    "bench",
    "docs",
    "pkg/AGENTS.md",
  ]);
  assert.equal(fs.existsSync(path.join(v.dir, ".sloppy")), true);
});

test("a subject's lists name what each variant removes, in the order they are given", () => {
  assert.deepEqual(listedPaths(SUBJECT, "nodocs"), [
    "bench",
    "docs",
    "AI.md",
    "DESIGN.md",
    "PRODUCT.md",
    "CONTRIBUTING.md",
    ".sloppy",
    ".mcp.json",
  ]);
  assert.deepEqual(listedPaths(SUBJECT, "notes-only"), [
    "bench",
    "docs",
    "AI.md",
    "DESIGN.md",
    "PRODUCT.md",
    "CONTRIBUTING.md",
    ".mcp.json",
  ]);
  assert.deepEqual(listedPaths(SUBJECT, "full"), ["bench"]);
});

test("the default subject is the one subject.json names", () => {
  assert.equal(loadSubject().name, JSON.parse(fs.readFileSync(path.join(BENCH_DIR, "subject.json"), "utf8")).default);
});

test("a subject whose documents are a site loses exactly its configured documents and every symlink to its context files", () => {
  const site = DOC_SITE;
  const repo = makeDocSiteSubject();
  const workRoot = tempDir();
  const nodocs = prepareVariant(repo, "nodocs", "HEAD", {
    workRoot,
    subject: site,
  });
  const notesOnly = prepareVariant(repo, "notes-only", "HEAD", {
    workRoot,
    subject: site,
  });
  const documents = [
    ".cursorrules",
    "AGENTS.md",
    "AI.md",
    "Architecture.md",
    "CLAUDE.md",
    "DEPLOYMENT.md",
    "GEMINI.md",
    "README.md",
    "apps/docs",
  ];
  assert.deepEqual([...notesOnly.removed].sort(), documents);
  assert.deepEqual(
    [...nodocs.removed].sort(),
    [".sloppy", ...documents].sort(),
  );
  assert.deepEqual(tracked(notesOnly.dir), [
    ".sloppy/graph.json",
    "LINK.md",
    "apps/api/src/main.ts",
    "docs/notes.md",
  ]);
  assert.deepEqual(tracked(nodocs.dir), [
    "LINK.md",
    "apps/api/src/main.ts",
    "docs/notes.md",
  ]);
});

test("two subjects at the same variant never share a folder", () => {
  const repo = makeSubject();
  const workRoot = tempDir();
  const a = prepareVariant(repo, "full", "HEAD", { workRoot, subject: SUBJECT });
  const b = prepareVariant(repo, "full", "HEAD", {
    workRoot,
    subject: DOC_SITE,
  });
  assert.notEqual(a.dir, b.dir);
  assert.match(path.basename(a.dir), /^subject-full-/);
  assert.match(path.basename(b.dir), /^doc-site-full-/);
});

test("a subject file is validated, and an unknown subject is refused by name", () => {
  const dir = tempDir();
  const write = (name, body) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, JSON.stringify(body));
    return file;
  };
  const good = DOC_SITE_CONFIG;
  const loaded = loadSubject(write("mine.json", { ...good, path: "/x" }));
  assert.equal(loaded.name, "mine");
  assert.equal(loaded.path, "/x");
  assert.throws(
    () => loadSubject(write("bad.json", { ...good, docs: ["../outside"] })),
    /docs\.0 must be a path inside the subject/,
  );
  assert.throws(
    () => loadSubject(write("nodump.json", { ...good, dump: [] })),
    /dump/,
  );
  assert.throws(
    () => loadSubject(write("eats.json", { ...good, docs: [".sloppy"] })),
    /container/,
  );
  assert.throws(() => loadSubject("nowhere"), /no subject called "nowhere"/);
});
