import { MemoryFiles } from "@sloppy/local";
import {
  digestOf,
  encodeText,
  graphFile,
  type VaultGraph,
} from "@sloppy/vault";
import { describe, expect, it } from "vitest";
import { check } from "./check.js";

const DID = "did:syr:z6MktEXAMPLEEXAMPLEEXAMPLEEXAMPLE";
const OTHER = "did:syr:z6MktSTRANGERSTRANGERSTRANGER";
const A = "01J0000000000000000000000A";
const B = "01J0000000000000000000000B";
const BLOCK = "01J000000000000000000000B1";

const SAID: VaultGraph = {
  format: 1,
  graph: "01J000000000000000000000GR",
  name: "A project",
  owner: DID,
  project: "..",
};

interface Written {
  ulid: string;
  ref?: string;
  front?: string;
  body?: string;
}

function note({ ulid, ref, front = "", body = "" }: Written): string {
  return [
    "---",
    `ref: ${ref ?? `${DID}/${ulid}`}`,
    "title: A note",
    ...(front === "" ? [] : [front]),
    "---",
    "",
    `<!-- block ${BLOCK} -->`,
    "",
    body,
    "",
  ].join("\n");
}

/** A project with its container inside it, and whatever was written into
 *  either — `notes/…` lands in the container, everything else in the code. */
async function project(
  files: Record<string, string>,
  graph: VaultGraph = SAID,
): Promise<MemoryFiles> {
  const root = new MemoryFiles({ root: "/project" });
  const container = root.at(".sloppy");
  await container.write("graph.json", graphFile(graph));
  for (const [path, held] of Object.entries(files)) {
    const at =
      path.startsWith("notes/") || path.startsWith(".sloppy/")
        ? container
        : root;
    await at.write(path, encodeText(held));
  }
  return container as MemoryFiles;
}

