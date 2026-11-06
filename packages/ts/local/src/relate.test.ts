// Where a note belongs and what it relates to — docs/ARCHITECTURE.md § "Asking
// a tool to write the notes".

import {
  type BlockDocument,
  type BlockView,
  type ChatToolCall,
  type NodeView,
  NoteWrittenSchema,
  type OwnedRef,
} from "@sloppy/types";
import { emptySidecars, fromMarkdown } from "@sloppy/vault";
import { beforeEach, describe, expect, it } from "vitest";
import { containerApi, performChatCall } from "./acts.js";
import { MemoryFiles } from "./files.js";
import { type NoteHere, notesHere } from "./here.js";
import {
  indexFor,
  indexOf,
  relationsOf,
  subjectOfDraft,
  subjectOfNote,
} from "./relate.js";

const PROJECT = "/work/compiler";

let files: MemoryFiles;

async function wrote(
  about: string,
  sections: string[],
  beside: { title?: string; tags?: string[]; under?: OwnedRef } = {},
): Promise<OwnedRef> {
  const call: ChatToolCall = {
    call: "c1",
    act: "write_note",
    arguments: { about, sections, ...beside },
  };
  const done = await performChatCall(files, call);
  expect(done.trouble).toBeUndefined();
  return NoteWrittenSchema.parse(JSON.parse(done.said)).note;
}

async function here(): Promise<NoteHere[]> {
  return notesHere(containerApi(files));
}

function documents(...markdown: string[]): BlockDocument[] {
  const aside = emptySidecars("01J00000000000000000000000");
  return markdown.map((one) => fromMarkdown(one, aside));
}

beforeEach(async () => {
  files = new MemoryFiles({ root: PROJECT, data: "/data" });
  await containerApi(files).openProject(PROJECT);
});

describe("the index over a project's notes", () => {
  it("ranks the same notes the same way, whatever order they are read in", async () => {
    const source = await wrote(
      "src",
      ["## Why\n\nEverything the compiler reads."],
      {
        title: "The source",
      },
    );
    await wrote(
      "src/parser.ts",
      ["## Why\n\nThe parser turns tokens into a grammar tree."],
      { title: "Parsing", tags: ["parsing"], under: source },
    );
    await wrote("src/lexer.ts", ["## Why\n\nThe lexer cuts tokens."], {
      title: "Lexing",
      tags: ["parsing"],
      under: source,
    });
    const notes = await here();
    const draft = {
      title: "Grammar tokens",
      sections: documents("## Why\n\nTokens and the grammar tree."),
      about: "src/grammar.ts",
      tags: ["parsing"],
    };

    const once = indexOf(notes);
    const again = indexOf([...notes].reverse());

    expect(relationsOf(again, subjectOfDraft(again, draft), 5)).toEqual(
      relationsOf(once, subjectOfDraft(once, draft), 5),
    );
  });

  it("is built again once a note changes, and kept while none does", async () => {
    await wrote("src/parser.ts", ["## Why\n\nTokens into a tree."], {
      title: "Parsing",
    });
    const first = indexFor(PROJECT, await here());

    expect(indexFor(PROJECT, await here())).toBe(first);

    await wrote("src/lexer.ts", ["## Why\n\nCuts tokens."], {
      title: "Lexing",
    });

    expect(indexFor(PROJECT, await here())).not.toBe(first);
  });
});

describe("why two notes are related", () => {
  it("names the strongest words they share", async () => {
    const parsing = await wrote(
      "docs/parsing.md",
      ["## Why\n\nPrecedence climbing keeps operator precedence in one table."],
      { title: "Precedence climbing" },
    );
    await wrote("docs/other.md", ["## Why\n\nSomething else entirely."], {
      title: "Release checklist",
    });
    const index = indexOf(await here());

    const { links } = relationsOf(
      index,
      subjectOfDraft(index, {
        title: "Operator precedence",
        sections: documents("## Why\n\nThe precedence table, climbing."),
        tags: [],
      }),
      5,
    );

    expect(links[0]?.note).toBe(parsing);
    expect(links[0]?.reasons[0]).toMatch(/^shares the words .*“precedence”/);
  });

  it("names the code both point at", async () => {
    const parser = await wrote("src/parser.ts", ["## Why\n\nOne."], {
      title: "Alpha",
    });
    const index = indexOf(await here());

    const { links } = relationsOf(
      index,
      subjectOfDraft(index, {
        title: "Beta",
        sections: [],
        about: "src/parser.ts",
        tags: [],
      }),
      5,
    );

    expect(links.find((one) => one.note === parser)?.reasons).toContain(
      "both point at src/parser.ts",
    );
  });

  it("names a folder both point into", async () => {
    const parser = await wrote("src/read/parser.ts", ["## Why\n\nOne."], {
      title: "Alpha",
    });
    const index = indexOf(await here());

    const { links } = relationsOf(
      index,
      subjectOfDraft(index, {
        title: "Beta",
        sections: [],
        about: "src/read/lexer.ts",
        tags: [],
      }),
      5,
    );

    expect(links.find((one) => one.note === parser)?.reasons).toContain(
      "both point into src/read/",
    );
  });

  it("names the note a line joins both of them to", async () => {
    const hub = await wrote("docs/hub.md", ["## Why\n\nWhere it starts."], {
      title: "The hub",
    });
    const cites = (name: string) =>
      wrote(`docs/${name}.md`, [`## Why\n\nSee [the hub](sloppy:${hub}).`], {
        title: name,
      });
    const left = await cites("Left");
    const right = await cites("Right");
    const index = indexOf(await here());
    const subject = subjectOfNote(index, left);
    if (!subject) throw new Error("no subject");

    const { links } = relationsOf(index, subject, 5);

    expect(links.find((one) => one.note === right)?.reasons).toContain(
      "both are linked with “The hub”",
    );
    expect(links.map((one) => one.note)).not.toContain(hub);
  });
});

