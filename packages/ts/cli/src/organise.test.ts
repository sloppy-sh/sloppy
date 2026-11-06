// `sloppy organise` — docs/ARCHITECTURE.md § "Tooling".

import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { containerApi, containerDataAt, performChatCall } from "@sloppy/local";
import { NoteWrittenSchema, type OwnedRef } from "@sloppy/types";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { NodeFiles } from "./node-files.js";
import type { Proposals } from "./organise.js";
import { labelFrom } from "./organise.js";
import { FINE, NOTHING_DONE, run, TO_FIX } from "./run.js";

const ranIt = promisify(execFile);

const historyHere = await ranIt("git", ["--version"]).then(
  () => true,
  () => false,
);

const BIN = fileURLToPath(new URL("../dist/sloppy.mjs", import.meta.url));
const FAKE_AGENT = fileURLToPath(
  new URL("./fixtures/fake-agent.mjs", import.meta.url),
);

let root = "";
const kept: Record<string, string | undefined> = {};
let noGlobal = "";

/** The notes of the fixture by title. */
let refs: Record<string, OwnedRef> = {};

interface Ran {
  code: number;
  out: string[];
  err: string[];
}

async function ran(argv: string[]): Promise<Ran> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(argv, {
    cwd: root,
    told: { out: (line) => out.push(line), err: (line) => err.push(line) },
    self: { command: process.execPath, args: [BIN] },
    agentAt: { "claude-code": FAKE_AGENT },
  });
  return { code, out, err };
}

async function wrote(
  about: string,
  sections: string[],
  beside: { title: string; under?: OwnedRef },
): Promise<OwnedRef> {
  const files = new NodeFiles({ root, data: containerDataAt(root) });
  const done = await performChatCall(files, {
    call: "c1",
    act: "write_note",
    arguments: { about, sections, ...beside },
  });
  expect(done.trouble).toBeUndefined();
  const ref = NoteWrittenSchema.parse(JSON.parse(done.said)).note;
  refs[beside.title] = ref;
  return ref;
}

/**
 * A project whose notes hang from one note about it. "Grammar rules" is hung
 * straight under that note, though it continues "Parsing"; "Lexing" is under
 * "Parsing" already, where it belongs. "Running the playground" and "The
 * playground image" are about one file, and each has a note of its own
 * beneath it, so neither is carried anywhere.
 */
async function aProject(): Promise<void> {
  const files = new NodeFiles({ root, data: containerDataAt(root) });
  await containerApi(files).openProject(root);
  const project = await wrote(
    "README.md",
    ["## Why\n\nA small compiler for a toy language."],
    { title: "The compiler" },
  );
  const parsing = await wrote(
    "src/parser.ts",
    [
      "## Why\n\nThe parser reads tokens into a grammar tree. Every grammar rule is a parser function.",
    ],
    { title: "Parsing", under: project },
  );
  await wrote(
    "src/lexer.ts",
    ["## Why\n\nThe lexer cuts the source into tokens the parser reads."],
    { title: "Lexing", under: parsing },
  );
  await wrote(
    "src/grammar.ts",
    [
      "## Why\n\nThe grammar rules the parser follows, one parser function per rule, each building a node of the grammar tree.",
    ],
    { title: "Grammar rules", under: project },
  );
  const image = await wrote(
    "docker/Dockerfile",
    ["## Why\n\nThe image the playground runs in, built nightly."],
    { title: "The playground image", under: project },
  );
  await wrote(
    "scripts/nightly.sh",
    ["## Why\n\nBuilds the playground image every night."],
    { title: "Nightly builds", under: image },
  );
  const running = await wrote(
    "docs/playground.md",
    [
      "## Why\n\nHow to run the playground image from [the Dockerfile](code:docker/Dockerfile), and what the playground runs.",
    ],
    { title: "Running the playground", under: project },
  );
  await wrote("docs/ports.md", ["## Why\n\nThe ports the playground opens."], {
    title: "Ports",
    under: running,
  });
}

async function git(...args: string[]): Promise<string> {
  return (await ranIt("git", args, { cwd: root })).stdout;
}

async function kept_(): Promise<void> {
  await git("init", "-q");
  await git("add", "-A");
  await git(
    "-c",
    "user.name=Person",
    "-c",
    "user.email=person@example.com",
    "commit",
    "-q",
    "-m",
    "The notes",
  );
}

