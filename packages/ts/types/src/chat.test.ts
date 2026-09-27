import { describe, expect, it } from "vitest";
import {
  sectionHeadings,
  CARD_ROWS,
  advertisedChatTools,
  argumentsFit,
  CHAT_AGENTS,
  CHAT_ARGUMENTS_MAX,
  CHAT_BLOCK_KINDS,
  CHAT_CARD_HEADING_MAX,
  CHAT_CARD_VALUE_MAX,
  CHAT_SAID_MAX,
  CHAT_SHOWN_MAX,
  CHAT_TOOL_SPECS,
  CHAT_TOOLS,
  cardRow,
  chatCard,
  chatModels,
  ChatActDoneSchema,
  ChatBlockSchema,
  ChatCardSchema,
  ChatEventSchema,
  ChatModelSchema,
  chatAgentName,
  chatToolWrites,
  ChatToolAnswerSchema,
  ChatToolCallSchema,
  ChatTurnSchema,
  CHAT_ANSWER_MAX,
  CHAT_SECTION_MAX,
  DeleteNoteArgumentsSchema,
  foundAnswer,
  LinkNotesArgumentsSchema,
  listingAnswer,
  ListedNoteSchema,
  MAX_SECTIONS_PER_WRITE,
  MOST_ATTACHED_PER_TURN,
  MOST_CARD_ROWS,
  MOST_LINES_DRAWN,
  MOST_NOTES_FOUND,
  MOST_NOTES_LISTED,
  MOST_NOTES_TOUCHED,
  MOST_SECTIONS_READ,
  MoveNoteArgumentsSchema,
  noteAnswer,
  NumberNoteArgumentsSchema,
  NoteReadSchema,
  NotesFoundSchema,
  NotesListedSchema,
  NoteWrittenSchema,
  ReadNoteArgumentsSchema,
  SearchNotesArgumentsSchema,
  StyleEdgeArgumentsSchema,
  StyleNoteArgumentsSchema,
  TagNoteArgumentsSchema,
  turnFits,
  WriteNoteArgumentsSchema,
  type FoundNote,
  type ListedNote,
  type NoteSection,
} from "./chat.js";
import { WRITE_DONE } from "./authority.js";

const NOTE =
  "did:syr:z6MktEXAMPLEEXAMPLEEXAMPLEEXAMPLE/01JQ7X3K9M2N4P5R6S7T8V9W0X";
const OTHER =
  "did:syr:z6MktEXAMPLEEXAMPLEEXAMPLEEXAMPLE/01JQ7X3K9M2N4P5R6S7T8V9W1Y";
const NOW = "2026-09-26T10:00:00.000Z";

describe("the agents this app chats with", () => {
  it("names every one of them", () => {
    for (const agent of CHAT_AGENTS) {
      expect(chatAgentName(agent)).not.toBe("");
    }
  });
});

