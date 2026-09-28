// A chat with an agent about the project: the acts Sloppy hands it, what a
// turn is made of, and what a page is told while it works —
// docs/ARCHITECTURE.md § "Asking a tool to write the notes".

import { z } from "zod";
import { ProjectPathSchema } from "./code-anchor.js";
import { AddressSchema } from "./address.js";
import {
  MARK_RADII,
  type NodeAppearance,
  RING_STYLES,
  RING_WEIGHTS,
} from "./appearance.js";
import { WRITE_DONE } from "./authority.js";
import { OwnedRefSchema, TimestampSchema, UlidSchema } from "./common.js";
import {
  EDGE_DIRECTIONS,
  EDGE_LABEL_MAX,
  EDGE_STROKES,
  type EdgeLook,
  EdgeLookSchema,
} from "./edge.js";

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

/** Long enough for what a model is called where somebody picks one. */
export const CHAT_MODEL_NAME_MAX = 64;

/** Long enough for the one line an act gives the person, which the thread
 *  shows whole. */
export const CHAT_TOLD_MAX = 200;

/** More tools than an agent has anything to gain from being handed. */
export const MAX_TOOLS_LISTED = 128;

/** A turn holding more blocks than this is one nobody is reading. */
export const MAX_BLOCKS_PER_TURN = 512;

/** A session longer than this is a new chat. */
export const MAX_TURNS_PER_SESSION = 512;

/** What a tool call's arguments may run to, encoded — {@link argumentsFit}. */
export const CHAT_ARGUMENTS_MAX = 8192;

/** One model an agent answers with. `model` is what that agent is asked for,
 *  in its own spelling; `name` is what somebody picking one reads. */
export const ChatModelSchema = z.object({
  model: z.string().min(1).max(CHAT_MODEL_MAX),
  name: z.string().min(1).max(CHAT_MODEL_NAME_MAX),
});
export type ChatModel = z.infer<typeof ChatModelSchema>;

const AGENT_MODELS: Record<ChatAgent, readonly ChatModel[]> = {
  claude_code: [
    { model: "opus", name: "Opus" },
    { model: "sonnet", name: "Sonnet" },
    { model: "haiku", name: "Haiku" },
  ],
};

/**
 * The models an agent can answer with, in the order somebody is offered them.
 * The one copy of what each is called where a person reads it, the way
 * {@link chatAgentName} is for the agents themselves.
 *
 * **An empty list is an agent that names none**, and choosing none is what
 * somebody who has picked nothing has: the agent answers with whatever it
 * would on its own.
 */
export function chatModels(agent: ChatAgent): readonly ChatModel[] {
  return AGENT_MODELS[agent];
}

/**
 * The acts Sloppy hands an agent. This is the vocabulary three surfaces read:
 * what the endpoint advertises, what the page does when one is called, and
 * what a thread draws. A new act is a value here, an entry in
 * {@link CHAT_TOOL_SPECS} and an arm of {@link ChatToolCallSchema}.
 */
export const CHAT_TOOLS = [
  "list_notes",
  "search_notes",
  "read_note",
  "write_note",
  "move_note",
  "tag_note",
  "number_note",
  "link_notes",
  "style_edge",
  "style_note",
  "delete_note",
] as const;
export type ChatToolName = (typeof CHAT_TOOLS)[number];

/** Past this a listing is something the agent skims rather than reads. */
export const MOST_NOTES_LISTED = 200;

/** Past this a search is one to ask again in better words. */
export const MOST_NOTES_FOUND = 25;

/** Longer than a phrase worth looking for. */
export const SEARCH_WORDS_MAX = 200;

/** Longer than the writing a search answers around what it matched. */
const SNIPPET_MAX = 512;

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