async function everyNote(): Promise<Map<string, string>> {
  const at = join(root, ".sloppy/notes");
  const held = new Map<string, string>();
  for (const file of (await readdir(at)).sort()) {
    held.set(file, await readFile(join(at, file), "utf8"));
  }
  return held;
}

function proposalsIn(out: string[]): Proposals {
  const { moves, links } = JSON.parse(out[0]) as Proposals;
  return { moves, links };
}

beforeAll(async () => {
  // The person's own git settings — signing, hooks, who they are — are theirs,
  // and a test must not reach for them.
  noGlobal = join(await mkdtemp(join(tmpdir(), "sloppy-git-")), "config");
  await writeFile(noGlobal, "");
  for (const name of ["GIT_CONFIG_GLOBAL", "GIT_CONFIG_NOSYSTEM"]) {
    kept[name] = process.env[name];
  }
  process.env.GIT_CONFIG_GLOBAL = noGlobal;
  process.env.GIT_CONFIG_NOSYSTEM = "1";
});

afterAll(async () => {
  for (const [name, value] of Object.entries(kept)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  await rm(join(noGlobal, ".."), { recursive: true, force: true });
});

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "sloppy-tidy-test-"));
  refs = {};
  await aProject();
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("sloppy organise", () => {
  it("proposes carrying a note hung under the project to the thought it continues", async () => {
    const { code, out } = await ran(["organise", "--json"]);
    expect(code).toBe(TO_FIX);
    const { moves } = proposalsIn(out);
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({
      note: refs["Grammar rules"],
      title: "Grammar rules",
      from: { note: refs["The compiler"] },
      to: { note: refs.Parsing, title: "Parsing" },
    });
    expect(moves[0].to.score - moves[0].from.score).toBeGreaterThan(0.1);
    expect(moves[0].to.reasons.join(" ")).toContain("parser");
  });

  it("answers the same notes the same way every time", async () => {
    const first = await ran(["organise", "--json"]);
    const second = await ran(["organise", "--json"]);
    expect(second.out).toEqual(first.out);
    const plain = await ran(["organise"]);
    expect(plain.out[0]).toMatch(
      /^Move 1b “Grammar rules” from under 1 “The compiler” \([\d.]+\) to under 1a “Parsing” \([\d.]+\): /,
    );
    expect(plain.out.at(-2)).toMatch(/proposed\. Nothing was changed\.$/);
  });

  it("with --loose, looks only at notes hung under a branch's first note or where they relate little", async () => {
    const loose = proposalsIn(
      (await ran(["organise", "--json", "--loose"])).out,
    );
    const hungUnderTheProject = new Set([
      refs.Parsing,
      refs["Grammar rules"],
      refs["The playground image"],
    ]);
    for (const one of [...loose.moves, ...loose.links]) {
      expect(hungUnderTheProject.has(one.note)).toBe(true);
    }
    expect(loose.moves.map((one) => one.note)).toEqual([refs["Grammar rules"]]);
    expect(loose.links.length).toBeGreaterThan(0);
  });

  it("never proposes two moves that would carry a note beneath itself", async () => {
    await wrote(
      "docs/rules.md",
      [
        "## Why\n\nA reader's guide to the grammar rules in [grammar.ts](code:src/grammar.ts): what each grammar rule takes, and the tree node it builds.",
      ],
      { title: "The rules, for readers", under: refs["The compiler"] },
    );
    const { moves } = proposalsIn((await ran(["organise", "--json"])).out);
    const landing = new Map(moves.map((one) => [one.note, one.to.note]));
    for (const [note, to] of landing) expect(landing.get(to)).not.toBe(note);
    expect(landing.has(refs["Grammar rules"])).toBe(true);
  });

  it("with --notes, looks only at the notes named", async () => {
    const ulid = refs.Lexing.split("/").pop() ?? "";
    const { out } = await ran(["organise", "--json", "--notes", ulid]);
    const proposals = proposalsIn(out);
    expect(proposals.moves).toEqual([]);
    expect(proposals.links.every((one) => one.note === refs.Lexing)).toBe(true);
    expect(await ran(["organise", "--notes", "nothing"])).toMatchObject({
      code: NOTHING_DONE,
      err: ["There is no note here at nothing."],
    });
  });

  it("labels a line by what the two share, passing over words every note carries", () => {
    expect(
      labelFrom(
        ["shares the words “folder”, “grammar” and “rule”"],
        (word) => word !== "folder",
      ),
    ).toBe("both on grammar and rule");
    expect(labelFrom(["both point at src/parser.ts"])).toBe(
      "both about src/parser.ts",
    );
    expect(labelFrom(["both point into src/"])).toBe("both about src");
    expect(labelFrom(["both are linked with “Parsing”"])).toBe(
      "both linked with Parsing",
    );
  });

  it.skipIf(!historyHere)(
    "with --since, looks only at the notes changed since that version",
    async () => {
      await kept_();
      const since = (await git("rev-parse", "HEAD")).trim();
      expect(
        proposalsIn((await ran(["organise", "--json", "--since", since])).out),
      ).toEqual({ moves: [], links: [] });
      const file = `${refs["Grammar rules"].split("/").pop()}.md`;
      const at = join(root, ".sloppy/notes", file);
      await writeFile(at, `${await readFile(at, "utf8")}\nMore on rules.\n`);
      const { moves } = proposalsIn(
        (await ran(["organise", "--json", "--since", since])).out,
      );
      expect(moves.map((one) => one.note)).toEqual([refs["Grammar rules"]]);
      expect(await ran(["organise", "--since", "nowhere"])).toMatchObject({
        code: NOTHING_DONE,
        err: ["That version is not in this project's history."],
      });
    },
  );

  it.skipIf(!historyHere)(
    "has an agent judge them on a branch off the person's version, leaving their notes alone",
    async () => {
      await kept_();
      const head = (await git("rev-parse", "HEAD")).trim();
      const before = await everyNote();
      const { code, out, err } = await ran([
        "organise",
        "--agent",
        "claude-code",
      ]);
      expect(err).toEqual([]);
      expect(code).toBe(FINE);

      expect((await git("rev-parse", "HEAD")).trim()).toBe(head);
      expect(await git("status", "--porcelain")).toBe("");
      expect(await everyNote()).toEqual(before);

      const branch = out
        .find((line) => line.startsWith("The draft is the branch "))
        ?.match(/branch (\S+)\./)?.[1];
      expect(branch).toMatch(/^sloppy\/organise\/\d{4}-\d{2}-\d{2}$/);
      expect((await git("merge-base", head, `${branch}`)).trim()).toBe(head);
      // The name a person merges is the branch, and nothing else answers to it.
      const named = await ranIt("git", ["rev-parse", `${branch}`], {
        cwd: root,
      });
      expect(named.stderr).toBe("");
      expect(named.stdout.trim()).toBe(
        (await git("rev-parse", `refs/heads/${branch}`)).trim(),
      );
      expect(named.stdout.trim()).not.toBe(head);
      // The checkout it was written in is let go of; the branch is what stays.
      expect((await git("worktree", "list")).trim().split("\n")).toHaveLength(
        1,
      );

      expect(out).toContain("Moved Grammar rules: it continues Parsing.");
      expect(out).toContain(
        "Moved 1a2 “Grammar rules” from under 1 “The compiler” to under 1a “Parsing”, was 1b.",
      );
      expect(
        out.some(
          (line) =>
            line.startsWith("Linked ") && line.endsWith(": “continues it”."),
        ),
      ).toBe(true);

      const review = await ran(["organise", "--review", `${branch}`]);
      expect(review.code).toBe(FINE);
      expect(review.out[0]).toBe(
        "Moved 1a2 “Grammar rules” from under 1 “The compiler” to under 1a “Parsing”, was 1b.",
      );
      expect(review.out[1]).toMatch(/^Linked .+: “continues it”\.$/);
      const json = JSON.parse(
        (await ran(["organise", "--review", `${branch}`, "--json"])).out[0],
      );
      expect(json.difference.notes.moved).toEqual([
        {
          ref: refs["Grammar rules"],
          from: refs["The compiler"],
          to: refs.Parsing,
        },
      ]);
      expect(json.lines.drawn).toHaveLength(1);
    },
  );

  it.skipIf(!historyHere)(
    "makes no draft where the project has no version to start from",
    async () => {
      await git("init", "-q");
      expect(await ran(["organise", "--agent", "claude-code"])).toMatchObject({
        code: NOTHING_DONE,
        err: [
          "Keep a version of this project first, with git commit. The draft starts from it.",
        ],
      });
      expect(await git("branch", "--list")).toBe("");
    },
  );

  it.skipIf(!historyHere)("says where there is no such draft", async () => {
    await kept_();
    expect(
      await ran(["organise", "--review", "sloppy/organise/1999-01-01"]),
    ).toMatchObject({
      code: NOTHING_DONE,
      err: [
        "There is no draft by that name. Name a branch sloppy organise --agent made.",
      ],
    });
  });
});
