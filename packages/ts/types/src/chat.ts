// A chat with an agent about the project: the acts Sloppy hands it, what a
// turn is made of, and what a page is told while it works —
// docs/ARCHITECTURE.md § "Asking a tool to write the notes".

import { z } from "zod";
import { AnchorStandingSchema, ProjectPathSchema } from "./code-anchor.js";
import { AddressSchema } from "./address.js";
import {
  MARK_RADII,
  type NodeAppearance,
  RING_STYLES,
  RING_WEIGHTS,
} from "./appearance.js";
import { WRITE_DONE } from "./authority.js";
import {
  OwnedRefSchema,
  PrincipalSchema,
  TimestampSchema,
  UlidSchema,
} from "./common.js";
import { DRAFT_PATH_MAX } from "./draft.js";
import { GraphOwnershipSchema } from "./graph.js";
import {
  EDGE_DIRECTIONS,
  EDGE_LABEL_MAX,
  EDGE_STROKES,
  type EdgeLook,
  EdgeLookSchema,
} from "./edge.js";

import { NODE_TITLE_MAX } from "./node.js";
import { MAX_TAGS_PER_NODE, TagSchema, TagsSchema } from "./tag.js";

/** The agents this app can chat with. A second one is a value here and a way
 *  for the shell to reach it, and touches no shape and no surface. */
export const CHAT_AGENTS = [
  "claude_code",
  "anthropic",
  "openai",
  "deepseek",
] as const;
export type ChatAgent = (typeof CHAT_AGENTS)[number];

const AGENT_NAMES: Record<ChatAgent, string> = {
  claude_code: "Claude Code",
  anthropic: "Anthropic",
  openai: "OpenAI",
  deepseek: "DeepSeek",
};

/** What an agent is called where somebody reads it. */
export function chatAgentName(agent: ChatAgent): string {
  return AGENT_NAMES[agent];
}

/**
 * How a device reaches an agent: a program it starts, or an endpoint a key
 * this device holds opens. The axis every surface asks, so nothing branches
 * on which agent it is.
 */
export type ChatReach = "program" | "key";

const AGENT_REACH: Record<ChatAgent, ChatReach> = {
  claude_code: "program",
  anthropic: "key",
  openai: "key",
  deepseek: "key",
};

export function chatAgentReach(agent: ChatAgent): ChatReach {
  return AGENT_REACH[agent];
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

/** What the thread KEEPS of an answer, for the person who opens the call to
 *  read it whole. A listing or a long read is cut here, and the note itself is
 *  where the rest is. */
export const CHAT_SHOWN_MAX = 16384;

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

/** The turns one chat holds. Past it the oldest go and the most recent stay,
 *  in what is on screen, what the device keeps and what is copied out. */
export const MAX_TURNS_PER_SESSION = 512;

/** Long enough for the line a thread is called by where somebody reads a list
 *  of them. */
export const CHAT_THREAD_NAME_MAX = 120;

/** What a thread is called before anything has been said in it. */
const UNTITLED_THREAD = "Untitled";

/**
 * What a thread is called, taken from what was said in it: the first line of
 * it, cut to {@link CHAT_THREAD_NAME_MAX}. **Said nothing, it is
 * {@link UNTITLED_THREAD}**, which is what a thread opened and not yet spoken
 * into is called, and what a person renaming one to nothing gets.
 */
export function threadNameFrom(words: string): string {
  const line = words.trim().split("\n")[0].trim();
  return line === "" ? UNTITLED_THREAD : cutToLine(line);
}

/** A name cut to the line a list of them reads as, with what was cut said. */
function cutToLine(name: string): string {
  return name.length > CHAT_THREAD_NAME_MAX
    ? `${name.slice(0, CHAT_THREAD_NAME_MAX - 1)}…`
    : name;
}

/** More places than one thread reads besides its own project. */
export const MOST_PLACES = 8;

/**
 * A place the thread may read besides its own project: a folder on this device
 * the person added to it, named so the agent can ask for it by name.
 *
 * `root` is where it is, as the platform spells a folder, and is the shell's
 * own business — no path is shown. `name` is what a person and the agent both
 * call it, and {@link placeNamed} is what keeps two of them apart. **Absent
 * `graph` is a folder that holds no graph**: a reading act naming it is refused
 * rather than answered, and it is named to the agent all the same, because the
 * name is how its files are reached.
 */
export const ChatPlaceSchema = z.object({
  root: z.string().min(1).max(DRAFT_PATH_MAX),
  name: z.string().min(1).max(CHAT_THREAD_NAME_MAX),
  graph: OwnedRefSchema.optional(),
});
export type ChatPlace = z.infer<typeof ChatPlaceSchema>;

/** Folders, however the platform spells the way between them. */
const BETWEEN_FOLDERS = /[/\\]+/;

/**
 * What one place is called among the places a thread already reads: the name it
 * came with, cut to the line a list of them reads as, where that is free, and
 * otherwise that name under as much of the folder above it as it takes to tell
 * the two apart.
 *
 * **A place is reached by this name and by nothing else** — the agent is handed
 * the names and a reading act carries one — so whatever adds a place carries
 * the name from here rather than the one the place arrived under.
 * docs/ARCHITECTURE.md § "Asking a tool to write the notes".
 */
export function placeNamed(taken: readonly string[], place: ChatPlace): string {
  const held = new Set(taken);
  const name = cutToLine(place.name);
  if (!held.has(name)) return name;
  const folders = place.root.split(BETWEEN_FOLDERS).filter((one) => one !== "");
  const above =
    folders[folders.length - 1] === name ? folders.slice(0, -1) : folders;
  for (let from = above.length - 1; from >= 0; from -= 1) {
    const tried = [...above.slice(from), name].join("/");
    if (tried.length > CHAT_THREAD_NAME_MAX) break;
    if (!held.has(tried)) return tried;
  }
  let second = 2;
  let tried = numbered(name, second);
  while (held.has(tried)) tried = numbered(name, (second += 1));
  return tried;
}

function numbered(name: string, second: number): string {
  const after = ` (${second})`;
  return `${name.slice(0, CHAT_THREAD_NAME_MAX - after.length)}${after}`;
}

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
    { model: "fable", name: "Fable" },
    { model: "opus", name: "Opus" },
    { model: "sonnet", name: "Sonnet" },
    { model: "haiku", name: "Haiku" },
  ],
  anthropic: [
    { model: "claude-fable-5-1", name: "Fable 5.1" },
    { model: "claude-opus-5", name: "Opus 5" },
    { model: "claude-sonnet-5", name: "Sonnet 5" },
    { model: "claude-haiku-4-5-20251001", name: "Haiku 4.5" },
  ],
  openai: [],
  deepseek: [],
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
 * The acts Sloppy hands an agent, in the app's chat and through `sloppy mcp`
 * alike. This is the vocabulary every surface reads: what an endpoint
 * advertises, what is done when one is called, and what a thread draws. A new
 * act is a value here, an entry in {@link CHAT_TOOL_SPECS} and an arm of
 * {@link ChatToolCallSchema}. What is left out of it on purpose is
 * docs/ARCHITECTURE.md § "An assistant outside the app".
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
  "list_tags",
  "list_bin",
  "restore_note",
  "list_offers",
  "read_graph",
  "read_around",
  "brief",
] as const;
export type ChatToolName = (typeof CHAT_TOOLS)[number];

