import { execFile } from "node:child_process";
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
import { promisify } from "node:util";
import { carryIdentityOut, makeLocalIdentity } from "@sloppy/local";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FINE, NOTHING_DONE, run, TO_FIX } from "./run.js";

interface Ran {
  code: number;
  out: string[];
  err: string[];
}

let root = "";

async function ran(argv: string[], at = root): Promise<Ran> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(argv, {
    cwd: at,
    told: { out: (line) => out.push(line), err: (line) => err.push(line) },
  });
  return { code, out, err };
}

async function wrote(path: string, said: string): Promise<void> {
  const at = join(root, path);
  await mkdir(dirname(at), { recursive: true });
  await writeFile(at, said);
}

const read = (path: string): Promise<string> =>
  readFile(join(root, path), "utf8");

const there = (path: string): Promise<boolean> =>
  readFile(join(root, path)).then(
    () => true,
    () => false,
  );

async function notes(): Promise<string[]> {
  return (await readdir(join(root, ".sloppy/notes"))).sort();
}

/** The one note file whose text holds this, which is how a test names the note
 *  it means without knowing the ulid. */
async function noteSaying(said: string): Promise<string> {
  for (const file of await notes()) {
    const held = await read(`.sloppy/notes/${file}`);
    if (held.includes(said)) return held;
  }
  throw new Error(`No note says ${said}`);
}

/** Every note the container holds, as their files. */
async function everyNote(): Promise<{ at: string; said: string }[]> {
  const held: { at: string; said: string }[] = [];
  for (const file of await notes()) {
    const at = `.sloppy/notes/${file}`;
    held.push({ at, said: await read(at) });
  }
  return held;
}

/** The project the tests are run against: a workspace with one package, one
 *  plain folder, and a file that reaches for another. */
async function aProject(): Promise<void> {
  await wrote(
    "package.json",
    JSON.stringify({ name: "thing", workspaces: ["packages/*"] }),
  );
  await wrote("README.md", "# thing\n");
  await wrote(
    "packages/one/package.json",
    JSON.stringify({ name: "@thing/one", main: "src/index.ts" }),
  );
  await wrote(
    "packages/one/src/index.ts",
    [
      'import { helper } from "./helper.js";',
      'export const NAME = "one";',
      "export function start() { return helper(NAME); }",
    ].join("\n"),
  );
  await wrote(
    "packages/one/src/helper.ts",
    "export function helper(name: string) { return name; }",
  );
  await wrote("docs/guide.md", "# guide\n");
}

const ranIt = promisify(execFile);

/** A history for the project, and the commit everything in it is at. */
async function committed(): Promise<string> {
  const git = (...argv: string[]): Promise<unknown> =>
    ranIt("git", argv, { cwd: root });
  await git("init", "-q");
  await git("add", "-A");
  await git(
    "-c",
    "user.email=nobody@example.com",
    "-c",
    "user.name=Nobody",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    "the code as the notes read it",
  );
  const { stdout } = await ranIt("git", ["rev-parse", "HEAD"], { cwd: root });
  return stdout.trim();
}