describe("the acts Sloppy hands an agent", () => {
  it("gives each one words for the agent, words for a person, and a schema", () => {
    for (const act of CHAT_TOOLS) {
      const spec = CHAT_TOOL_SPECS[act];
      expect(spec.description.length).toBeGreaterThan(0);
      expect(spec.label.length).toBeGreaterThan(0);
      expect(spec.arguments.safeParse(undefined).success).toBe(false);
    }
  });

  it("puts the writing ones behind the person and leaves reading alone", () => {
    for (const act of [
      "write_note",
      "move_note",
      "tag_note",
      "number_note",
      "link_notes",
      "style_edge",
      "style_note",
      "delete_note",
    ] as const) {
      expect(chatToolWrites(act)).toBe(true);
    }
    expect(chatToolWrites("list_notes")).toBe(false);
    expect(chatToolWrites("search_notes")).toBe(false);
    expect(chatToolWrites("read_note")).toBe(false);
  });

  it("advertises every act once, as a JSON Schema object", () => {
    const advertised = advertisedChatTools();

    expect(advertised.map((one) => one.name)).toEqual([...CHAT_TOOLS]);
    for (const one of advertised) {
      expect(one.description).toBe(CHAT_TOOL_SPECS[one.name].description);
      expect(one.arguments.type).toBe("object");
      expect(one.arguments).not.toHaveProperty("$schema");
    }
  });

  it("tells the agent what every argument of every act is for", () => {
    const named: string[] = [];

    for (const one of advertisedChatTools()) {
      const properties = (one.arguments.properties ?? {}) as Record<
        string,
        { type?: string; description?: string }
      >;
      for (const [field, shape] of Object.entries(properties)) {
        named.push(`${one.name}.${field}`);
        expect(shape.description ?? "").not.toBe("");
        expect(shape.type).not.toBeUndefined();
      }
    }

    expect(named).toEqual([
      "search_notes.words",
      "read_note.note",
      "write_note.about",
      "write_note.title",
      "write_note.sections",
      "write_note.tags",
      "write_note.under",
      "write_note.address",
      "move_note.note",
      "move_note.to",
      "move_note.relation",
      "move_note.address",
      "tag_note.note",
      "tag_note.tags",
      "tag_note.off",
      "number_note.note",
      "number_note.address",
      "link_notes.note",
      "link_notes.to",
      "link_notes.off",
      "style_edge.note",
      "style_edge.to",
      "style_edge.label",
      "style_edge.direction",
      "style_edge.stroke",
      "style_edge.off",
      "style_note.note",
      "style_note.ring_weight",
      "style_note.ring_style",
      "style_note.mark_radius",
      "style_note.off",
      "delete_note.note",
    ]);
  });

  it("names an arm of the call union for every act", () => {
    const armed = ChatToolCallSchema.options.map(
      (arm) => arm.shape.act.value as string,
    );

    expect(armed.sort()).toEqual([...CHAT_TOOLS].sort());
  });
});

