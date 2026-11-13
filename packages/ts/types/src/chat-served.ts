// How Sloppy's acts are served to an assistant outside the app: which of them
// are advertised, in which words, and what an answer carries —
// docs/ARCHITECTURE.md § "An assistant outside the app".

import {
  type AdvertisedTool,
  advertisedAs,
  advertisedChatTools,
  CHAT_TOOL_SPECS,
  type ChatToolName,
  type Doctrine,
} from "./chat.js";

/** Which acts are advertised: every one, or {@link CORE_CHAT_TOOLS} in short
 *  words. An act left out is still served to a caller that names it. */
export const TOOL_SETS = ["default", "core"] as const;
export type ToolSet = (typeof TOOL_SETS)[number];

/** How an answer is spelled: as the app's own chat reads it, or `terse` — the
 *  same facts in short keys, refs within the graph cut to their ULID, and
 *  sections without markdown's emphasis. */
export const ANSWER_SHAPES = ["default", "terse"] as const;
export type AnswerShape = (typeof ANSWER_SHAPES)[number];

export interface ServingShape {
  doctrine: Doctrine;
  tools: ToolSet;
  answers: AnswerShape;
  /** Whether a note an answer carries names the exact lines of code it points
   *  at, a brief answers short with the note the task's words reach best, and
   *  a long note read with no sections named answers as its opening and an
   *  outline. */
  landOnCode: boolean;
}

/** What `sloppy mcp` serves where nothing says otherwise. */
export const DEFAULT_SERVING: ServingShape = {
  doctrine: "answer-first",
  tools: "default",
  answers: "default",
  landOnCode: false,
};

/** Every saving at once. */
export const LEAN_SERVING: ServingShape = {
  doctrine: "answer-first",
  tools: "core",
  answers: "terse",
  landOnCode: true,
};

/**
 * The acts ordinary work on a project reaches for. What is left out is the
 * canvas's look (`style_edge`, `style_note`), the bin (`list_bin`,
 * `restore_note`), offers waiting on the person (`list_offers`) and what a
 * graph is (`read_graph`), whose gating a write's own answer already says —
 * docs/ARCHITECTURE.md § "An assistant outside the app" is the ruling.
 */
export const CORE_CHAT_TOOLS = [
  "brief",
  "find_code",
  "search_notes",
  "read_note",
  "read_around",
  "list_notes",
  "write_note",
  "link_notes",
] as const satisfies readonly ChatToolName[];
export type CoreChatTool = (typeof CORE_CHAT_TOOLS)[number];

interface ShortWords {
  description: string;
  /** A phrase for each argument whose name does not already say it. */
  arguments?: Record<string, string>;
}

const CORE_WORDS: Record<CoreChatTool, ShortWords> = {
  brief: {
    description:
      "Usually the first call for a task or a why-question: the notes it reaches, whole, and those around them in a line each.",
    arguments: {
      notes: "Refs the task is about.",
      about: "Paths it will touch.",
      words: "The task.",
      budget: "Characters.",
    },
  },
  find_code: {
    description:
      "Where something is in the code, best first, as path#L<a>-L<b> with the notes explaining it. Read those lines; do not search again.",
    arguments: { words: "A name or a few words." },
  },
  search_notes: {
    description:
      "Find notes by words or an address. Cite one as [title](sloppy:<ref>) rather than restating it.",
  },
  read_note: {
    description:
      "Read a note: its tags, its sections as markdown, and the code it points at, saying where that code has changed.",
    arguments: {
      sections: "Headings; absent reads all.",
      quoted: "Absent shows only broken quotes.",
    },
  },
  read_around: {
    description:
      "Read a note, and the notes within depth hops of it in a line each.",
  },
  list_notes: {
    description: "List the notes: ref, title, address, tags and parent.",
    arguments: {
      about: "Add the code each is about.",
      at: "Only notes about this path.",
      tags: "Only notes carrying all of these.",
    },
  },
  write_note: {
    description:
      "Write the note about a project path, starting one if none; a ## section replaces its namesake. A reason only from a source the note names, else the open question. Search first; cite, not repeat.",
    arguments: {
      about: "Project path.",
      sections:
        "Markdown, each opening with ##; a fence with info code:<path>#L<a>-L<b> quotes those lines.",
      tags: "Lowercase systems it belongs to; at least one.",
      start: "A new note even where one links to the path.",
      under: "Ref of its parent.",
      address: "Like 1a1; absent takes the next.",
    },
  },
  link_notes: {
    description: "Draw lines from a note to others, or take them off.",
    arguments: { to: "Refs.", off: "Refs to unlink." },
  },
};

