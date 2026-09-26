// A chat with an agent about the project: the acts Sloppy hands it, what a
// turn is made of, and what a page is told while it works —
// docs/ARCHITECTURE.md § "Asking a tool to write the notes".

import { z } from "zod";
import { ProjectPathSchema } from "./code-anchor.js";
import { AddressSchema } from "./address.js";
import { WRITE_DONE } from "./authority.js";
import { OwnedRefSchema, TimestampSchema, UlidSchema } from "./common.js";

import { NODE_TITLE_MAX } from "./node.js";
import { MAX_TAGS_PER_NODE, TagsSchema } from "./tag.js";

/** The agents this app can chat with. A second one is a value here and a way
 *  for the shell to reach it, and touches no shape and no surface. */
export const CHAT_AGENTS = ["claude_code"] as const;
export type ChatAgent = (typeof CHAT_AGENTS)[number];

const AGENT_NAMES: Record<ChatAgent, string> = {
  claude_code: "Claude Code",
};

/** What an agent is called where somebody reads it. */
export function chatAgentName(agent: ChatAgent): string {
  return AGENT_NAMES[agent];
}

/**
 * An id minted by whatever runs the session — a session's, and a tool call's.
 * It is OPAQUE: nothing here parses one, compares its parts or reads meaning
 * out of it, so an agent that spells ids some other way costs nobody a change.
 */
export const CHAT_ID_MAX = 128;
export const ChatSessionIdSchema = z.string().min(1).max(CHAT_ID_MAX);
export type ChatSessionId = z.infer<typeof ChatSessionIdSchema>;
export const ChatCallIdSchema = z.string().min(1).max(CHAT_ID_MAX);
export type ChatCallId = z.infer<typeof ChatCallIdSchema>;

/** Long enough for what somebody types into a chat in one go. */
export const CHAT_ASKED_MAX = 8192;

/** Long enough for one block of an agent's writing; a shell holding more of it
 *  sends the first of it. */
export const CHAT_SAID_MAX = 65536;

/** What a tool's answer may run to on its way back to the agent — a listing of
 *  a container's notes, or a note read whole. */
export const CHAT_ANSWER_MAX = 65536;

/** What the thread SHOWS of an answer. A person reads the first of it and
 *  opens the note itself for the rest, so this is far shorter than what the
 *  agent was handed. */
export const CHAT_SHOWN_MAX = 2048;

/** Long enough for what a session that could not go on has to say. */
export const CHAT_TROUBLE_MAX = 2048;

/** Longer than any tool name an agent answers to, its own and Sloppy's. */
export const CHAT_TOOL_NAME_MAX = 128;

/** Long enough for what an agent calls itself. */
export const CHAT_MODEL_MAX = 128;

/** More tools than an agent has anything to gain from being handed. */
export const MAX_TOOLS_LISTED = 128;

/** A turn holding more blocks than this is one nobody is reading. */
export const MAX_BLOCKS_PER_TURN = 512;

/** A session longer than this is a new chat. */
export const MAX_TURNS_PER_SESSION = 512;

/** What a tool call's arguments may run to, encoded — {@link argumentsFit}. */
export const CHAT_ARGUMENTS_MAX = 8192;

/**
 * The acts Sloppy hands an agent. This is the vocabulary three surfaces read:
 * what the endpoint advertises, what the page does when one is called, and
 * what a thread draws. A new act is a value here, an entry in
 * {@link CHAT_TOOL_SPECS} and an arm of {@link ChatToolCallSchema}.
 */
export const CHAT_TOOLS = [
  "list_notes",
  "read_note",
  "write_note",
  "tag_note",
] as const;
export type ChatToolName = (typeof CHAT_TOOLS)[number];

/** Past this a listing is something the agent skims rather than reads. */
export const MOST_NOTES_LISTED = 200;

/** More sections than one note is written in at a time. */
export const MAX_SECTIONS_PER_WRITE = 32;

/** What one answer carries of a note holding more sections than that. Nothing
 *  bounds the sections a NOTE holds, so this bounds the ANSWER — a note is
 *  never too long to read, only too long to hand over whole. */
export const MOST_SECTIONS_READ = 200;

/** Long enough for one section of a note, in markdown. */
export const CHAT_SECTION_MAX = 16384;

/** The places one note is about — its own, and every anchor its sections
 *  reach. */
const ABOUT_MAX = 64;