/**
 * The acts a BUILD adds to those, named here beside them because a call
 * arriving and a row of the thread are read against the whole set before
 * anything of a build is reached. What each one IS — its words to an agent, the
 * shape of its arguments and which role may call it — is `build.ts`:
 * {@link BUILD_TOOL_SPECS}, {@link BuildToolCallSchema} and `toolsForRole`.
 */
export const BUILD_TOOLS = [
  "plan_build",
  "raise_need",
  "hand_off",
  "review_build",
] as const;
export type BuildToolName = (typeof BUILD_TOOLS)[number];

/** Every act Sloppy serves, whichever surface it is served from. A call
 *  arrives as one of these or as a tool of the agent's own. */
export const SLOPPY_TOOLS = [...CHAT_TOOLS, ...BUILD_TOOLS] as const;
export type SloppyToolName = (typeof SLOPPY_TOOLS)[number];

/** Whether an act is one of the chat's own, which is what a surface asks
 *  before it reads a call's arguments against {@link ChatToolCallSchema}. */
export function isChatTool(act: SloppyToolName): act is ChatToolName {
  return (CHAT_TOOLS as readonly string[]).includes(act);
}

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
export const ABOUT_MAX = 64;

/**
 * Which of the thread's places a reading act answers for. **Absent is the
 * project the chat is about**, which is where everything a reading act is not
 * told otherwise is read; the writing acts carry none of this and land in the
 * chat's own draft.
 */
const InPlaceSchema = z
  .string()
  .max(CHAT_THREAD_NAME_MAX)
  .optional()
  .describe(
    "Which place to read: the name of one the person added to this thread. Absent is this project.",
  );

export const ListNotesArgumentsSchema = z.object({
  about: ProjectPathSchema.optional().describe(
    "Only the notes about this file or folder, from the project root and spelled with /: a note pointing at it, at somewhere inside it, or at a folder it is in. Leave it out for every note.",
  ),
  tags: z
    .array(TagSchema)
    .max(MAX_TAGS_PER_NODE)
    .optional()
    .describe(
      "Only the notes carrying every one of these tags, the way picking several out on the canvas picks out what carries them all. Leave it out for every note.",
    ),
  in: InPlaceSchema,
});
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
  in: InPlaceSchema,
});
export type SearchNotesArguments = z.infer<typeof SearchNotesArgumentsSchema>;

export const ReadNoteArgumentsSchema = z.object({
  note: OwnedRefSchema.describe("The note, as a listing of them gives it."),
  in: InPlaceSchema,
});
export type ReadNoteArguments = z.infer<typeof ReadNoteArgumentsSchema>;

