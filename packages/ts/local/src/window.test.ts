// The window composed for an ask — note 1e12a.

import {
  type OwnedRef,
  ulid,
  type Window,
  WindowAskSchema,
  WindowSchema,
} from "@sloppy/types";
import { emptySidecars, fromMarkdown } from "@sloppy/vault";
import { beforeEach, describe, expect, it } from "vitest";
import { containerApi } from "./acts.js";
import type { LocalApi } from "./api.js";
import { AGENT_MD } from "./agent-md.js";
import { MemoryFiles } from "./files.js";
import { charsOver4, composeWindow } from "./window.js";

const PROJECT = "/work/orchard";
const GRAFT = "src/graft.ts";
const GRAFT_SAYS =
  "export function graft() {}\nconst scion = 1;\nconst stock = 2;\n";
const BUD = "src/bud.ts";
const BUD_SAYS =
  "// one\n// two\n// three\nexport function bud() {}\nconst eye = 1;\n";

let files: MemoryFiles;
let api: LocalApi;
let refs: Record<
  "orchard" | "trees" | "grafting" | "pruning" | "soil",
  OwnedRef
>;

async function note(
  title: string,
  tags: string[],
  sections: string[],
  under?: OwnedRef,
): Promise<OwnedRef> {
  const made = await api.createNode({
    from:
      under === undefined
        ? { relation: "branch" }
        : { relation: "under", note: under },
    title,
    tags,
  });
  let after: OwnedRef | undefined;
  for (const markdown of sections) {
    const block = await api.createBlock({
      node: made.ref,
      ...(after === undefined ? {} : { after }),
      content: fromMarkdown(markdown, emptySidecars(ulid())),
    });
    after = block.ref;
  }
  return made.ref;
}

beforeEach(async () => {
  files = new MemoryFiles({ root: PROJECT, data: "/data" });
  await files.write(GRAFT, new TextEncoder().encode(GRAFT_SAYS));
  await files.write(BUD, new TextEncoder().encode(BUD_SAYS));
  api = containerApi(files);
  await api.openProject(PROJECT);
  const orchard = await note(
    "The orchard",
    ["garden"],
    ["## What it is for\n\nEverything that grows here."],
  );
  const trees = await note(
    "Fruit trees",
    ["garden"],
    ["## What it is for\n\nThe trees the orchard keeps.", "## Why\n\nShade."],
    orchard,
  );
  const grafting = await note(
    "Grafting apples onto quince stock",
    ["garden", "propagation"],
    [
      "## What it is for\n\nJoining a scion to a rootstock so the apple keeps its variety.",
      `## Where\n\n[the graft](code:${GRAFT}#L2-L3) is done once per tree.`,
    ],
    trees,
  );
  const pruning = await note(
    "Pruning in winter",
    ["garden"],
    ["## What it is for\n\nCutting back while the tree sleeps."],
  );
  const soil = await note(
    "Soil tests",
    ["chemistry"],
    ["## What it is for\n\nWhat the ground holds."],
  );
  refs = { orchard, trees, grafting, pruning, soil };
});

const ask = (budget: number, depth?: number) =>
  WindowAskSchema.parse({
    ask: "how is grafting onto quince done",
    budget,
    depth,
  });

const kinds = (window: Window) => window.parts.map((part) => part.kind);

const total = (window: Window) =>
  window.parts.reduce((sum, part) => sum + part.tokens, 0);