export const ListNotesArgumentsSchema = z.object({});
export type ListNotesArguments = z.infer<typeof ListNotesArgumentsSchema>;

export const ReadNoteArgumentsSchema = z.object({
  note: OwnedRefSchema.describe("The note, as a listing of them gives it."),
});
export type ReadNoteArguments = z.infer<typeof ReadNoteArgumentsSchema>;

export const WriteNoteArgumentsSchema = z.object({
  about: ProjectPathSchema.describe(
    "The file or folder in the project this note is about, from the project root and spelled with /.",
  ),
  title: z
    .string()
    .trim()
    .min(1)
    .max(NODE_TITLE_MAX)
    .optional()
    .describe(
      "What to call a note being written for the first time. Leave it out to keep the title a note already there has.",
    ),
  sections: z
    .array(z.string().max(CHAT_SECTION_MAX))
    .max(MAX_SECTIONS_PER_WRITE)
    .describe(
      "The note's sections, in order, each in markdown and each opening with a `## ` heading. A heading already in the note replaces that section, a new heading goes after the rest, and a section left out stays as it is. An empty list writes nothing.",
    ),
  tags: z
    .array(z.string())
    .max(MAX_TAGS_PER_NODE)
    .optional()
    .describe(
      "The systems this note belongs to, so that picking one out picks out everything about it. Lowercase, a word or a short phrase.",
    ),
});
export type WriteNoteArguments = z.infer<typeof WriteNoteArgumentsSchema>;

export const TagNoteArgumentsSchema = z.object({
  note: OwnedRefSchema.describe("The note, as a listing of them gives it."),
  tags: z
    .array(z.string())
    .max(MAX_TAGS_PER_NODE)
    .describe("The systems this note belongs to. Nothing is ever taken off."),
});
export type TagNoteArguments = z.infer<typeof TagNoteArgumentsSchema>;

export interface ChatToolSpec {
  /** One line for the agent, in the words it is being asked in. */
  description: string;
  /** What a person reads in the thread while it happens. */
  label: string;
  /**
   * What the call's arguments must be. **This is the check, and the advertised
   * JSON Schema is looser than it** — a path held to `insideProject` reaches
   * the agent as a bounded string — so the arguments are parsed here whatever
   * the agent was shown.
   */
  arguments: z.ZodType;
  /** Whether it writes, which is what puts it behind the person's answer. */
  writes: boolean;
}

export const CHAT_TOOL_SPECS: Record<ChatToolName, ChatToolSpec> = {
  list_notes: {
    description:
      "List the notes this project already has: each one's ref, title, address, tags, and the places in the code it is about. A long list answers with as much of itself as fits and says how many notes it left.",
    label: "Reading the notes",
    arguments: ListNotesArgumentsSchema,
    writes: false,
  },
  read_note: {
    description:
      "Read one note whole — its title, tags, the places it is about, and its sections as markdown. A long note answers with as much of itself as fits and says how many sections it left.",
    label: "Reading a note",
    arguments: ReadNoteArgumentsSchema,
    writes: false,
  },
  write_note: {
    description:
      "Write the note about a place in the project, starting one where there is none. The person is asked before anything lands.",
    label: "Writing a note",
    arguments: WriteNoteArgumentsSchema,
    writes: true,
  },
  tag_note: {
    description:
      "Put tags on a note, naming the systems it belongs to. The person is asked first.",
    label: "Tagging a note",
    arguments: TagNoteArgumentsSchema,
    writes: true,
  },
};

/** Whether an act writes, which is the whole of what decides whether the
 *  person is asked before it happens. */
export function chatToolWrites(act: ChatToolName): boolean {
  return CHAT_TOOL_SPECS[act].writes;
}

/** One act as an agent is shown it. */
export interface AdvertisedTool {
  name: ChatToolName;
  description: string;
  /** JSON Schema for the call's arguments, derived from the act's own schema
   *  and looser than it — see {@link ChatToolSpec.arguments}. */
  arguments: Record<string, unknown>;
}

/**
 * Every act, as the endpoint serving them advertises them. One function so
 * that what an agent is shown and what its calls are parsed against cannot be
 * two different things.
 */
export function advertisedChatTools(): AdvertisedTool[] {
  return CHAT_TOOLS.map((name) => {
    const { $schema, ...shape } = z.toJSONSchema(
      CHAT_TOOL_SPECS[name].arguments,
      {
        io: "input",
      },
    ) as Record<string, unknown>;
    return {
      name,
      description: CHAT_TOOL_SPECS[name].description,
      arguments: shape,
    };
  });
}

