// What an assistant is handed of the notes around a task — docs/ARCHITECTURE.md
// § "Asking a tool to write the notes".

import {
  BriefReadSchema,
  BriefShortSchema,
  SHORT_BRIEF_MAX,
  SHORT_BRIEF_READ,
  type ChatToolCall,
  GIST_MAX,
  NeighbourhoodReadSchema,
  NoteReadSchema,
  NotesFoundSchema,
  NoteWrittenSchema,
  type OwnedRef,
  ulid,
} from "@sloppy/types";
import { digestOf, emptySidecars, fromMarkdown } from "@sloppy/vault";
import { beforeEach, describe, expect, it } from "vitest";
import { containerApi, performChatCall } from "./acts.js";
import { gistOf, taskWords } from "./brief.js";
import { MemoryFiles } from "./files.js";

const PROJECT = "/work/compiler";
const PARSER = "src/parser.ts";
const LEXER = "src/lexer.ts";
const PARSER_SAYS =
  "export function parse() {}\nconst two = 2;\nconst three = 3;\n";

let files: MemoryFiles;

async function said(call: ChatToolCall): Promise<string> {
  const done = await performChatCall(files, call);
  expect(done.trouble).toBeUndefined();
  return done.said;
}

async function wrote(
  about: string,
  sections: string[],
  beside: { title?: string; under?: OwnedRef } = {},
): Promise<OwnedRef> {
  return NoteWrittenSchema.parse(
    JSON.parse(
      await said({
        call: "c1",
        act: "write_note",
        arguments: { about, sections, tags: ["parsing"], ...beside },
      }),
    ),
  ).note;
}

async function readAround(note: OwnedRef, depth = 1) {
  return NeighbourhoodReadSchema.parse(
    JSON.parse(
      await said({
        call: "c2",
        act: "read_around",
        arguments: { note, depth },
      }),
    ),
  );
}

function cites(note: OwnedRef, label = "that"): string {
  return `[${label}](sloppy:${note})`;
}

beforeEach(async () => {
  files = new MemoryFiles({ root: PROJECT, data: "/data" });
  await files.write(PARSER, new TextEncoder().encode(PARSER_SAYS));
  await files.write(LEXER, new TextEncoder().encode("export const one = 1;\n"));
  await containerApi(files).openProject(PROJECT);
});

describe("where the code under an anchor stands", () => {
  const ANCHORED = [
    `## Why\n\nIt reads [the parser](code:${PARSER}) whole.`,
    `## Where\n\n[parse](code:${PARSER}#parse), [the constants](code:${PARSER}#L2-L3), [past the end](code:${PARSER}#L2-L9), [a name gone](code:${PARSER}#tokenise), [the lexer](code:${LEXER}) and [a file gone](code:src/gone.ts).`,
  ];

  async function standings(note: OwnedRef) {
    return NoteReadSchema.parse(
      JSON.parse(
        await said({ call: "c2", act: "read_note", arguments: { note } }),
      ),
    ).anchors;
  }

  async function readAgainst(note: OwnedRef, path: string, digest: string) {
    await containerApi(files).updateNode(note, {
      read_against: [{ path, digest }],
    });
  }

  it("is held, moved, unread or missing, and says so one anchor at a time", async () => {
    const note = await wrote(PARSER, ANCHORED);
    await readAgainst(
      note,
      PARSER,
      await digestOf(new TextEncoder().encode(PARSER_SAYS)),
    );

    expect(await standings(note)).toEqual([
      { path: PARSER, standing: "held" },
      { path: PARSER, fragment: "parse", standing: "held" },
      { path: PARSER, fragment: "L2-L3", standing: "held" },
      { path: PARSER, fragment: "L2-L9", standing: "moved" },
      { path: PARSER, fragment: "tokenise", standing: "moved" },
      { path: LEXER, standing: "unread" },
      { path: "src/gone.ts", standing: "missing" },
    ]);
  });

  it("is unread on a folder that is there, which nothing digests, and missing on one that is not", async () => {
    const note = await wrote("src", [
      "## Why\n\nIt holds [the source](code:src), [what reads it](code:src/parse) and [a folder gone](code:lib).",
    ]);
    expect(await standings(note)).toEqual([
      { path: "src", standing: "unread" },
      { path: "src/parse", standing: "missing" },
      { path: "lib", standing: "missing" },
    ]);
  });

  it("is moved wherever the file a person read the note against has changed", async () => {
    const note = await wrote(PARSER, ANCHORED);
    await readAgainst(
      note,
      PARSER,
      await digestOf(new TextEncoder().encode(PARSER_SAYS)),
    );
    await files.write(
      PARSER,
      new TextEncoder().encode(`${PARSER_SAYS}const four = 4;\n`),
    );

    const parser = (await standings(note))?.filter(
      (one) => one.path === PARSER,
    );

    expect(parser?.map((one) => one.standing)).toEqual([
      "moved",
      "moved",
      "moved",
      "moved",
      "moved",
    ]);
  });

  it("is unread where the reading is spelled with an algorithm this build does not take", async () => {
    const note = await wrote(LEXER, [`## Why\n\n[the lexer](code:${LEXER})`]);
    await readAgainst(note, LEXER, `sha512:${"ab".repeat(64)}`);

    expect(await standings(note)).toEqual([
      { path: LEXER, standing: "unread" },
    ]);
  });

  it("is not answered at all where the graph is nobody's project", async () => {
    const note = await wrote(PARSER, ANCHORED);
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

    expect(await standings(note)).toBeUndefined();
    const around = await readAround(note);
    expect(around.note.anchors).toBeUndefined();
  });
});

