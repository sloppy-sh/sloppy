// Sloppy's own acts, done against a project's container and answered to the
// agent — docs/ARCHITECTURE.md § "Asking a tool to write the notes".

import { AGENT_FILE } from "./agent-md.js";
import { LocalApi } from "./api.js";
import { MemoryFiles } from "./files.js";
import {
  type WriteNoteArguments,
  BinListedSchema,
  BriefReadSchema,
  BriefShortSchema,
  CodeFoundSchema,
  ChatToolAnswerSchema,
  FOUND_LINE_MAX,
  type ChatToolCall,
  GraphReadSchema,
  type NodeView,
  HEADING_MAX,
  ListedNoteSchema,
  NeighbourhoodReadSchema,
  NoteBinnedSchema,
  NOTE_OUTLINE_READ,
  NoteReadSchema,
  NotesFoundSchema,
  NotesListedSchema,
  NoteWrittenSchema,
  OffersListedSchema,
  type OwnedRef,
  RelatedSchema,
  splitOwnedRef,
  TagsListedSchema,
  ulid,
  UNNAMED_GRAPH_ULID,
  WHOLE_NOTE_MAX,
} from "@sloppy/types";
import { beforeEach, describe, expect, it } from "vitest";
import { containerApi, performChatCall } from "./acts.js";
import { type CodeReader, codeIndexOf } from "./code-index.js";
import { symbolsIn } from "./code-symbols.js";

const PROJECT = "/work/compiler";
const SOMEBODY = "did:syr:z6MkrAnotherPersonWritingHereAAAAAAAAAAAAAAAA";
const PARSER = "src/parser.ts";
const ABOUT_THE_PARSER = `## Why\n\nIt reads [${PARSER}](code:${PARSER}) whole.`;
const PLACES_FILE = "src/places.ts";
const READING_DOC = "docs/reading.md";

let files: MemoryFiles;

async function answer(
  call: ChatToolCall,
  at: MemoryFiles = files,
): Promise<string> {
  const said = await performChatCall(at, call);
  expect(said.trouble).toBeUndefined();
  ChatToolAnswerSchema.parse({ said: said.said, trouble: said.trouble });
  return said.said;
}

/** A write asked to start a note about the place, whatever links to it. */
function startsAbout(about: string, sections: string[]): ChatToolCall {
  const call = writes(about, sections);
  return {
    call: call.call,
    act: "write_note",
    arguments: { ...(call.arguments as WriteNoteArguments), start: true },
  };
}

function writes(
  about: string,
  sections: string[],
  beside: {
    title?: string;
    tags?: string[];
    under?: OwnedRef;
    address?: string;
  } = {},
): ChatToolCall {
  return {
    call: "c1",
    act: "write_note",
    arguments: { about, sections, ...beside },
  };
}

/** The ref of the note a write left, which is what every act after it names. */
async function wrote(
  call: ChatToolCall,
  at: MemoryFiles = files,
): Promise<OwnedRef> {
  return NoteWrittenSchema.parse(JSON.parse(await answer(call, at))).note;
}

/** The container as somebody else's writing left it: a note nobody here wrote,
 *  which is what an offer rather than an overwrite rests on. */
async function theirNote(): Promise<OwnedRef> {
  const theirs = new LocalApi(containerApi(files).files, { writer: SOMEBODY });
  const note = await theirs.createNode({
    from: { relation: "free" },
    title: "The parser",
  });
  await theirs.createBlock({
    node: note.ref,
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: PARSER,
              marks: [{ type: "link", attrs: { href: `code:${PARSER}` } }],
            },
          ],
        },
      ],
    },
  });
  return note.ref;
}

beforeEach(async () => {
  files = new MemoryFiles({ root: PROJECT, data: "/data" });
  await files.write(
    PARSER,
    new TextEncoder().encode("export const one = 1;\n"),
  );
  await containerApi(files).openProject(PROJECT);
});

describe("the notes a project has", () => {
  it("are none where nothing has been written", async () => {
    const said = await answer({ call: "c1", act: "list_notes", arguments: {} });

    expect(NotesListedSchema.parse(JSON.parse(said)).notes).toEqual([]);
  });

  it("carry what a note is called, what it is tagged and what it is about", async () => {
    await answer(
      writes(PARSER, [ABOUT_THE_PARSER], {
        title: "The parser",
        tags: ["reading"],
      }),
    );

    const listed = NotesListedSchema.parse(
      JSON.parse(
        await answer({
          call: "c2",
          act: "list_notes",
          arguments: { about: true },
        }),
      ),
    );

    expect(listed.notes).toHaveLength(1);
    expect(listed.notes[0].title).toBe("The parser");
    expect(listed.notes[0].tags).toEqual(["reading"]);
    expect(listed.notes[0].about).toEqual([PARSER]);
  });

  it("leave out the places each note is about unless they are asked for", async () => {
    await answer(writes(PARSER, [ABOUT_THE_PARSER], { title: "The parser" }));

    const listed = NotesListedSchema.parse(
      JSON.parse(
        await answer({ call: "c2", act: "list_notes", arguments: {} }),
      ),
    );

    expect(listed.notes).toHaveLength(1);
    expect(listed.notes[0].title).toBe("The parser");
    expect(listed.notes[0]).not.toHaveProperty("about");
  });

  async function listed(asked: { at?: string; tags?: string[] }) {
    return NotesListedSchema.parse(
      JSON.parse(
        await answer({ call: "c9", act: "list_notes", arguments: asked }),
      ),
    ).notes.map((one) => one.title);
  }

  it("are narrowed to a place: a note at it, inside it, or about a folder it is in", async () => {
    await answer(
      writes("src", ["## Why\n\nThe compiler."], { title: "The compiler" }),
    );
    await answer(writes(PARSER, [ABOUT_THE_PARSER], { title: "The parser" }));
    await answer(
      writes(READING_DOC, ["## Why\n\nHow to read."], { title: "Reading" }),
    );

    expect(await listed({ at: PARSER })).toEqual([
      "The compiler",
      "The parser",
    ]);
    expect(await listed({ at: "src" })).toEqual(["The compiler", "The parser"]);
    expect(await listed({ at: "docs" })).toEqual(["Reading"]);
    expect(await listed({ at: "lib" })).toEqual([]);
  });

  it("are narrowed to the notes carrying every tag named", async () => {
    await answer(
      writes(PARSER, [ABOUT_THE_PARSER], {
        title: "The parser",
        tags: ["reading", "parsing"],
      }),
    );
    await answer(
      writes(READING_DOC, ["## Why\n\nHow to read."], {
        title: "Reading",
        tags: ["reading"],
      }),
    );

    expect(await listed({ tags: ["reading"] })).toEqual([
      "The parser",
      "Reading",
    ]);
    expect(await listed({ tags: ["reading", "parsing"] })).toEqual([
      "The parser",
    ]);
    expect(await listed({ tags: ["reading", "lexing"] })).toEqual([]);
  });
});

describe("reading a note against the code", () => {
  it("says where the code under each of its anchors stands", async () => {
    const note = await wrote(
      writes(PARSER, [
        `${ABOUT_THE_PARSER} See [one](code:${PARSER}#one) and [gone](code:src/gone.ts).`,
      ]),
    );

    const read = NoteReadSchema.parse(
      JSON.parse(
        await answer({ call: "c2", act: "read_note", arguments: { note } }),
      ),
    );

    expect(read.anchors).toEqual([
      { path: PARSER, standing: "unread" },
      { path: PARSER, fragment: "one", standing: "unread" },
      { path: "src/gone.ts", standing: "missing" },
    ]);
  });

  it("writes nothing on the note, and leaves its readings the person's", async () => {
    const note = await wrote(writes(PARSER, [ABOUT_THE_PARSER]));
    const before = await containerApi(files).getNode(note);
    const held = async () => {
      const paths = (await files.list(".sloppy")).sort();
      expect(paths.length).toBeGreaterThan(0);
      const read = await Promise.all(
        paths.map(async (path) => [path, await files.read(path)] as const),
      );
      expect(read.every(([, bytes]) => bytes !== undefined)).toBe(true);
      return read;
    };
    const heldBefore = await held();

    await answer({ call: "c2", act: "read_note", arguments: { note } });
    await answer({
      call: "c3",
      act: "read_around",
      arguments: { note, depth: 2 },
    });
    await answer({
      call: "c4",
      act: "brief",
      arguments: { notes: [note], budget: 65536 },
    });

    const after = await containerApi(files).getNode(note);
    expect(after?.read_against).toBeUndefined();
    expect(after?.checked).toBeUndefined();
    expect(after?.updated_at).toBe(before?.updated_at);
    expect(await held()).toEqual(heldBefore);
  });
});

describe("a note and the notes around it", () => {
  it("answers the note whole and what is around it, and counts them for the person", async () => {
    const parser = await wrote(
      writes(PARSER, [ABOUT_THE_PARSER], { title: "The parser" }),
    );
    const lexer = await wrote(
      writes(PLACES_FILE, [
        `## Why\n\nIt feeds [the parser](sloppy:${parser}).`,
      ]),
    );

    const done = await performChatCall(files, {
      call: "c2",
      act: "read_around",
      arguments: { note: parser, depth: 1 },
    });
    const read = NeighbourhoodReadSchema.parse(JSON.parse(done.said));

    expect(read.note.title).toBe("The parser");
    expect(read.around.map((one) => one.note)).toEqual([lexer]);
    expect(done.facts).toEqual(
      expect.objectContaining({ act: "read_around", count: 1 }),
    );
    expect(done.touched).toEqual([]);
  });

  it("answers a note that is not there with words the agent can act on", async () => {
    const done = await performChatCall(files, {
      call: "c2",
      act: "read_around",
      arguments: { note: `${SOMEBODY}/${ulid()}`, depth: 1 },
    });

    expect(done.trouble).toBe(true);
    expect(done.refused).toBe("no_note");
  });
});