export const WriteNoteArgumentsSchema = z.object({
  about: ProjectPathSchema.describe(
    "The file or folder in the project this note is about, from the project root and spelled with /. The note about a place is the one started about it, else the one note that links to it; where several link to it and none was started about it, nothing is written and they are named.",
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
    "The number to write on the note, like 1a1, which is what a person cites it by. It springs from the number of the note above it, or is a whole number where the note springs from nothing. Leave it out and a note being started takes the next number in the run it joins, and a note already there keeps the one it has. Where the note above carries none, number it first with number_note, so this one and the rest beneath it take theirs.",
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

export const ListTagsArgumentsSchema = z.object({ in: InPlaceSchema });
export type ListTagsArguments = z.infer<typeof ListTagsArgumentsSchema>;

export const ListBinArgumentsSchema = z.object({ in: InPlaceSchema });
export type ListBinArguments = z.infer<typeof ListBinArgumentsSchema>;

export const RestoreNoteArgumentsSchema = z.object({
  note: OwnedRefSchema.describe(
    "The note to take back out of the bin, as list_bin gives it. Everything that went in with it comes back with it.",
  ),
});
export type RestoreNoteArguments = z.infer<typeof RestoreNoteArgumentsSchema>;

export const ListOffersArgumentsSchema = z.object({
  note: OwnedRefSchema.describe("The note, as a listing of them gives it."),
  in: InPlaceSchema,
});
export type ListOffersArguments = z.infer<typeof ListOffersArgumentsSchema>;

export const ReadGraphArgumentsSchema = z.object({ in: InPlaceSchema });
export type ReadGraphArguments = z.infer<typeof ReadGraphArgumentsSchema>;

/** Further than this a neighbourhood is most of a graph. */
export const MOST_HOPS = 3;

export const ReadAroundArgumentsSchema = z.object({
  note: OwnedRefSchema.describe("The note, as a listing of them gives it."),
  depth: z
    .int()
    .min(1)
    .max(MOST_HOPS)
    .default(1)
    .describe(
      "How many hops out from the note to read: 1 is what it sprang out of, what it cites and is cited by, what springs out of it and what it is linked to; 2 is theirs as well.",
    ),
  in: InPlaceSchema,
});
export type ReadAroundArguments = z.infer<typeof ReadAroundArgumentsSchema>;

/** More notes than one brief hands over whole. `MOST_NOTES_PER_TASK` in
 *  `build.ts` is this, because a build's task is briefed the same way. */
export const MOST_BRIEF_NOTES = 32;

/** More places than one task touches at a time. */
export const MOST_BRIEF_PLACES = 16;

/** Smaller than this a brief cannot carry one note and its places. */
export const LEAST_BRIEF_BUDGET = 4096;

export const BriefArgumentsSchema = z.object({
  notes: z
    .array(OwnedRefSchema)
    .max(MOST_BRIEF_NOTES)
    .optional()
    .describe(
      "The notes the task is about, as a listing of them gives them. Each is handed over whole.",
    ),
  about: z
    .array(ProjectPathSchema)
    .max(MOST_BRIEF_PLACES)
    .optional()
    .describe(
      "The files and folders the task will touch, from the project root and spelled with /. The note started about each is handed over whole, else every note pointing at it.",
    ),
  words: z
    .string()
    .trim()
    .min(1)
    .max(SEARCH_WORDS_MAX)
    .optional()
    .describe(
      "A few words for what the task is about. The notes carrying all of them are handed over whole.",
    ),
  budget: z
    .int()
    .min(LEAST_BRIEF_BUDGET)
    .max(CHAT_ANSWER_MAX)
    .default(CHAT_ANSWER_MAX)
    .describe(
      "How many characters the brief may run to. The notes asked for come first, whole, and the notes around them fill what is left as one line each.",
    ),
  in: InPlaceSchema,
});
export type BriefArguments = z.infer<typeof BriefArgumentsSchema>;

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
  list_tags: {
    description:
      "List the tags this graph's notes carry, each with how many notes carry it, most carried first. Read it before tagging anything: a system already has its tag, and a second spelling of it splits one set into two that nobody's question picks out together.",
    label: "Reading the tags",
    arguments: ListTagsArgumentsSchema,
    writes: false,
  },
  list_bin: {
    description:
      "List the notes in the bin: each one's ref, title and number, when it went, and how many notes went in with it. Look here before writing down again what a note may already have said — what somebody binned may be what to put back.",
    label: "Looking in the bin",
    arguments: ListBinArgumentsSchema,
    writes: false,
  },
  restore_note: {
    description:
      "Take a note back out of the bin, with everything that went in with it. Where its number was given to another note while it was in the bin it comes back with none, so read it afterwards and number it if it needs one. A person put it there: take back what they asked for, or what the notes plainly still need.",
    label: "Taking a note out of the bin",
    arguments: RestoreNoteArgumentsSchema,
    writes: true,
  },
  list_offers: {
    description:
      "List the changes offered on one note and not yet taken in: who offered each, when, and what it says of itself. Whoever the note's writing lands for takes one in or turns it down, never you. You see every offer on a note your writing lands on, and otherwise the ones you made — look here before offering a change that is already waiting.",
    label: "Reading what is offered",
    arguments: ListOffersArgumentsSchema,
    writes: false,
  },
  read_graph: {
    description:
      "Read what this graph is: its name, whose it is and what they are called, how a note written in it is gated, and where the code it is about is. In an 'owned' graph each note is gated by whoever started it, so your writing onto a note somebody else started is offered to them rather than written; in an 'open' one it lands.",
    label: "Reading the graph",
    arguments: ReadGraphArgumentsSchema,
    writes: false,
  },
  read_around: {
    description:
      "Read one note whole and the notes around it to a depth: what it sprang out of, what it cites and what cites it, what springs out of it, and what it is linked to — each of those as one line saying what it is. Read this rather than the notes one at a time when the note alone does not say enough.",
    label: "Reading a note and its neighbours",
    arguments: ReadAroundArgumentsSchema,
    writes: false,
  },
  brief: {
    description:
      "What to call first when starting a task: name the notes, the places you will touch and a few words, read the brief once and act. The notes asked for come whole and the notes around them as one line each, as much as the budget holds. Each place a note points at says whether the code under it has moved since a person read the note against it (moved), was never read against it (unread), or is gone (missing).",
    label: "Briefing",
    arguments: BriefArgumentsSchema,
    writes: false,
  },
};

/** Whether an act writes on the draft, which is what the thread's icon says. */
export function chatToolWrites(act: ChatToolName): boolean {
  return CHAT_TOOL_SPECS[act].writes;
}

/** One act as an agent is shown it. A build's acts are named on this too, which
 *  is what the parameter is for — `build.ts`. */
export interface AdvertisedTool<Name extends string = ChatToolName> {
  name: Name;
  description: string;
  /** JSON Schema for the call's arguments, derived from the act's own schema
   *  and looser than it — see {@link ChatToolSpec.arguments}. */
  arguments: Record<string, unknown>;
}

/** One act as the endpoint serving it advertises it, composed from the act's
 *  own spec so that what an agent is shown and what its calls are parsed
 *  against cannot be two different things. */
export function advertisedAs<Name extends string>(
  name: Name,
  spec: ChatToolSpec,
): AdvertisedTool<Name> {
  const { $schema, ...shape } = z.toJSONSchema(spec.arguments, {
    io: "input",
  }) as Record<string, unknown>;
  return { name, description: spec.description, arguments: shape };
}

/** Every act of the chat's, as the endpoint serving them advertises them. */
export function advertisedChatTools(): AdvertisedTool[] {
  return CHAT_TOOLS.map((name) => advertisedAs(name, CHAT_TOOL_SPECS[name]));
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
  /** Every anchor the note's writing holds, in the order it names them, and
   *  where the code under each stands now. **Absent is a graph that is
   *  nobody's project**, where there is no code to read. */
  anchors: z.array(AnchorStandingSchema).max(ABOUT_MAX).optional(),
});
export type NoteRead = z.infer<typeof NoteReadSchema>;

/** Longer than a gist is one line. */
export const GIST_MAX = 280;

/** More notes than one answer carries around the ones it is about. */
export const MOST_AROUND = 64;

/** How a note on a walk was reached from the one before it. `named` is a note
 *  a brief was asked for and could not carry whole. */
export const NEIGHBOUR_RELATIONS = [
  "named",
  "parent",
  "child",
  "cites",
  "cited_by",
  "linked",
] as const;
export type NeighbourRelation = (typeof NEIGHBOUR_RELATIONS)[number];

/** A note near the one being read, as one line: what it is, where it is, and
 *  what it says first. Worked out from its writing whenever it is asked for and
 *  never kept. */
export const NeighbourSchema = z.object({
  note: OwnedRefSchema,
  title: z.string().max(NODE_TITLE_MAX),
  /** **Absent is a note with no address**, which is an ordinary note. */
  address: AddressSchema.optional(),
  tags: TagsSchema,
  about: z.array(ProjectPathSchema).max(ABOUT_MAX),
  /** How this note was reached from the one before it on the walk. */
  relation: z.enum(NEIGHBOUR_RELATIONS),
  /** Hops from the note being read, from 1. **0 is a note a brief was asked
   *  for and could not carry whole.** */
  depth: z.int().min(0),
  /** The first paragraph of the note's writing that is not an anchor alone or
   *  a compass line, cut to {@link GIST_MAX}. **Empty is a note with no such
   *  paragraph.** */
  gist: z.string().max(GIST_MAX),
});
export type Neighbour = z.infer<typeof NeighbourSchema>;

/** One note whole and the notes around it — {@link aroundAnswer} is what
 *  composes one. */
export const NeighbourhoodReadSchema = z.object({
  note: NoteReadSchema,
  /** Nearest first, in the order the walk reached them. */
  around: z.array(NeighbourSchema).max(MOST_AROUND),
  /** **Absent is every note the walk reached.** A count is how many further
   *  ones it reached that this answer does not carry. */
  more: z.int().min(1).optional(),
});
export type NeighbourhoodRead = z.infer<typeof NeighbourhoodReadSchema>;

/** A note a brief hands over whole. */
export const BriefNoteSchema = NoteReadSchema;
export type BriefNote = NoteRead;

/** What a task is briefed with — {@link briefAnswer} is what composes one. */
export const BriefReadSchema = z.object({
  /** The notes asked for, whole, in the order they were asked for. */
  notes: z.array(BriefNoteSchema).max(MOST_BRIEF_NOTES),
  /** The notes asked for that did not fit whole, then the notes around the
   *  ones asked for. */
  around: z.array(NeighbourSchema).max(MOST_AROUND),
  /** **Absent is every note around them.** A count is how many further ones
   *  there are that this brief does not carry. */
  more: z.int().min(1).optional(),
});
export type BriefRead = z.infer<typeof BriefReadSchema>;

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

/** Past this a listing of tags is one nobody tags against. */
export const MOST_TAGS_LISTED = 500;

/** One tag a graph's notes carry, and how many of them carry it. */
export const ListedTagSchema = z.object({
  tag: TagSchema,
  notes: z.int().min(1),
});
export type ListedTag = z.infer<typeof ListedTagSchema>;

/** The tags a graph's notes carry, or as many as one answer carries —
 *  {@link tagsAnswer} is what composes one. */
export const TagsListedSchema = z.object({
  tags: z.array(ListedTagSchema).max(MOST_TAGS_LISTED),
  /** **Absent is every tag there is.** A count is how many further tags the
   *  graph's notes carry that this answer does not. */
  more: z.int().min(1).optional(),
});
export type TagsListed = z.infer<typeof TagsListedSchema>;

/** Past this the bin is something the agent skims rather than reads. */
export const MOST_BINNED_LISTED = 200;

/** One note in the bin, as a listing of the bin gives it. */
export const BinnedNoteSchema = z.object({
  note: OwnedRefSchema,
  title: z.string().max(NODE_TITLE_MAX),
  /** **Absent is a note that had no address**, or one whose address went to
   *  another note while it was in the bin. */
  address: AddressSchema.optional(),
  binned_at: TimestampSchema,
  /** How many notes went in with it, beneath it. */
  beneath: z.int().min(0),
});
export type BinnedNote = z.infer<typeof BinnedNoteSchema>;

/** What is in the bin, latest first, or as much of it as one answer carries —
 *  {@link binAnswer} is what composes one. */
export const BinListedSchema = z.object({
  bin: z.array(BinnedNoteSchema).max(MOST_BINNED_LISTED),
  /** **Absent is everything in the bin.** A count is how many further notes
   *  are in it that this answer does not carry. */
  more: z.int().min(1).optional(),
});
export type BinListed = z.infer<typeof BinListedSchema>;

/** Past this the offers on one note are more than anybody is deciding. */
export const MOST_OFFERS_LISTED = 100;

/** Long enough for the one line an offer says of itself. */
export const OFFER_SUMMARY_MAX = 200;

/** One change offered on a note and not yet taken in. `summary` is one line,
 *  already cut to length; **empty is an offer that says nothing of itself**. */
export const ListedOfferSchema = z.object({
  offer: OwnedRefSchema,
  by: PrincipalSchema,
  at: TimestampSchema,
  summary: z.string().max(OFFER_SUMMARY_MAX),
});
export type ListedOffer = z.infer<typeof ListedOfferSchema>;

/** The offers on one note, oldest first, or as many as one answer carries —
 *  {@link offersAnswer} is what composes one. */
export const OffersListedSchema = z.object({
  offers: z.array(ListedOfferSchema).max(MOST_OFFERS_LISTED),
  /** **Absent is every offer the reader may see.** A count is how many further
   *  ones there are that this answer does not carry. */
  more: z.int().min(1).optional(),
});
export type OffersListed = z.infer<typeof OffersListedSchema>;

/** Longer than a graph, or its owner, is called. */
const GRAPH_NAME_MAX = 512;

/** What a graph is, as the agent reads it. */
export const GraphReadSchema = z.object({
  name: z.string().max(GRAPH_NAME_MAX),
  owner: PrincipalSchema,
  /** **Absent is an owner who has not said** what they are called. */
  owner_name: z.string().max(GRAPH_NAME_MAX).optional(),
  ownership: GraphOwnershipSchema,
  /** Where the code this graph is about is, from the graph's own folder —
   *  `..` for a container inside its project. **Absent is a graph that is
   *  nobody's project.** */
  project: z.string().max(DRAFT_PATH_MAX).optional(),
});
export type GraphRead = z.infer<typeof GraphReadSchema>;

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
  /** Which of Sloppy's own acts this is, the chat's and a build's alike
   *  ({@link SLOPPY_TOOLS}). **Absent is a tool of the agent's own** — reading
   *  a file, searching the code — which is drawn by name and is never behind
   *  the person's answer, because nothing of ours runs. */
  act: z.enum(SLOPPY_TOOLS).optional(),
  /** Carried untouched, the way a document element's `attrs` is: the page
   *  parses them against the act's own schema before doing anything, and draws
   *  nothing it has not read. **Absent is a call with none.** Bounded by
   *  {@link argumentsFit}. */
  arguments: z.unknown().optional(),
  /** When the agent called it. **Absent is a call written down before times
   *  were kept.** */
  at: TimestampSchema.optional(),
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
  /** How long the call took to answer, in ms. **Absent is one nobody timed.** */
  took: z.int().min(0).optional(),
  /** What the answer added to the agent's window, in tokens, as the agent's
   *  next request measured it — shared evenly among answers that arrived
   *  together. **Absent is an answer nothing measured**, which is not free. */
  tokens: z.int().min(0).optional(),
});
export type ToolResultBlock = z.infer<typeof ToolResultBlockSchema>;

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
  /**
   * Which of the thread's conversations this turn was said in — Sloppy's own
   * id for one, minted where it is opened, and never what the agent calls its
   * own ({@link ChatThreadSchema}'s `session`).
   *
   * **Absent is a thread that runs one conversation**, which is every chat and
   * every turn written before a thread could run more than one. A build runs
   * one per phase and one per task, several at once, so everything drawn per
   * conversation — its turns, its spend, how full its window is — is grouped
   * by this.
   */
  conversation: UlidSchema.optional(),
});
export type ChatTurn = z.infer<typeof ChatTurnSchema>;