const LOOK_FIRST = " Look here before anything else.";

const LANDS_ON_CODE =
  " Each note's code is the exact lines it points at: read those lines, do not grep for them.";

const BRIEF_ENDS_THE_SEARCH =
  "Usually the only call to make before reading code. Name the task in a few words, the notes, or the paths you will touch; get the note it reaches best, with its opening and the sections the words reach, the titles of the next few, the exact lines of code to read, and the places in the code the words reach.";

const CORE_LANDS_ON_CODE = " Read the lines it names; do not grep for them.";

const OUTLINED = " A long note comes back as its opening and headings.";

const CORE_BRIEF_ENDS_THE_SEARCH =
  "Usually the only call to make before reading code, for a task or a why-question: the note that answers it best and the exact lines to read.";

/** Words added to an act's own where answers land on code. */
function landing(
  name: ChatToolName,
  description: string,
  core: boolean,
): string {
  const lands = core ? CORE_LANDS_ON_CODE : LANDS_ON_CODE;
  if (name === "brief") {
    return `${core ? CORE_BRIEF_ENDS_THE_SEARCH : BRIEF_ENDS_THE_SEARCH}${lands}`;
  }
  if (name === "read_note") return `${description}${OUTLINED}${lands}`;
  if (name === "search_notes" || name === "read_around") {
    return `${description}${lands}`;
  }
  return description;
}

/** The acts as `serving` advertises them. */
export function servedChatTools(serving: ServingShape): AdvertisedTool[] {
  if (serving.tools === "default") {
    return advertisedChatTools(serving.doctrine, true).map((tool) =>
      serving.landOnCode
        ? { ...tool, description: landing(tool.name, tool.description, false) }
        : tool,
    );
  }
  return CORE_CHAT_TOOLS.map((name) => {
    const words = CORE_WORDS[name];
    const first =
      serving.doctrine === "notes-first" && name === "search_notes"
        ? `${words.description}${LOOK_FIRST}`
        : words.description;
    const tool = advertisedAs(name, {
      ...CHAT_TOOL_SPECS[name],
      description: serving.landOnCode ? landing(name, first, true) : first,
    });
    return {
      ...tool,
      arguments: shortened(tool.arguments, words.arguments ?? {}),
    };
  });
}

/** What a core act's schema keeps of each argument: its type, and the bounds
 *  a plausible call could fall outside of. The rest is still checked on the
 *  call. */
const KEPT_OF_A_SHAPE = new Set([
  "type",
  "items",
  "enum",
  "minimum",
  "maximum",
]);

function bare(shape: Record<string, unknown>): Record<string, unknown> {
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(shape)) {
    if (!KEPT_OF_A_SHAPE.has(key)) continue;
    kept[key] =
      key === "items" && typeof value === "object" && value !== null
        ? bare(value as Record<string, unknown>)
        : value;
  }
  return kept;
}

/** An act's JSON Schema in its barest words, and `in` left out: a server for
 *  one project has no other place to read. */
function shortened(
  schema: Record<string, unknown>,
  words: Record<string, string>,
): Record<string, unknown> {
  const properties = (schema.properties ?? {}) as Record<
    string,
    Record<string, unknown>
  >;
  const kept: Record<string, Record<string, unknown>> = {};
  for (const [field, shape] of Object.entries(properties)) {
    if (field === "in") continue;
    const said = words[field];
    kept[field] =
      said === undefined ? bare(shape) : { ...bare(shape), description: said };
  }
  const required = Array.isArray(schema.required)
    ? schema.required.filter((field) => field !== "in")
    : undefined;
  return {
    type: schema.type,
    properties: kept,
    ...(required === undefined || required.length === 0 ? {} : { required }),
  };
}