describe("what a note says first", () => {
  const sections = (markdown: string) =>
    fromMarkdown(markdown, emptySidecars(ulid()));

  it("is the first paragraph that is not an anchor alone or a compass", () => {
    const other =
      "did:syr:z6MktEXAMPLEEXAMPLEEXAMPLEEXAMPLE/01JQ7X3K9M2N4P5R6S7T8V9W00";
    const opening = sections(
      `## What it is for\n\n[${PARSER}](code:${PARSER})\n\nnorth: [[${other}]]`,
    );
    const after = sections("## Why\n\nIt reads the source whole, once.");

    expect(opening.content.map((element) => element.type)).toContain("compass");
    expect(gistOf([opening, after])).toBe("It reads the source whole, once.");
  });

  it("keeps a paragraph that says something beside its anchor", () => {
    expect(
      gistOf([
        sections(`## Why\n\nIt reads [${PARSER}](code:${PARSER}) whole.`),
      ]),
    ).toBe(`It reads ${PARSER} whole.`);
  });

  it("is cut at a word to one line's length", () => {
    const gist = gistOf([sections(`## Why\n\n${"word ".repeat(200)}`)]);

    expect([...gist].length).toBeLessThanOrEqual(GIST_MAX);
    expect(gist.endsWith("word…")).toBe(true);
  });

  it("is empty where nothing in the note is a paragraph of its own", () => {
    expect(gistOf([sections(`## Where\n\n[${PARSER}](code:${PARSER})`)])).toBe(
      "",
    );
  });
});

describe("the notes around one", () => {
  /** A field of notes around `focal`: its parent, a note it cites and links to,
   *  one citing it, one beneath it, one linked to it, and one beside it. */
  async function field() {
    const root = await wrote("src", ["## What it is for\n\nThe compiler."]);
    const cited = await wrote(
      "src/cited.ts",
      ["## What it is for\n\nWhat the focal note leans on."],
      { under: root },
    );
    const focal = await wrote(
      "src/focal.ts",
      [`## Why\n\nIt follows ${cites(cited)}.`],
      { under: root },
    );
    const citing = await wrote(
      "src/citing.ts",
      [`## Why\n\nIt grew out of ${cites(focal)}.`],
      { under: root },
    );
    const child = await wrote(
      "src/focal/child.ts",
      ["## What it is for\n\nA part of it."],
      { under: focal },
    );
    const linked = await wrote("lib/linked.ts", [
      "## What it is for\n\nSomething beside it.",
    ]);
    await said({
      call: "c3",
      act: "link_notes",
      arguments: { note: focal, to: [linked, cited] },
    });
    const beside = await wrote(
      "src/beside.ts",
      ["## What it is for\n\nAnother part of the compiler."],
      { under: root },
    );
    return { root, cited, focal, citing, child, linked, beside };
  }

  it("walks to its parent, what it cites, what cites it, what is beneath it and what it is linked to, in that order and once each", async () => {
    const { root, cited, focal, citing, child, linked } = await field();

    const read = await readAround(focal);

    expect(read.note.note).toBe(focal);
    expect(
      read.around.map((one) => [one.note, one.relation, one.depth]),
    ).toEqual([
      [root, "parent", 1],
      [cited, "cites", 1],
      [citing, "cited_by", 1],
      [child, "child", 1],
      [linked, "linked", 1],
    ]);
    expect(read.around[1].gist).toBe("What the focal note leans on.");
  });

  it("reaches further a hop at a time, and answers the same way twice", async () => {
    const { focal, beside } = await field();

    const once = await readAround(focal, 2);
    const twice = await readAround(focal, 2);

    expect(once).toEqual(twice);
    expect(
      once.around.filter((one) => one.depth === 2).map((one) => one.note),
    ).toContain(beside);
    expect(new Set(once.around.map((one) => one.note)).size).toBe(
      once.around.length,
    );
  });
});