describe("check", () => {
  it("says nothing about a container that holds", async () => {
    const container = await project({
      "notes/01J0000000000000000000000A.md": note({
        ulid: A,
        front: `links:\n  - ${DID}/${B}`,
        body: `A [walkthrough](code:src/a.ts) of [the other](sloppy:${DID}/${B}).`,
      }),
      "notes/01J0000000000000000000000B.md": note({ ulid: B }),
      "src/a.ts": "export const a = 1;\n",
    });
    expect(await check(container)).toEqual({ notes: 2, defects: [] });
  });

  it("says which file isn't a note", async () => {
    const container = await project({
      "notes/01J0000000000000000000000A.md": "Just some markdown.\n",
    });
    const { defects } = await check(container);
    expect(defects).toEqual([
      {
        kind: "not-a-note",
        file: "notes/01J0000000000000000000000A.md",
        said: "This file isn't a note.",
      },
    ]);
  });

  it("says which front matter field doesn't hold", async () => {
    const container = await project({
      "notes/01J0000000000000000000000A.md": note({
        ulid: A,
        front: [
          "parent: not-a-ref",
          "checked: ",
          "aliases:",
          "  - 1a",
          "  - nope!",
        ].join("\n"),
      }),
    });
    const { defects } = await check(container);
    expect(defects.map((one) => one.said)).toEqual([
      "`parent` doesn't name a note.",
      "`checked` doesn't name a commit.",
      '`aliases`: "nope!" isn\'t an address.',
    ]);
    expect(defects.every((one) => one.kind === "front-matter")).toBe(true);
  });

  it("says when a file's name and the note in it disagree", async () => {
    const container = await project({
      "notes/01J0000000000000000000000A.md": note({
        ulid: A,
        ref: `${DID}/${B}`,
      }),
    });
    const { defects } = await check(container);
    expect(defects).toHaveLength(1);
    expect(defects[0].said).toBe(
      "This file's name and the note in it disagree.",
    );
  });

  it("says which citation lands nowhere, and leaves somebody else's alone", async () => {
    const container = await project({
      "notes/01J0000000000000000000000A.md": note({
        ulid: A,
        body: [
          `Ours: [gone](sloppy:${DID}/${B}).`,
          `Theirs: [away](sloppy:${OTHER}/${B}).`,
        ].join("\n\n"),
      }),
    });
    const { defects } = await check(container);
    expect(defects).toEqual([
      {
        kind: "missing-note",
        file: "notes/01J0000000000000000000000A.md",
        note: `${DID}/${A}`,
        said: `Points at a note this graph hasn't got: ${DID}/${B}`,
      },
    ]);
  });

  it("resolves a citation of a note in the bin", async () => {
    const container = await project({
      "notes/01J0000000000000000000000A.md": note({
        ulid: A,
        body: `[binned](sloppy:${DID}/${B})`,
      }),
      ".sloppy/bin/01J0000000000000000000000B.md": note({ ulid: B }),
    });
    expect((await check(container)).defects).toEqual([]);
  });

  it("says which anchor points at code that isn't there", async () => {
    const container = await project({
      "notes/01J0000000000000000000000A.md": note({
        ulid: A,
        body: "[gone](code:src/gone.ts#L1-L4)",
      }),
    });
    const { defects } = await check(container);
    expect(defects).toEqual([
      {
        kind: "missing-code",
        file: "notes/01J0000000000000000000000A.md",
        note: `${DID}/${A}`,
        said: "Points at code that isn't there: src/gone.ts",
      },
    ]);
  });

  it("says which of a note's files has changed since it was read", async () => {
    const said = "export const a = 1;\n";
    const container = await project({
      "notes/01J0000000000000000000000A.md": note({
        ulid: A,
        front: [
          "read_against:",
          "  - path: src/a.ts",
          `    digest: ${await digestOf(encodeText(said))}`,
          "  - path: src/b.ts",
          `    digest: ${await digestOf(encodeText(said))}`,
        ].join("\n"),
        body: "[a](code:src/a.ts) and [b](code:src/b.ts)",
      }),
      "src/a.ts": said,
      "src/b.ts": `${said}// and more\n`,
    });
    const { defects } = await check(container);
    expect(defects).toEqual([
      {
        kind: "code-moved",
        file: "notes/01J0000000000000000000000A.md",
        note: `${DID}/${A}`,
        said: "Read against a file that has changed since: src/b.ts",
      },
    ]);
  });

  // The canvas draws its mark off the note's row alone, so the terminal asks
  // over the readings too, and the reading clears when the note is read again.
  it("says a file it was read against though the writing no longer points there", async () => {
    const said = "export const a = 1;\n";
    const container = await project({
      "notes/01J0000000000000000000000A.md": note({
        ulid: A,
        front: [
          "read_against:",
          "  - path: src/a.ts",
          `    digest: ${await digestOf(encodeText(said))}`,
        ].join("\n"),
        body: "nothing points anywhere now",
      }),
      "src/a.ts": `${said}// and more\n`,
    });
    const { defects } = await check(container);
    expect(defects).toEqual([
      {
        kind: "code-moved",
        file: "notes/01J0000000000000000000000A.md",
        note: `${DID}/${A}`,
        said: "Read against a file that has changed since: src/a.ts",
      },
    ]);
  });

  it("says a file that isn't there once, and as the sharper of the two", async () => {
    const container = await project({
      "notes/01J0000000000000000000000A.md": note({
        ulid: A,
        front: [
          "read_against:",
          "  - path: src/gone.ts",
          `    digest: ${await digestOf(encodeText("was"))}`,
        ].join("\n"),
        body: "[gone](code:src/gone.ts)",
      }),
    });
    const { defects } = await check(container);
    expect(defects.map((one) => one.kind)).toEqual(["missing-code"]);
  });

  // Unread is not stale: a note nobody has read against the code is never out
  // of date, however far the code has moved.
  it("says nothing about a note nobody has read against the code", async () => {
    const container = await project({
      "notes/01J0000000000000000000000A.md": note({
        ulid: A,
        body: "[a](code:src/a.ts)",
      }),
      "src/a.ts": "export const a = 2;\n",
    });
    expect((await check(container)).defects).toEqual([]);
  });

  it("looks for no code where the graph is nobody's project", async () => {
    const nobodys: VaultGraph = {
      format: 1,
      graph: SAID.graph,
      name: SAID.name,
      owner: DID,
    };
    const container = await project(
      {
        "notes/01J0000000000000000000000A.md": note({
          ulid: A,
          front: [
            "read_against:",
            "  - path: src/gone.ts",
            `    digest: ${await digestOf(encodeText("was"))}`,
          ].join("\n"),
          body: "[gone](code:src/gone.ts)",
        }),
      },
      nobodys,
    );
    expect((await check(container)).defects).toEqual([]);
  });

  it("refuses a folder with no graph in it", async () => {
    const files = new MemoryFiles({ root: "/nowhere" });
    await expect(check(files)).rejects.toThrow(
      "There is no graph in that folder.",
    );
  });
});