describe("what a call may carry", () => {
  it("takes a note to read by its ref and nothing else", () => {
    expect(ReadNoteArgumentsSchema.parse({ note: NOTE }).note).toBe(NOTE);
    expect(ReadNoteArgumentsSchema.safeParse({ note: "1a1" }).success).toBe(
      false,
    );
  });

  it("holds a place to somewhere inside the project", () => {
    expect(
      WriteNoteArgumentsSchema.parse({ about: "src/parser", sections: [] })
        .about,
    ).toBe("src/parser");
    for (const about of ["../secrets", "/etc/passwd", "--help"]) {
      expect(
        WriteNoteArgumentsSchema.safeParse({ about, sections: [] }).success,
      ).toBe(false);
    }
  });

  it("refuses more sections than one note is written in at a time", () => {
    const sections = Array.from(
      { length: MAX_SECTIONS_PER_WRITE + 1 },
      () => "## A section",
    );

    expect(
      WriteNoteArgumentsSchema.safeParse({ about: "src", sections }).success,
    ).toBe(false);
  });

  it("keeps the title a person reads, trimmed", () => {
    const written = WriteNoteArgumentsSchema.parse({
      about: "src",
      title: "  What the reader does  ",
      sections: [],
    });

    expect(written.title).toBe("What the reader does");
  });

  it("looks for words somebody would type, and nothing empty", () => {
    expect(
      SearchNotesArgumentsSchema.parse({ words: "  the reader " }).words,
    ).toBe("the reader");
    for (const words of ["", "   "]) {
      expect(SearchNotesArgumentsSchema.safeParse({ words }).success).toBe(
        false,
      );
    }
  });

  it("carries a note under or after another", () => {
    const under = MoveNoteArgumentsSchema.parse({
      note: NOTE,
      to: OTHER,
      relation: "under",
    });

    expect(under.relation).toBe("under");
    expect(under.address).toBeUndefined();
    expect(
      MoveNoteArgumentsSchema.safeParse({
        note: NOTE,
        to: OTHER,
        relation: "beside",
      }).success,
    ).toBe(false);
  });

  it("takes the number a person cites a note by, held to the grammar", () => {
    for (const shape of [
      MoveNoteArgumentsSchema,
      WriteNoteArgumentsSchema,
      NumberNoteArgumentsSchema,
    ]) {
      const asked = { note: NOTE, to: OTHER, relation: "after", about: "src" };
      expect(
        shape.parse({ ...asked, sections: [], address: "1a1" }),
      ).toMatchObject({ address: "1a1" });
      expect(
        shape.safeParse({ ...asked, sections: [], address: "0a" }).success,
      ).toBe(false);
    }
  });

  it("leaves a note with no number where a numbering names none", () => {
    expect(NumberNoteArgumentsSchema.parse({ note: NOTE }).address).toBe(
      undefined,
    );
  });

  it("draws lines and takes them off, each by the ref at the other end", () => {
    const asked = LinkNotesArgumentsSchema.parse({
      note: NOTE,
      to: [OTHER],
      off: [OTHER],
    });

    expect(asked.to).toEqual([OTHER]);
    expect(asked.off).toEqual([OTHER]);
    expect(
      LinkNotesArgumentsSchema.safeParse({ note: NOTE, to: ["1a1"] }).success,
    ).toBe(false);
    expect(
      LinkNotesArgumentsSchema.safeParse({
        note: NOTE,
        to: Array.from({ length: MOST_LINES_DRAWN + 1 }, () => OTHER),
      }).success,
    ).toBe(false);
  });

  it("says what a line reads as, in the channels a look is made of", () => {
    const asked = StyleEdgeArgumentsSchema.parse({
      note: NOTE,
      to: OTHER,
      label: "  grew out of  ",
      direction: "to",
      stroke: "dashed",
    });

    expect(asked.label).toBe("grew out of");
    expect(
      StyleEdgeArgumentsSchema.safeParse({
        note: NOTE,
        to: OTHER,
        direction: "sideways",
      }).success,
    ).toBe(false);
    expect(
      StyleEdgeArgumentsSchema.parse({
        note: NOTE,
        to: OTHER,
        off: ["label", "direction", "stroke"],
      }).off,
    ).toEqual(["label", "direction", "stroke"]);
  });

  it("says how a mark is drawn, in the shape channels and no colour", () => {
    const asked = StyleNoteArgumentsSchema.parse({
      note: NOTE,
      ring_weight: "heavy",
      ring_style: "dashed",
      mark_radius: "large",
    });

    expect(asked.ring_weight).toBe("heavy");
    for (const said of [
      { ring_weight: "glowing" },
      { mark_radius: "enormous" },
      { off: ["preview"] },
    ]) {
      expect(
        StyleNoteArgumentsSchema.safeParse({ note: NOTE, ...said }).success,
      ).toBe(false);
    }
  });

  it("puts one note in the bin, by its ref", () => {
    expect(DeleteNoteArgumentsSchema.parse({ note: NOTE }).note).toBe(NOTE);
    expect(DeleteNoteArgumentsSchema.safeParse({ note: "1a1" }).success).toBe(
      false,
    );
  });

  it("writes a note under a named one, and under none where it says none", () => {
    expect(
      WriteNoteArgumentsSchema.parse({
        about: "src",
        sections: [],
        under: NOTE,
      }).under,
    ).toBe(NOTE);
    expect(
      WriteNoteArgumentsSchema.parse({ about: "src", sections: [] }).under,
    ).toBeUndefined();
  });

  it("takes tags off a note as its own half of a tagging", () => {
    const asked = TagNoteArgumentsSchema.parse({
      note: NOTE,
      off: ["parsing"],
    });

    expect(asked.off).toEqual(["parsing"]);
    expect(asked.tags).toBeUndefined();
  });

  it("is parsed into the act it names", () => {
    const call = ChatToolCallSchema.parse({
      call: "call-1",
      act: "write_note",
      arguments: { about: "src", sections: ["## What it does"] },
    });

    expect(call.act === "write_note" && call.arguments.about).toBe("src");
  });
});