describe("showing a note to a reader in a headset", () => {
  it("says which note the reader is looking at, and writes nothing", async () => {
    const parser = await wrote(
      writes(PARSER, [ABOUT_THE_PARSER], { title: "The parser", address: "1" }),
    );

    const done = await performChatCall(files, {
      call: "c2",
      act: "show_note",
      arguments: { note: parser },
    });

    expect(done.said).toBe("The reader is now looking at «The parser» (1).");
    expect(done.facts).toEqual(expect.objectContaining({ act: "show_note" }));
    expect(done.touched).toEqual([]);
  });

  it("answers a note that is not there with words the agent can act on", async () => {
    const done = await performChatCall(files, {
      call: "c2",
      act: "show_note",
      arguments: { note: `${SOMEBODY}/${ulid()}` },
    });

    expect(done.trouble).toBe(true);
    expect(done.refused).toBe("no_note");
  });
});

describe("a brief", () => {
  it("refuses one that names nothing, in words the agent can act on", async () => {
    const done = await performChatCall(files, {
      call: "c2",
      act: "brief",
      arguments: { budget: 65536 },
    });

    expect(done.trouble).toBe(true);
    expect(done.refused).toBe("nothing_asked");
    expect(done.said).toBe(
      "That names nothing to brief on. Name notes, places or words.",
    );
  });

  it("refuses a note named that is not there", async () => {
    const done = await performChatCall(files, {
      call: "c2",
      act: "brief",
      arguments: { notes: [`${SOMEBODY}/${ulid()}`], budget: 65536 },
    });

    expect(done.refused).toBe("no_note");
  });

  it("briefs on a place, and counts what it handed over for the person", async () => {
    const parser = await wrote(writes(PARSER, [ABOUT_THE_PARSER]));

    const done = await performChatCall(files, {
      call: "c2",
      act: "brief",
      arguments: { about: [PARSER], budget: 65536 },
    });

    expect(BriefReadSchema.parse(JSON.parse(done.said)).notes[0].note).toBe(
      parser,
    );
    expect(done.facts).toEqual({ act: "brief", count: 1, around: 0 });
  });
});

describe("writing a note", () => {
  it("starts one where the place has none, and says so", async () => {
    const written = NoteWrittenSchema.parse(
      JSON.parse(
        await answer(
          writes(PARSER, [ABOUT_THE_PARSER], { title: "The parser" }),
        ),
      ),
    );

    expect(written.done).toBe("written");
    const read = NoteReadSchema.parse(
      JSON.parse(
        await answer({
          call: "c2",
          act: "read_note",
          arguments: { note: written.note },
        }),
      ),
    );
    expect(read.title).toBe("The parser");
    expect(read.sections[0].markdown).toContain("It reads");
  });

  it("writes onto the note that points at the place rather than a second one", async () => {
    const first = NoteWrittenSchema.parse(
      JSON.parse(await answer(writes(PARSER, [ABOUT_THE_PARSER]))),
    );
    const again = NoteWrittenSchema.parse(
      JSON.parse(
        await answer(
          writes(PARSER, [
            `## Why\n\nIt reads [${PARSER}](code:${PARSER}) twice.`,
          ]),
        ),
      ),
    );

    expect(again.note).toBe(first.note);
    expect(again.done).toBe("written");
    const listed = NotesListedSchema.parse(
      JSON.parse(
        await answer({ call: "c3", act: "list_notes", arguments: {} }),
      ),
    );
    expect(listed.notes).toHaveLength(1);
  });

  it("holds the place a note it started is about, so the next write lands on it", async () => {
    const first = NoteWrittenSchema.parse(
      JSON.parse(
        await answer(
          writes(PARSER, ["## Why\n\nBecause it is bounded."], {
            title: "The parser",
          }),
        ),
      ),
    );
    const again = NoteWrittenSchema.parse(
      JSON.parse(await answer(writes(PARSER, ["## How\n\nBy one table."]))),
    );

    expect(again.note).toBe(first.note);
    const listed = NotesListedSchema.parse(
      JSON.parse(
        await answer({
          call: "c3",
          act: "list_notes",
          arguments: { about: true },
        }),
      ),
    );
    expect(listed.notes).toHaveLength(1);
    expect(listed.notes[0].title).toBe("The parser");
    expect(listed.notes[0].about).toEqual([PARSER]);
  });

  // A project's container is an open graph, so the store would let this land.
  // The rule that makes it an offer is the writer's own — `writeOnto`.
  it("offers a change on a note somebody else has written in", async () => {
    const theirs = await theirNote();

    const written = NoteWrittenSchema.parse(
      JSON.parse(
        await answer(writes(PARSER, ["## Why\n\nBecause it is bounded."])),
      ),
    );

    expect(written.note).toBe(theirs);
    expect(written.done).toBe("offered");
  });

  it("hangs a note under the one the agent named", async () => {
    const folder = await wrote(
      writes("src", ["## Why\n\nEverything the compiler reads."]),
    );
    const elsewhere = await wrote(
      writes(READING_DOC, ["## Why\n\nWhat somebody new reads first."], {
        title: "Reading",
      }),
    );

    const under = await wrote(
      writes(PLACES_FILE, ["## Why\n\nWhere each name was written."], {
        under: elsewhere,
      }),
    );

    const notes = NotesListedSchema.parse(
      JSON.parse(
        await answer({ call: "c4", act: "list_notes", arguments: {} }),
      ),
    ).notes;
    expect(notes.find((one) => one.note === under)?.parent).toBe(elsewhere);
    expect(notes.find((one) => one.note === elsewhere)?.parent).toBe(folder);
  });

  it("hangs a note under the note about the folder above it where the agent names none", async () => {
    const folder = await wrote(
      writes("src", ["## Why\n\nEverything the compiler reads."]),
    );

    const note = await wrote(
      writes(PARSER, [ABOUT_THE_PARSER], { title: "The parser" }),
    );

    const notes = NotesListedSchema.parse(
      JSON.parse(
        await answer({ call: "c4", act: "list_notes", arguments: {} }),
      ),
    ).notes;
    expect(notes.find((one) => one.note === note)?.parent).toBe(folder);
  });

  it("lands on the note started about the place, not one that cites it in passing", async () => {
    const citing = await wrote(
      writes(PLACES_FILE, [
        `## Why\n\nIt hands names to [${PARSER}](code:${PARSER}).`,
      ]),
    );
    const api = containerApi(files);
    const started = await api.createNode({
      from: { relation: "free" },
      title: "The parser",
    });
    await api.createBlock({
      node: started.ref,
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: PARSER,
                marks: [{ type: "link", attrs: { href: `code:${PARSER}` } }],
              },
            ],
          },
        ],
      },
    });

    const written = await wrote(writes(PARSER, ["## How\n\nBy one table."]));

    expect(written).toBe(started.ref);
    const kept = NoteReadSchema.parse(
      JSON.parse(
        await answer({
          call: "c2",
          act: "read_note",
          arguments: { note: citing },
        }),
      ),
    );
    expect(kept.sections.map((one) => one.markdown).join("\n")).not.toContain(
      "By one table",
    );
  });

  it("writes onto the one note that cites the place where none was started about it", async () => {
    const citing = await wrote(
      writes(PLACES_FILE, [
        `## Why\n\nIt hands names to [${PARSER}](code:${PARSER}).`,
      ]),
    );

    const written = NoteWrittenSchema.parse(
      JSON.parse(await answer(writes(PARSER, ["## How\n\nBy one table."]))),
    );

    expect(written.note).toBe(citing);
    expect(written.done).toBe("written");
  });

  it("starts a note about the place when asked to, even where one note cites it", async () => {
    const citing = await wrote(
      writes(PLACES_FILE, [
        `## Why\n\nIt hands names to [${PARSER}](code:${PARSER}).`,
      ]),
    );

    const written = NoteWrittenSchema.parse(
      JSON.parse(
        await answer(startsAbout(PARSER, ["## How\n\nBy one table."])),
      ),
    );

    expect(written.note).not.toBe(citing);
    expect(written.done).toBe("written");
  });

  it("writes onto the note started about the place even when asked to start one", async () => {
    const started = await wrote(writes(PARSER, ["## What\n\nA parser."]));

    const written = NoteWrittenSchema.parse(
      JSON.parse(
        await answer(startsAbout(PARSER, ["## How\n\nBy one table."])),
      ),
    );

    expect(written.note).toBe(started);
  });

  it("refuses where several notes cite the place and none was started about it, naming them", async () => {
    const one = await wrote(
      writes(
        PLACES_FILE,
        [`## Why\n\nIt hands names to [${PARSER}](code:${PARSER}).`],
        {
          title: "Places",
        },
      ),
    );
    const two = await wrote(
      writes(
        READING_DOC,
        [`## Why\n\nRead [${PARSER}](code:${PARSER}) first.`],
        {
          title: "Reading",
        },
      ),
    );

    const said = await performChatCall(
      files,
      writes(PARSER, ["## How\n\nBy one table."]),
    );

    expect(said.trouble).toBe(true);
    expect(said.touched).toEqual([]);
    for (const named of [one, two, "Places", "Reading"]) {
      expect(said.said).toContain(named);
    }
    const listed = NotesListedSchema.parse(
      JSON.parse(
        await answer({ call: "c3", act: "list_notes", arguments: {} }),
      ),
    );
    expect(listed.notes).toHaveLength(2);
  });

  it("starts a note where nothing here reaches the place", async () => {
    const other = await wrote(
      writes(PLACES_FILE, ["## Why\n\nWhere each name was written."]),
    );

    const written = NoteWrittenSchema.parse(
      JSON.parse(await answer(writes(PARSER, ["## How\n\nBy one table."]))),
    );

    expect(written.note).not.toBe(other);
    expect(written.done).toBe("written");
  });

  it("answers a write under a note that is not there with words the agent can act on", async () => {
    const said = await performChatCall(
      files,
      writes(PARSER, [ABOUT_THE_PARSER], {
        under: `${SOMEBODY}/01J0000000000000000000000A`,
      }),
    );

    expect(said.trouble).toBe(true);
    expect(said.said).toContain("no note");
  });

  it("reads only the sections named, and names every heading the note has", async () => {
    const note = await wrote(
      writes(
        PARSER,
        [
          `## What it is for\n\nIt reads [${PARSER}](code:${PARSER}).`,
          "## Why\n\nBecause a file is read once.",
          "## Open questions\n\nNone yet.",
        ],
        { title: "The parser" },
      ),
    );

    const read = NoteReadSchema.parse(
      JSON.parse(
        await answer({
          call: "c2",
          act: "read_note",
          arguments: { note, sections: ["why"] },
        }),
      ),
    );

    expect(read.headings).toEqual(["What it is for", "Why", "Open questions"]);
    expect(read.sections).toHaveLength(1);
    expect(read.sections[0].markdown).toContain("Because a file is read once.");
    expect(read.about).toEqual([PARSER]);
  });

  it("reads the whole note where no sections are named", async () => {
    const note = await wrote(
      writes(PARSER, [ABOUT_THE_PARSER, "## How\n\nBy one table."]),
    );

    const read = NoteReadSchema.parse(
      JSON.parse(
        await answer({ call: "c2", act: "read_note", arguments: { note } }),
      ),
    );

    expect(read.sections).toHaveLength(2);
    expect(read.headings).toEqual(["Why", "How"]);
  });

  describe("where answers land on code", () => {
    const LONG = "It reads one token at a time. ".repeat(120);
    const longNote = () =>
      wrote(
        writes(
          PARSER,
          [
            `## What it is for\n\nIt reads [${PARSER}](code:${PARSER}).`,
            `## Why\n\n${LONG}`,
            `## How\n\n${LONG}`,
          ],
          { title: "The parser" },
        ),
      );

    async function leanRead(note: OwnedRef, sections?: string[]) {
      const done = await performChatCall(
        files,
        {
          call: "c2",
          act: "read_note",
          arguments: { note, ...(sections === undefined ? {} : { sections }) },
        },
        false,
        { landOnCode: true },
      );
      expect(done.trouble).toBeUndefined();
      expect(done.facts).toMatchObject({ act: "read_note" });
      return NoteReadSchema.parse(JSON.parse(done.said));
    }

    it("answers a long note as its opening and the heading and size of each other section", async () => {
      const note = await longNote();
      const whole = NoteReadSchema.parse(
        JSON.parse(
          await answer({ call: "c2", act: "read_note", arguments: { note } }),
        ),
      );

      const read = await leanRead(note);

      expect(read.sections).toEqual([whole.sections[0]]);
      expect(read.outline).toEqual([
        { heading: "Why", size: whole.sections[1].markdown.length },
        { heading: "How", size: whole.sections[2].markdown.length },
      ]);
      expect(read.read).toBe(NOTE_OUTLINE_READ);
      expect(read.headings).toBeUndefined();
      expect(read.more).toBeUndefined();
      expect(read.about).toEqual([PARSER]);
    });

    it("opens a long note at its first section with writing of its own, and carries what no heading names whole", async () => {
      const note = await longNote();
      await containerApi(files).createBlock({
        node: note,
        content: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: PARSER,
                  marks: [{ type: "link", attrs: { href: `code:${PARSER}` } }],
                },
              ],
            },
          ],
        },
      });

      const read = await leanRead(note);

      expect(read.sections.map(({ markdown }) => markdown)).toEqual([
        `[${PARSER}](code:${PARSER})`,
        expect.stringContaining("What it is for"),
      ]);
      expect(read.outline?.map(({ heading }) => heading)).toEqual([
        "Why",
        "How",
      ]);
    });

    it("carries a section whole whose heading is too long to be asked for by name", async () => {
      const heading = "A heading that runs on ".repeat(20).trim();
      const note = await wrote(
        writes(
          PARSER,
          [
            `## What it is for\n\nIt reads [${PARSER}](code:${PARSER}).`,
            `## ${heading}\n\n${LONG}`,
            `## How\n\n${LONG}`,
          ],
          { title: "The parser" },
        ),
      );
      expect(heading.length).toBeGreaterThan(HEADING_MAX);

      const read = await leanRead(note);

      expect(read.sections.map(({ markdown }) => markdown)).toEqual([
        expect.stringContaining("What it is for"),
        expect.stringContaining(heading),
      ]);
      expect(read.outline?.map(({ heading }) => heading)).toEqual(["How"]);
    });

    it("reads the sections a long note is asked for whole, as anywhere else", async () => {
      const read = await leanRead(await longNote(), ["how"]);

      expect(read.sections).toHaveLength(1);
      expect(read.sections[0].markdown).toContain(LONG.trim());
      expect(read.headings).toEqual(["What it is for", "Why", "How"]);
      expect(read.outline).toBeUndefined();
      expect(read.read).toBeUndefined();
    });

    it("answers a note no longer than a whole one runs to whole", async () => {
      const note = await wrote(
        writes(PARSER, [ABOUT_THE_PARSER, "## How\n\nBy one table."]),
      );

      const read = await leanRead(note);

      expect(read.sections).toHaveLength(2);
      expect(read.outline).toBeUndefined();
      expect(
        read.sections.reduce((sum, one) => sum + one.markdown.length, 0),
      ).toBeLessThanOrEqual(WHOLE_NOTE_MAX);
    });

    it("leaves a long note whole where answers do not land on code", async () => {
      const read = NoteReadSchema.parse(
        JSON.parse(
          await answer({
            call: "c2",
            act: "read_note",
            arguments: { note: await longNote() },
          }),
        ),
      );

      expect(read.sections).toHaveLength(3);
      expect(read.outline).toBeUndefined();
      expect(
        read.sections.reduce((sum, one) => sum + one.markdown.length, 0),
      ).toBeGreaterThan(WHOLE_NOTE_MAX);
    });
  });

  it("answers a section the note does not have in words naming the ones it does", async () => {
    const note = await wrote(
      writes(PARSER, [ABOUT_THE_PARSER, "## How\n\nBy one table."]),
    );

    const said = await performChatCall(files, {
      call: "c2",
      act: "read_note",
      arguments: { note, sections: ["Trade-offs"] },
    });

    expect(said.trouble).toBe(true);
    expect(said.refused).toBe("no_section");
    expect(said.said).toContain('"Trade-offs"');
    expect(said.said).toContain("Why, How");
  });

  it("answers a read of a note that is not there with words the agent can act on", async () => {
    const said = await performChatCall(files, {
      call: "c1",
      act: "read_note",
      arguments: { note: `${SOMEBODY}/01J0000000000000000000000A` },
    });

    expect(said.trouble).toBe(true);
    expect(said.said).toContain("no note");
  });
});

