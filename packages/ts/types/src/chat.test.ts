import { describe, expect, it } from "vitest";
import {
  advertisedChatTools,
  argumentsFit,
  CHAT_AGENTS,
  CHAT_ARGUMENTS_MAX,
  CHAT_BLOCK_KINDS,
  CHAT_SAID_MAX,
  CHAT_SHOWN_MAX,
  CHAT_TOOL_SPECS,
  CHAT_TOOLS,
  ChatBlockSchema,
  ChatEventSchema,
  chatAgentName,
  chatToolWrites,
  ChatToolAnswerSchema,
  ChatToolCallSchema,
  ChatTurnSchema,
  ListedNoteSchema,
  MAX_SECTIONS_PER_WRITE,
  NoteWrittenSchema,
  ReadNoteArgumentsSchema,
  turnFits,
  WriteNoteArgumentsSchema,
} from "./chat.js";
import { WRITE_DONE } from "./authority.js";

const NOTE =
  "did:syr:z6MktEXAMPLEEXAMPLEEXAMPLEEXAMPLE/01JQ7X3K9M2N4P5R6S7T8V9W0X";
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
    expect(chatToolWrites("write_note")).toBe(true);
    expect(chatToolWrites("tag_note")).toBe(true);
    expect(chatToolWrites("list_notes")).toBe(false);
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
      "read_note.note",
      "write_note.about",
      "write_note.title",
      "write_note.sections",
      "write_note.tags",
      "tag_note.note",
      "tag_note.tags",
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
  it("reads every one of the six, and nothing else", () => {
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
      { event: "trouble", said: "That did not finish. Try again." },
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

  it("refuses trouble with nothing to say", () => {
    expect(
      ChatEventSchema.safeParse({ event: "trouble", said: "" }).success,
    ).toBe(false);
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