export const SearchNotesArgumentsSchema = z.object({
  words: z
    .string()
    .trim()
    .min(1)
    .max(SEARCH_WORDS_MAX)
    .describe(
      "The words to look for, or an address like 1a1. A note is found where its title, its tags or its writing carry all of them.",
    ),
});
export type SearchNotesArguments = z.infer<typeof SearchNotesArgumentsSchema>;

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
      "The systems this note belongs to, so that picking one out picks out everything about it. Lowercase, a word or a short phrase. Write at least one: a note carrying none is in no set at all.",
    ),
  under: OwnedRefSchema.optional().describe(
    "The note this one springs out of, where a note is being started. Leave it out and it springs out of the note about the nearest folder above the place. A note already there is written onto where it stands; move_note is what carries one somewhere else.",
  ),
  address: AddressSchema.optional().describe(
    "The number to write on the note, like 1a1, which is what a person cites it by. It springs from the number of the note above it, or is a whole number where the note springs from nothing. Leave it out and a note being started takes the next number in the run it joins, and a note already there keeps the one it has.",
  ),
});
export type WriteNoteArguments = z.infer<typeof WriteNoteArgumentsSchema>;

export const MoveNoteArgumentsSchema = z.object({
  note: OwnedRefSchema.describe(
    "The note to carry, as a listing of them gives it. Everything beneath it goes with it.",
  ),
  to: OwnedRefSchema.describe("The note it lands by."),
  relation: z
    .enum(["under", "after"])
    .describe(
      "'under' where the note sprang out of that one, 'after' where it continues the run that one is in.",
    ),
  address: AddressSchema.optional().describe(
    "The number the note takes where it lands, like 1a1. It springs from the number of the note it lands under, or is a whole number where it lands as a branch. Leave it out and it takes the next number in the run it joins. Either way the number it leaves keeps leading to it.",
  ),
});
export type MoveNoteArguments = z.infer<typeof MoveNoteArgumentsSchema>;

export const TagNoteArgumentsSchema = z.object({
  note: OwnedRefSchema.describe("The note, as a listing of them gives it."),
  tags: z
    .array(z.string())
    .max(MAX_TAGS_PER_NODE)
    .optional()
    .describe(
      "The systems this note belongs to, put on beside the ones it already carries. Leave it out to take tags off and put none on.",
    ),
  off: z
    .array(z.string())
    .max(MAX_TAGS_PER_NODE)
    .optional()
    .describe(
      "Tags that have stopped being true of this note, taken off it. A tag named in both comes off.",
    ),
});
export type TagNoteArguments = z.infer<typeof TagNoteArgumentsSchema>;

export const NumberNoteArgumentsSchema = z.object({
  note: OwnedRefSchema.describe("The note, as a listing of them gives it."),
  address: AddressSchema.optional().describe(
    "The number to write on it, like 1a1. It springs from the number of the note above it, no other note in this graph may be at it, and the number it leaves keeps leading to it. Leave it out to take the number it has off it.",
  ),
});
export type NumberNoteArguments = z.infer<typeof NumberNoteArgumentsSchema>;

/** More lines than one act draws out of one note. */
export const MOST_LINES_DRAWN = 64;

export const LinkNotesArgumentsSchema = z.object({
  note: OwnedRefSchema.describe("The note the lines are drawn from."),
  to: z
    .array(OwnedRefSchema)
    .max(MOST_LINES_DRAWN)
    .optional()
    .describe(
      "The notes to draw a line to, beside the lines this note already carries. Leave it out to take lines off and draw none.",
    ),
  off: z
    .array(OwnedRefSchema)
    .max(MOST_LINES_DRAWN)
    .optional()
    .describe(
      "The notes whose line to this one has stopped being true, taken off it. A note named in both loses its line.",
    ),
});
export type LinkNotesArguments = z.infer<typeof LinkNotesArgumentsSchema>;

/** What a look on a line is made of, beside the note at the other end. */
const EDGE_LOOK_CHANNELS = [
  "label",
  "direction",
  "stroke",
] as const satisfies readonly (keyof EdgeLook)[];
export type EdgeLookChannel = (typeof EDGE_LOOK_CHANNELS)[number];