describe("tagging a note", () => {
  it("puts tags on beside the ones already there", async () => {
    const written = await wrote(
      writes(PARSER, [ABOUT_THE_PARSER], { tags: ["reading"] }),
    );

    const listed = ListedNoteSchema.parse(
      JSON.parse(
        await answer({
          call: "c2",
          act: "tag_note",
          arguments: { note: written, tags: ["parser"] },
        }),
      ),
    );

    expect([...listed.tags].sort()).toEqual(["parser", "reading"]);
  });

  it("takes off the tag named and leaves the ones it was not asked about", async () => {
    const written = await wrote(
      writes(PARSER, [ABOUT_THE_PARSER], {
        tags: ["reading", "parser", "lexing"],
      }),
    );

    const listed = ListedNoteSchema.parse(
      JSON.parse(
        await answer({
          call: "c2",
          act: "tag_note",
          arguments: { note: written, off: ["reading"] },
        }),
      ),
    );

    expect([...listed.tags].sort()).toEqual(["lexing", "parser"]);
  });

  it("puts one on and takes another off in the one act", async () => {
    const written = await wrote(
      writes(PARSER, [ABOUT_THE_PARSER], { tags: ["reading"] }),
    );

    const listed = ListedNoteSchema.parse(
      JSON.parse(
        await answer({
          call: "c2",
          act: "tag_note",
          arguments: { note: written, tags: ["parser"], off: ["reading"] },
        }),
      ),
    );

    expect([...listed.tags]).toEqual(["parser"]);
  });

  it("says a tagging that would change nothing changed nothing", async () => {
    const written = await wrote(
      writes(PARSER, [ABOUT_THE_PARSER], { tags: ["reading"] }),
    );

    const said = await performChatCall(files, {
      call: "c2",
      act: "tag_note",
      arguments: { note: written },
    });

    expect(said.trouble).toBe(true);
  });
});

describe("looking through the notes", () => {
  const SEEDS = "src/seeds.ts";

  async function twoNotes(): Promise<{ parser: OwnedRef; seeds: OwnedRef }> {
    const parser = await wrote(
      writes(PARSER, [`## Why\n\nThe lexer hands it tokens, one at a time.`], {
        title: "The parser",
      }),
    );
    const seeds = await wrote(
      writes(SEEDS, [`## Why\n\nA seed keeps its own clock underground.`], {
        title: "Seeds",
      }),
    );
    return { parser, seeds };
  }

  it("reaches a note by what it SAYS, and answers something to cite it by", async () => {
    const { parser } = await twoNotes();

    const found = NotesFoundSchema.parse(
      JSON.parse(
        await answer({
          call: "c3",
          act: "search_notes",
          arguments: { words: "lexer tokens", detail: "line" },
        }),
      ),
    );

    expect(found.found.map((one) => one.note)).toEqual([parser]);
    expect(found.found[0].title).toBe("The parser");
    expect(found.found[0].line).toBe(
      "The lexer hands it tokens, one at a time.",
    );
    expect(found.found[0].section).toBe("Why");
  });

  it("answers each note with the one line that matched, and its tags", async () => {
    await wrote(
      writes(
        PARSER,
        [
          "## Why\n\nIt reads the file once. The lexer hands it tokens, one at a time. Nothing is read twice.\n\nA second paragraph says nothing of it.",
        ],
        { title: "The parser", tags: ["reading"] },
      ),
    );

    const [hit] = NotesFoundSchema.parse(
      JSON.parse(
        await answer({
          call: "c3",
          act: "search_notes",
          arguments: { words: "lexer", detail: "line" },
        }),
      ),
    ).found;

    expect(hit.line).toBe("The lexer hands it tokens, one at a time.");
    expect(hit.tags).toEqual(["reading"]);
    expect(hit).not.toHaveProperty("snippet");
  });

  it("cuts a long line around what matched", async () => {
    const long = `${"Before it comes a great deal of writing about other things. ".repeat(3).replace(/\. /g, ", ")}the lexer hands it tokens${", and after it more".repeat(20)}.`;
    await wrote(writes(PARSER, [`## Why\n\n${long}`], { title: "The parser" }));

    const [hit] = NotesFoundSchema.parse(
      JSON.parse(
        await answer({
          call: "c3",
          act: "search_notes",
          arguments: { words: "lexer", detail: "line" },
        }),
      ),
    ).found;

    expect(hit.line.length).toBeLessThanOrEqual(FOUND_LINE_MAX);
    expect(hit.line).toContain("lexer hands it tokens");
  });

  it("adds the writing around the match where the sections are asked for", async () => {
    await twoNotes();

    const [hit] = NotesFoundSchema.parse(
      JSON.parse(
        await answer({
          call: "c3",
          act: "search_notes",
          arguments: { words: "lexer tokens", detail: "sections" },
        }),
      ),
    ).found;

    expect(hit.snippet).toContain("Why The lexer hands it tokens");
    expect(hit.line).toBe("The lexer hands it tokens, one at a time.");
  });

  it("says so plainly where nothing here carries the words", async () => {
    await twoNotes();

    const found = NotesFoundSchema.parse(
      JSON.parse(
        await answer({
          call: "c3",
          act: "search_notes",
          arguments: { words: "quantum gravity", detail: "line" },
        }),
      ),
    );

    expect(found.found).toEqual([]);
  });
});

