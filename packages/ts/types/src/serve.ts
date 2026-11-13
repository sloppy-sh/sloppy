// The notes of the folders open on a desk, served read-only to a headset —
// docs/ARCHITECTURE.md § "A headset beside the desk".

import type { ChatEvent, ChatTurn } from "./chat.js";
import type { EdgeDirection } from "./edge.js";
import type { Density, Effect, Look, Style } from "./look.js";

/** The protocol a desk accepts a headset's connection on. */
export const SERVE_ALPN = "sloppy/serve/1";

/** How many digits a pairing code has. */
export const SERVE_CODE_LENGTH = 6;

/** How long a code a desk shows is accepted, in milliseconds. */
export const SERVE_PAIR_WINDOW_MS = 120_000;

/** How long a headset not paired before has to send its first line, in milliseconds. */
export const SERVE_FIRST_LINE_MS = 10_000;

/** The first message from a headset the desk has not paired: `params: { code }`,
 *  answered `{ paired: true }`. */
export const SERVE_PAIR = "pair";

/** The `error.data` a desk refuses any other first line from a headset not
 *  paired before with. **Absent is a desk that does not say**, read as showing a code. */
export interface ServeNotPaired {
  /** Whether the desk is showing a code now. */
  pairing: boolean;
}

/** How far a desk can be reached: `local` is this network only; `anywhere`
 *  also through a relay. */
export const SERVE_REACHES = ["local", "anywhere"] as const;
export type ServeReach = (typeof SERVE_REACHES)[number];

/** The serve-level method that lists what is served, answered as {@link ProjectsListed}. */
export const PROJECTS_LIST = "projects/list";

/** The serve-level method that answers every note of a served project's graph,
 *  as {@link FieldListed}: `params: { project?, after? }`. */
export const FIELD_LIST = "field/list";

/** The most notes one {@link FIELD_LIST} answer carries. */
export const FIELD_PAGE = 5_000;

/** The serve-level method that answers the look the desk is wearing, as
 *  {@link LookServed}. A server with no look answers error −32601 in words. */
export const LOOK_READ = "look/read";

/**
 * The look a desk is wearing, as a headset draws with it: what a look file
 * carries of it — DESIGN.md § "A look is a file" — less what only a page can
 * draw. `palette` is absent where the look is one of Sloppy's own and wears its
 * own colours, which a headset carries by `based_on`.
 */
export interface LookServed {
  name: string;
  /** **Absent is a look that stands on its own**, on the app's own colours. */
  based_on?: string;
  palette?: Record<string, string>;
  style: Style;
  density: Density;
  effect: Effect[];
  fonts: Required<NonNullable<Look["fonts"]>>;
}

/** The serve-level method that answers every look the desk could wear, as
 *  {@link LooksListed}. Unqueued, and the same answer for the desk's life. */
export const LOOK_LIST = "look/list";

/** One look a desk could wear, as a headset draws with it. */
export interface LookListed {
  /** One of Sloppy's own looks' ids, or a scheme's slug in the collection. */
  id: string;
  name: string;
  /** Which way the look's ground runs. */
  variant: "light" | "dark";
  /** **Absent is a look nobody is credited with.** */
  author?: string;
  /** The tokens the desk paints the look with, by CSS custom property name. */
  palette: Record<string, string>;
}

/** The answer to {@link LOOK_LIST}: Sloppy's own looks first, in the order the
 *  desk offers them, then the collection, light before dark, each by name. */
export interface LooksListed {
  looks: LookListed[];
}

/** A line drawn by hand from a note, with the look its author set on it. */
export interface FieldLink {
  to: string;
  label?: string;
  direction?: EdgeDirection;
}

/** One note as the field reads it. */
export interface FieldNote {
  note: string;
  title: string;
  /** **Absent is a note with no address.** */
  address?: string;
  /** **Absent is a note that starts a line of thought of its own.** */
  parent?: string;
  tags: string[];
  links: FieldLink[];
  /** **Absent is a mark that wears no picture**; present, {@link PICTURE_READ} answers it. */
  picture?: true;
}

/**
 * The answer to {@link FIELD_LIST}: the graph's notes in ref order, every one
 * where it holds {@link FIELD_PAGE} or fewer. **Absent `next` is the last page**;
 * present, it is the ref to ask again with as `params.after`.
 */
export interface FieldListed {
  notes: FieldNote[];
  next?: string;
}

/** The serve-level method that answers the picture a note's mark wears, as
 *  {@link PictureRead}: `params: { note }`, the note's ref. */
export const PICTURE_READ = "picture/read";

/** The most pixels a {@link PICTURE_READ} answer is on its longer side. */
export const PICTURE_LONGEST = 256;