export const StyleEdgeArgumentsSchema = z.object({
  note: OwnedRefSchema.describe(
    "The note at this end of the line, as a listing of them gives it. The arrowhead is read against it.",
  ),
  to: OwnedRefSchema.describe("The note at the other end."),
  label: z
    .string()
    .trim()
    .max(EDGE_LABEL_MAX)
    .optional()
    .describe(
      "What the line says, like 'grew out of'. Leave it out and whatever the line says stays.",
    ),
  direction: z
    .enum(EDGE_DIRECTIONS)
    .optional()
    .describe(
      "Where the arrowhead sits: 'to' points at the other note, 'from' back at this one, 'both' draws one at each end.",
    ),
  stroke: z
    .enum(EDGE_STROKES)
    .optional()
    .describe("How broken the line is drawn."),
  off: z
    .array(z.enum(EDGE_LOOK_CHANNELS))
    .max(EDGE_LOOK_CHANNELS.length)
    .optional()
    .describe(
      "What to take back off the line. Naming all three leaves it drawn as the graph draws it.",
    ),
});
export type StyleEdgeArguments = z.infer<typeof StyleEdgeArgumentsSchema>;

/** The channels of a note's look this act sets. The pictures a mark wears are
 *  the person's own uploads, so they are not among them. */
const MARK_CHANNELS = [
  "ring_weight",
  "ring_style",
  "mark_radius",
] as const satisfies readonly (keyof NodeAppearance)[];
export type MarkChannel = (typeof MARK_CHANNELS)[number];

export const StyleNoteArgumentsSchema = z.object({
  note: OwnedRefSchema.describe("The note, as a listing of them gives it."),
  ring_weight: z
    .enum(RING_WEIGHTS)
    .optional()
    .describe(
      "How heavy a ring the mark wears, which is how loudly the ring says what it says. 'none' is the mark an unstyled note draws, and is what most notes should draw.",
    ),
  ring_style: z
    .enum(RING_STYLES)
    .optional()
    .describe(
      "How broken the ring is. A broken ring reads as a draft, and says nothing on a mark wearing no ring.",
    ),
  mark_radius: z
    .enum(MARK_RADII)
    .optional()
    .describe(
      "How big the mark is drawn. A mark is already as big as the thought folded under it and this multiplies that, so it is how much of the project the note answers for.",
    ),
  off: z
    .array(z.enum(MARK_CHANNELS))
    .max(MARK_CHANNELS.length)
    .optional()
    .describe(
      "What to take back off the mark. Naming all of them leaves it drawn as the graph draws an unstyled note; a picture on the mark is not one of these and stays.",
    ),
});
export type StyleNoteArguments = z.infer<typeof StyleNoteArgumentsSchema>;