describe("carrying a note somewhere else", () => {
  /** A folder note with two notes under it, numbered the way a person would
   *  number them, so a move has a run to join and a number to leave behind. */
  async function numbered(): Promise<{
    folder: OwnedRef;
    parser: OwnedRef;
    reading: OwnedRef;
  }> {
    const api = containerApi(files);
    const folder = await wrote(
      writes("src", ["## Why\n\nEverything the compiler reads."]),
    );
    const parser = await wrote(
      writes(PARSER, [ABOUT_THE_PARSER], { title: "The parser" }),
    );
    const reading = await wrote(
      writes(READING_DOC, ["## Why\n\nWhat somebody new reads first."], {
        title: "Reading",
      }),
    );
    await api.setAddress(folder, "1");
    await api.setAddress(parser, "1a");
    await api.setAddress(reading, "1b");
    return { folder, parser, reading };
  }

  async function listed(
    call: string,
  ): Promise<Map<OwnedRef, { parent?: OwnedRef }>> {
    const notes = NotesListedSchema.parse(
      JSON.parse(await answer({ call, act: "list_notes", arguments: {} })),
    ).notes;
    return new Map(notes.map((one) => [one.note, one]));
  }

  it("hangs the note under the one it really sprang out of, and says where it now sits", async () => {
    const { parser, reading } = await numbered();

    const moved = ListedNoteSchema.parse(
      JSON.parse(
        await answer({
          call: "c4",
          act: "move_note",
          arguments: { note: reading, to: parser, relation: "under" },
        }),
      ),
    );

    expect(moved.note).toBe(reading);
    expect(moved.parent).toBe(parser);
    expect(moved.address).toBe("1a1");
    expect((await listed("c5")).get(reading)?.parent).toBe(parser);
  });

  it("leaves the number it was at leading to it, so a citation still lands", async () => {
    const { parser, reading } = await numbered();
    await answer({
      call: "c4",
      act: "move_note",
      arguments: { note: reading, to: parser, relation: "under" },
    });

    const found = NotesFoundSchema.parse(
      JSON.parse(
        await answer({
          call: "c5",
          act: "search_notes",
          arguments: { words: "1b", detail: "line" },
        }),
      ),
    );

    expect(found.found.map((one) => one.note)).toEqual([reading]);
  });

  it("puts the note after another where that is what it continues", async () => {
    const { folder, parser, reading } = await numbered();
    const deeper = await wrote(
      writes(PLACES_FILE, ["## Why\n\nWhere each name was written."], {
        title: "Places",
        under: parser,
      }),
    );

    const moved = ListedNoteSchema.parse(
      JSON.parse(
        await answer({
          call: "c5",
          act: "move_note",
          arguments: { note: deeper, to: reading, relation: "after" },
        }),
      ),
    );

    expect(moved.parent).toBe(folder);
  });

  it("answers a move of a note that is not there with words the agent can act on", async () => {
    const { parser } = await numbered();

    const said = await performChatCall(files, {
      call: "c4",
      act: "move_note",
      arguments: {
        note: `${SOMEBODY}/01J0000000000000000000000A`,
        to: parser,
        relation: "under",
      },
    });

    expect(said.trouble).toBe(true);
    expect(said.said).toContain("no note");
  });

  it("hands back what the graph refused rather than going quiet", async () => {
    const { parser } = await numbered();

    const said = await performChatCall(files, {
      call: "c4",
      act: "move_note",
      arguments: { note: parser, to: parser, relation: "under" },
    });

    expect(said.trouble).toBe(true);
    expect(said.said).not.toBe("");
  });
});

describe("numbering a note", () => {
  it("writes the number a person cites it by, and takes it off again", async () => {
    const note = await wrote(
      writes(PARSER, [ABOUT_THE_PARSER], { title: "The parser" }),
    );

    const numbered = ListedNoteSchema.parse(
      JSON.parse(
        await answer({
          call: "c2",
          act: "number_note",
          arguments: { note, address: "7" },
        }),
      ),
    );
    const bare = ListedNoteSchema.parse(
      JSON.parse(
        await answer({ call: "c3", act: "number_note", arguments: { note } }),
      ),
    );

    expect(numbered.address).toBe("7");
    expect(bare.address).toBeUndefined();
  });

  it("leaves the number it gave up leading to it, so a citation still lands", async () => {
    const note = await wrote(
      writes(PARSER, [ABOUT_THE_PARSER], { title: "The parser" }),
    );
    await answer({
      call: "c2",
      act: "number_note",
      arguments: { note, address: "7" },
    });
    await answer({
      call: "c3",
      act: "number_note",
      arguments: { note, address: "8" },
    });

    const found = NotesFoundSchema.parse(
      JSON.parse(
        await answer({
          call: "c4",
          act: "search_notes",
          arguments: { words: "7", detail: "line" },
        }),
      ),
    );

    expect(found.found.map((one) => one.note)).toEqual([note]);
  });

  it("hands back what the graph refused, rather than numbering it anyway", async () => {
    await wrote(writes("src", ["## Why\n\nEverything the compiler reads."]));
    const note = await wrote(
      writes(PARSER, [ABOUT_THE_PARSER], { title: "The parser" }),
    );

    // The folder's note opened the branch and is at 1 already.
    const said = await performChatCall(files, {
      call: "c3",
      act: "number_note",
      arguments: { note, address: "1" },
    });

    expect(said.trouble).toBe(true);
    expect(said.said).not.toBe("");
    expect((await containerApi(files).getNode(note))?.address).toBe("1a");
  });

  it("answers a numbering of a note that is not there with words the agent can act on", async () => {
    const said = await performChatCall(files, {
      call: "c1",
      act: "number_note",
      arguments: {
        note: `${SOMEBODY}/01J0000000000000000000000A`,
        address: "1",
      },
    });

    expect(said.trouble).toBe(true);
    expect(said.said).toContain("no note");
  });
});

describe("drawing a line between two notes", () => {
  /** Two notes, and a line the person drew by hand between the second and a
   *  third, which no act below names. */
  async function drawn(): Promise<{
    parser: OwnedRef;
    seeds: OwnedRef;
    theirs: OwnedRef;
  }> {
    const parser = await wrote(
      writes(PARSER, [ABOUT_THE_PARSER], { title: "The parser" }),
    );
    const seeds = await wrote(
      writes(PLACES_FILE, ["## Why\n\nWhere each name was."], {}),
    );
    const theirs = await wrote(
      writes(READING_DOC, ["## Why\n\nRead this first."], {}),
    );
    await containerApi(files).updateNode(parser, { links: [theirs] });
    return { parser, seeds, theirs };
  }

  it("draws the line, and leaves the one already there alone", async () => {
    const { parser, seeds, theirs } = await drawn();

    const listed = ListedNoteSchema.parse(
      JSON.parse(
        await answer({
          call: "c4",
          act: "link_notes",
          arguments: { note: parser, to: [seeds] },
        }),
      ),
    );

    expect([...(listed.links ?? [])].sort()).toEqual([seeds, theirs].sort());
  });

  it("takes the line named off, and no other", async () => {
    const { parser, seeds, theirs } = await drawn();
    await answer({
      call: "c4",
      act: "link_notes",
      arguments: { note: parser, to: [seeds] },
    });

    const listed = ListedNoteSchema.parse(
      JSON.parse(
        await answer({
          call: "c5",
          act: "link_notes",
          arguments: { note: parser, off: [seeds] },
        }),
      ),
    );

    expect(listed.links).toEqual([theirs]);
  });

  it("answers a line to a note that is not there without drawing any of them", async () => {
    const { parser, seeds } = await drawn();

    const said = await performChatCall(files, {
      call: "c4",
      act: "link_notes",
      arguments: {
        note: parser,
        to: [seeds, `${SOMEBODY}/01J0000000000000000000000A`],
      },
    });

    expect(said.trouble).toBe(true);
    expect((await containerApi(files).getNode(parser))?.links).not.toContain(
      seeds,
    );
  });

  it("draws no line from a note to itself", async () => {
    const { parser } = await drawn();

    const said = await performChatCall(files, {
      call: "c4",
      act: "link_notes",
      arguments: { note: parser, to: [parser] },
    });

    expect(said.trouble).toBe(true);
  });

  it("says a linking that would change nothing changed nothing", async () => {
    const { parser } = await drawn();

    const said = await performChatCall(files, {
      call: "c4",
      act: "link_notes",
      arguments: { note: parser },
    });

    expect(said.trouble).toBe(true);
  });
});