/** One note as a listing gives it. `about` is the places in the code it
 *  reaches, its own and every anchor its sections hold. */
export const ListedNoteSchema = z.object({
  note: OwnedRefSchema,
  title: z.string().max(NODE_TITLE_MAX),
  /** **Absent is a note with no address**, which is an ordinary note. */
  address: AddressSchema.optional(),
  tags: TagsSchema,
  about: z.array(ProjectPathSchema).max(ABOUT_MAX),
});
export type ListedNote = z.infer<typeof ListedNoteSchema>;

/** One section of a note, as the agent reads and writes one. `id` is what says
 *  a section written back is THAT section rather than a second copy. */
export const NoteSectionSchema = z.object({
  id: UlidSchema,
  markdown: z.string().max(CHAT_SECTION_MAX),
});
export type NoteSection = z.infer<typeof NoteSectionSchema>;

/** One note read whole, or as much of it as one answer carries —
 *  {@link noteAnswer} is what composes one. */
export const NoteReadSchema = ListedNoteSchema.extend({
  sections: z.array(NoteSectionSchema).max(MOST_SECTIONS_READ),
  /** **Absent is the whole note.** A count is how many further sections the
   *  note holds that this answer does not carry. */
  more: z.int().min(1).optional(),
});
export type NoteRead = z.infer<typeof NoteReadSchema>;

/** The notes a project has, or as many of them as one answer carries —
 *  {@link listingAnswer} is what composes one. */
export const NotesListedSchema = z.object({
  notes: z.array(ListedNoteSchema).max(MOST_NOTES_LISTED),
  /** **Absent is every note there is.** A count is how many further notes the
   *  project has that this answer does not carry. */
  more: z.int().min(1).optional(),
});
export type NotesListed = z.infer<typeof NotesListedSchema>;

/**
 * What one write came to. `offered` is a note somebody has written in: the
 * agent writes as the project's container rather than as the person, so its
 * writing stands as an amendment until they take it in — `writeOnto` in
 * `@sloppy/local` is that rule and nothing here repeats it.
 */
export const NoteWrittenSchema = z.object({
  note: OwnedRefSchema,
  done: z.enum(WRITE_DONE),
});
export type NoteWritten = z.infer<typeof NoteWrittenSchema>;

/** The kinds of block a turn is made of. **An OPEN set**: a kind this build
 *  has no renderer for is carried untouched rather than refused, for the
 *  reason AI.md § "A Block Is a Section" gives about a note's own elements. */
export const CHAT_BLOCK_KINDS = [
  "said",
  "thinking",
  "tool_call",
  "tool_result",
] as const;
export type ChatBlockKind = (typeof CHAT_BLOCK_KINDS)[number];

export const SaidBlockSchema = z.object({
  kind: z.literal("said"),
  said: z.string().max(CHAT_SAID_MAX),
});

export const ThinkingBlockSchema = z.object({
  kind: z.literal("thinking"),
  said: z.string().max(CHAT_SAID_MAX),
});

export const ToolCallBlockSchema = z.object({
  kind: z.literal("tool_call"),
  call: ChatCallIdSchema,
  /** The name the call arrived under, which is the agent's spelling of it and
   *  never Sloppy's. Shown only where {@link ToolCallBlock.act} is absent. */
  tool: z.string().min(1).max(CHAT_TOOL_NAME_MAX),
  /** Which of Sloppy's own acts this is. **Absent is a tool of the agent's
   *  own** — reading a file, searching the code — which is drawn by name and
   *  is never behind the person's answer, because nothing of ours runs. */
  act: z.enum(CHAT_TOOLS).optional(),
  /** Carried untouched, the way a document element's `attrs` is: the page
   *  parses them against the act's own schema before doing anything, and draws
   *  nothing it has not read. **Absent is a call with none.** Bounded by
   *  {@link argumentsFit}. */
  arguments: z.unknown().optional(),
});
export type ToolCallBlock = z.infer<typeof ToolCallBlockSchema>;

export const ToolResultBlockSchema = z.object({
  kind: z.literal("tool_result"),
  call: ChatCallIdSchema,
  /** What the call came to, as much of it as the thread shows — the agent was
   *  handed the whole of it. */
  said: z.string().max(CHAT_SHOWN_MAX),
  /** **Absent is a call that came to an answer.** True is one that did not,
   *  which the agent was told about and may act on. */
  trouble: z.boolean().optional(),
});