export const DeleteNoteArgumentsSchema = z.object({
  note: OwnedRefSchema.describe(
    "The note to put in the bin, as a listing of them gives it. Everything beneath it goes with it, and a person can take it back out.",
  ),
});
export type DeleteNoteArguments = z.infer<typeof DeleteNoteArgumentsSchema>;

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
      "List the notes this project already has: each one's ref, title, address, tags, what it springs out of, and the places in the code it is about. A long list answers with as much of itself as fits and says how many notes it left.",
    label: "Reading the notes",
    arguments: ListNotesArgumentsSchema,
    writes: false,
  },
  search_notes: {
    description:
      "Find the notes that carry some words, with the writing around what matched. Look here before writing anything down, and before answering why something in this project is the way it is: where a note already says the thing, cite it — [what it is called](sloppy:<ref>) — rather than writing it a second time.",
    label: "Looking through the notes",
    arguments: SearchNotesArgumentsSchema,
    writes: false,
  },
  read_note: {
    description:
      "Read one note whole — its title, tags, the places it is about, and its sections as markdown. It says what a piece of this project is FOR, which is what you read the code against when somebody asks whether it is still doing what it was written to do. A long note answers with as much of itself as fits and says how many sections it left.",
    label: "Reading a note",
    arguments: ReadNoteArgumentsSchema,
    writes: false,
  },
  write_note: {
    description:
      "Write the note about a place in the project, starting one where there is none. A decision and the reason for it belong here, and so does what you found reading one against the code. A reason goes down only from a source you name in the note — the person's words, a commit message, a comment, a document here — and where none says why, the open question goes down instead. Search first: what this graph already says is cited, not written again, and a relation between two notes goes on the line between them. Tag it with the system it is about, and draw it with style_note where its mark should be found from across the field.",
    label: "Writing a note",
    arguments: WriteNoteArgumentsSchema,
    writes: true,
  },
  move_note: {
    description:
      "Carry a note to what it really sprang out of, or after the note it continues. Everything beneath it goes with it, and the address it leaves keeps leading to it.",
    label: "Moving a note",
    arguments: MoveNoteArgumentsSchema,
    writes: true,
  },
  tag_note: {
    description:
      "Put tags on a note, naming the systems it belongs to, and take off the ones that have stopped being true of it. This is the whole of what can be done for the canvas's colour: a tag has no look of its own, the colour a note draws in is the reader's own selection, and a note carrying no tags is one their question can never reach.",
    label: "Tagging a note",
    arguments: TagNoteArgumentsSchema,
    writes: true,
  },
  number_note: {
    description:
      "Write the number a person cites a note by — 1a1 — or take the one it has off it. Read the notes first: the number springs from the number of the note above it, and no other note in this graph may be at it.",
    label: "Numbering a note",
    arguments: NumberNoteArgumentsSchema,
    writes: true,
  },
  link_notes: {
    description:
      "Draw a line between two notes, and take one off. Read the notes first: a line that is already there is not drawn again, and naming a note in the writing draws one already, so this is for a connection the writing does not make. What the line MEANS goes on the line with style_edge, never into prose about it.",
    label: "Linking notes",
    arguments: LinkNotesArgumentsSchema,
    writes: true,
  },
  style_edge: {
    description:
      "Say what the line between two notes reads as: the words on it, which end the arrowhead sits at, how broken it is drawn. It is a look on whatever line is already there — genealogy, run, citation or one drawn by hand — and draws nothing where there is no line, so draw the line first.",
    label: "Labelling a line",
    arguments: StyleEdgeArgumentsSchema,
    writes: true,
  },
  style_note: {
    description:
      "Say how a note's mark is drawn on the canvas: the ring it wears inside its own edge, how broken that ring is, how big the mark is. Size says how much of the project the note answers for, and a broken ring says the reading is not finished. Shape only — the colour on the canvas answers the reader's own question and is never a note's to set. A look is read against the marks carrying none, so draw the few notes somebody should find from across the field and leave the rest plain.",
    label: "Drawing a mark",
    arguments: StyleNoteArgumentsSchema,
    writes: true,
  },
  delete_note: {
    description:
      "Put a note in the bin, with everything beneath it. A person can take it back out. Read the note first: what a note says is worth citing from somewhere else more often than it is worth losing.",
    label: "Putting a note in the bin",
    arguments: DeleteNoteArgumentsSchema,
    writes: true,
  },
};

/** Whether an act writes on the draft, which is what the thread's icon says. */
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
  /** What the note sprang out of. **Absent is a note that starts a line of
   *  thought of its own** — a branch, or a note written under nothing. */
  parent: OwnedRefSchema.optional(),
  tags: TagsSchema,
  about: z.array(ProjectPathSchema).max(ABOUT_MAX),
  /** The lines drawn between this note and another by hand. **Absent is a note
   *  with none**, and the lines the genealogy, the run and the writing draw are
   *  not among them — those are read off the parent, the addresses and the
   *  citations in the writing. */
  links: z.array(OwnedRefSchema).max(MOST_LINES_DRAWN).optional(),
});
export type ListedNote = z.infer<typeof ListedNoteSchema>;

/**
 * One note a search reached. `snippet` is the writing around what matched,
 * already cut to length; **empty is a note reached by its title, its tags or
 * its address** rather than by its writing.
 */
export const FoundNoteSchema = z.object({
  note: OwnedRefSchema,
  title: z.string().max(NODE_TITLE_MAX),
  /** **Absent is a note with no address**, which is an ordinary note. */
  address: AddressSchema.optional(),
  snippet: z.string().max(SNIPPET_MAX),
});
export type FoundNote = z.infer<typeof FoundNoteSchema>;

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
  /** The looks this note sets on its lines, one per note at the other end.
   *  **Absent is a note that sets none**, which is a line drawn as the graph
   *  draws it — and the other end may still set one. */
  edges: z.array(EdgeLookSchema).max(MOST_LINES_DRAWN).optional(),
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

/** The notes a search reached, or as many of them as one answer carries —
 *  {@link foundAnswer} is what composes one. */