describe("what a line reads as", () => {
  async function twoNotes(): Promise<{ parser: OwnedRef; seeds: OwnedRef }> {
    const parser = await wrote(
      writes(PARSER, [ABOUT_THE_PARSER], { title: "The parser" }),
    );
    const seeds = await wrote(
      writes(PLACES_FILE, ["## Why\n\nWhere each name was."], {}),
    );
    return { parser, seeds };
  }

  it("writes the words on the line, and reads them back off the note", async () => {
    const { parser, seeds } = await twoNotes();

    await answer({
      call: "c4",
      act: "style_edge",
      arguments: {
        note: parser,
        to: seeds,
        label: "grew out of",
        direction: "to",
      },
    });

    const read = NoteReadSchema.parse(
      JSON.parse(
        await answer({
          call: "c5",
          act: "read_note",
          arguments: { note: parser },
        }),
      ),
    );
    expect(read.edges).toEqual([
      { to: seeds, label: "grew out of", direction: "to" },
    ]);
  });

  it("leaves the line with one look, whichever end of it the agent names", async () => {
    const { parser, seeds } = await twoNotes();
    await answer({
      call: "c4",
      act: "style_edge",
      arguments: { note: parser, to: seeds, label: "grew out of" },
    });

    await answer({
      call: "c5",
      act: "style_edge",
      arguments: { note: seeds, to: parser, stroke: "dashed", direction: "to" },
    });

    const api = containerApi(files);
    expect((await api.getNode(seeds))?.edges).toBeUndefined();
    // The arrowhead turns with the end the look is written on, so it still
    // points at the note the agent named.
    expect((await api.getNode(parser))?.edges).toEqual([
      { to: seeds, label: "grew out of", direction: "from", stroke: "dashed" },
    ]);
  });

  it("takes the channels named back off and leaves the rest of the look", async () => {
    const { parser, seeds } = await twoNotes();
    await answer({
      call: "c4",
      act: "style_edge",
      arguments: {
        note: parser,
        to: seeds,
        label: "grew out of",
        stroke: "dotted",
      },
    });

    await answer({
      call: "c5",
      act: "style_edge",
      arguments: { note: parser, to: seeds, off: ["label"] },
    });

    expect((await containerApi(files).getNode(parser))?.edges).toEqual([
      { to: seeds, stroke: "dotted" },
    ]);
  });

  it("leaves the line drawn as the graph draws it where every channel comes off", async () => {
    const { parser, seeds } = await twoNotes();
    await answer({
      call: "c4",
      act: "style_edge",
      arguments: {
        note: parser,
        to: seeds,
        label: "grew out of",
        stroke: "dotted",
      },
    });

    await answer({
      call: "c5",
      act: "style_edge",
      arguments: {
        note: parser,
        to: seeds,
        off: ["label", "direction", "stroke"],
      },
    });

    expect((await containerApi(files).getNode(parser))?.edges).toBeUndefined();
  });

  it("answers a look on a line to a note that is not there", async () => {
    const { parser } = await twoNotes();

    const said = await performChatCall(files, {
      call: "c4",
      act: "style_edge",
      arguments: {
        note: parser,
        to: `${SOMEBODY}/01J0000000000000000000000A`,
        label: "grew out of",
      },
    });

    expect(said.trouble).toBe(true);
  });

  it("says a look that names no channel changed nothing", async () => {
    const { parser, seeds } = await twoNotes();

    const said = await performChatCall(files, {
      call: "c4",
      act: "style_edge",
      arguments: { note: parser, to: seeds },
    });

    expect(said.trouble).toBe(true);
  });
});

describe("how a note is drawn", () => {
  it("sets the channels named and leaves the picture its author put on the mark", async () => {
    const note = await wrote(
      writes(PARSER, [ABOUT_THE_PARSER], { title: "The parser" }),
    );
    await containerApi(files).updateNode(note, {
      appearance: { preview: "up1" },
    });

    await answer({
      call: "c2",
      act: "style_note",
      arguments: { note, ring_weight: "heavy", ring_style: "dashed" },
    });

    expect((await containerApi(files).getNode(note))?.appearance).toEqual({
      preview: "up1",
      ring_weight: "heavy",
      ring_style: "dashed",
    });
  });

  it("draws the mark at the step it names, over the fine size a person set", async () => {
    const note = await wrote(
      writes(PARSER, [ABOUT_THE_PARSER], { title: "The parser" }),
    );
    await containerApi(files).updateNode(note, {
      appearance: { mark_scale: 1.9 },
    });

    await answer({
      call: "c2",
      act: "style_note",
      arguments: { note, mark_radius: "small" },
    });

    expect((await containerApi(files).getNode(note))?.appearance).toEqual({
      mark_radius: "small",
    });
  });

  it("leaves the note unstyled where every channel it carries comes off", async () => {
    const note = await wrote(
      writes(PARSER, [ABOUT_THE_PARSER], { title: "The parser" }),
    );
    await answer({
      call: "c2",
      act: "style_note",
      arguments: { note, ring_weight: "heavy", mark_radius: "large" },
    });

    await answer({
      call: "c3",
      act: "style_note",
      arguments: { note, off: ["ring_weight", "ring_style", "mark_radius"] },
    });

    expect(
      (await containerApi(files).getNode(note))?.appearance,
    ).toBeUndefined();
  });

  it("says a look that names no channel changed nothing", async () => {
    const note = await wrote(
      writes(PARSER, [ABOUT_THE_PARSER], { title: "The parser" }),
    );

    const said = await performChatCall(files, {
      call: "c2",
      act: "style_note",
      arguments: { note },
    });

    expect(said.trouble).toBe(true);
  });
});