/** The answer to {@link PICTURE_READ}: the picture as PNG, base64, no more than
 *  {@link PICTURE_LONGEST} on its longer side. **`picture: null` is a note whose
 *  mark wears none**, or one this desk could not read. */
export type PictureRead =
  | { picture: string; width: number; height: number }
  | { picture: null };

/** The serve-level method that answers a picture a note's writing shows, as
 *  {@link AssetRead}: `params` {@link AssetAsked}. */
export const ASSET_READ = "asset/read";

/** The most bytes a {@link ASSET_READ} answer carries, before base64. */
export const ASSET_MOST = 4 * 1024 * 1024;

export interface AssetAsked {
  /** The note's ref. */
  note: string;
  /** The picture's path exactly as the note's markdown names it in `read_note`'s answer. */
  path: string;
}

/** The answer to {@link ASSET_READ}: the file as it is kept, base64, and its type. */
export interface AssetRead {
  bytes: string;
  mime: string;
}

/** A pairing code: {@link SERVE_CODE_LENGTH} decimal digits, leading zeroes kept. */
export type ServeCode = string;

export function isServeCode(held: unknown): held is ServeCode {
  return (
    typeof held === "string" &&
    held.length === SERVE_CODE_LENGTH &&
    /^[0-9]+$/.test(held)
  );
}

/** A pairing code from `random`, which answers in `[0, 1)`. The code is all that
 *  pairs a headset, so `random` is the platform's cryptographic source. */
export function makeServeCode(random: () => number): ServeCode {
  let code = "";
  for (let at = 0; at < SERVE_CODE_LENGTH; at++) {
    code += Math.floor(random() * 10) % 10;
  }
  return code;
}

/** The code a desk is showing, which pairs one headset at most. */
export interface ServePairing {
  code: ServeCode;
  /** When it stops being accepted, in milliseconds since the epoch. */
  until: number;
}

/** One project a desk serves. `id` is what a message's `project` names. */
export interface ServedProject {
  id: string;
  name: string;
}

/** The answer to {@link PROJECTS_LIST}, in the order the desk serves them. */
export interface ProjectsListed {
  projects: ServedProject[];
}

/** A headset a desk has paired, which it accepts again without a code. */
export interface PairedHeadset {
  /** The headset's endpoint id. */
  id: string;
  /** What the headset calls itself. **Absent is a headset that said nothing.** */
  name?: string;
  /** When it paired, in milliseconds since the epoch. */
  paired_at: number;
}

/** A desk that is serving: who it is, how far it reaches, and who it has paired. */
export interface Serving {
  /** The desk's endpoint id, which a paired headset dials. */
  id: string;
  /** The desk's whole address as one string, for a headset not on this network. */
  ticket: string;
  /** What a headset on this network finds the desk as. **Absent is a desk
   *  that is not announced by name.** */
  name?: string;
  /** **Absent is a desk showing no code**, which no headset can pair with. */
  pairing?: ServePairing;
  reach: ServeReach;
  /** The relay a person named. **Absent is the public relays in `anywhere`,
   *  and no relay at all in `local`.** */
  relay?: string;
  paired: PairedHeadset[];
  /** Headsets connected now. */
  connections: number;
}

/** One line a paired headset sent, and which connection it came on. */
export interface ServeCall {
  /** Names the connection for as long as it is open; what answers it is sent back on it. */
  connection: string;
  /** One JSON-RPC message, as {@link ServeMessage}. */
  line: string;
}

/**
 * One message a headset sends: a JSON-RPC 2.0 request or notification, the MCP
 * methods `sloppy mcp` answers plus {@link PROJECTS_LIST}, {@link FIELD_LIST},
 * {@link LOOK_READ}, {@link PICTURE_READ}, {@link ASSET_READ} and {@link SERVE_PAIR}.
 */
export interface ServeMessage {
  jsonrpc: "2.0";
  /** **Absent is a notification**, which is taken and never answered. */
  id?: string | number | null;
  method: string;
  params?: unknown;
  /** Which served project the message is asked of, by {@link ServedProject.id}.
   *  **Absent is the first project served.** A name that is none of them is
   *  answered with error −32602. Ignored on {@link PROJECTS_LIST} and
   *  {@link LOOK_READ}; on
   *  {@link FIELD_LIST}, `params.project` names it where present. */
  project?: string;
}

/**
 * A line from the desk that answers no request: no `id`, named by `method` —
 * {@link CHAT_EVENT} and {@link VIEW_SHOW}. A headset handles one it knows and
 * leaves one it does not.
 */
export interface ServeNotification<
  Method extends string = string,
  Params = unknown,
> {
  jsonrpc: "2.0";
  method: Method;
  params: Params;
}

/**
 * What a served method is refused with, as `error.code`, beside JSON-RPC's own.
 * The `message` is for the person, and a headset shows it as it came.
 */