describe("a brief", () => {
  it("hands the notes asked for whole and the ones around them as one line", async () => {
    const parser = await wrote(PARSER, [
      `## Why\n\nIt reads [the parser](code:${PARSER}) whole.`,
    ]);
    const lexer = await wrote(LEXER, [
      `## Why\n\nIt tokenises before ${cites(parser, "the parser")} reads.`,
    ]);

    const brief = BriefReadSchema.parse(
      JSON.parse(
        await said({
          call: "c2",
          act: "brief",
          arguments: { about: [PARSER], budget: 65536 },
        }),
      ),
    );

    expect(brief.notes.map((note) => note.note)).toEqual([parser]);
    expect(brief.notes[0].anchors).toEqual([
      { path: PARSER, standing: "unread" },
    ]);
    expect(brief.around.map((one) => [one.note, one.relation])).toEqual([
      [lexer, "cited_by"],
    ]);
  });

  it("holds to its budget, handing a note asked for that does not fit as one line, and says how many it left", async () => {
    const small = await wrote(PARSER, ["## Why\n\nIt reads the source whole."]);
    const big = await wrote(LEXER, [
      `## Why\n\n${"Tokens come first. ".repeat(250)}`,
    ]);
    for (let n = 0; n < 12; n += 1) {
      await wrote(`src/part-${n}.ts`, [
        `## Why\n\nIt grew out of ${cites(small)}. ${"It says more. ".repeat(30)}`,
      ]);
    }

    const done = await performChatCall(files, {
      call: "c2",
      act: "brief",
      arguments: { notes: [small, big], budget: 4096 },
    });
    const brief = BriefReadSchema.parse(JSON.parse(done.said));

    expect(done.said.length).toBeLessThanOrEqual(4096);
    expect(brief.notes.map((note) => note.note)).toEqual([small]);
    expect(brief.around[0]).toEqual(
      expect.objectContaining({ note: big, relation: "named", depth: 0 }),
    );
    expect(brief.around[0].gist.startsWith("Tokens come first.")).toBe(true);
    expect(brief.more).toBeGreaterThan(0);
    expect(done.facts).toEqual({
      act: "brief",
      count: 1,
      around: brief.around.length,
    });
  });

  it("reaches the notes some words reach", async () => {
    const parser = await wrote(PARSER, [
      "## Why\n\nThe token economy decides how much it reads.",
    ]);
    await wrote(LEXER, ["## Why\n\nIt tokenises the source."]);

    const brief = BriefReadSchema.parse(
      JSON.parse(
        await said({
          call: "c2",
          act: "brief",
          arguments: { words: "token economy", budget: 65536 },
        }),
      ),
    );

    expect(brief.notes.map((note) => note.note)).toEqual([parser]);
  });
});

