import { containerDataAt, MemoryFiles } from "@sloppy/local";
import { encodeText, graphFile, type VaultGraph } from "@sloppy/vault";
import { describe, expect, it } from "vitest";
import { FINE, NOTHING_DONE, run, TO_FIX } from "./run.js";

const DID = "did:syr:z6MktEXAMPLEEXAMPLEEXAMPLEEXAMPLE";
const A = "01J0000000000000000000000A";
const BLOCK = "01J000000000000000000000B1";

const SAID: VaultGraph = {
  format: 1,
  graph: "01J000000000000000000000GR",
  name: "A project",
  owner: DID,
  project: "..",
};

function note(body: string): string {
  return [
    "---",
    `ref: ${DID}/${A}`,
    "title: A note",
    "---",
    "",
    `<!-- block ${BLOCK} -->`,
    "",
    body,
    "",
  ].join("\n");
}

interface Ran {
  code: number;
  out: string[];
  err: string[];
}

async function ran(argv: string[], files: MemoryFiles): Promise<Ran> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(argv, {
    cwd: "/project",
    told: { out: (line) => out.push(line), err: (line) => err.push(line) },
    filesAt: (root) => files.at(root),
  });
  return { code, out, err };
}

async function wrote(body: string): Promise<MemoryFiles> {
  const root = new MemoryFiles({ root: "/" });
  const container = root.at("/project/.sloppy");
  await container.write("graph.json", graphFile(SAID));
  await container.write(`notes/${A}.md`, encodeText(note(body)));
  return root;
}

describe("sloppy", () => {
  it("checks the folder it was run in", async () => {
    const { code, out } = await ran(["check"], await wrote("Nothing to see."));
    expect(code).toBe(FINE);
    expect(out).toEqual(["1 note read. Nothing to fix."]);
  });

  it("lists what doesn't hold, and says so in its exit code", async () => {
    const files = await wrote("[gone](code:src/gone.ts)");
    const { code, out } = await ran(["check", "/project"], files);
    expect(code).toBe(TO_FIX);
    expect(out).toEqual([
      `notes/${A}.md: Points at code that isn't there: src/gone.ts`,
    ]);
  });

  it("answers in JSON where it was asked to", async () => {
    const files = await wrote("[gone](code:src/gone.ts)");
    const { code, out } = await ran(["check", "--json"], files);
    expect(code).toBe(TO_FIX);
    expect(JSON.parse(out[0])).toEqual({
      command: "check",
      notes: 1,
      defects: [
        {
          kind: "missing-code",
          file: `notes/${A}.md`,
          note: `${DID}/${A}`,
          said: "Points at code that isn't there: src/gone.ts",
        },
      ],
    });
  });

  it("says a folder with no notes in it has none, and does nothing", async () => {
    const { code, err } = await ran(["check"], new MemoryFiles({ root: "/" }));
    expect(code).toBe(NOTHING_DONE);
    expect(err).toEqual(["There are no notes in that folder yet."]);
  });

  it("answers in JSON where a run read nothing", async () => {
    const { code, out, err } = await ran(
      ["check", "--json"],
      new MemoryFiles({ root: "/" }),
    );
    expect(code).toBe(NOTHING_DONE);
    expect(err).toEqual([]);
    expect(JSON.parse(out[0])).toEqual({
      command: "check",
      said: "There are no notes in that folder yet.",
    });
  });

  it("says a folder it cannot read in words a person can act on", async () => {
    const files = new MemoryFiles({ root: "/" });
    await files.at("/project/.sloppy").write("graph.json", encodeText("{"));
    const { code, err } = await ran(["check"], files);
    expect(code).toBe(NOTHING_DONE);
    expect(err).toEqual(["This file isn't a Sloppy graph."]);
  });

  it("says a folder with no notes in it has none, whatever was asked of it", async () => {
    for (const argv of [["check"], ["draft", "a.ts"]]) {
      const { code, err } = await ran(argv, new MemoryFiles({ root: "/" }));
      expect(code).toBe(NOTHING_DONE);
      expect(err).toEqual(["There are no notes in that folder yet."]);
    }
    const { out } = await ran(
      ["draft", "a.ts", "--json"],
      new MemoryFiles({ root: "/" }),
    );
    expect(JSON.parse(out[0])).toEqual({
      command: "draft",
      said: "There are no notes in that folder yet.",
    });
  });

  it("says what it can do where nobody said", async () => {
    const { code, out } = await ran([], new MemoryFiles());
    expect(code).toBe(NOTHING_DONE);
    expect(out[0]).toContain("sloppy");
    expect(out.join("\n")).toContain("sloppy check [dir]");
  });

  it("says when there is no such command", async () => {
    const { code, err } = await ran(["publish"], new MemoryFiles());
    expect(code).toBe(NOTHING_DONE);
    expect(err).toEqual(["No such command: publish"]);
  });

  it("takes --help on a command", async () => {
    const { code, out } = await ran(["check", "--help"], new MemoryFiles());
    expect(code).toBe(FINE);
    expect(out.join("\n")).toContain("--json");
  });

  it("writes as the identity the container keeps, wherever it is run from", async () => {
    const asked: { root: string; data: string }[] = [];
    const files = await wrote("Nothing to see.");
    await run(["check", "/project"], {
      cwd: "/somewhere/else",
      told: { out: () => {}, err: () => {} },
      filesAt: (root, data) => {
        asked.push({ root, data });
        return files.at(root);
      },
    });
    expect(asked.length).toBeGreaterThan(0);
    for (const { root, data } of asked) {
      expect(data).toBe(containerDataAt(root));
    }
  });
});