describe("what a call comes to", () => {
  it("answers the agent whole, and says when it came to nothing", () => {
    expect(ChatToolAnswerSchema.parse({ said: "{}" }).trouble).toBeUndefined();
    expect(
      ChatToolAnswerSchema.parse({ said: "No note there.", trouble: true })
        .trouble,
    ).toBe(true);
  });

  it("says which of the two ways a write landed", () => {
    for (const done of WRITE_DONE) {
      expect(NoteWrittenSchema.parse({ note: NOTE, done }).done).toBe(done);
    }
  });

  it("lists a note with no address, which is an ordinary note", () => {
    const listed = ListedNoteSchema.parse({
      note: NOTE,
      title: "The reader",
      tags: ["Parsing", "parsing"],
      about: ["src/parser"],
    });

    expect(listed.address).toBeUndefined();
    expect(listed.tags).toEqual(["parsing"]);
  });

  it("says what a note sprang out of, and nothing for one that starts a line", () => {
    const sprang = ListedNoteSchema.parse({
      note: NOTE,
      title: "The reader",
      parent: OTHER,
      tags: [],
      about: [],
    });

    expect(sprang.parent).toBe(OTHER);
    expect(
      ListedNoteSchema.parse({
        note: NOTE,
        title: "A branch",
        tags: [],
        about: [],
      }).parent,
    ).toBeUndefined();
  });
});

describe("what one answer carries", () => {
  const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const ulid = (n: number): string =>
    `01JQ7X3K9M2N4P5R6S7T8V9W${CROCKFORD[(n >> 5) & 31]}${CROCKFORD[n & 31]}`;
  const listed = (n: number, about?: string[]): ListedNote =>
    ListedNoteSchema.parse({
      note: `did:syr:z6MktEXAMPLEEXAMPLEEXAMPLEEXAMPLE/${ulid(n)}`,
      title: `What src/place-${n} does`,
      tags: ["parsing"],
      about: about ?? [`src/place-${n}`],
    });
  const section = (n: number, markdown: string): NoteSection => ({
    id: ulid(n),
    markdown,
  });
  const wide = (n: number): string[] =>
    Array.from({ length: 32 }, (_, at) => `src/${"a".repeat(200)}/${n}-${at}`);

  it("carries every note where they all fit, and says nothing of more", () => {
    const answer = listingAnswer([listed(0), listed(1)]);
    const held = NotesListedSchema.parse(JSON.parse(answer.said));

    expect(ChatToolAnswerSchema.safeParse(answer).success).toBe(true);
    expect(held.notes).toHaveLength(2);
    expect(held.more).toBeUndefined();
    expect(answer.trouble).toBeUndefined();
  });

  it("carries as many notes as it reads to, and says how many it left", () => {
    const notes = Array.from({ length: MOST_NOTES_LISTED + 50 }, (_, n) =>
      listed(n),
    );

    const held = NotesListedSchema.parse(JSON.parse(listingAnswer(notes).said));

    expect(held.notes).toHaveLength(MOST_NOTES_LISTED);
    expect(held.more).toBe(50);
    expect(held.notes[0]).toEqual(notes[0]);
  });

  it("stops at what one answer holds, not only at what it reads to", () => {
    const notes = Array.from({ length: MOST_NOTES_LISTED }, (_, n) =>
      listed(n, wide(n)),
    );

    const answer = listingAnswer(notes);
    const held = NotesListedSchema.parse(JSON.parse(answer.said));

    expect(answer.said.length).toBeLessThanOrEqual(CHAT_ANSWER_MAX);
    expect(held.notes.length).toBeLessThan(notes.length);
    expect(held.notes.length + (held.more ?? 0)).toBe(notes.length);
  });

  const found = (
    n: number,
    snippet = "The reader reads it whole.",
  ): FoundNote => ({
    note: `did:syr:z6MktEXAMPLEEXAMPLEEXAMPLEEXAMPLE/${ulid(n)}`,
    title: `What src/place-${n} does`,
    snippet,
  });

  it("carries what a search reached, with the writing around each match", () => {
    const answer = foundAnswer([found(0), found(1)]);
    const held = NotesFoundSchema.parse(JSON.parse(answer.said));

    expect(ChatToolAnswerSchema.safeParse(answer).success).toBe(true);
    expect(held.found).toHaveLength(2);
    expect(held.found[0].snippet).toBe("The reader reads it whole.");
    expect(held.more).toBeUndefined();
  });

  it("carries as many found notes as a search reads to, and says how many it left", () => {
    const hits = Array.from({ length: MOST_NOTES_FOUND + 5 }, (_, n) =>
      found(n),
    );

    const held = NotesFoundSchema.parse(JSON.parse(foundAnswer(hits).said));

    expect(held.found).toHaveLength(MOST_NOTES_FOUND);
    expect(held.more).toBe(5);
  });

  it("reads a note holding more sections than one write puts in it", () => {
    const sections = Array.from(
      { length: MAX_SECTIONS_PER_WRITE + 1 },
      (_, n) => section(n, `## A section\n\nThe ${n}th of them.`),
    );

    const held = NoteReadSchema.parse(
      JSON.parse(noteAnswer(listed(0), sections).said),
    );

    expect(held.sections).toHaveLength(sections.length);
    expect(held.more).toBeUndefined();
  });

  it("carries as many sections as a read reads to, and says how many it left", () => {
    const sections = Array.from({ length: MOST_SECTIONS_READ + 40 }, (_, n) =>
      section(n, `## A section\n\nThe ${n}th of them.`),
    );

    const held = NoteReadSchema.parse(
      JSON.parse(noteAnswer(listed(0), sections).said),
    );

    expect(held.sections).toHaveLength(MOST_SECTIONS_READ);
    expect(held.more).toBe(40);
  });

  it("carries what one answer holds of a long note, from the first", () => {
    const sections = Array.from({ length: 20 }, (_, n) =>
      section(n, "a".repeat(CHAT_SECTION_MAX)),
    );

    const answer = noteAnswer(listed(0), sections);
    const held = NoteReadSchema.parse(JSON.parse(answer.said));

    expect(ChatToolAnswerSchema.safeParse(answer).success).toBe(true);
    expect(answer.trouble).toBeUndefined();
    expect(held.sections.length).toBeGreaterThan(0);
    expect(held.sections.length + (held.more ?? 0)).toBe(sections.length);
    expect(held.sections[0]).toEqual(sections[0]);
  });

  it("comes to trouble where nothing under the bound is left of the note", () => {
    const everywhere = listed(
      0,
      Array.from(
        { length: 64 },
        (_, n) => `src/${"a".repeat(1018)}${String(n).padStart(2, "0")}`,
      ),
    );

    const answer = noteAnswer(everywhere, []);

    expect(answer.trouble).toBe(true);
    expect(ChatToolAnswerSchema.safeParse(answer).success).toBe(true);
  });
});