describe("answers that land on code", () => {
  async function landed(call: ChatToolCall): Promise<unknown> {
    const done = await performChatCall(files, call, false, {
      landOnCode: true,
    });
    expect(done.trouble).toBeUndefined();
    return JSON.parse(done.said);
  }

  it("name the exact lines each anchor stands for, one per anchor and in its order", async () => {
    const note = await wrote(PARSER, [
      `## Where\n\n[parse](code:${PARSER}#parse), [the constants](code:${PARSER}#L2-L3), [the lexer](code:${LEXER}), [a name gone](code:${PARSER}#tokenise), [the source](code:src) and [a file gone](code:src/gone.ts).`,
    ]);

    const read = NoteReadSchema.parse(
      await landed({ call: "c2", act: "read_note", arguments: { note } }),
    );

    expect(read.code).toEqual([
      `${PARSER}#L1-L3`,
      `${PARSER}#L2-L3`,
      `${LEXER}#L1-L1`,
      `${PARSER}#tokenise`,
      "src/",
      "src/gone.ts",
    ]);
    expect(read.code).toHaveLength(read.anchors?.length ?? 0);
  });

  it("are not named where nobody asked", async () => {
    const note = await wrote(PARSER, [
      `## Why\n\nIt reads [parse](code:${PARSER}#parse).`,
    ]);
    const read = NoteReadSchema.parse(
      JSON.parse(
        await said({ call: "c2", act: "read_note", arguments: { note } }),
      ),
    );
    expect(read.code).toBeUndefined();
  });

  it("send a search to the lines of the section its line was found in", async () => {
    await wrote(PARSER, [
      `## Why\n\nIt reads [the lexer](code:${LEXER}) first.`,
      `## How\n\nThe recursive descent lives in [parse](code:${PARSER}#parse).`,
    ]);

    const found = NotesFoundSchema.parse(
      await landed({
        call: "c2",
        act: "search_notes",
        arguments: { words: "recursive descent", detail: "line" },
      }),
    );

    expect(found.found[0].code).toEqual([`${PARSER}#L1-L3`]);
  });

  it("brief on a task with the note carrying most of its words, its opening, the sections those words reach, and their lines", async () => {
    const parser = await wrote(PARSER, [
      "## Why\n\nIt reads the source whole.",
      "## Speed\n\nIt never looks back.",
      `## Recovery\n\nWhen a token is unexpected the parser skips to the next statement, in [parse](code:${PARSER}#parse).`,
    ]);
    const lexer = await wrote(LEXER, [
      "## Why\n\nIt tokenises the source, unexpected or not.",
    ]);

    const brief = BriefShortSchema.parse(
      await landed({
        call: "c2",
        act: "brief",
        arguments: {
          words: "how does the parser recover from an unexpected token",
          budget: 65536,
        },
      }),
    );

    expect(brief.notes.map((note) => note.note)).toEqual([parser]);
    const [only] = brief.notes;
    expect(only.sections.map((section) => section.markdown)).toEqual([
      expect.stringContaining("## Why"),
      expect.stringContaining("## Recovery"),
    ]);
    expect(only.headings).toBeUndefined();
    expect(only.more).toBe(1);
    expect(only.code).toEqual([`${PARSER}#L1-L3`]);
    expect(brief.also.map((one) => one.note)).toContain(lexer);
    expect(brief.read).toBe(SHORT_BRIEF_READ);
  });

  it("brief on a task with the first note cut to fit, never another note first", async () => {
    const long = Array.from(
      { length: 400 },
      (_, at) => `The parser recovers from token ${at} by skipping ahead.`,
    ).join("\n\n");
    const parser = await wrote(PARSER, [
      `An opening said once.\n\n${long}`,
      `## Recovery\n\n${long}`,
    ]);

    const done = await performChatCall(
      files,
      {
        call: "c2",
        act: "brief",
        arguments: { words: "parser recovers token", budget: 65536 },
      },
      false,
      { landOnCode: true },
    );

    expect(done.said.length).toBeLessThanOrEqual(SHORT_BRIEF_MAX);
    const brief = BriefShortSchema.parse(JSON.parse(done.said));
    expect(brief.notes[0].note).toBe(parser);
    expect(brief.notes[0].sections[0].markdown).toMatch(
      /^An opening said once\.[\s\S]* …$/,
    );
  });

  it("brief on a task with the note's own lines where the sections its words reach point at none", async () => {
    await wrote(PARSER, [
      `## Why\n\nIt reads [parse](code:${PARSER}#parse).`,
      "## Recovery\n\nWhen a token is unexpected the parser skips ahead.",
    ]);

    const brief = BriefShortSchema.parse(
      await landed({
        call: "c2",
        act: "brief",
        arguments: { words: "unexpected token recovery", budget: 65536 },
      }),
    );

    expect(brief.notes[0].sections.map((one) => one.markdown)).toEqual([
      expect.stringContaining("## Why"),
      expect.stringContaining("## Recovery"),
    ]);
    expect(brief.notes[0].code).toEqual([`${PARSER}#L1-L3`]);
  });

  it("brief a note named with no words whole", async () => {
    const parser = await wrote(PARSER, [
      "## Why\n\nIt reads the source whole.",
      "## Recovery\n\nIt skips to the next statement.",
    ]);

    const brief = BriefShortSchema.parse(
      await landed({
        call: "c2",
        act: "brief",
        arguments: { notes: [parser], budget: 65536 },
      }),
    );

    expect(brief.notes[0].sections.map((one) => one.markdown)).toEqual([
      expect.any(String),
      expect.stringContaining("## Why"),
      expect.stringContaining("## Recovery"),
    ]);
    expect(brief.notes[0].more).toBeUndefined();
  });
});

describe("the words of a task", () => {
  it("are the ones that say what it is about, each once", () => {
    expect(
      taskWords("How is the Energy model built, and why? The model."),
    ).toEqual(["energy", "model", "built"]);
  });
});
