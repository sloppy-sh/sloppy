import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeText } from "@sloppy/vault";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NodeFiles } from "./node-files.js";
import { projectOpenings, projectParts } from "./tree.js";

describe("what a project's files say it is made of", () => {
  let root = "";
  let project: NodeFiles;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "sloppy-tree-"));
    project = new NodeFiles({ root });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const wrote = (path: string, said: string): Promise<void> =>
    project.write(path, encodeText(said));

  it("takes the packages a workspace declares, and the folders beside them", async () => {
    await wrote(
      "package.json",
      JSON.stringify({ name: "top", workspaces: ["packages/*"] }),
    );
    await wrote(
      "packages/one/package.json",
      JSON.stringify({ name: "@x/one" }),
    );
    await wrote("packages/one/src/index.ts", "export const a = 1;");
    await wrote(
      "packages/two/package.json",
      JSON.stringify({ name: "@x/two" }),
    );
    await wrote("packages/two/src/index.ts", "export const b = 2;");
    await wrote("docs/guide.md", "# guide");
    await wrote("node_modules/left/index.js", "module.exports = 1;");

    const parts = await projectParts(project);
    expect(parts.map((part) => part.path)).toEqual([
      "docs",
      "packages/one",
      "packages/two",
    ]);
    expect(parts.map((part) => part.name)).toEqual([
      "docs",
      "@x/one",
      "@x/two",
    ]);
    expect(parts[1].entries).toContain("packages/one/src/index.ts");
  });

  it("reads a pnpm workspace and a Cargo one the same way", async () => {
    await wrote(
      "pnpm-workspace.yaml",
      "packages:\n  - 'apps/*'\n  - libs/one\n",
    );
    await wrote("Cargo.toml", '[workspace]\nmembers = ["crates/deep"]\n');
    await wrote("apps/web/package.json", JSON.stringify({ name: "web" }));
    await wrote("libs/one/index.ts", "export const a = 1;");
    await wrote("crates/deep/Cargo.toml", '[package]\nname = "deep"\n');
    await wrote("crates/deep/src/lib.rs", "pub fn a() {}");

    const parts = await projectParts(project);
    expect(parts.map((part) => part.path)).toEqual([
      "apps/web",
      "crates/deep",
      "libs/one",
    ]);
    expect(parts.find((part) => part.path === "crates/deep")).toMatchObject({
      name: "deep",
      entries: ["crates/deep/src/lib.rs", "crates/deep/Cargo.toml"],
    });
  });

  it("points a part with nothing to open at its own folder", async () => {
    await wrote("docs/one/deep.md", "# deep");
    const parts = await projectParts(project);
    expect(parts).toEqual([{ path: "docs", name: "docs", entries: ["docs"] }]);
  });

  it("opens a project at what is at the top of it", async () => {
    await wrote("README.md", "# top");
    await wrote("package.json", "{}");
    await wrote("src/index.ts", "export const a = 1;");
    expect(await projectOpenings(project)).toEqual([
      "README.md",
      "package.json",
    ]);
  });

  it("says a folder with nothing in it is made of nothing", async () => {
    expect(await projectParts(project)).toEqual([]);
    expect(await projectOpenings(project)).toEqual([]);
  });
});