describe("the blocks a turn carries", () => {
  it("takes what the agent said and what it was thinking", () => {
    expect(
      ChatBlockSchema.parse({ kind: "said", said: "Here it is." }),
    ).toEqual({ kind: "said", said: "Here it is." });
    expect(
      ChatBlockSchema.parse({ kind: "thinking", said: "Reading first." }).kind,
    ).toBe("thinking");
  });

  it("carries one of Sloppy's acts and one of the agent's own alike", () => {
    const ours = ChatBlockSchema.parse({
      kind: "tool_call",
      call: "call-1",
      tool: "mcp__notes__write_note",
      act: "write_note",
      arguments: { about: "src" },
    });
    const theirs = ChatBlockSchema.parse({
      kind: "tool_call",
      call: "call-2",
      tool: "Read",
      arguments: { file_path: "src/parser.ts" },
    });

    expect(ours.kind === "tool_call" && ours.act).toBe("write_note");
    expect(theirs.kind === "tool_call" && theirs.act).toBeUndefined();
  });

  it("keeps a kind it has no renderer for, whole", () => {
    const carried = ChatBlockSchema.parse({
      kind: "a_kind_from_later",
      whatever: { nested: [1, 2] },
    });

    expect(carried).toEqual({
      kind: "a_kind_from_later",
      whatever: { nested: [1, 2] },
    });
  });

  it("refuses a block of a kind it knows that breaks its own bounds", () => {
    for (const block of [
      { kind: "said", said: "a".repeat(CHAT_SAID_MAX + 1) },
      { kind: "tool_result", call: "c", said: "a".repeat(CHAT_SHOWN_MAX + 1) },
      { kind: "tool_call", call: "c", tool: "" },
    ]) {
      expect(ChatBlockSchema.safeParse(block).success).toBe(false);
    }
  });

  it("never lets a known kind fall through to the carried arm", () => {
    for (const kind of CHAT_BLOCK_KINDS) {
      expect(ChatBlockSchema.safeParse({ kind, made_up: true }).success).toBe(
        false,
      );
    }
  });
});

