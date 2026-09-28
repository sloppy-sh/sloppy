import { describe, expect, it } from "vitest";
import { vaultToNote } from "./note.js";
import {
  placesIn,
  review,
  type ReviewInput,
  type ReviewSignal,
} from "./review.js";

const DID = "did:syr:z6MktEXAMPLEEXAMPLEEXAMPLEEXAMPLE";
const ulid = (n: number) => `01J000000000000000000000${n}A`;
const ref = (n: number) => `${DID}/${ulid(n)}`;
const COMMIT = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0";

/** A note as the file a vault holds it in, read back the way the app and the
 *  CLI both read one. */
function note(said: {
  n: number;
  checked?: string;
  /** Each path the note has been read against, and what that file said. */
  readAgainst?: Record<string, string>;
  /** One per section, in the order the note reads. */
  body: string | string[];
}): ReturnType<typeof vaultToNote> {
  const readings = Object.entries(said.readAgainst ?? {});
  const front = [
    "---",
    `ref: ${ref(said.n)}`,
    "title: A note",
    ...(said.checked === undefined ? [] : [`checked: ${said.checked}`]),
    ...(readings.length === 0
      ? []
      : [
          "read_against:",
          ...readings.flatMap(([path, text]) => [
            `  - path: ${path}`,
            `    digest: ${stands(text)}`,
          ]),
        ]),
    "---",
  ].join("\n");
  const sections = (Array.isArray(said.body) ? said.body : [said.body])
    .map(
      (text, at) =>
        `<!-- block 01J00000000000000000000${at}${said.n}A -->\n\n${text}\n`,
    )
    .join("\n");
  return vaultToNote({ markdown: `${front}\n\n${sections}` });
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

/** A digest of what a file says, spelled the way a reading is. `sha256:` and
 *  hex is all the drift reader asks of one, so the text stands in for the
 *  bytes. */
function stands(text: string): string {
  let held = 0;
  for (const char of text) held = (held * 31 + char.codePointAt(0)!) >>> 0;
  return `sha256:${held.toString(16).padStart(64, "0")}`;
}

/** A project whose files say these things, as {@link ReviewInput.codeNow}
 *  asks. */
function code(files: Record<string, string>): ReviewInput["codeNow"] {
  return async (path) => {
    const said = files[path];
    return said === undefined ? undefined : stands(said);
  };
}

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

  it("says a decision nobody has given the reason for", async () => {
    const signals = await review({
      notes: [
        note({
          n: 1,
          body: [compass({ north: [ref(2)], west: [ref(3)] }), "## Why"],
        }),
      ],
      projectTop: [],
      changed: nothingMoved,
    });
    expect(signals).toContainEqual<ReviewSignal>({
      kind: "decision-without-why",
      note: ref(1),
    });
  });

  it("says a decision whose why is still an empty paragraph", async () => {
    const signals = await review({
      notes: [
        note({
          n: 1,
          body: [
            compass({ north: [ref(2)], west: [ref(3)] }),
            "## Why\n\n<!-- -->",
          ],
        }),
      ],
      projectTop: [],
      changed: nothingMoved,
    });
    expect(signals).toContainEqual<ReviewSignal>({
      kind: "decision-without-why",
      note: ref(1),
    });
  });

  it("says nothing about a decision whose why is written", async () => {
    const signals = await review({
      notes: [
        note({
          n: 1,
          body: [
            compass({
              north: [ref(2)],
              south: [ref(3)],
              east: [ref(4)],
              west: [ref(5)],
            }),
            "## Why\n\nThe other one cost more to keep.",
          ],
        }),
      ],
      projectTop: [],
      changed: nothingMoved,
    });
    expect(signals).toEqual([]);
  });

  it("asks nothing of a note that holds a compass and is no decision", async () => {
    const signals = await review({
      notes: [note({ n: 1, body: compass({ north: [ref(2)] }) })],
      projectTop: [],
      changed: nothingMoved,
    });
    expect(signals.map((signal) => signal.kind)).toEqual([
      "compass-gap",
      "compass-gap",
      "compass-gap",
    ]);
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

describe("the places a project keeps its code", () => {
  it("names its top-level folders and every package the tree declares", () => {
    expect(
      placesIn([
        "README.md",
        "src/parser.ts",
        "docs/guide.md",
        "packages/ui/package.json",
        "packages/ui/src/one.ts",
        "crates/engine/Cargo.toml",
      ]),
    ).toEqual([
      "crates",
      "crates/engine",
      "docs",
      "packages",
      "packages/ui",
      "src",
    ]);
  });

  it("leaves a file at the top out: a project is not a note about its own README", () => {
    expect(placesIn(["README.md", "package.json"])).toEqual([]);
  });

  it("asks for nothing a build wrote or a tool keeps", () => {
    expect(
      placesIn([
        "dist/app.js",
        "build/app.js",
        "out/app.js",
        "coverage/index.html",
        "vendor/thing.go",
        "__pycache__/one.pyc",
        "node_modules/left-pad/package.json",
        "target/debug/app",
        ".github/workflows/check.yml",
        "src/parser.ts",
      ]),
    ).toEqual(["src"]);
  });
});

describe("a note read against the files themselves", () => {
  it("names the one that has changed since, and asks no history", async () => {
    let asked = false;
    const signals = await review({
      notes: [
        note({
          n: 1,
          readAgainst: { "src/a.ts": "one", "src/b.ts": "two" },
          body: "[parser](code:src/a.ts) and [lexer](code:src/b.ts)",
        }),
      ],
      projectTop: ["src"],
      changed: async () => {
        asked = true;
        return ["src/a.ts"];
      },
      codeNow: code({ "src/a.ts": "one", "src/b.ts": "two, rewritten" }),
    });
    expect(asked).toBe(false);
    expect(signals).toEqual<ReviewSignal[]>([
      { kind: "anchor-changed", note: ref(1), path: "src/b.ts" },
    ]);
  });

  it("answers by its readings even where it also carries a commit", async () => {
    const signals = await review({
      notes: [
        note({
          n: 1,
          checked: COMMIT,
          readAgainst: { "src/a.ts": "one" },
          body: "[parser](code:src/a.ts)",
        }),
      ],
      projectTop: ["src"],
      changed: async () => ["src/a.ts"],
      codeNow: code({ "src/a.ts": "one" }),
    });
    expect(signals).toEqual([]);
  });

  it("falls back to the commit and the history where it carries no reading", async () => {
    const signals = await review({
      notes: [note({ n: 1, checked: COMMIT, body: "[parser](code:src/a.ts)" })],
      projectTop: ["src"],
      changed: async (checked, paths) => {
        expect(checked).toBe(COMMIT);
        return [...paths];
      },
      codeNow: code({ "src/a.ts": "one" }),
    });
    expect(signals).toEqual<ReviewSignal[]>([
      { kind: "anchor-changed", note: ref(1), path: "src/a.ts" },
    ]);
  });

  it("says nothing about a note with neither a reading nor a commit", async () => {
    const signals = await review({
      notes: [note({ n: 1, body: "[parser](code:src/a.ts)" })],
      projectTop: ["src"],
      changed: async () => ["src/a.ts"],
      codeNow: code({ "src/a.ts": "written since" }),
    });
    expect(signals).toEqual([]);
  });

  it("says nothing at all where the code cannot be reached", async () => {
    const signals = await review({
      notes: [
        note({
          n: 1,
          readAgainst: { "src/a.ts": "one" },
          body: "[parser](code:src/a.ts)",
        }),
      ],
      projectTop: ["src"],
      changed: nothingMoved,
    });
    expect(signals).toEqual([]);
  });

  it("names a file the project has not got any more", async () => {
    const signals = await review({
      notes: [
        note({
          n: 1,
          readAgainst: { "src/a.ts": "one" },
          body: "[parser](code:src/a.ts)",
        }),
      ],
      projectTop: ["src"],
      changed: nothingMoved,
      codeNow: code({}),
    });
    expect(signals).toEqual<ReviewSignal[]>([
      { kind: "anchor-changed", note: ref(1), path: "src/a.ts" },
    ]);
  });

  it("says nothing about a place the note points at that nobody read it against", async () => {
    const signals = await review({
      notes: [
        note({
          n: 1,
          readAgainst: { "src/a.ts": "one" },
          body: "[parser](code:src/a.ts) and [lexer](code:src/b.ts)",
        }),
      ],
      projectTop: ["src"],
      changed: nothingMoved,
      codeNow: code({ "src/a.ts": "one", "src/b.ts": "written since" }),
    });
    expect(signals).toEqual([]);
  });
});
