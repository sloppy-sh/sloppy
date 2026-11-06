import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadSubject } from "../lib/config.mjs";

const made = [];
process.on("exit", () => {
  for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
});

export function tempDir(prefix = "sloppy-bench-test-") {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), prefix));
  made.push(dir);
  return dir;
}

export const write = (root, rel, content) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), content);
};

export const gitIn =
  (root) =>
  (...args) =>
    execFileSync(
      "git",
      ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args],
      {
        cwd: root,
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "t",
          GIT_AUTHOR_EMAIL: "t@t",
          GIT_COMMITTER_NAME: "t",
          GIT_COMMITTER_EMAIL: "t@t",
        },
        stdio: "pipe",
      },
    );

/** A throwaway subject: documents, a container, symlinks to AI.md, a harness folder and plain code. */
export function makeSubject() {
  const root = tempDir("sloppy-bench-subject-");
  write(root, "AI.md", "# Rules\nThe ref identifies a note.\n");
  write(root, "docs/ARCHITECTURE.md", "# Architecture\n");
  write(root, "DESIGN.md", "# Design\n");
  write(root, "PRODUCT.md", "# Product\n");
  write(root, "CONTRIBUTING.md", "# Contributing\n");
  write(root, ".sloppy/graph.json", "{}\n");
  write(root, ".mcp.json", "{}\n");
  write(root, "README.md", "# Subject\n");
  write(root, "src/a.js", "export const a = 1;\n");
  write(root, "bench/tasks/secret.json", "{}\n");
  fs.symlinkSync("AI.md", path.join(root, "CLAUDE.md"));
  fs.symlinkSync("AI.md", path.join(root, ".rules"));
  fs.mkdirSync(path.join(root, "pkg"));
  fs.symlinkSync("../AI.md", path.join(root, "pkg", "AGENTS.md"));
  fs.symlinkSync("README.md", path.join(root, "LINK.md"));
  const git = gitIn(root);
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-q", "-m", "one");
  write(root, "src/b.js", "export const b = 2;\n");
  git("add", "-A");
  git("commit", "-q", "-m", "two, with a message an agent should never read");
  return root;
}

/** The subject configuration `makeSubject` is laid out for. */
export const SUBJECT_CONFIG = {
  label: "Subject",
  path: ".",
  default_pack: "example",
  sloppy_cli: "packages/ts/cli/dist/sloppy.mjs",
  docs: ["docs", "AI.md", "DESIGN.md", "PRODUCT.md", "CONTRIBUTING.md"],
  container: ".sloppy",
  mcp_file: ".mcp.json",
  context_links: ["AI.md"],
  pointed: ["AI.md", "docs/ARCHITECTURE.md"],
  dump: ["AI.md", "docs/ARCHITECTURE.md", "DESIGN.md", "PRODUCT.md"],
};

/** The subject configuration `makeDocSiteSubject` is laid out for. */
export const DOC_SITE_CONFIG = {
  label: "doc-site",
  path: ".",
  default_pack: "example",
  sloppy_cli: "packages/ts/cli/dist/sloppy.mjs",
  docs: ["apps/docs", "README.md", "Architecture.md", "DEPLOYMENT.md", "AI.md"],
  container: ".sloppy",
  mcp_file: ".mcp.json",
  context_links: ["AI.md"],
  pointed: ["AI.md", "Architecture.md", "apps/docs/app/src/routes"],
  dump: [
    "README.md",
    "Architecture.md",
    "DEPLOYMENT.md",
    "AI.md",
    "apps/docs/app/src/routes/+page.md",
    "apps/docs/app/src/routes/architecture/mandates/+page.md",
  ],
};

/** `config` written as `<name>.json` and read back by `loadSubject`, so it is named and validated as a real one. */
export function testSubject(config = SUBJECT_CONFIG, name = "subject") {
  const file = path.join(tempDir("sloppy-bench-subjects-"), `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(config));
  return loadSubject(file);
}

export const NO_AGENTS = { allow_installed: [], installed: {} };

/** A throwaway project whose documents are a documentation site, root documents, AI.md and its symlinks, a container. */
export function makeDocSiteSubject() {
  const root = tempDir("sloppy-bench-doc-site-");
  write(root, "AI.md", "# Rules\nA platform holds a mandate.\n");
  write(root, "README.md", "# doc-site\n");
  write(root, "Architecture.md", "# Architecture\n");
  write(root, "DEPLOYMENT.md", "# Deployment\n");
  write(root, "apps/docs/app/src/routes/+page.md", "# Home\n");
  write(
    root,
    "apps/docs/app/src/routes/architecture/mandates/+page.md",
    "# Mandates\n",
  );
  write(root, "apps/docs/package.json", "{}\n");
  write(root, "apps/api/src/main.ts", "export {};\n");
  write(root, ".sloppy/graph.json", "{}\n");
  write(root, "docs/notes.md", "# Not a document of this subject\n");
  for (const link of ["CLAUDE.md", "AGENTS.md", "GEMINI.md", ".cursorrules"])
    fs.symlinkSync("AI.md", path.join(root, link));
  fs.symlinkSync("README.md", path.join(root, "LINK.md"));
  const git = gitIn(root);
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-q", "-m", "one");
  return root;
}