describe("a turn", () => {
  const said = { kind: "said" as const, said: "document the identity system" };

  it("is a person's words, or whatever the agent did", () => {
    const theirs = ChatTurnSchema.parse({
      from: "person",
      blocks: [said],
      at: NOW,
    });

    expect(turnFits(theirs)).toBe(true);
    expect(
      turnFits(
        ChatTurnSchema.parse({
          from: "agent",
          blocks: [said, { kind: "tool_call", call: "c", tool: "Read" }],
          at: NOW,
        }),
      ),
    ).toBe(true);
  });

  it("is not a person calling a tool", () => {
    const turn = ChatTurnSchema.parse({
      from: "person",
      blocks: [{ kind: "tool_call", call: "c", tool: "Read" }],
      at: NOW,
    });

    expect(turnFits(turn)).toBe(false);
  });
});

describe("what a page is told", () => {
  it("reads every one of them, and nothing else", () => {
    const events = [
      { event: "started", session: "s-1", model: "a model", tools: ["Read"] },
      {
        event: "block",
        at: 0,
        block: { kind: "said", said: "Reading the parser." },
      },
      {
        event: "asking",
        call: "call-1",
        act: "write_note",
        arguments: { about: "src" },
      },
      { event: "settled", call: "call-1", allowed: true },
      { event: "ended" },
      { event: "over" },
      { event: "over", said: "That did not finish. Try again." },
    ];

    for (const event of events) {
      expect(ChatEventSchema.safeParse(event).success).toBe(true);
    }
    expect(ChatEventSchema.safeParse({ event: "something_else" }).success).toBe(
      false,
    );
  });

  it("says a session that named no model named none", () => {
    const started = ChatEventSchema.parse({
      event: "started",
      session: "s-1",
      tools: [],
    });

    expect(started.event === "started" && started.model).toBeUndefined();
  });

  it("says a turn nobody stopped finished", () => {
    const ended = ChatEventSchema.parse({ event: "ended" });

    expect(ended.event === "ended" && ended.stopped).toBeUndefined();
  });

  it("says a session nothing went wrong in had nothing to say", () => {
    const over = ChatEventSchema.parse({ event: "over" });

    expect(over.event === "over" && over.said).toBeUndefined();
  });

  it("refuses a session that could not go on with nothing to say", () => {
    expect(ChatEventSchema.safeParse({ event: "over", said: "" }).success).toBe(
      false,
    );
  });
});

describe("what a call's arguments may run to", () => {
  it("takes a call with none, and one small enough to carry", () => {
    expect(argumentsFit(undefined)).toBe(true);
    expect(argumentsFit({ about: "src/parser" })).toBe(true);
  });

  it("turns down more than a page could draw", () => {
    expect(argumentsFit({ said: "a".repeat(CHAT_ARGUMENTS_MAX) })).toBe(false);
  });

  it("turns down what will not encode at all", () => {
    const round: Record<string, unknown> = {};
    round.itself = round;

    expect(argumentsFit(round)).toBe(false);
    expect(argumentsFit(() => undefined)).toBe(false);
  });
});

describe("the models an agent answers with", () => {
  it("names every one it offers", () => {
    for (const agent of CHAT_AGENTS) {
      for (const model of chatModels(agent)) {
        expect(ChatModelSchema.parse(model)).toEqual(model);
        expect(model.name).not.toBe(model.model);
      }
    }
  });
});