const historyHere = await ranIt("git", ["--version"]).then(
  () => true,
  () => false,
);

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "sloppy-cli-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("sloppy init", () => {
  it("starts the notes and writes what the tree says", async () => {
    await aProject();
    const { code, out } = await ran(["init"]);
    expect(code).toBe(FINE);
    expect(out[0]).toBe("Notes started in this project.");
    expect(out.slice(2)).toEqual(["  thing", "  docs", "  @thing/one"]);

    const graph = JSON.parse(await read(".sloppy/graph.json"));
    expect(graph).toMatchObject({ project: "..", ownership: "owned" });
    expect(await there(".sloppy/AGENT.md")).toBe(true);

    const walkthrough = await noteSaying("title: docs");
    expect(walkthrough).toContain("tags:\n  - walkthrough");
    expect(walkthrough).toContain("[docs](code:docs)");

    const project = await noteSaying("  - project");
    const ref = /^ref: (.+)$/m.exec(project)?.[1];
    expect(ref).toBeTruthy();
    expect(project).toContain("[README.md](code:README.md)");
    expect(walkthrough).toContain(`north: [[${ref}]]`);
    expect(walkthrough).not.toContain("south:");

    expect(await ran(["check"])).toMatchObject({
      code: FINE,
      out: ["3 notes read. Nothing to fix."],
    });
  });

  it("keeps this device's own business out of the project's history", async () => {
    await aProject();
    await ran(["init"]);
    const ignore = (await read(".sloppy/.gitignore")).split("\n");
    const own = await readdir(join(root, ".sloppy/.sloppy"));
    expect(own.length).toBeGreaterThan(0);
    for (const file of own) {
      const kept = ignore.some((line) => {
        const said = line.replace(/^\/\.sloppy\//, "");
        return said.startsWith("*")
          ? file.endsWith(said.slice(1))
          : said === file;
      });
      expect(kept, `${file} is not kept out`).toBe(true);
    }
  });

  it("leaves an ignore somebody wrote alone, and adds what is missing", async () => {
    await aProject();
    await wrote(".sloppy/.gitignore", "drafts/\n");
    await ran(["init"]);
    const ignore = await read(".sloppy/.gitignore");
    expect(ignore.startsWith("drafts/\n")).toBe(true);
    expect(ignore).toContain("/.sloppy/*.key");
  });

  it("writes nothing the second time", async () => {
    await aProject();
    await ran(["init"]);
    const before = await everyNote();
    const { code, out } = await ran(["init"]);
    expect(code).toBe(FINE);
    expect(out).toEqual(["Everything here already has a note."]);
    expect(await everyNote()).toEqual(before);
  });

  it("writes under the identity it was handed", async () => {
    await aProject();
    const made = makeLocalIdentity();
    const did = made.identity.did;
    await wrote(
      "carried.json",
      new TextDecoder().decode(carryIdentityOut(made.identity, made.key)),
    );
    const { code } = await ran(["init", "--identity", "carried.json"]);
    expect(code).toBe(FINE);
    expect(JSON.parse(await read(".sloppy/graph.json")).owner).toBe(did);
  });

  it("says where to name the identity file, and where one isn't there", async () => {
    await aProject();
    expect(await ran(["init", "--identity"])).toMatchObject({
      code: NOTHING_DONE,
      err: ["Name the file your identity is in."],
    });
    expect(await ran(["init", "--identity", "nobody.json"])).toMatchObject({
      code: NOTHING_DONE,
      err: ["That file isn't there."],
    });
    expect(await there(".sloppy/graph.json")).toBe(false);
  });

  it("will not start a project's notes inside a graph of its own", async () => {
    await wrote("graph.json", "{}");
    const { code, err } = await ran(["init"]);
    expect(code).toBe(NOTHING_DONE);
    expect(err[0]).toContain("already a graph of its own");
  });
});