describe("a window", () => {
  it("holds the best note whole, its chain, the notes beside it in its tags, its code and the instructions, in that order", async () => {
    const window = WindowSchema.parse(
      await composeWindow(api, ask(100_000), charsOver4),
    );

    expect(kinds(window)).toEqual([
      "note",
      "ancestor",
      "ancestor",
      "sibling",
      "code",
      "instructions",
    ]);
    expect(window.cut).toEqual([]);
    const [best, parent, grandparent, sibling, code] = window.parts;
    expect(best).toMatchObject({ ref: refs.grafting });
    expect(best.text).toContain("so the apple keeps its variety");
    expect(best.text).toContain("is done once per tree");
    expect(parent).toMatchObject({ ref: refs.trees });
    expect(parent.text).toContain("The trees the orchard keeps.");
    expect(parent.text).toContain("- Why");
    expect(parent.text).not.toContain("Shade.");
    expect(grandparent).toMatchObject({ ref: refs.orchard });
    expect(sibling).toMatchObject({ ref: refs.pruning });
    expect(sibling.text).toContain("Pruning in winter");
    expect(code).toMatchObject({
      path: GRAFT,
      fragment: "L2-L3",
      standing: "unread",
    });
    expect(code.text).toBe(
      `${GRAFT}#L2-L3 (unread)\nconst scion = 1;\nconst stock = 2;`,
    );
    for (const part of window.parts) {
      expect(part.tokens).toBe(charsOver4(part.text));
    }
  });

  it("left with only room for the best note, holds it whole and nothing else, and says what it cut in the order it cut it", async () => {
    const full = await composeWindow(api, ask(100_000), charsOver4);
    const whole = full.parts[0];

    const window = WindowSchema.parse(
      await composeWindow(api, ask(whole.tokens), charsOver4),
    );

    expect(window.parts).toEqual([whole]);
    expect(window.cut.map((cut) => cut.kind)).toEqual([
      "code",
      "sibling",
      "ancestor",
      "ancestor",
      "instructions",
    ]);
    expect(window.cut[2]).toMatchObject({ ref: refs.orchard });
    expect(window.cut[3]).toMatchObject({ ref: refs.trees });
    expect(window.cut.map((cut) => cut.tokens)).toEqual(
      [4, 3, 2, 1, 5].map((at) => full.parts[at].tokens),
    );
  });

  it("cuts only as far as the budget needs", async () => {
    const full = await composeWindow(api, ask(100_000), charsOver4);
    const window = await composeWindow(
      api,
      ask(total(full) - full.parts[4].tokens),
      charsOver4,
    );
    expect(kinds(window)).toEqual([
      "note",
      "ancestor",
      "ancestor",
      "sibling",
      "instructions",
    ]);
    expect(window.cut.map((cut) => cut.kind)).toEqual(["code"]);
  });

  it("shortens the best note to its opening and headings before it drops it", async () => {
    const full = await composeWindow(api, ask(100_000), charsOver4);
    const whole = full.parts[0];

    const window = WindowSchema.parse(
      await composeWindow(api, ask(whole.tokens - 1), charsOver4),
    );

    expect(kinds(window)).toEqual(["note"]);
    const [short] = window.parts;
    expect(short.text).toContain("- Where");
    expect(short.text).not.toContain("is done once per tree");
    expect(window.cut.at(-1)).toEqual({
      kind: "note",
      ref: refs.grafting,
      tokens: whole.tokens - short.tokens,
    });
    expect(total(window)).toBeLessThanOrEqual(window.budget);
  });

  it("has no code part for a best note with no anchors", async () => {
    const window = await composeWindow(
      api,
      WindowAskSchema.parse({ ask: "pruning in winter", budget: 100_000 }),
      charsOver4,
    );
    expect(window.parts[0]).toMatchObject({ kind: "note", ref: refs.pruning });
    expect(kinds(window)).not.toContain("code");
  });

  it("reaches no further up the chain than the depth asked", async () => {
    const one = await composeWindow(api, ask(100_000, 1), charsOver4);
    expect(
      one.parts
        .filter((part) => part.kind === "ancestor")
        .map((part) => part.ref),
    ).toEqual([refs.trees]);

    const none = await composeWindow(api, ask(100_000, 0), charsOver4);
    expect(kinds(none)).not.toContain("ancestor");
  });

  it("drops the best note when even its opening and headings do not fit, and says so twice", async () => {
    const full = await composeWindow(api, ask(100_000), charsOver4);

    const window = WindowSchema.parse(
      await composeWindow(api, ask(1), charsOver4),
    );

    expect(window.parts).toEqual([]);
    expect(window.cut.slice(-2)).toMatchObject([
      { kind: "note", ref: refs.grafting },
      { kind: "note", ref: refs.grafting },
    ]);
    expect(window.cut.reduce((sum, cut) => sum + cut.tokens, 0)).toBe(
      total(full),
    );
  });

  it("carries the instructions file's own opening as its line", async () => {
    const window = await composeWindow(api, ask(100_000), charsOver4);
    const opening = AGENT_MD.split("\n\n")[1].replaceAll("\n", " ");
    expect(window.parts.at(-1)).toEqual({
      kind: "instructions",
      path: ".sloppy/AGENT.md",
      text: opening,
      tokens: charsOver4(opening),
    });
  });

  it("holds only the instructions where no note answers the ask", async () => {
    const window = await composeWindow(
      api,
      WindowAskSchema.parse({ ask: "zeppelin", budget: 100_000 }),
      charsOver4,
    );
    expect(kinds(window)).toEqual(["instructions"]);
  });

  it("holds no code and no instructions where the graph is nobody's project", async () => {
    const graph = JSON.parse(
      new TextDecoder().decode(
        (await files.read(".sloppy/graph.json")) as Uint8Array,
      ),
    ) as Record<string, unknown>;
    delete graph.project;
    await files.write(
      ".sloppy/graph.json",
      new TextEncoder().encode(JSON.stringify(graph, null, 2)),
    );

    const window = await composeWindow(
      containerApi(files),
      ask(100_000),
      charsOver4,
    );
    expect(kinds(window)).toEqual(["note", "ancestor", "ancestor", "sibling"]);
  });

  it("shows a name's run from the lines that lead into it, as the code sheet does", async () => {
    await note(
      "Budding",
      ["nursery"],
      [`## What it is for\n\n[the bud](code:${BUD}#bud) takes one eye.`],
    );
    const window = await composeWindow(
      api,
      WindowAskSchema.parse({ ask: "budding", budget: 100_000 }),
      charsOver4,
    );
    const code = window.parts.find((part) => part.kind === "code");
    expect(code?.text).toBe(
      `${BUD}#bud (unread)\n// two\n// three\nexport function bud() {}\nconst eye = 1;`,
    );
  });
});