const KNOWN_KINDS: ReadonlySet<string> = new Set(CHAT_BLOCK_KINDS);

/**
 * A block of a kind this build knows nothing about, kept whole. It is what
 * makes the set open, so it refuses the kinds above rather than standing in
 * for one of them that failed its own bounds.
 */
export const CarriedBlockSchema = z.looseObject({
  kind: z
    .string()
    .min(1)
    .max(CHAT_TOOL_NAME_MAX)
    .refine((kind) => !KNOWN_KINDS.has(kind), "That block is not carried."),
});

export const ChatBlockSchema = z.union([
  SaidBlockSchema,
  ThinkingBlockSchema,
  ToolCallBlockSchema,
  ToolResultBlockSchema,
  CarriedBlockSchema,
]);
export type ChatBlock = z.infer<typeof ChatBlockSchema>;

/** Who a turn is from. */
export const CHAT_SPEAKERS = ["person", "agent"] as const;
export type ChatSpeaker = (typeof CHAT_SPEAKERS)[number];

/** One turn: what a person said, or what the agent did between one of their
 *  turns and the next ({@link turnFits}). */
export const ChatTurnSchema = z.object({
  from: z.enum(CHAT_SPEAKERS),
  blocks: z.array(ChatBlockSchema).max(MAX_BLOCKS_PER_TURN),
  at: TimestampSchema,
});
export type ChatTurn = z.infer<typeof ChatTurnSchema>;

/** A chat as the surface holding it has it. Nothing stores one: a session
 *  lasts as long as the surface showing it. */
export const ChatSessionSchema = z.object({
  id: ChatSessionIdSchema,
  /** What the agent said it is. **Absent is one that said nothing about
   *  it**, which is not a failure. */
  model: z.string().max(CHAT_MODEL_MAX).optional(),
  /** Every tool the agent has here, Sloppy's and its own, under the names its
   *  calls arrive by. */
  tools: z
    .array(z.string().min(1).max(CHAT_TOOL_NAME_MAX))
    .max(MAX_TOOLS_LISTED),
  turns: z.array(ChatTurnSchema).max(MAX_TURNS_PER_SESSION),
});
export type ChatSession = z.infer<typeof ChatSessionSchema>;

/** A call of one of Sloppy's own acts, arguments already parsed, as the page
 *  is handed it. */
export const ChatToolCallSchema = z.discriminatedUnion("act", [
  z.object({
    call: ChatCallIdSchema,
    act: z.literal("list_notes"),
    arguments: ListNotesArgumentsSchema,
  }),
  z.object({
    call: ChatCallIdSchema,
    act: z.literal("read_note"),
    arguments: ReadNoteArgumentsSchema,
  }),
  z.object({
    call: ChatCallIdSchema,
    act: z.literal("write_note"),
    arguments: WriteNoteArgumentsSchema,
  }),
  z.object({
    call: ChatCallIdSchema,
    act: z.literal("tag_note"),
    arguments: TagNoteArgumentsSchema,
  }),
]);
export type ChatToolCall = z.infer<typeof ChatToolCallSchema>;

/** What the page answers a call with. `said` is what the AGENT reads, whole;
 *  what the thread shows is the shorter `tool_result` block beside it. */
export const ChatToolAnswerSchema = z.object({
  said: z.string().max(CHAT_ANSWER_MAX),
  /** **Absent is an answer.** True is a call that came to nothing the agent
   *  asked for — a note that is not there, a place it may not write — told to
   *  it in words it can act on. */
  trouble: z.boolean().optional(),
});
export type ChatToolAnswer = z.infer<typeof ChatToolAnswerSchema>;

const NOTE_TOO_LONG = "That note is too long to read.";

/**
 * The notes a project has, as the agent is handed them: JSON, carrying as many
 * as {@link CHAT_ANSWER_MAX} holds and saying how many it left. **Every
 * listing an act answers with is composed here** — docs/ARCHITECTURE.md
 * § "Asking a tool to write the notes".
 */
export function listingAnswer(notes: readonly ListedNote[]): ChatToolAnswer {
  let kept = notes.slice(0, MOST_NOTES_LISTED);
  for (;;) {
    const said = JSON.stringify(
      withMore({ notes: kept }, notes.length - kept.length),
    );
    if (said.length <= CHAT_ANSWER_MAX || kept.length === 0) return { said };
    kept = kept.slice(0, -1);
  }
}