describe("what a person puts in front of the agent", () => {
  const picture = { name: "photo.jpg", path: ".sloppy/.sloppy/chat/photo.jpg" };

  it("goes in their turn beside what they said", () => {
    const turn = ChatTurnSchema.parse({
      from: "person",
      blocks: [
        { kind: "said", said: "what is this screen doing" },
        { kind: "attached", attached: [picture] },
      ],
      at: NOW,
    });

    expect(turnFits(turn)).toBe(true);
  });

  it("is somewhere in the project, so the agent can read it", () => {
    for (const path of ["../outside.png", "/etc/passwd", "-rf"]) {
      expect(
        ChatBlockSchema.safeParse({
          kind: "attached",
          attached: [{ name: "photo.jpg", path }],
        }).success,
      ).toBe(false);
    }
  });

  it("is a file at a time, up to as many as one turn carries", () => {
    for (const attached of [
      [],
      Array.from({ length: MOST_ATTACHED_PER_TURN + 1 }, () => picture),
    ]) {
      expect(
        ChatBlockSchema.safeParse({ kind: "attached", attached }).success,
      ).toBe(false);
    }
  });
});

describe("what a person reads of an act", () => {
  const done = {
    said: JSON.stringify({ note: NOTE, done: "written" }),
    told: "Written.",
    card: chatCard("note", "1a1 · The parser", [
      ...cardRow("About", "src/parser.ts"),
      ...cardRow("Tags", "parsing, seed"),
    ]),
    touched: [NOTE],
  };

  it("is answered beside what the agent reads", () => {
    expect(ChatActDoneSchema.parse(done)).toEqual(done);
  });

  it("is left behind by the shape the agent is handed", () => {
    expect(ChatToolAnswerSchema.parse(done)).toEqual({ said: done.said });
  });

  it("lays out only the rows that say something", () => {
    expect(cardRow("Tags", "  ")).toEqual([]);
    expect(cardRow("Tags", undefined)).toEqual([]);
    expect(cardRow("Number", "1a1")).toEqual([
      { label: "Number", value: "1a1" },
    ]);
  });

  it("holds a card to what one carries", () => {
    const card = chatCard(
      "note",
      "a".repeat(CHAT_CARD_HEADING_MAX + 10),
      Array.from({ length: MOST_CARD_ROWS + 3 }, () => ({
        label: "Tags",
        value: "seed",
      })),
    );

    expect(ChatCardSchema.parse(card)).toEqual(card);
    expect(card.heading.length).toBe(CHAT_CARD_HEADING_MAX);
    expect(card.rows.length).toBe(MOST_CARD_ROWS);
    expect(
      cardRow("Words", "a".repeat(CHAT_CARD_VALUE_MAX + 10))[0].value.length,
    ).toBe(CHAT_CARD_VALUE_MAX);
  });

  it("says nothing changed, or says which notes did, or does not say", () => {
    for (const touched of [undefined, [], [NOTE, OTHER]]) {
      expect(ChatActDoneSchema.parse({ said: "{}", touched }).touched).toEqual(
        touched,
      );
    }
    expect(
      ChatActDoneSchema.safeParse({
        said: "{}",
        touched: Array.from({ length: MOST_NOTES_TOUCHED + 1 }, () => NOTE),
      }).success,
    ).toBe(false);
  });
});

describe("what both readings of a card share", () => {
  it("names a section by its heading, however it is spaced", () => {
    // The question is drawn from the call and the record from the outcome, so
    // a second reader here showed the person a blank row before the write and
    // the heading after it.
    for (const opens of ["", "\n", "\n\n", "  \n"]) {
      expect(sectionHeadings([`${opens}## Why\n\nBecause.`]), opens).toBe(
        "Why",
      );
    }
  });

  it("says nothing for a section written without one", () => {
    expect(sectionHeadings(["Just words."])).toBe("");
    expect(sectionHeadings(["### Too deep to be a section"])).toBe("");
    expect(sectionHeadings([])).toBe("");
  });

  it("names them in the order they were written", () => {
    expect(sectionHeadings(["## What it does", "## Why", "no heading"])).toBe(
      "What it does, Why",
    );
  });

  it("labels a row once, for both readings to use", () => {
    expect(new Set(Object.values(CARD_ROWS)).size).toBe(
      Object.values(CARD_ROWS).length,
    );
    for (const said of Object.values(CARD_ROWS)) expect(said.trim()).toBe(said);
  });
});