describe("the picture a mark wears", () => {
  const LOGO = "assets/logo.png";
  const LOGO_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2]);
  const BADGE = "assets/badge.gif";
  const BADGE_BYTES = new TextEncoder().encode("GIF89a-badge");
  const FAKE = "assets/fake.png";

  async function styled(note: OwnedRef, asked: Record<string, unknown>) {
    return performChatCall(files, {
      call: "c2",
      act: "style_note",
      arguments: { note, ...asked },
    } as ChatToolCall);
  }

  async function lookOf(note: OwnedRef) {
    return (await containerApi(files).getNode(note))?.appearance;
  }

  async function library(): Promise<string[]> {
    return (await containerApi(files).ownPictures("block")).map(
      (one) => one.upload_id,
    );
  }

  async function aNote(): Promise<OwnedRef> {
    return wrote(writes(PARSER, [ABOUT_THE_PARSER], { title: "The parser" }));
  }

  beforeEach(async () => {
    await files.write(LOGO, LOGO_BYTES);
    await files.write(BADGE, BADGE_BYTES);
    await files.write(FAKE, new TextEncoder().encode("not a picture at all"));
  });

  it("puts an image from the project on the mark, kept among the notes' pictures", async () => {
    const note = await aNote();

    const said = await styled(note, { picture: LOGO });

    expect(said.trouble).toBeUndefined();
    const facts = said.facts as { act: "style_note"; note: NodeView };
    const preview = facts.note.appearance?.preview as string;
    expect((await lookOf(note))?.preview).toBe(preview);
    expect(await library()).toEqual([preview]);
    const vault = (await containerApi(files).projectFolder())?.at(".sloppy");
    expect(await vault?.read(`media/${preview}.png`)).toEqual(LOGO_BYTES);
  });

  it("refuses a picture outside the project", async () => {
    const note = await aNote();

    for (const outside of ["../logo.png", "/etc/logo.png"]) {
      const said = await styled(note, { picture: outside });
      expect(said.trouble).toBe(true);
      expect(said.said).toMatch(/not in the project/);
    }
    expect(await lookOf(note)).toBeUndefined();
  });

  it("refuses a file that does not open as a picture whatever its name, and one that is not there", async () => {
    const note = await aNote();

    const named = await styled(note, { picture: FAKE });
    const code = await styled(note, { picture: PARSER });
    const missing = await styled(note, { picture: "assets/gone.png" });

    for (const refused of [named, code]) {
      expect(refused.trouble).toBe(true);
      expect(refused.said).toMatch(/does not open as a PNG/);
    }
    expect(missing.trouble).toBe(true);
    expect(missing.said).toMatch(/no file at that path/);
    expect(await library()).toEqual([]);
  });

  it("stores a picture as the kind its bytes open as", async () => {
    const note = await aNote();
    await files.write("assets/really-a-gif.png", BADGE_BYTES);

    await styled(note, { picture: "assets/really-a-gif.png" });

    const [stored] = await containerApi(files).ownPictures("block");
    expect(stored?.mime_type).toBe("image/gif");
  });

  it("refuses one picture and a series named together", async () => {
    const note = await aNote();

    const said = await styled(note, { picture: LOGO, pictures: [BADGE] });

    expect(said.trouble).toBe(true);
    expect(await library()).toEqual([]);
  });

  it("takes the picture off and leaves it among the notes' pictures, as the Look tab does", async () => {
    const note = await aNote();
    await styled(note, { picture: LOGO, ring_weight: "heavy" });
    const [kept] = await library();

    const said = await styled(note, { off: ["picture"] });

    expect(said.trouble).toBeUndefined();
    expect(await lookOf(note)).toEqual({ ring_weight: "heavy" });
    expect(await library()).toEqual([kept]);
  });

  it("lets go of the pictures a call stored when the look it was for is refused", async () => {
    const note = await aNote();

    const said = await styled(note, { pictures: [LOGO, FAKE] });

    expect(said.trouble).toBe(true);
    expect(await lookOf(note)).toBeUndefined();
    expect(await library()).toEqual([]);
  });

  it("wears one already among the notes' pictures without storing it again", async () => {
    const parser = await aNote();
    const other = await wrote(
      writes(READING_DOC, ["## Why\n\nWhat somebody new reads first."], {
        title: "Reading",
      }),
    );
    const said = await styled(parser, { picture: LOGO });
    const preview = (said.facts as { note: NodeView }).note.appearance
      ?.preview as string;

    await styled(other, { picture: `media/${preview}.png` });

    expect((await lookOf(other))?.preview).toBe(preview);
    expect(await library()).toEqual([preview]);
  });

  it("puts a series on the mark, with how long each holds and how it gives way", async () => {
    const note = await aNote();

    await styled(note, {
      pictures: [LOGO, BADGE],
      picture_every: 30,
      picture_transition: "slide",
    });

    const look = await lookOf(note);
    expect(look?.preview_more).toHaveLength(1);
    expect(look?.preview).not.toBe(look?.preview_more?.[0]);
    expect(look).toMatchObject({
      preview_every: 30,
      preview_transition: "slide",
    });
  });

  it("drops the turns where the mark wears one picture, as the Look tab does", async () => {
    const note = await aNote();
    await styled(note, {
      pictures: [LOGO, BADGE],
      picture_every: 30,
      picture_transition: "slide",
    });

    await styled(note, { picture: LOGO });
    const one = await lookOf(note);
    const bare = await aNoteAbout(READING_DOC);
    await styled(bare, { picture_every: 30, ring_weight: "heavy" });

    expect(Object.keys(one ?? {})).toEqual(["preview"]);
    expect(await lookOf(bare)).toEqual({ ring_weight: "heavy" });
  });

  it("takes the turns back off by name", async () => {
    const note = await aNote();
    await styled(note, {
      pictures: [LOGO, BADGE],
      picture_every: 30,
      picture_transition: "zoom",
    });

    await styled(note, { off: ["picture_every", "picture_transition"] });

    const look = await lookOf(note);
    expect(look?.preview_every).toBeUndefined();
    expect(look?.preview_transition).toBeUndefined();
    expect(look?.preview_more).toHaveLength(1);
  });

  it("says a size finely or in steps, and one takes the other off", async () => {
    const note = await aNote();

    await styled(note, { mark_radius: "large" });
    await styled(note, { mark_scale: 1.6 });
    const fine = await lookOf(note);
    await styled(note, { mark_radius: "huge" });
    const stepped = await lookOf(note);
    await styled(note, { mark_scale: 1 });
    const plain = await lookOf(note);

    expect(fine).toEqual({ mark_scale: 1.6 });
    expect(stepped).toEqual({ mark_radius: "huge" });
    expect(plain).toBeUndefined();
  });

  it("takes the fine size off by name", async () => {
    const note = await aNote();
    await styled(note, { mark_scale: 1.6, ring_weight: "hairline" });

    await styled(note, { off: ["mark_scale"] });

    expect(await lookOf(note)).toEqual({ ring_weight: "hairline" });
  });

  it("says a picture's cover finely or in steps, one taking the other off, and neither without a picture", async () => {
    const note = await aNote();
    const bare = await aNoteAbout(READING_DOC);

    await styled(note, { picture: LOGO, picture_size: "large" });
    const stepped = await lookOf(note);
    await styled(note, { picture_cover: 0.7 });
    const fine = await lookOf(note);
    await styled(note, { picture_size: "small" });
    const plain = await lookOf(note);
    await styled(bare, { picture_cover: 0.7, ring_weight: "heavy" });

    expect(stepped).toMatchObject({ preview_size: "large" });
    expect(fine?.preview_size).toBeUndefined();
    expect(fine?.preview_cover).toBe(0.7);
    expect(plain?.preview_size).toBeUndefined();
    expect(plain?.preview_cover).toBeUndefined();
    expect(await lookOf(bare)).toEqual({ ring_weight: "heavy" });
  });

  it("takes a cover back off by name", async () => {
    const note = await aNote();
    await styled(note, { picture: LOGO, picture_cover: 0.7 });

    await styled(note, { off: ["picture_cover"] });

    expect((await lookOf(note))?.preview_cover).toBeUndefined();
    expect((await lookOf(note))?.preview).toBeDefined();
  });

  it("gives a ring to a mark wearing none where a style is named, and stores the plain values as nothing", async () => {
    const note = await aNote();

    await styled(note, { ring_style: "dashed" });
    const broken = await lookOf(note);
    await styled(note, { ring_weight: "none" });

    expect(broken).toEqual({ ring_weight: "regular", ring_style: "dashed" });
    expect(await lookOf(note)).toBeUndefined();
  });

  // A look is not writing, so a picture lands on a note somebody else started.
  it("puts the picture on a note somebody else started, not offered", async () => {
    const theirs = await theirNote();

    const said = await styled(theirs, { picture: LOGO });

    expect(said.trouble).toBeUndefined();
    expect((await lookOf(theirs))?.preview).toBeDefined();
    const offered = await performChatCall(files, {
      call: "c3",
      act: "list_offers",
      arguments: { note: theirs },
    });
    expect(OffersListedSchema.parse(JSON.parse(offered.said)).offers).toEqual(
      [],
    );
  });

  async function aNoteAbout(about: string): Promise<OwnedRef> {
    return wrote(
      writes(about, ["## Why\n\nSomething else."], { title: about }),
    );
  }
});

describe("putting a note in the bin", () => {
  it("answers the note as it stood, and the notes here no longer hold it", async () => {
    const note = await wrote(
      writes(PARSER, [ABOUT_THE_PARSER], { title: "The parser" }),
    );

    const binned = NoteBinnedSchema.parse(
      JSON.parse(
        await answer({ call: "c2", act: "delete_note", arguments: { note } }),
      ),
    );

    expect(binned.binned.note).toBe(note);
    expect(binned.binned.title).toBe("The parser");
    const listed = NotesListedSchema.parse(
      JSON.parse(
        await answer({ call: "c3", act: "list_notes", arguments: {} }),
      ),
    );
    expect(listed.notes.map((one) => one.note)).not.toContain(note);
  });

  it("leaves it where a person can take it back out", async () => {
    const note = await wrote(
      writes(PARSER, [ABOUT_THE_PARSER], { title: "The parser" }),
    );
    await answer({ call: "c2", act: "delete_note", arguments: { note } });

    const api = containerApi(files);
    expect((await api.deletedBranches()).map((one) => one.ref)).toContain(note);
    await api.restoreBranch(note);
    expect((await api.getNode(note))?.title).toBe("The parser");
  });

  it("answers a note that is not there with words the agent can act on", async () => {
    const said = await performChatCall(files, {
      call: "c1",
      act: "delete_note",
      arguments: { note: `${SOMEBODY}/01J0000000000000000000000A` },
    });

    expect(said.trouble).toBe(true);
    expect(said.said).toContain("no note");
  });
});

describe("the tags a graph carries", () => {
  it("counts each tag by the notes carrying it, most carried first", async () => {
    await wrote(
      writes(PARSER, [ABOUT_THE_PARSER], { tags: ["reading", "parsing"] }),
    );
    await wrote(
      writes(PLACES_FILE, ["## Why\n\nIt names places."], {
        tags: ["reading"],
      }),
    );

    const done = await performChatCall(files, {
      call: "c3",
      act: "list_tags",
      arguments: {},
    });

    expect(TagsListedSchema.parse(JSON.parse(done.said)).tags).toEqual([
      { tag: "reading", notes: 2 },
      { tag: "parsing", notes: 1 },
    ]);
    expect(done.facts).toEqual({ act: "list_tags", count: 2 });
    expect(done.touched).toEqual([]);
  });
});

describe("the bin", () => {
  it("lists what went in, with how many went with it", async () => {
    const parser = await wrote(
      writes(PARSER, [ABOUT_THE_PARSER], { title: "The parser" }),
    );
    await wrote(
      writes(PLACES_FILE, ["## Why\n\nIt names places."], { under: parser }),
    );
    await answer({
      call: "c3",
      act: "delete_note",
      arguments: { note: parser },
    });

    const done = await performChatCall(files, {
      call: "c4",
      act: "list_bin",
      arguments: {},
    });
    const bin = BinListedSchema.parse(JSON.parse(done.said)).bin;

    expect(bin).toHaveLength(1);
    expect(bin[0]).toMatchObject({
      note: parser,
      title: "The parser",
      beneath: 1,
    });
    expect(done.facts).toEqual({ act: "list_bin", count: 1 });
  });

  it("says plainly when nothing is in it", async () => {
    const done = await performChatCall(files, {
      call: "c1",
      act: "list_bin",
      arguments: {},
    });

    expect(BinListedSchema.parse(JSON.parse(done.said)).bin).toEqual([]);
    expect(done.facts).toEqual({ act: "list_bin", count: 0 });
  });

  it("takes a note back out with what went in with it, and names both", async () => {
    const parser = await wrote(
      writes(PARSER, [ABOUT_THE_PARSER], { title: "The parser" }),
    );
    const places = await wrote(
      writes(PLACES_FILE, ["## Why\n\nIt names places."], { under: parser }),
    );
    await answer({
      call: "c3",
      act: "delete_note",
      arguments: { note: parser },
    });

    const done = await performChatCall(files, {
      call: "c4",
      act: "restore_note",
      arguments: { note: parser },
    });

    expect(done.trouble).toBeUndefined();
    expect(ListedNoteSchema.parse(JSON.parse(done.said)).note).toBe(parser);
    expect(done.facts).toMatchObject({ act: "restore_note", beneath: 1 });
    expect([...(done.touched ?? [])].sort()).toEqual([parser, places].sort());
    expect(done.facts?.act === "restore_note" && done.facts.note.title).toBe(
      "The parser",
    );
    const listed = NotesListedSchema.parse(
      JSON.parse(
        await answer({ call: "c5", act: "list_notes", arguments: {} }),
      ),
    );
    expect(listed.notes.map((one) => one.note).sort()).toEqual(
      [parser, places].sort(),
    );
  });

  it("answers a note that is not in the bin with words the agent can act on", async () => {
    const note = await wrote(writes(PARSER, [ABOUT_THE_PARSER]));

    const done = await performChatCall(files, {
      call: "c2",
      act: "restore_note",
      arguments: { note },
    });

    expect(done.trouble).toBe(true);
    expect(done.said).toContain("not here to put back");
  });
});

