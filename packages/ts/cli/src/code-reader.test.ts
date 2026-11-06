// The project's code as find_code reads it, from a real repository on disk.

import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { codeFound, placeOf } from "@sloppy/local";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { codeReader, isOwnCode } from "./code-reader.js";
import { git } from "./git.js";

let root: string;
let kept: string;

async function put(path: string, text: string): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), text);
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "sloppy-code-"));
  kept = await mkdtemp(join(tmpdir(), "sloppy-code-kept-"));
  await git(root, ["init", "-q"]);
  await put(".gitignore", "ignored/\n");
  await put(
    "src/merge.ts",
    "export function mergeRequests() {\n  return 1;\n}\n",
  );
  await put("lib/approve.rb", "class Approver\n  def approve!\n  end\nend\n");
  await put(
    "node_modules/dep/index.js",
    "export function mergeRequests() {}\n",
  );
  await put("ignored/merge.ts", "export function mergeRequests() {}\n");
  await put("dist/merge.js", "export function mergeRequests() {}\n");
  await put(".sloppy/notes/merge.md", "# merge\n");
  await put("logo.png", "\u0000PNG");
  await git(root, ["add", "-A"]);
  await put("src/fresh.go", "package src\n\nfunc FreshMerge() {\n}\n");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(kept, { recursive: true, force: true });
});

const where = async (words: string, reader = codeReader(kept)) =>
  codeFound(await reader(root), words, 10).map(placeOf);

describe("reading a project's code", () => {
  it("reads what git keeps and would keep, and leaves out what was brought in, made, ignored or not text", async () => {
    const index = await codeReader(kept)(root);
    expect(index.files.map((file) => file.path)).toEqual([
      ".gitignore",
      "lib/approve.rb",
      "src/fresh.go",
      "src/merge.ts",
    ]);
    expect((await where("mergeRequests"))[0]).toBe("src/merge.ts#L1-L3");
    expect((await where("FreshMerge"))[0]).toBe("src/fresh.go#L3-L4");
  });

  it("builds once per project however often it is asked", async () => {
    const reader = codeReader(kept);
    expect(reader(root)).toBe(reader(root));
  });

  it("keeps what each file defines outside the project, and reads a change made since", async () => {
    const before = await git(root, ["status", "--porcelain", "--ignored"]);
    await where("approve");
    expect(await readdir(kept)).toHaveLength(1);
    expect(await git(root, ["status", "--porcelain", "--ignored"])).toBe(
      before,
    );
    await put("lib/approve.rb", "class Approver\n  def reject!\n  end\nend\n");
    expect(await where("reject!")).toEqual(["lib/approve.rb#L2-L3"]);
  });

  it("takes what it kept for a file git holds unchanged rather than reading it again", async () => {
    await where("approve");
    const [name] = await readdir(kept);
    const at = join(kept, name as string);
    const held = JSON.parse(await readFile(at, "utf8"));
    held.files["src/merge.ts"][1] = [["keptOnly", 1, 7, 9]];
    await writeFile(at, JSON.stringify(held));
    expect(await where("keptOnly")).toEqual(["src/merge.ts#L7-L9"]);
  });

  it("tells the project's own writing from what is brought in or made", () => {
    expect(isOwnCode("app/models/user.rb")).toBe(true);
    expect(isOwnCode("vendor/gems/x/lib/x.rb")).toBe(false);
    expect(isOwnCode("web/app.min.js")).toBe(false);
    expect(isOwnCode("api/x.pb.go")).toBe(false);
    expect(isOwnCode("pnpm-lock.yaml")).toBe(false);
    expect(isOwnCode(".sloppy/notes/x.md")).toBe(false);
  });
});