describe("where a note belongs", () => {
  it("is the note it is most related to, where that differs from the folder above it", async () => {
    const source = await wrote(
      "src",
      ["## Why\n\nEverything the compiler reads."],
      {
        title: "The source",
      },
    );
    const parsing = await wrote(
      "src/parser.ts",
      [
        "## Why\n\nThe parser turns a stream of tokens into a syntax tree, by the grammar.",
      ],
      { title: "Parsing", tags: ["parsing"], under: source },
    );
    await wrote(
      "src/emit.ts",
      ["## Why\n\nThe emitter writes bytecode for the machine."],
      { title: "Emitting", tags: ["output"], under: source },
    );
    const index = indexOf(await here());

    const { parents } = relationsOf(
      index,
      subjectOfDraft(index, {
        title: "Grammar productions",
        sections: documents(
          `## Why\n\nEach production of the grammar the [parser](sloppy:${parsing}) reads tokens by, into the syntax tree.`,
        ),
        about: "src/grammar.ts",
        tags: ["parsing"],
      }),
      3,
    );

    expect(parents[0]?.note).toBe(parsing);
    expect(parents.map((one) => one.note)).toContain(source);
  });

  it("is never a note beneath it", async () => {
    const top = await wrote("docs/top.md", ["## Why\n\nTokens and trees."], {
      title: "Tokens",
    });
    const below = await wrote(
      "docs/below.md",
      ["## Why\n\nTokens and trees."],
      {
        title: "Tokens",
        under: top,
      },
    );
    const index = indexOf(await here());
    const subject = subjectOfNote(index, top);
    if (!subject) throw new Error("no subject");

    const { parents, links } = relationsOf(index, subject, 5);

    expect(parents.map((one) => one.note)).not.toContain(below);
    expect(links.map((one) => one.note)).not.toContain(below);
  });
});

describe("the index on a graph of five hundred notes", () => {
  it("is built and asked within a bound", () => {
    const words = Array.from({ length: 2000 }, (_, at) => `term${at}`);
    const synthetic: NoteHere[] = Array.from({ length: 500 }, (_, at) => {
      const ref =
        `did:example:graph/${String(at).padStart(26, "0")}` as OwnedRef;
      const text = Array.from(
        { length: 300 },
        (_, word) => words[(at * 7 + word * 13) % words.length],
      ).join(" ");
      const note = {
        ref,
        title: `Note ${words[at % words.length]} ${words[(at * 3) % words.length]}`,
        tags: [`tag${at % 12}`],
        links:
          at > 0
            ? [`did:example:graph/${String(at - 1).padStart(26, "0")}`]
            : [],
        ...(at === 0
          ? {}
          : {
              parent: `did:example:graph/${String(Math.floor(at / 4)).padStart(26, "0")}`,
            }),
        updated_at: "2026-11-01T00:00:00.000Z",
      } as unknown as NodeView;
      const block = {
        ref: `${ref}-b` as OwnedRef,
        updated_at: note.updated_at,
        content: documents(`## Why\n\n${text}`)[0],
      } as unknown as BlockView;
      return {
        note,
        about: [`src/part${at % 20}/file${at}.ts`],
        blocks: [block],
      };
    });

    const built = performance.now();
    const index = indexOf(synthetic);
    const builtIn = performance.now() - built;
    const asked = performance.now();
    for (const held of synthetic.slice(0, 20)) {
      const subject = subjectOfNote(index, held.note.ref);
      if (subject) relationsOf(index, subject, 10);
    }
    const askedIn = (performance.now() - asked) / 20;

    expect(builtIn).toBeLessThan(2000);
    expect(askedIn).toBeLessThan(500);
  });
});