describe("what is offered on a note", () => {
  it("lists the offer this container made on a note somebody else wrote", async () => {
    const theirs = await theirNote();
    await answer(writes(PARSER, ["## Why\n\nBecause it is bounded."]));

    const done = await performChatCall(files, {
      call: "c2",
      act: "list_offers",
      arguments: { note: theirs },
    });
    const offers = OffersListedSchema.parse(JSON.parse(done.said)).offers;

    expect(offers).toHaveLength(1);
    expect(offers[0].by).toBe(
      splitOwnedRef(await containerApi(files).graphHere()).owner,
    );
    expect(done.facts).toEqual({ act: "list_offers", count: 1 });
    expect(done.touched).toEqual([]);
  });

  it("answers a note that is not there with words the agent can act on", async () => {
    const done = await performChatCall(files, {
      call: "c1",
      act: "list_offers",
      arguments: { note: `${SOMEBODY}/01J0000000000000000000000A` },
    });

    expect(done.trouble).toBe(true);
    expect(done.said).toContain("no note");
  });
});

describe("the graph itself", () => {
  it("says what it is called, whose it is, how it is gated and where its code is", async () => {
    const done = await performChatCall(files, {
      call: "c1",
      act: "read_graph",
      arguments: {},
    });
    const read = GraphReadSchema.parse(JSON.parse(done.said));
    const here = await containerApi(files).graphHere();

    expect(read.owner).toBe(splitOwnedRef(here).owner);
    expect(read.ownership).toBe("open");
    expect(read.project).toBe("..");
    expect(done.facts).toEqual({ act: "read_graph", name: read.name });
    expect(done.touched).toEqual([]);
  });

  it("names the owner as the profile they wrote on this device says", async () => {
    const here = await containerApi(files).graphHere();
    const owner = new LocalApi(containerApi(files).files, {
      writer: splitOwnedRef(here).owner,
    });
    await owner.updateProfile({
      display_name: "Ada",
      bio: "Writes compilers.",
      banner_url: "https://example.com/band.png",
    });

    const done = await performChatCall(files, {
      call: "c1",
      act: "read_graph",
      arguments: {},
    });
    const read = GraphReadSchema.parse(JSON.parse(done.said));

    expect(read.owner_name).toBe("Ada");
    expect(read.project).toBe("..");
  });
});

describe("the number a note is written or carried at", () => {
  /** Nothing to spring from opens a branch, so the rule numbers it and what
   *  is written beneath it after — a first note with no number would leave
   *  every one after it bare. */
  it("opens a branch with the first note, and numbers the ones written after it", async () => {
    const folder = await wrote(
      writes("src", ["## Why\n\nEverything the compiler reads."]),
    );
    const note = await wrote(
      writes(PARSER, [ABOUT_THE_PARSER], { title: "The parser" }),
    );

    const api = containerApi(files);
    expect((await api.getNode(folder))?.address).toBe("1");
    expect((await api.getNode(note))?.address).toBe("1a");
  });

  it("numbers a note the write names one for", async () => {
    const folder = await wrote(
      writes("src", ["## Why\n\nEverything the compiler reads."]),
    );
    await answer({
      call: "c2",
      act: "number_note",
      arguments: { note: folder, address: "1" },
    });

    const note = await wrote(
      writes(PARSER, [ABOUT_THE_PARSER], {
        title: "The parser",
        address: "1a",
      }),
    );

    expect((await containerApi(files).getNode(note))?.address).toBe("1a");
  });

  it("hands back what the graph refused a number, and writes no note", async () => {
    await wrote(writes("src", ["## Why\n\nEverything the compiler reads."]));

    // 2a springs from 2, and the note above is at 1.
    const said = await performChatCall(
      files,
      writes(PARSER, [ABOUT_THE_PARSER], {
        title: "The parser",
        address: "2a",
      }),
    );

    expect(said.trouble).toBe(true);
    expect(said.said).not.toBe("");
    const listed = NotesListedSchema.parse(
      JSON.parse(
        await answer({ call: "c3", act: "list_notes", arguments: {} }),
      ),
    );
    expect(listed.notes).toHaveLength(1);
  });

  it("numbers the note a write lands on, where the write names a number", async () => {
    const folder = await wrote(
      writes("src", ["## Why\n\nEverything the compiler reads."]),
    );
    await answer({
      call: "c2",
      act: "number_note",
      arguments: { note: folder, address: "1" },
    });
    const note = await wrote(
      writes(PARSER, [ABOUT_THE_PARSER], { title: "The parser" }),
    );

    await answer(
      writes(PARSER, ["## How\n\nBy one table."], { address: "1a" }),
    );

    expect((await containerApi(files).getNode(note))?.address).toBe("1a");
  });

  it("writes nothing where the graph refuses the number a write names", async () => {
    const folder = await wrote(
      writes("src", ["## Why\n\nEverything the compiler reads."]),
    );
    await answer({
      call: "c2",
      act: "number_note",
      arguments: { note: folder, address: "1" },
    });
    const note = await wrote(
      writes(PARSER, [ABOUT_THE_PARSER], { title: "The parser" }),
    );

    // Numbered by the rule when it was written, under a folder note at 1.
    expect((await containerApi(files).getNode(note))?.address).toBe("1a");

    const said = await performChatCall(
      files,
      writes(PARSER, ["## How\n\nBy one table."], { address: "1" }),
    );

    expect(said.trouble).toBe(true);
    const read = NoteReadSchema.parse(
      JSON.parse(
        await answer({ call: "c4", act: "read_note", arguments: { note } }),
      ),
    );
    expect(read.sections.map((one) => one.markdown).join("")).not.toContain(
      "By one table",
    );
    expect(read.address).toBe("1a");
  });

  it("carries a note to the number the move names", async () => {
    const folder = await wrote(
      writes("src", ["## Why\n\nEverything the compiler reads."]),
    );
    const parser = await wrote(
      writes(PARSER, [ABOUT_THE_PARSER], { title: "The parser" }),
    );
    const api = containerApi(files);
    await api.setAddress(folder, "1");
    await api.setAddress(parser, "1a");
    const reading = await wrote(
      writes(READING_DOC, ["## Why\n\nRead this first."], {}),
    );

    const moved = ListedNoteSchema.parse(
      JSON.parse(
        await answer({
          call: "c4",
          act: "move_note",
          arguments: {
            note: reading,
            to: parser,
            relation: "under",
            address: "1a4",
          },
        }),
      ),
    );

    expect(moved.address).toBe("1a4");
  });
});

describe("a place beside the project", () => {
  const PLACE = "/work/lexer";
  const PLAIN = "/work/scratch";

  /** One device's disk, so the project and the folders beside it sit on it
   *  together. */
  let device: Map<string, Uint8Array>;
  let place: MemoryFiles;

  /** An act against `at` served the way a place is served. */
  function reads(at: MemoryFiles, call: ChatToolCall) {
    return performChatCall(at, call, true);
  }

  /** Every file on the disk and what is in each one, so a test says the folder
   *  was left as it was FOUND and not only that the same files are in it. */
  function everyFile(): Record<string, string> {
    const read = new TextDecoder();
    return Object.fromEntries(
      [...device]
        .sort(([one], [two]) => one.localeCompare(two))
        .map(([at, bytes]) => [at, read.decode(bytes)]),
    );
  }

  /** Every reading act a place answers, so a test says the folder was
   *  left as it was found by all of them and not only by the one it asked. */
  async function everyRead(
    at: MemoryFiles,
  ): Promise<{ notes: OwnedRef[]; listed: string[]; read: string[] }> {
    const notes = NotesListedSchema.parse(
      JSON.parse(
        (await reads(at, { call: "c1", act: "list_notes", arguments: {} }))
          .said,
      ),
    ).notes;
    await reads(at, {
      call: "c2",
      act: "search_notes",
      arguments: { words: "parser", detail: "line" },
    });
    await reads(at, { call: "c2", act: "list_tags", arguments: {} });
    await reads(at, { call: "c2", act: "read_graph", arguments: {} });
    await reads(at, {
      call: "c2",
      act: "brief",
      arguments: { words: "parser", budget: 65536 },
    });
    const bin = await reads(at, { call: "c2", act: "list_bin", arguments: {} });
    expect(bin.trouble).toBeUndefined();
    for (const one of notes) {
      await reads(at, {
        call: "c2",
        act: "list_offers",
        arguments: { note: one.note },
      });
    }
    const read: string[] = [];
    for (const one of notes) {
      const answered = await reads(at, {
        call: "c3",
        act: "read_note",
        arguments: { note: one.note },
      });
      read.push(answered.said);
      await reads(at, {
        call: "c3",
        act: "read_around",
        arguments: { note: one.note, depth: 2 },
      });
    }
    return {
      notes: notes.map((one) => one.note),
      listed: notes.map((one) => one.title),
      read,
    };
  }

  beforeEach(async () => {
    device = new Map();
    place = new MemoryFiles({
      root: PLACE,
      data: "/data/other",
      store: device,
    });
    await place.write(
      PARSER,
      new TextEncoder().encode("export const two = 2;\n"),
    );
    await containerApi(place).openProject(PLACE);
    await performChatCall(
      place,
      writes(PARSER, [ABOUT_THE_PARSER], { title: "The lexer" }),
    );
  });

  it("answers the notes it holds, and nothing is written in it", async () => {
    // Gone, the two files a project of this device's own carries: a read that
    // put them back would be a write in somebody else's repository.
    await place.remove(".sloppy/.gitignore");
    await place.remove(`.sloppy/${AGENT_FILE}`);
    const before = everyFile();

    const answered = await everyRead(place);

    expect(answered.listed).toEqual(["The lexer"]);
    expect(answered.read[0]).toContain("The lexer");
    expect(everyFile()).toEqual(before);
  });

  it("writes nothing into a folder holding no notes, and finds none there to read", async () => {
    const plain = new MemoryFiles({
      root: PLAIN,
      data: "/data/other",
      store: device,
    });
    await plain.write(
      PARSER,
      new TextEncoder().encode("export const three = 3;\n"),
    );
    const note = (await everyRead(place)).notes[0];
    const before = everyFile();

    await expect(
      reads(plain, { call: "c1", act: "list_notes", arguments: {} }),
    ).rejects.toThrow("There are no notes in that folder");
    const searched = await reads(plain, {
      call: "c2",
      act: "search_notes",
      arguments: { words: "parser", detail: "line" },
    });
    const read = await reads(plain, {
      call: "c3",
      act: "read_note",
      arguments: { note },
    });

    expect(JSON.parse(searched.said)).toEqual({ found: [] });
    expect(read.refused).toBe("no_note");
    expect(everyFile()).toEqual(before);
  });

  it("lists what is in its bin, and nothing is written in it", async () => {
    const gone = await wrote(
      writes(PLACES_FILE, ["## Why\n\nIt names places."], { title: "Places" }),
      place,
    );
    await performChatCall(place, {
      call: "c1",
      act: "delete_note",
      arguments: { note: gone },
    });
    const before = everyFile();

    const done = await reads(place, {
      call: "c2",
      act: "list_bin",
      arguments: {},
    });

    expect(done.trouble).toBeUndefined();
    expect(BinListedSchema.parse(JSON.parse(done.said)).bin).toMatchObject([
      { note: gone, title: "Places", beneath: 0 },
    ]);
    expect(everyFile()).toEqual(before);
  });

  it("refuses an act that would write, whatever routed it here", async () => {
    const before = everyFile();

    const done = await reads(place, writes(PARSER, [ABOUT_THE_PARSER]));
    await everyRead(place);

    expect(done.trouble).toBe(true);
    expect(done.said).toContain("can only be read");
    expect(everyFile()).toEqual(before);
  });

  it("reads a folder that shares the first ulid without giving it one of its own", async () => {
    const graphFile = ".sloppy/graph.json";
    const said = JSON.parse(
      new TextDecoder().decode(await place.read(graphFile)),
    );
    await place.write(
      graphFile,
      new TextEncoder().encode(
        `${JSON.stringify({ ...said, graph: UNNAMED_GRAPH_ULID })}\n`,
      ),
    );
    const before = everyFile();

    expect((await everyRead(place)).listed).toEqual(["The lexer"]);

    expect(everyFile()).toEqual(before);
  });
});