describe("sloppy draft", () => {
  it("writes what a file imports, exports and might point at", async () => {
    await aProject();
    await ran(["init"]);
    const { code, out } = await ran([
      "draft",
      "packages/one/src/helper.ts",
      "packages/one/src/index.ts",
    ]);
    expect(code).toBe(FINE);
    expect(out).toEqual([
      "packages/one/src/helper.ts: written.",
      "packages/one/src/index.ts: written.",
    ]);

    const note = await noteSaying("title: packages/one/src/index.ts");
    expect(note).toContain(
      "[packages/one/src/index.ts](code:packages/one/src/index.ts)",
    );
    expect(note).toContain("```mermaid");
    expect(note).toContain('in0["./helper.js"] --> file');
    expect(note).toContain("[start](code:packages/one/src/index.ts#start)");
    expect(note).toContain("## Candidates");
    expect(note).toContain("Part of — [@thing/one](sloppy:");
    expect(note).toContain("Made of — [packages/one/src/helper.ts](sloppy:");
    // A candidate is writing. The compass itself is nobody's but the person's.
    expect(note).not.toContain("north:");

    expect((await ran(["check"])).code).toBe(FINE);
  });

  it("writes the same note again rather than a second one", async () => {
    await aProject();
    await ran(["init"]);
    await ran(["draft", "packages/one/src/index.ts"]);
    const before = await notes();
    await ran(["draft", "packages/one/src/index.ts"]);
    expect(await notes()).toEqual(before);
    const note = await noteSaying("title: packages/one/src/index.ts");
    expect(note.match(/## What it exports/g)).toHaveLength(1);
  });

  it("offers a change to a note somebody else keeps", async () => {
    await aProject();
    await ran(["init"]);
    await ran(["draft", "packages/one/src/index.ts"]);
    const someoneElse = makeLocalIdentity().identity.did;
    for (const held of await everyNote()) {
      if (!held.said.includes("title: packages/one/src/index.ts")) continue;
      await wrote(
        held.at,
        held.said.replace(/^owner: .*$/m, `owner: ${someoneElse}`),
      );
    }
    const was = await noteSaying("title: packages/one/src/index.ts");

    const { code, out } = await ran(["draft", "packages/one/src/index.ts"]);
    expect(code).toBe(FINE);
    expect(out).toEqual([
      "packages/one/src/index.ts: offered. The note about it is somebody else's to take in.",
    ]);
    expect(await noteSaying("title: packages/one/src/index.ts")).toBe(was);
    const offers = await readdir(join(root, ".sloppy/amendments"));
    expect(offers).toHaveLength(1);
    expect(await read(`.sloppy/amendments/${offers[0]}`)).toContain(
      "## What it exports",
    );
  });

  it("says which of the files named it could not write about", async () => {
    await aProject();
    await ran(["init"]);
    const { code, out } = await ran([
      "draft",
      "packages/one/nope.ts",
      "packages/one/src",
      "../elsewhere.ts",
    ]);
    expect(code).toBe(TO_FIX);
    expect(out).toEqual([
      "../elsewhere.ts: That isn't a file in this project.",
      "packages/one/nope.ts: There is no such file in this project.",
      "packages/one/src: That is a folder. Name the files in it.",
    ]);
  });

  it("works from a folder inside the project, and asks for the files", async () => {
    await aProject();
    await ran(["init"]);
    const { code } = await ran(
      ["draft", "index.ts"],
      join(root, "packages/one/src"),
    );
    expect(code).toBe(FINE);
    expect(await noteSaying("title: packages/one/src/index.ts")).toBeTruthy();
    expect(await ran(["draft"])).toMatchObject({
      code: NOTHING_DONE,
      err: ["Name the files to write about."],
    });
  });
});

describe("sloppy review", () => {
  it("says what the code has left behind, and stands in nobody's way", async () => {
    await aProject();
    await ran(["init"]);
    await wrote("later/a.ts", "export const a = 1;");

    const { code, out } = await ran(["review"]);
    expect(code).toBe(FINE);
    expect(out).toContain("later: No note is about this yet.");
    expect(
      out.some((line) => line.includes("Nothing says what this is made of.")),
    ).toBe(true);
    expect(out.some((line) => line.includes("(@thing/one)"))).toBe(true);

    expect((await ran(["review", "--strict"])).code).toBe(TO_FIX);
  });

  it("answers in JSON with the signals themselves", async () => {
    await aProject();
    await ran(["init"]);
    const { out } = await ran(["review", "--json"]);
    const said = JSON.parse(out[0]) as {
      command: string;
      signals: { kind: string; direction?: string }[];
    };
    expect(said.command).toBe("review");
    expect(said.signals.map((one) => one.kind)).toEqual(
      Array(6).fill("compass-gap"),
    );
    expect(said.signals.map((one) => one.direction)).toEqual([
      "south",
      "east",
      "west",
      "south",
      "east",
      "west",
    ]);
  });

  it("says so where the code has left nothing behind", async () => {
    await wrote("src/a.ts", "export const a = 1;");
    await ran(["init"]);
    for (const held of await everyNote()) {
      await wrote(
        held.at,
        held.said.replace(/^north: .*$/m, "[the code](code:src/a.ts)"),
      );
    }
    const { code, out } = await ran(["review"]);
    expect(code).toBe(FINE);
    expect(out).toEqual(["Nothing the code has left behind."]);
  });

  it.skipIf(!historyHere)(
    "says when the code under a note has moved since it was read",
    async () => {
      await aProject();
      await ran(["init"]);
      await ran(["draft", "packages/one/src/index.ts"]);
      const commit = await committed();
      for (const held of await everyNote()) {
        if (!held.said.includes("title: packages/one/src/index.ts")) continue;
        await wrote(
          held.at,
          held.said.replace("title:", `checked: ${commit}\ntitle:`),
        );
      }

      const moved = (lines: string[]): boolean =>
        lines.some((line) => line.includes("has changed since this was read"));
      expect(moved((await ran(["review"])).out)).toBe(false);
      await wrote("packages/one/src/index.ts", "export const NAME = 'two';");
      const { out } = await ran(["review"]);
      expect(moved(out)).toBe(true);
      expect(
        out.some((line) =>
          line.endsWith(
            "The code it points at has changed since this was read: packages/one/src/index.ts",
          ),
        ),
      ).toBe(true);
    },
  );

  it("says a folder with no notes in it has none", async () => {
    await aProject();
    expect(await ran(["review"])).toMatchObject({
      code: NOTHING_DONE,
      err: ["There are no notes in that folder yet."],
    });
  });
});