/** One run of an agent as the surface holding it has it, lasting as long as
 *  that run does. {@link ChatThreadSchema} is what is KEPT: the conversation
 *  outlives any session of it. */
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

/** A call of one of the CHAT's acts, arguments already parsed, as the page is
 *  handed it. `SloppyToolCallSchema` in `build.ts` is every act a call may
 *  arrive as, which is what a seam serving one parses against. */
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
  z.object({
    call: ChatCallIdSchema,
    act: z.literal("list_tags"),
    arguments: ListTagsArgumentsSchema,
  }),
  z.object({
    call: ChatCallIdSchema,
    act: z.literal("list_bin"),
    arguments: ListBinArgumentsSchema,
  }),
  z.object({
    call: ChatCallIdSchema,
    act: z.literal("restore_note"),
    arguments: RestoreNoteArgumentsSchema,
  }),
  z.object({
    call: ChatCallIdSchema,
    act: z.literal("list_offers"),
    arguments: ListOffersArgumentsSchema,
  }),
  z.object({
    call: ChatCallIdSchema,
    act: z.literal("read_graph"),
    arguments: ReadGraphArgumentsSchema,
  }),
  z.object({
    call: ChatCallIdSchema,
    act: z.literal("read_around"),
    arguments: ReadAroundArgumentsSchema,
  }),
  z.object({
    call: ChatCallIdSchema,
    act: z.literal("brief"),
    arguments: BriefArgumentsSchema,
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

/** The tags a graph's notes carry, by the rule {@link listingAnswer} holds a
 *  listing to, most carried first. */
export function tagsAnswer(tags: readonly ListedTag[]): ChatToolAnswer {
  return asMuchAsFits(
    tags,
    MOST_TAGS_LISTED,
    (kept, more) => withMore({ tags: kept }, more),
    LISTING_TOO_LONG,
  );
}

/** What is in the bin, by the rule {@link listingAnswer} holds a listing to,
 *  latest first. */
export function binAnswer(bin: readonly BinnedNote[]): ChatToolAnswer {
  return asMuchAsFits(
    bin,
    MOST_BINNED_LISTED,
    (kept, more) => withMore({ bin: kept }, more),
    LISTING_TOO_LONG,
  );
}

/** The offers on one note, by the rule {@link listingAnswer} holds a listing
 *  to, oldest first. */
export function offersAnswer(offers: readonly ListedOffer[]): ChatToolAnswer {
  return asMuchAsFits(
    offers,
    MOST_OFFERS_LISTED,
    (kept, more) => withMore({ offers: kept }, more),
    LISTING_TOO_LONG,
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
 * One note whole and the notes around it, by the rule {@link listingAnswer}
 * holds a listing to: the notes around it are dropped from the end first, and
 * only where none of them is left do the note's own sections go, by
 * {@link noteAnswer}'s rule.
 */
export function aroundAnswer(
  note: Omit<NoteRead, "more">,
  around: readonly Neighbour[],
): ChatToolAnswer {
  const whole = withMore(
    { ...note, sections: note.sections.slice(0, MOST_SECTIONS_READ) },
    note.sections.length - MOST_SECTIONS_READ,
  );
  const withAround = asMuchAsFits(
    around,
    MOST_AROUND,
    (kept, more) => withMore({ note: whole, around: kept }, more),
    NOTE_TOO_LONG,
  );
  if (!withAround.trouble) return withAround;
  return asMuchAsFits(
    note.sections,
    MOST_SECTIONS_READ,
    (kept, more) =>
      withMore(
        { note: withMore({ ...note, sections: kept }, more), around: [] },
        around.length,
      ),
    NOTE_TOO_LONG,
  );
}

/** A note a brief was asked for: whole, and as one line for where it does not
 *  fit whole. */
export interface BriefAsked {
  whole: Omit<NoteRead, "more">;
  gist: string;
}

const BRIEF_TOO_LONG =
  "That brief is too long even empty. Ask for fewer notes or a bigger budget.";

/**
 * What a task is briefed with, held to `budget` characters and never past
 * {@link CHAT_ANSWER_MAX}: the notes asked for whole, in order, while they fit;
 * the first that does not, and every one after it, as one line at depth 0; then
 * the notes around them from the front while they fit. **A brief whose first
 * note's title and places alone run past the budget comes to trouble.**
 */
export function briefAnswer(
  asked: readonly BriefAsked[],
  around: readonly Neighbour[],
  budget: number,
): ChatToolAnswer {
  const bound = Math.min(budget, CHAT_ANSWER_MAX);
  const fits = (brief: BriefRead): boolean =>
    JSON.stringify(brief).length <= bound;
  const [first] = asked;
  if (first && !fits({ notes: [bareOf(first.whole)], around: [] })) {
    return { said: BRIEF_TOO_LONG, trouble: true };
  }
  const notes: NoteRead[] = [];
  for (const one of asked.slice(0, MOST_BRIEF_NOTES)) {
    const whole = wholeOf(one.whole);
    if (!fits({ notes: [...notes, whole], around: [] })) break;
    notes.push(whole);
  }
  const waiting = [...asked.slice(notes.length).map(asNamed), ...around];
  const kept: Neighbour[] = [];
  for (const one of waiting.slice(0, MOST_AROUND)) {
    if (!fits({ notes, around: [...kept, one] })) break;
    kept.push(one);
  }
  return {
    said: JSON.stringify(
      withMore({ notes, around: kept }, waiting.length - kept.length),
    ),
  };
}

function wholeOf(note: Omit<NoteRead, "more">): NoteRead {
  return withMore(
    { ...note, sections: note.sections.slice(0, MOST_SECTIONS_READ) },
    note.sections.length - MOST_SECTIONS_READ,
  );
}

function bareOf(note: Omit<NoteRead, "more">): NoteRead {
  return withMore({ ...note, sections: [] }, note.sections.length);
}

function asNamed({ whole, gist }: BriefAsked): Neighbour {
  return {
    note: whole.note,
    title: whole.title,
    ...(whole.address === undefined ? {} : { address: whole.address }),
    tags: whole.tags,
    about: whole.about,
    relation: "named",
    depth: 0,
    gist,
  };
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

/**
 * What a turn spent. Every count is this TURN's own, so a session is its turns
 * added up — except `cost`, which an agent reports as what the whole
 * conversation has come to so far, and is therefore the latest rather than a
 * sum. {@link spentTogether} is the one copy of that rule.
 */
export const ChatSpendSchema = z.object({
  /** Tokens put in front of the agent. */
  sent: z.int().min(0),
  /** Tokens the agent wrote. */
  answered: z.int().min(0),
  /** Tokens read back from what it had already been shown. */
  recalled: z.int().min(0).optional(),
  /** Tokens kept for it to read back later. */
  kept: z.int().min(0).optional(),
  /** Tokens spent thinking before answering. */
  thought: z.int().min(0).optional(),
  /** What the conversation has cost so far, in US dollars. **Absent is an
   *  agent that does not say**, which is not free. */
  cost: z.number().min(0).optional(),
});
export type ChatSpend = z.infer<typeof ChatSpendSchema>;

/** A turn's spend added to a session's: the counts summed, `cost` replaced. */
export function spentTogether(
  held: ChatSpend | undefined,
  more: ChatSpend,
): ChatSpend {
  if (held === undefined) return { ...more };
  const add = (a: number | undefined, b: number | undefined) =>
    a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0);
  const summed = {
    sent: held.sent + more.sent,
    answered: held.answered + more.answered,
    recalled: add(held.recalled, more.recalled),
    kept: add(held.kept, more.kept),
    thought: add(held.thought, more.thought),
    cost: more.cost ?? held.cost,
  };
  return Object.fromEntries(
    Object.entries(summed).filter(([, value]) => value !== undefined),
  ) as ChatSpend;
}

/**
 * What a part of what the agent is holding counts towards. **Classify on this
 * and never on a part's name**, which is the agent's own wording and changes
 * under us.
 *
 * - `used` — in the window now.
 * - `free` — room left in the window.
 * - `buffer` — room the agent keeps back for its own answer.
 * - `deferred` — held aside rather than in the window, and NEVER in the used
 *   total.
 */
export const CONTEXT_PART_KINDS = [
  "used",
  "free",
  "buffer",
  "deferred",
] as const;
export type ContextPartKind = (typeof CONTEXT_PART_KINDS)[number];

/** Longer than what any agent calls a part of what it is holding. */
export const CONTEXT_PART_NAME_MAX = 80;

/** More parts than a bar can be read as, let alone a legend beside it. */
export const MOST_CONTEXT_PARTS = 32;

/** One part of what the agent is holding, as the agent itself names and counts
 *  it. **The name is the agent's own and is shown as it arrived** — nothing
 *  here invents, translates or groups one. */
export const ContextPartSchema = z.object({
  name: z.string().min(1).max(CONTEXT_PART_NAME_MAX),
  tokens: z.int().min(0),
  kind: z.enum(CONTEXT_PART_KINDS),
});
export type ContextPart = z.infer<typeof ContextPartSchema>;

/**
 * How full the agent's window is — read from the agent, never estimated here.
 * docs/ARCHITECTURE.md § "Asking a tool to write the notes".
 *
 * `total` is what is in the window now and `limit` is how much it holds, both
 * in tokens. **An EMPTY `parts` is a count with no breakdown**, which is what
 * arrives between one asked-for breakdown and the next;
 * {@link contextTogether} is what reads one of these onto the last.
 *
 * **Absent `compactsAt` is an agent that does not say** where it will make
 * room, which is not the same as one that never will. **Absent `compacted` is
 * a turn that made no room**; a count is what the window held before it did.
 */
export const ContextUsageSchema = z.object({
  total: z.int().min(0),
  limit: z.int().min(1),
  compactsAt: z.int().min(0).optional(),
  parts: z.array(ContextPartSchema).max(MOST_CONTEXT_PARTS),
  at: TimestampSchema,
  compacted: z.object({ from: z.int().min(0) }).optional(),
});
export type ContextUsage = z.infer<typeof ContextUsageSchema>;

/** What of the window the parts account for — the one place they are summed. */
export function usedIn(usage: ContextUsage): number {
  return partsSummed(usage, "used");
}

/** What the agent is holding aside rather than in the window. */
export function heldAsideIn(usage: ContextUsage): number {
  return partsSummed(usage, "deferred");
}

function partsSummed(usage: ContextUsage, kind: ContextPartKind): number {
  return usage.parts.reduce(
    (summed, part) => (part.kind === kind ? summed + part.tokens : summed),
    0,
  );
}

/**
 * A count arriving onto the one held: the newer counts, with the older
 * breakdown kept where the newer carries none — and where it said where room
 * would be made, that too, because only a breakdown carries it. **Except where
 * the turn made room**, which replaced what the window held and left every part
 * counted before it stale, so the newer count stands alone until the agent is
 * asked for a breakdown again.
 */
export function contextTogether(
  held: ContextUsage | undefined,
  more: ContextUsage,
): ContextUsage {
  if (
    held === undefined ||
    more.parts.length > 0 ||
    more.compacted !== undefined
  )
    return more;
  return {
    ...(held.compactsAt === undefined ? {} : { compactsAt: held.compactsAt }),
    ...more,
    parts: held.parts,
  };
}

/** What stands in the dock as a thread: a conversation, or a build. The turns,
 *  the spend and the window are drawn the same way for both. */
export const CHAT_THREAD_KINDS = ["chat", "build"] as const;
export type ChatThreadKind = (typeof CHAT_THREAD_KINDS)[number];

/**
 * One chat, kept on this device until somebody deletes it. `id` is the thread
 * everywhere: the draft it writes into is this id's and so is the session the
 * agent was opened with, so reopening a thread picks up both.
 *
 * `graph` and `project` are what it is a chat ABOUT, which is what says which
 * threads belong in front of somebody — a device holds the threads of every
 * project it has opened.
 *
 * **Absent `archived_at` is a live thread**, and a time is one put aside;
 * **absent `session`** is a thread no agent has opened yet, or one whose agent
 * said nothing about a session, and reopening it opens a new one. `agent` and
 * `model` are what it last opened with — **absent is a thread that has not
 * opened one yet**. **Absent `spent` is a thread nothing was said about**,
 * which is not a free one.
 */
export const ChatThreadSchema = z.object({
  id: UlidSchema,
  /** **Absent is a chat**, which is every thread written before a build could
   *  stand in the dock as one. */
  kind: z.enum(CHAT_THREAD_KINDS).optional(),
  /** The build this thread is of. **Absent is a chat**, and a thread of kind
   *  `build` carries one. */
  build: UlidSchema.optional(),
  name: z.string().min(1).max(CHAT_THREAD_NAME_MAX),
  graph: OwnedRefSchema,
  project: z.string().min(1).max(DRAFT_PATH_MAX),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
  archived_at: TimestampSchema.optional(),
  agent: z.enum(CHAT_AGENTS).optional(),
  model: z.string().max(CHAT_MODEL_MAX).optional(),
  /** The one conversation a chat picks up again. A BUILD thread leaves it
   *  absent and never picks a conversation up: each of its sessions is a
   *  `BuildSession` of its own, and a fresh session reads the hand-off. */
  session: ChatSessionIdSchema.optional(),
  places: z.array(ChatPlaceSchema).max(MOST_PLACES),
  turns: z.array(ChatTurnSchema).max(MAX_TURNS_PER_SESSION),
  spent: ChatSpendSchema.optional(),
});
export type ChatThread = z.infer<typeof ChatThreadSchema>;

const ContextEventSchema = z.object({
  event: z.literal("context"),
  usage: ContextUsageSchema,
});

const EndedEventSchema = z.object({
  event: z.literal("ended"),
  /** **Absent is a turn that finished.** True is one the person stopped, which
   *  is not trouble and says nothing to them. */
  stopped: z.boolean().optional(),
  /** What the turn spent. **Absent is a turn nothing was said about**, which
   *  is not nothing spent. */
  spent: ChatSpendSchema.optional(),
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
  ContextEventSchema,
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