export const NotesFoundSchema = z.object({
  found: z.array(FoundNoteSchema).max(MOST_NOTES_FOUND),
  /** **Absent is every note the search reached.** A count is how many further
   *  ones it reached that this answer does not carry. */
  more: z.int().min(1).optional(),
});
export type NotesFound = z.infer<typeof NotesFoundSchema>;

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

/** A note put in the bin, as it stood when it went. Everything beneath it went
 *  with it, and a person can take it back out. */
export const NoteBinnedSchema = z.object({
  binned: ListedNoteSchema,
});
export type NoteBinned = z.infer<typeof NoteBinnedSchema>;

/** Longer than what a person calls a file they put in front of an agent. */
export const CHAT_ATTACHED_NAME_MAX = 200;

/** More files than somebody puts in front of an agent in one go. */
export const MOST_ATTACHED_PER_TURN = 8;

/** What one of them may run to, in bytes. Past this the person is told it is
 *  too big to send rather than being left waiting on it. */
export const CHAT_ATTACHMENT_MAX = 10 * 1024 * 1024;

/**
 * A file or a picture a person put in front of the agent alongside what they
 * said. `name` is what they call it and `path` is where it was put, from the
 * project root — **the agent READS it there**, so nothing here carries bytes
 * and no act has to be added for one.
 */
export const ChatAttachmentSchema = z.object({
  name: z.string().min(1).max(CHAT_ATTACHED_NAME_MAX),
  path: ProjectPathSchema,
});
export type ChatAttachment = z.infer<typeof ChatAttachmentSchema>;

/** The kinds of block a turn is made of. **An OPEN set**: a kind this build
 *  has no renderer for is carried untouched rather than refused, for the
 *  reason AI.md § "A Block Is a Section" gives about a note's own elements. */
export const CHAT_BLOCK_KINDS = [
  "said",
  "attached",
  "thinking",
  "tool_call",
  "tool_result",
] as const;
export type ChatBlockKind = (typeof CHAT_BLOCK_KINDS)[number];

export const SaidBlockSchema = z.object({
  kind: z.literal("said"),
  said: z.string().max(CHAT_SAID_MAX),
});

/** What a person attached to what they said, which is the only block of
 *  theirs that is not words — {@link turnFits}. */
export const AttachedBlockSchema = z.object({
  kind: z.literal("attached"),
  attached: z.array(ChatAttachmentSchema).min(1).max(MOST_ATTACHED_PER_TURN),
});
export type AttachedBlock = z.infer<typeof AttachedBlockSchema>;

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
  AttachedBlockSchema,
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
    act: z.literal("search_notes"),
    arguments: SearchNotesArgumentsSchema,
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
    act: z.literal("move_note"),
    arguments: MoveNoteArgumentsSchema,
  }),
  z.object({
    call: ChatCallIdSchema,
    act: z.literal("tag_note"),
    arguments: TagNoteArgumentsSchema,
  }),
  z.object({
    call: ChatCallIdSchema,
    act: z.literal("number_note"),
    arguments: NumberNoteArgumentsSchema,
  }),
  z.object({
    call: ChatCallIdSchema,
    act: z.literal("link_notes"),
    arguments: LinkNotesArgumentsSchema,
  }),
  z.object({
    call: ChatCallIdSchema,
    act: z.literal("style_edge"),
    arguments: StyleEdgeArgumentsSchema,
  }),
  z.object({
    call: ChatCallIdSchema,
    act: z.literal("style_note"),
    arguments: StyleNoteArgumentsSchema,
  }),
  z.object({
    call: ChatCallIdSchema,
    act: z.literal("delete_note"),
    arguments: DeleteNoteArgumentsSchema,
  }),
]);
export type ChatToolCall = z.infer<typeof ChatToolCallSchema>;

/**
 * What the AGENT is handed of a call, and the whole of it: `said` is what it
 * reads, and the seam out to it parses this shape, so what an act lays out for
 * the PERSON ({@link ChatActDoneSchema}) stays on this side of it.
 */
export const ChatToolAnswerSchema = z.object({
  said: z.string().max(CHAT_ANSWER_MAX),
  /** **Absent is an answer.** True is a call that came to nothing the agent
   *  asked for — a note that is not there, a place it may not write — told to
   *  it in words it can act on. */
  trouble: z.boolean().optional(),
});
export type ChatToolAnswer = z.infer<typeof ChatToolAnswerSchema>;