/**
 * One note as the agent is handed it, by the rule {@link listingAnswer} holds a
 * listing to: its sections from the first, as many as one answer carries, and
 * how many it left. **A note whose title, tags and places alone run past the
 * bound comes to trouble**, nothing under it being left to carry.
 */
export function noteAnswer(
  note: ListedNote,
  sections: readonly NoteSection[],
): ChatToolAnswer {
  let kept = sections.slice(0, MOST_SECTIONS_READ);
  for (;;) {
    const said = JSON.stringify(
      withMore({ ...note, sections: kept }, sections.length - kept.length),
    );
    if (said.length <= CHAT_ANSWER_MAX) return { said };
    if (kept.length === 0) return { said: NOTE_TOO_LONG, trouble: true };
    kept = kept.slice(0, -1);
  }
}

function withMore<T extends object>(held: T, more: number): T {
  return more > 0 ? { ...held, more } : held;
}

const StartedEventSchema = z.object({
  event: z.literal("started"),
  session: ChatSessionIdSchema,
  model: z.string().max(CHAT_MODEL_MAX).optional(),
  tools: z
    .array(z.string().min(1).max(CHAT_TOOL_NAME_MAX))
    .max(MAX_TOOLS_LISTED),
});

const BlockEventSchema = z.object({
  event: z.literal("block"),
  /** Where in the turn underway this block stands, counting from 0. **A block
   *  arriving again at a place already held is that block grown**, and
   *  replaces it — which is the whole of how a page renders writing as it
   *  arrives. */
  at: z
    .int()
    .min(0)
    .max(MAX_BLOCKS_PER_TURN - 1),
  block: ChatBlockSchema,
});

const AskingEventSchema = z.object({
  event: z.literal("asking"),
  call: ChatCallIdSchema,
  act: z.enum(CHAT_TOOLS),
  /** Carried untouched, as on a tool call block, and bounded by
   *  {@link argumentsFit}. It is what the question in the thread is written
   *  from, so this event stands on its own and never waits on a block. */
  arguments: z.unknown().optional(),
});

const SettledEventSchema = z.object({
  event: z.literal("settled"),
  call: ChatCallIdSchema,
  /** What the call was answered with. **False is a call turned down**, and a
   *  call nobody answered because the session ended under the question. */
  allowed: z.boolean(),
});

const EndedEventSchema = z.object({
  event: z.literal("ended"),
  /** **Absent is a turn that finished.** True is one the person stopped, which
   *  is not trouble and says nothing to them. */
  stopped: z.boolean().optional(),
});

const OverEventSchema = z.object({
  event: z.literal("over"),
  /** Why the session could not go on, in words for the person — the agent's
   *  own where it gave some. **Absent is a session that simply ended**: one
   *  closed here, one another was opened over, one the agent finished. Nothing
   *  is said to the person about those, and nothing went wrong. */
  said: z.string().min(1).max(CHAT_TROUBLE_MAX).optional(),
});

/**
 * What a page is told while a session runs. A CLOSED set, unlike the blocks it
 * carries: every one of these is composed by the shell rather than read off an
 * agent, so a page renders by exhausting them.
 */
export const ChatEventSchema = z.discriminatedUnion("event", [
  StartedEventSchema,
  BlockEventSchema,
  AskingEventSchema,
  SettledEventSchema,
  EndedEventSchema,
  OverEventSchema,
]);
export type ChatEvent = z.infer<typeof ChatEventSchema>;

/**
 * Whether a call's arguments are small enough to carry. They arrive as
 * whatever the agent sent, so the shape cannot bound them without refusing the
 * openness that lets an unread call still be drawn — and a refinement here
 * would take `.omit()` and `.partial()` with it. A value that will not encode
 * at all does not fit either.
 */
export function argumentsFit(value: unknown): boolean {
  if (value === undefined) return true;
  try {
    const encoded = JSON.stringify(value);
    return encoded !== undefined && encoded.length <= CHAT_ARGUMENTS_MAX;
  } catch {
    return false;
  }
}

/**
 * Whether what a turn carries fits who it is from: a person types words, so
 * their turn holds nothing but what they said. The shape cannot say it for the
 * reason {@link argumentsFit} cannot, and both ends of the seam are held to
 * this instead.
 */
export function turnFits(turn: ChatTurn): boolean {
  return (
    turn.from === "agent" || turn.blocks.every((block) => block.kind === "said")
  );
}
