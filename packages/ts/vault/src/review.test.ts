import { describe, expect, it } from "vitest";
import { vaultToNote } from "./note.js";
import { review, type ReviewInput, type ReviewSignal } from "./review.js";

const DID = "did:syr:z6MktEXAMPLEEXAMPLEEXAMPLEEXAMPLE";
const ulid = (n: number) => `01J000000000000000000000${n}A`;
const ref = (n: number) => `${DID}/${ulid(n)}`;
const COMMIT = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0";

/** A note as the file a vault holds it in, read back the way the app and the
 *  CLI both read one. */
function note(said: {
  n: number;
  checked?: string;
  body: string;
}): ReturnType<typeof vaultToNote> {
  const front = [
    "---",
    `ref: ${ref(said.n)}`,
    "title: A note",
    ...(said.checked === undefined ? [] : [`checked: ${said.checked}`]),
    "---",
  ].join("\n");
  return vaultToNote({
    markdown: `${front}\n\n<!-- block ${ulid(said.n)} -->\n\n${said.body}\n`,
  });
}

function compass(slots: Partial<Record<string, string[]>>): string {
  return (["north", "south", "east", "west"] as const)
    .flatMap((direction) => {
      const held = slots[direction] ?? [];
      return held.length === 0
        ? []
        : [`${direction}: ${held.map((one) => `[[${one}]]`).join(" ")}`];
    })
    .join("\n");
}

const nothingMoved: ReviewInput["changed"] = async () => [];

describe("what the code has left behind", () => {
  it("says nothing about a project whose notes are all in step", async () => {
    const signals = await review({
      notes: [note({ n: 1, checked: COMMIT, body: "[parser](code:src/a.ts)" })],
      projectTop: ["src"],
      changed: nothingMoved,
    });
    expect(signals).toEqual([]);
  });

  it("names the anchor whose code has moved since it was last read", async () => {
    const signals = await review({
      notes: [
        note({
          n: 1,
          checked: COMMIT,
          body: "[parser](code:src/a.ts) and [lexer](code:src/b.ts)",
        }),
      ],
      projectTop: ["src"],
      changed: async (checked, paths) => {
        expect(checked).toBe(COMMIT);
        expect([...paths].sort()).toEqual(["src/a.ts", "src/b.ts"]);
        return ["src/b.ts"];
      },
    });
    expect(signals).toEqual<ReviewSignal[]>([
      { kind: "anchor-changed", note: ref(1), path: "src/b.ts" },
    ]);
  });

  it("says nothing about a note nobody has confirmed", async () => {
    let asked = false;
    const signals = await review({
      notes: [note({ n: 1, body: "[parser](code:src/a.ts)" })],
      projectTop: ["src"],
      changed: async () => {
        asked = true;
        return ["src/a.ts"];
      },
    });
    expect(asked).toBe(false);
    expect(signals).toEqual([]);
  });

  it("names the code no note points at", async () => {
    const signals = await review({
      notes: [note({ n: 1, body: "[parser](code:packages/api/src/a.ts)" })],
      projectTop: ["packages/api", "packages/web", "scripts"],
      changed: nothingMoved,
    });
    expect(signals).toEqual<ReviewSignal[]>([
      { kind: "code-without-note", path: "packages/web" },
      { kind: "code-without-note", path: "scripts" },
    ]);
  });

  it("names each slot a compass has left empty", async () => {
    const signals = await review({
      notes: [
        note({
          n: 1,
          body: compass({ north: [ref(2)], west: [ref(3)] }),
        }),
      ],
      projectTop: [],
      changed: nothingMoved,
    });
    expect(signals).toEqual<ReviewSignal[]>([
      { kind: "compass-gap", note: ref(1), direction: "south" },
      { kind: "compass-gap", note: ref(1), direction: "east" },
    ]);
  });

  it("says a decision with nothing to the west has not said what instead", async () => {
    const signals = await review({
      notes: [note({ n: 1, body: compass({ north: [ref(2)] }) })],
      projectTop: [],
      changed: nothingMoved,
    });
    expect(signals).toContainEqual<ReviewSignal>({
      kind: "no-instead-of",
      note: ref(1),
    });
  });

  it("says nothing about the compass on a note that holds none", async () => {
    const signals = await review({
      notes: [note({ n: 1, body: "Just a thought." })],
      projectTop: [],
      changed: nothingMoved,
    });
    expect(signals).toEqual([]);
  });
});