/** What a card is about, which is what a surface draws it as. A CLOSED set:
 *  every card is composed here rather than read off an agent. */
export const CHAT_CARD_ABOUT = ["note", "line", "mark"] as const;
export type ChatCardAbout = (typeof CHAT_CARD_ABOUT)[number];

/** More rows than a card somebody takes in at a glance. */
export const MOST_CARD_ROWS = 12;

/** Long enough for a note as somebody cites it — its address and its title. */
export const CHAT_CARD_HEADING_MAX = 200;

/** Longer than what a row is labelled — a word, or two. */
export const CHAT_CARD_LABEL_MAX = 40;

/** Long enough for a place's path or a short run of notes, and short enough
 *  that a row stays a row. */
export const CHAT_CARD_VALUE_MAX = 512;

/** One labelled row of a card, in the words a person reads. */
export const ChatCardRowSchema = z.object({
  label: z.string().min(1).max(CHAT_CARD_LABEL_MAX),
  value: z.string().min(1).max(CHAT_CARD_VALUE_MAX),
});
export type ChatCardRow = z.infer<typeof ChatCardRowSchema>;

/**
 * What an act lays out for the person: the note, line or mark it is about, how
 * that reads at the head of it, and the rows that say what happens to it.
 * **The agent is never handed one.**
 *
 * **Nothing on it is written in a tense.** One card stands in front of an act
 * as the question and after it as what came of it — docs/ARCHITECTURE.md
 * § "Asking a tool to write the notes" — so which of the two it is, is the
 * surface's to say and never the card's.
 */
export const ChatCardSchema = z.object({
  about: z.enum(CHAT_CARD_ABOUT),
  heading: z.string().max(CHAT_CARD_HEADING_MAX),
  rows: z.array(ChatCardRowSchema).max(MOST_CARD_ROWS),
});
export type ChatCard = z.infer<typeof ChatCardSchema>;

/**
 * One row, held to what a person reads of it. **A row with nothing to say —
 * no value, or no label — is no row**, so a card lays out what is there and
 * nothing else. Spread it: `...cardRow("Tags", tags.join(", "))`.
 */
export function cardRow(
  label: string,
  value: string | undefined,
): ChatCardRow[] {
  const said = value?.trim() ?? "";
  if (said === "" || label === "") return [];
  return [
    {
      label: label.slice(0, CHAT_CARD_LABEL_MAX),
      value: said.slice(0, CHAT_CARD_VALUE_MAX),
    },
  ];
}

/** A card, held to what one carries, so no act draws a bigger one. */
export function chatCard(
  about: ChatCardAbout,
  heading: string,
  rows: readonly ChatCardRow[],
): ChatCard {
  return {
    about,
    heading: heading.trim().slice(0, CHAT_CARD_HEADING_MAX),
    rows: rows.slice(0, MOST_CARD_ROWS),
  };
}

/**
 * What a card's rows are labelled. One card is drawn twice — as the question
 * in front of an act that would write, and as the record of what it did — and
 * these are what keep the two reading the same.
 */
export const CARD_ROWS = {
  place: "Place",
  under: "Under",
  after: "After",
  on: "On",
  tags: "Tags",
  off: "Off",
  number: "Number",
  alsoAt: "Also at",
  sections: "Sections",
  withIt: "With it",
  to: "To",
  words: "Words",
  arrow: "Arrow",
  line: "Line",
} as const;

/** What a note nothing can name is called, in both readings of a card. */
export const A_NOTE = "A note";

/** What a channel taken back off reads as: whatever the graph draws without it. */
export const CARD_NONE = "None";

/**
 * The sections a write names, as their headings read. A section written with
 * no heading names nothing, and leading blank lines are not one — which is why
 * this is one function rather than each side of the card writing its own.
 */
export function sectionHeadings(sections: readonly string[]): string {
  return sections
    .map((markdown) => markdown.trimStart().split("\n")[0].trim())
    .filter((first) => first.startsWith("## "))
    .map((first) => first.slice("## ".length).trim())
    .filter((heading) => heading !== "")
    .join(", ");
}