describe("relating a note to the rest", () => {
  /** A folder note with a note about parsing under it, and one about emitting:
   *  the shape a draft about the grammar is placed in. */
  async function compiler(): Promise<{ source: OwnedRef; parsing: OwnedRef }> {
    const source = await wrote(
      writes("src", ["## Why\n\nEverything the compiler reads."], {
        title: "The source",
      }),
    );
    const parsing = await wrote(
      writes(
        PARSER,
        [
          "## Why\n\nThe parser turns a stream of tokens into a syntax tree, by the grammar.",
        ],
        { title: "Parsing", tags: ["parsing"], under: source },
      ),
    );
    await wrote(
      writes("src/emit.ts", ["## Why\n\nThe emitter writes bytecode."], {
        title: "Emitting",
        tags: ["output"],
        under: source,
      }),
    );
    return { source, parsing };
  }

  function aboutTheGrammar(parsing: OwnedRef): string[] {
    return [
      `## Why\n\nEach production of the grammar the [parser](sloppy:${parsing}) reads tokens by, into the syntax tree.`,
    ];
  }

  async function everyFile(): Promise<Map<string, string>> {
    const held = new Map<string, string>();
    for (const path of await files.list("")) {
      held.set(path, new TextDecoder().decode(await files.read(path)));
    }
    return held;
  }

  it("answers where a note already here belongs, and what it relates to", async () => {
    const { source, parsing } = await compiler();
    const grammar = await wrote(
      writes("src/grammar.ts", aboutTheGrammar(parsing), {
        title: "Grammar productions",
        tags: ["parsing"],
        under: source,
      }),
    );

    const done = await performChatCall(files, {
      call: "c9",
      act: "relate",
      arguments: { note: grammar, limit: 3 },
    });

    const related = RelatedSchema.parse(JSON.parse(done.said));
    expect(related.parents.map((one) => one.note)).toContain(source);
    expect(related.links.map((one) => one.note)).not.toContain(source);
    expect(related.links.map((one) => one.note)).not.toContain(parsing);
    expect(done.facts).toMatchObject({ act: "relate" });
    expect(done.touched).toEqual([]);
  });

  it("answers where a draft belongs, before it is written, and writes nothing", async () => {
    const { parsing } = await compiler();
    const before = await everyFile();

    const done = await performChatCall(files, {
      call: "c9",
      act: "relate",
      arguments: {
        title: "Grammar productions",
        sections: aboutTheGrammar(parsing),
        about: "src/grammar.ts",
        tags: ["parsing"],
        limit: 5,
      },
    });

    const related = RelatedSchema.parse(JSON.parse(done.said));
    expect(related.parents[0]?.note).toBe(parsing);
    expect(related.parents[0]?.reasons.length).toBeGreaterThan(0);
    expect(await everyFile()).toEqual(before);
  });

  it("refuses one that names nothing, and a note that is not there", async () => {
    const nothing = await performChatCall(files, {
      call: "c9",
      act: "relate",
      arguments: { limit: 5 },
    });
    const missing = await performChatCall(files, {
      call: "c9",
      act: "relate",
      arguments: { note: `${SOMEBODY}/01J0000000000000000000000A`, limit: 5 },
    });

    expect(nothing).toMatchObject({
      trouble: true,
      refused: "nothing_to_relate",
    });
    expect(missing).toMatchObject({ trouble: true, refused: "no_note" });
  });

  it("places a new note named under nothing under the note most related to it, and says why", async () => {
    const { parsing } = await compiler();

    const written = NoteWrittenSchema.parse(
      JSON.parse(
        await answer(
          writes("src/grammar.ts", aboutTheGrammar(parsing), {
            title: "Grammar productions",
            tags: ["parsing"],
          }),
        ),
      ),
    );

    expect((await containerApi(files).getNode(written.note))?.parent).toBe(
      parsing,
    );
    expect(written.placed).toMatch(/^Placed under “Parsing”.*most related/);
  });

  it("places it by the folder above it where nothing is related enough", async () => {
    const { source } = await compiler();

    const written = NoteWrittenSchema.parse(
      JSON.parse(
        await answer(
          writes("src/config.ts", ["## Why\n\nWhich flags a build takes."], {
            title: "Flags",
            tags: ["settings"],
          }),
        ),
      ),
    );

    expect((await containerApi(files).getNode(written.note))?.parent).toBe(
      source,
    );
    expect(written.placed).toMatch(/nearest folder above src\/config\.ts/);
  });

  it("puts a note where it was told, and says nothing of placing it", async () => {
    const { source, parsing } = await compiler();

    const written = NoteWrittenSchema.parse(
      JSON.parse(
        await answer(
          writes("src/grammar.ts", aboutTheGrammar(parsing), {
            title: "Grammar productions",
            tags: ["parsing"],
            under: source,
          }),
        ),
      ),
    );

    expect((await containerApi(files).getNode(written.note))?.parent).toBe(
      source,
    );
    expect(written.placed).toBeUndefined();
  });

  it("never moves a note already there", async () => {
    const { source, parsing } = await compiler();
    const grammar = await wrote(
      writes("src/grammar.ts", ["## Why\n\nFlags."], {
        title: "Grammar productions",
        under: source,
      }),
    );

    const written = NoteWrittenSchema.parse(
      JSON.parse(
        await answer(
          writes("src/grammar.ts", aboutTheGrammar(parsing), {
            tags: ["parsing"],
          }),
        ),
      ),
    );

    expect(written.note).toBe(grammar);
    expect(written.placed).toBeUndefined();
    expect((await containerApi(files).getNode(grammar))?.parent).toBe(source);
  });
});

describe("finding where something is in the code", () => {
  const PARSER_CODE =
    "export function parseTokens(tokens: Token[]) {\n  return tokens;\n}\n";
  const read: string[] = [];
  const code: CodeReader = async (root) => {
    read.push(root);
    return codeIndexOf([
      { path: PARSER, symbols: symbolsIn(PARSER, PARSER_CODE) },
      { path: "src/emit.ts", symbols: [] },
    ]);
  };

  function finds(words: string): ChatToolCall {
    return {
      call: "c1",
      act: "find_code",
      arguments: { words, limit: 8 },
    };
  }

  it("answers the exact lines, what is defined there, and the notes explaining the file", async () => {
    const note = await wrote(
      writes(PARSER, ["## Why\n\nThe parser."], { title: "Parsing" }),
    );
    const done = await performChatCall(files, finds("parseTokens"), false, {
      code,
    });
    const found = CodeFoundSchema.parse(JSON.parse(done.said));
    expect(found.found[0]).toEqual({
      place: `${PARSER}#L1-L3`,
      kind: "function",
      name: "parseTokens",
      notes: [{ note, title: "Parsing", address: "1" }],
    });
    expect(found.read).toMatch(/read those lines/);
    expect(read).toEqual([PROJECT]);
    expect(done.facts).toEqual({ act: "find_code", count: found.found.length });
    expect(done.touched).toEqual([]);
  });

  it("names no notes on a file none of them reaches", async () => {
    const done = await performChatCall(files, finds("emit"), false, { code });
    const found = CodeFoundSchema.parse(JSON.parse(done.said));
    expect(found.found).toEqual([{ place: "src/emit.ts", kind: "file" }]);
  });

  it("names, in a brief that lands on code, the places its words reach beside its notes", async () => {
    await wrote(
      writes(PARSER, ["## Why\n\nThe parser reads tokens."], {
        title: "Parsing",
      }),
    );
    const call: ChatToolCall = {
      call: "c1",
      act: "brief",
      arguments: { words: "parse tokens", budget: 16000 },
    };
    const landing = await performChatCall(files, call, false, {
      landOnCode: true,
      code,
    });
    const briefed = BriefShortSchema.parse(JSON.parse(landing.said));
    expect(briefed.places?.[0]).toMatchObject({
      place: `${PARSER}#L1-L3`,
      name: "parseTokens",
    });
    const plain = await performChatCall(files, call, false, { code });
    expect(
      BriefReadSchema.parse(JSON.parse(plain.said)).places,
    ).toBeUndefined();
  });

  it("says there is no code to look through where nothing reads it", async () => {
    const done = await performChatCall(files, finds("parseTokens"));
    expect(done).toMatchObject({ trouble: true, refused: "no_code" });
  });
});