export const SERVE_REFUSALS = {
  /** The desk has no speech agent set up. */
  NO_SPEECH: -32010,
  /** The recording is longer than {@link SPEECH_LONGEST_MS}. */
  SPEECH_TOO_LONG: -32011,
  /** The recording is not a WAV the desk can hear. */
  SPEECH_UNREADABLE: -32012,
  /** The speech agent could not hear it; the agent's own sentence where it said one. */
  SPEECH_FAILED: -32013,
  /** Another thread of this project is answering, and the desk lets one answer at a time. */
  ANSWERING: -32020,
  /** The desk has no chat agent set up. */
  NO_AGENT: -32021,
  /** The path names no picture the note's own writing shows. */
  NO_SUCH_ASSET: -32040,
  /** The picture is larger than {@link ASSET_MOST}. */
  ASSET_TOO_LARGE: -32041,
} as const;
export type ServeRefusal = keyof typeof SERVE_REFUSALS;

export const NO_SPEECH_SAID =
  "The desk has no speech set up. On the desk, Settings → AI.";
export const NO_AGENT_SAID =
  "The desk has no assistant set up. On the desk, Settings → AI.";
export const SPEECH_TOO_LONG_SAID =
  "That was too long to hear in one go. Hold the button for a minute at most.";
export const SPEECH_UNREADABLE_SAID =
  "That could not be heard. Hold the button and try again.";
export const NO_SUCH_ASSET_SAID = "That picture is not in this note.";
export const ASSET_TOO_LARGE_SAID = "That picture is too large to show here.";

/** Turns a reader's voice into words: `params` {@link SpeechHear}, answered
 *  {@link SpeechHeard}. */
export const SPEECH_HEAR = "speech/hear";

/** A recording, as {@link SPEECH_HEAR} is sent it. */
export interface SpeechHear {
  /** A WAV, base64: {@link SPEECH_RATE} a second, mono, 16-bit PCM, no longer
   *  than {@link SPEECH_LONGEST_MS}. */
  audio: string;
  /** The language spoken, as a two-letter code. **Absent is the agent's guess.** */
  language?: string;
}

/** Lists the threads of the project asked of: `params` `{}`, answered
 *  {@link ChatThreadsListed}. */
export const CHAT_THREADS = "chat/threads";

/** One thread as a headset lists it. */
export interface ChatThreadServed {
  id: string;
  name: string;
  /** As the thread file has it. */
  updated_at: string;
  archived: boolean;
  /** Whether the assistant is answering in it now. */
  answering: boolean;
}

/** The answer to {@link CHAT_THREADS}: newest first, the archived ones last. */
export interface ChatThreadsListed {
  threads: ChatThreadServed[];
}

/** Opens a thread and subscribes this connection to it: `params`
 *  {@link ChatOpen}, answered {@link ChatOpened}. */
export const CHAT_OPEN = "chat/open";

/** The most turns {@link CHAT_OPEN} answers with: the last ones. */
export const CHAT_OPEN_TURNS = 40;

/** The most characters of each `said` block {@link CHAT_OPEN} answers with,
 *  a longer one cut and ended with "…". */
export const CHAT_SAID_CUT = 4_000;

export interface ChatOpen {
  /** **Absent starts a new thread**, answered with its id, no name and no
   *  turns; it is kept and named on its first {@link CHAT_SAY}. */
  thread?: string;
}

/** The answer to {@link CHAT_OPEN}. */
export interface ChatOpened {
  thread: { id: string; name: string; turns: ChatTurn[] };
}

/** Says something into a thread: `params` {@link ChatSay}, answered `{}` at
 *  once, the answer arriving as {@link CHAT_EVENT}. */
export const CHAT_SAY = "chat/say";

export interface ChatSay {
  thread: string;
  said: string;
}

/** Stops the turn underway: `params` {@link ChatThreadNamed}, answered `{}`. */
export const CHAT_STOP = "chat/stop";

/** Stops listening to a thread: `params` {@link ChatThreadNamed}, answered `{}`. */
export const CHAT_CLOSE = "chat/close";

export interface ChatThreadNamed {
  thread: string;
}

/** One event of a thread a connection opened, as the desk's chat has it. */
export const CHAT_EVENT = "chat/event";

export interface ChatEventServed {
  thread: string;
  event: ChatEvent;
}

/** The assistant took the reader to a note. */
export const VIEW_SHOW = "view/show";

export interface ViewShow {
  note: string;
  title: string;
  /** **Absent is a note with no address.** */
  address?: string;
}

/** Every notification the desk sends, by method. */
export interface ServeNotifications {
  [CHAT_EVENT]: ChatEventServed;
  [VIEW_SHOW]: ViewShow;
}