/** More notes than one act names what it did to. A move or a delete carries
 *  everything beneath a note with it, and past this the act says nothing and
 *  the whole folder is read again — {@link ChatActDoneSchema}. */
export const MOST_NOTES_TOUCHED = 200;

/**
 * One of Sloppy's own acts, done. It answers TWO readers: `said` and `trouble`
 * are the agent's, and what an act adds here is the person's — one line for
 * the thread, a card where there is something to lay out, and what it left
 * different. A card is presentation, and the seam parses
 * {@link ChatToolAnswerSchema} on its way out, so none of this reaches the
 * agent.
 */
export const ChatActDoneSchema = ChatToolAnswerSchema.extend({
  /** What the person is told of this, whole. **Absent is an act with nothing
   *  to say beyond its own label** — the thread draws that alone. */
  told: z.string().max(CHAT_TOLD_MAX).optional(),
  /** What this lays out for them. **Absent is an act with nothing worth
   *  laying out**, which is every reading act and a look that changed one
   *  channel. */
  card: ChatCardSchema.optional(),
  /** The notes this left different from how it found them, so a surface reads
   *  exactly those again. **Absent is an act that did not say**, and the whole
   *  folder is read again; an EMPTY list is one that changed nothing. */
  touched: z.array(OwnedRefSchema).max(MOST_NOTES_TOUCHED).optional(),
});
export type ChatActDone = z.infer<typeof ChatActDoneSchema>;

const NOTE_TOO_LONG = "That note is too long to read.";
const LISTING_TOO_LONG = "There is more here than one answer holds.";
const SEARCH_TOO_LONG = "Look for something narrower.";

/**
 * The notes a project has, as the agent is handed them: JSON, carrying as many
 * as {@link CHAT_ANSWER_MAX} holds and saying how many it left. **Every
 * listing an act answers with is composed here** — docs/ARCHITECTURE.md
 * § "Asking a tool to write the notes".
 */
export function listingAnswer(notes: readonly ListedNote[]): ChatToolAnswer {
  return asMuchAsFits(
    notes,
    MOST_NOTES_LISTED,
    (kept, more) => withMore({ notes: kept }, more),
    LISTING_TOO_LONG,
  );
}

/** The notes a search reached, by the rule {@link listingAnswer} holds a
 *  listing to, best match first. */
export function foundAnswer(found: readonly FoundNote[]): ChatToolAnswer {
  return asMuchAsFits(
    found,
    MOST_NOTES_FOUND,
    (kept, more) => withMore({ found: kept }, more),
    SEARCH_TOO_LONG,
  );
}

/**
 * One note as the agent is handed it, by that same rule: its sections from the
 * first, as many as one answer carries, and how many it left. **A note whose
 * title, tags and places alone run past the bound comes to trouble**, nothing
 * under it being left to carry.
 */
export function noteAnswer(
  note: Omit<NoteRead, "sections" | "more">,
  sections: readonly NoteSection[],
): ChatToolAnswer {
  return asMuchAsFits(
    sections,
    MOST_SECTIONS_READ,
    (kept, more) => withMore({ ...note, sections: kept }, more),
    NOTE_TOO_LONG,
  );
}

/**
 * As many of `held` as one answer carries, dropped from the end until what
 * `around` makes of them fits. **`tooLong` is what the agent is told instead
 * where nothing under the bound is left**, as trouble it can act on.
 */
function asMuchAsFits<T>(
  held: readonly T[],
  most: number,
  around: (kept: readonly T[], more: number) => object,
  tooLong: string,
): ChatToolAnswer {
  let kept = held.slice(0, most);
  for (;;) {
    const said = JSON.stringify(around(kept, held.length - kept.length));
    if (said.length <= CHAT_ANSWER_MAX) return { said };
    if (kept.length === 0) return { said: tooLong, trouble: true };
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
 * Whether what a turn carries fits who it is from: a person says words and
 * puts files in front of the agent, so their turn holds nothing else. The
 * shape cannot say it for the reason {@link argumentsFit} cannot, and both
 * ends of the seam are held to this instead.
 */
export function turnFits(turn: ChatTurn): boolean {
  return (
    turn.from === "agent" ||
    turn.blocks.every(
      (block) => block.kind === "said" || block.kind === "attached",
    )
  );
}
