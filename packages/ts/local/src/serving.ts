// Sloppy's own acts served as MCP messages to a caller outside the app — over a
// command's input and output, or over the network to a headset, one project or
// several — docs/ARCHITECTURE.md § "An assistant outside the app" and
// § "A headset beside the desk".

import {
  type AnswerShape,
  CHAT_TOOL_SPECS,
  CHAT_TOOLS,
  type ChatToolAnswer,
  type ChatToolName,
  ChatToolCallSchema,
  DEFAULT_SERVING,
  type Doctrine,
  FIELD_LIST,
  FIELD_PAGE,
  type FieldListed,
  type FieldNote,
  headsetOnly,
  isChatTool,
  LOOK_READ,
  type LookServed,
  type NodeView,
  OwnedRefSchema,
  PICTURE_LONGEST,
  PICTURE_READ,
  type PictureRead,
  PROJECTS_LIST,
  type ProjectsListed,
  resolveAppearance,
  SERVE_FIRST_LINE_MS,
  SERVE_PAIR,
  type ServeCode,
  type ServeNotPaired,
  SLOPPY_TOOLS,
  servedChatTools,
  type ToolSet,
  ulid,
} from "@sloppy/types";
import { graphOwnerAt, performChatCall, placeApi } from "./acts.js";
import type { CodeReader } from "./code-index.js";
import type { Files } from "./files.js";
import { notesListed } from "./here.js";
import { refsWidened, terseAnswer } from "./terse.js";

/** What this server answers to, and what a caller prefixes its acts with. */
const NAME = "sloppy";

/** Answered where a caller names no version of the protocol. */
export const MCP_PROTOCOL = "2025-06-18";

export const NO_NOTES_HERE =
  "There are no notes in this folder yet. Ask the person to start them, with sloppy init in this folder or by opening it in Sloppy.";

const NOT_HERE =
  "There is nothing here by that name. Everything that can be asked for is in the list of tools.";

const A_BUILD =
  "Building from the notes is something a person starts in front of Sloppy, so it cannot be asked for from here.";

const ONE_FOLDER =
  "This serves the notes of the one project it was started in, so `in` names nothing here. Ask again without it.";

const UNREADABLE = "That call's arguments are not right.";

const WENT_WRONG =
  "That did not work. Check the folder is there and is theirs, and ask again.";

const NO_SUCH_PROJECT =
  "There is no project here by that name. Ask projects/list for the ones served.";

export const NO_LOOK =
  "This desk shares no look, so the headset keeps its own.";

const LOOK_UNREAD =
  "The desk could not say what it is wearing just now, so the headset keeps its own.";

export const NOT_PAIRED =
  "This headset is not paired with this desk yet. Enter the code the desk shows.";

export const NOT_PAIRING =
  "This headset is not paired with this desk yet. Ask the desk for a code: on it, choose Pair a headset.";

export const WRONG_CODE =
  "That is not a code this desk is showing. Check it, or ask the desk for a new one.";

export const PAIR_TOO_LATE =
  "The code did not come in time. Connect again and enter the code the desk shows.";

/** The error code a connection is refused with before it pairs. */
export const UNPAIRED = -32001;

/** A picture's bytes made a PNG no more than `longest` pixels on its longer side. */
export type PictureShrink = (
  bytes: Uint8Array,
  mime_type: string,
  longest: number,
) => Promise<{ png: Uint8Array; width: number; height: number }>;

/** A project as it is served: everything {@link McpServer} says but where its
 *  lines come from and go. */
export interface McpProject {
  /** The project's root folder, where its container is. **Absent is a folder
   *  with no notes in it**, where every call is answered in words. */
  files?: Files;
  /** What this build calls itself to a caller that asks. */
  version: string;
  /** **Absent is `answer-first`.** */
  doctrine?: Doctrine;
  /** **Absent is `default`**, every act. */
  tools?: ToolSet;
  /** **Absent is `default`**, the answers the app's own chat reads. */
  answers?: AnswerShape;
  /** **Absent is no.** */
  landOnCode?: boolean;
  /** Acts neither advertised nor answered. **Absent is none.** */
  without?: readonly ChatToolName[];
  /** What reads the project's code for `find_code`. **Absent is none**, and
   *  the act answers that there is no code to look through. */
  code?: CodeReader;
  /** Whether nothing an act does lands, and a folder holding no graph is said
   *  rather than started — `placeApi`. **Absent is no.** */
  reading?: boolean;
  /** What makes a note's picture small enough to send for {@link PICTURE_READ}.
   *  **Absent is a surface that cannot**, where every picture is answered null. */
  shrink?: PictureShrink;
}

export interface McpServer extends McpProject {
  /** The lines a caller sends, one message each, until it is done. */
  calls: AsyncIterable<string> | Iterable<string>;
  /** One message back to that caller, on a line of its own. */
  answer(line: string): void;
}

/** Where a caller's lines come from and where the answers go. */
export interface McpTransport {
  calls: AsyncIterable<string> | Iterable<string>;
  answer(line: string): void;
}

interface Held extends McpProject {
  /** Whose graph the notes are in, once a terse answer has asked. */
  home?: Promise<string | undefined>;
}

type Answered =
  | { result: unknown }
  | { error: { code: number; message: string; data?: unknown } };

/** Serves until the caller is done with it, one message at a time and in the
 *  order they came: two writes landing together would each read where the
 *  other was about to write. */
export async function serveMcp(server: McpServer): Promise<void> {
  const at: Held = { ...server };
  for await (const line of server.calls) {
    const answered = await answerLine(at, line);
    if (answered !== undefined) server.answer(answered);
  }
}

/** The acts a project served read-only leaves out: every one that writes. */
export const WRITING_ACTS: readonly ChatToolName[] = CHAT_TOOLS.filter(
  (act) => CHAT_TOOL_SPECS[act].writes,
);

/** One served project, as {@link servingProjects} takes it. */
export interface ProjectServed {
  id: string;
  name: string;
  server: McpProject;
}

/** Projects named for a caller, each id its name and a second of a name
 *  `name-2`, in the order given. */
export function namedProjects(
  projects: readonly { name: string; server: McpProject }[],
): ProjectServed[] {
  const named: ProjectServed[] = [];
  for (const { name, server } of projects) {
    let id = name;
    for (let again = 2; named.some((one) => one.id === id); again++) {
      id = `${name}-${again}`;
    }
    named.push({ id, name, server });
  }
  return named;
}

/**
 * Several projects behind one loop, read-only: every writing act is left out
 * of each, and nothing any act does lands. A line is taken with the answer it goes back to, so several
 * connections share it; each project answers its queued lines in the order
 * they came, and two projects never wait on each other.
 */
export interface ProjectsServing {
  /** `connection` names the connection the line came on, for as long as it is
   *  open. **Absent is a transport with one caller**, named `""`. Whatever is
   *  sent on it later, a notification included, goes through `answer`. */
  take(line: string, answer: (line: string) => void, connection?: string): void;
  /** Told once `connection` has gone, so nothing is sent on it again. */
  closed(connection: string): void;
  /** Settles once every line taken so far is answered. */
  settled(): Promise<void>;
}

/** The connection a line came on, as a {@link ServeMethod} is handed it. */
export interface ServeCaller {
  id: string;
  /** Sends a `ServeNotification` on this connection; one since closed drops it. */
  notify(method: string, params: unknown): void;
}

/**
 * A method a served project answers by name: the result, or a
 * {@link ServeRefused} the headset shows in its words. Any other throw is
 * answered as something that went wrong.
 */
export interface ServeMethod {
  handle(
    params: Record<string, unknown>,
    project: ProjectServed,
    connection: ServeCaller,
  ): Promise<unknown>;
  /** Whether it waits behind every queued line of its project. An unqueued one
   *  is answered as soon as it is done, whatever is before it. */
  queued: boolean;
  /** Whether it is answered whichever project is named, one not served
   *  included. **Absent is no**: an unknown project is refused. */
  anyProject?: true;
}

export type ServeMethodTable = Readonly<Record<string, ServeMethod>>;

/** A served method's refusal: `error.code` and the words for the person. */
export class ServeRefused extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
  }
}

/** What a desk serves beside its projects. */
export interface ServingOptions {
  /** The look the desk is wearing now, asked each time {@link LOOK_READ} is.
   *  **Absent is a server that shares no look**, answered {@link NO_LOOK}. */
  look?: () => LookServed | Promise<LookServed>;
  /** Methods answered beside the ones every loop answers, which they never
   *  replace. **Absent is none.** */
  methods?: ServeMethodTable;
  /** Told once a connection has gone. */
  closed?: (connection: string) => void;
}

/** What a project-free method is handed where no project is named or served. */
const NO_PROJECT: ProjectServed = { id: "", name: "", server: { version: "" } };

export function servingProjects(
  projects: readonly ProjectServed[],
  options: ServingOptions = {},
): ProjectsServing {
  const held = projects.map((one) => ({
    served: {
      id: one.id,
      name: one.name,
      server: {
        ...one.server,
        reading: true,
        without: [...new Set([...(one.server.without ?? []), ...WRITING_ACTS])],
      } as Held,
    } satisfies ProjectServed & { server: Held },
    queue: Promise.resolve(),
  }));
  const listed: ProjectsListed = {
    projects: projects.map(({ id, name }) => ({ id, name })),
  };
  const builtIn: ServeMethodTable = {
    [PROJECTS_LIST]: {
      queued: false,
      anyProject: true,
      handle: async () => listed,
    },
    [LOOK_READ]: {
      queued: false,
      anyProject: true,
      handle: () => lookRead(options.look),
    },
    [FIELD_LIST]: {
      queued: true,
      handle: (params, project) => fieldListed(project.server, params.after),
    },
    [PICTURE_READ]: {
      queued: true,
      handle: (params, project) => pictureRead(project.server, params.note),
    },
  };
  const gone = new Set<string>();
  let pending: Promise<unknown>[] = [];
  return {
    take(line, answer, connection = "") {
      const asked = read(line);
      if (asked === undefined) {
        answer(said(null, { error: { code: -32700, message: "Parse error" } }));
        return;
      }
      const method = typeof asked.method === "string" ? asked.method : "";
      const served = builtIn[method] ?? options.methods?.[method];
      const params = objectOf(asked.params) ?? {};
      const named =
        (method === FIELD_LIST ? params.project : undefined) ?? asked.project;
      const project =
        named === undefined
          ? held[0]
          : held.find((one) => one.served.id === named);
      if (project === undefined && !served?.anyProject) {
        if ("id" in asked) {
          answer(
            said(asked.id, {
              error: { code: -32602, message: NO_SUCH_PROJECT },
            }),
          );
        }
        return;
      }
      if (served === undefined) {
        const at = project as (typeof held)[number];
        at.queue = at.queue
          .then(() => answerLine(at.served.server, line))
          .then((answered) => {
            if (answered !== undefined) answer(answered);
          });
        pending.push(at.queue);
        return;
      }
      if (!("id" in asked)) return;
      const caller: ServeCaller = {
        id: connection,
        notify(method, params) {
          if (gone.has(connection)) return;
          answer(JSON.stringify({ jsonrpc: "2.0", method, params }));
        },
      };
      const handled = () =>
        served
          .handle(params, project?.served ?? NO_PROJECT, caller)
          .then(
            (result) => said(asked.id, { result }),
            (thrown) => said(asked.id, refusal(thrown)),
          )
          .then(answer);
      if (served.queued && project !== undefined) {
        project.queue = project.queue.then(handled);
        pending.push(project.queue);
      } else {
        pending.push(handled());
      }
    },
    closed(connection) {
      if (connection === "") return;
      gone.add(connection);
      options.closed?.(connection);
    },
    async settled() {
      while (pending.length > 0) {
        const waiting = pending;
        pending = [];
        await Promise.all(waiting);
      }
    },
  };
}

function refusal(thrown: unknown): Answered {
  if (thrown instanceof ServeRefused) {
    return {
      error: {
        code: thrown.code,
        message: thrown.message,
        ...(thrown.data === undefined ? {} : { data: thrown.data }),
      },
    };
  }
  return { error: { code: -32603, message: WENT_WRONG } };
}

/** The answer to {@link LOOK_READ}. */
async function lookRead(look: ServingOptions["look"]): Promise<LookServed> {
  if (look === undefined) throw new ServeRefused(-32601, NO_LOOK);
  try {
    return await look();
  } catch {
    throw new ServeRefused(-32603, LOOK_UNREAD);
  }
}

/** The answer to {@link FIELD_LIST}. */
async function fieldListed(
  at: McpProject,
  after: unknown,
): Promise<FieldListed> {
  if (!at.files) return { notes: [] };
  const notes = await notesListed(placeApi(at.files)).catch(() => undefined);
  if (notes === undefined) throw new ServeRefused(-32603, WENT_WRONG);
  return fieldPage(notes, typeof after === "string" ? after : undefined);
}

/** The picture `note`'s mark wears in the project `at` serves, made small. */
export async function pictureRead(
  at: McpProject,
  note: unknown,
): Promise<PictureRead> {
  const none: PictureRead = { picture: null };
  const ref = OwnedRefSchema.safeParse(note);
  if (!at.files || !at.shrink || !ref.success) return none;
  const held = await placeApi(at.files)
    .markPicture(ref.data)
    .catch(() => undefined);
  if (held === undefined) return none;
  const shrunk = await at
    .shrink(held.bytes, held.mime_type, PICTURE_LONGEST)
    .catch(() => undefined);
  if (
    shrunk === undefined ||
    shrunk.width < 1 ||
    shrunk.height < 1 ||
    Math.max(shrunk.width, shrunk.height) > PICTURE_LONGEST
  ) {
    return none;
  }
  return {
    picture: base64(shrunk.png),
    width: shrunk.width,
    height: shrunk.height,
  };
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }
  return btoa(binary);
}

/** One page of the field, in ref order, from just after `after`. */
export function fieldPage(
  notes: readonly NodeView[],
  after?: string,
): FieldListed {
  const ordered = notes
    .filter((note) => after === undefined || note.ref > after)
    .sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));
  const page = ordered.slice(0, FIELD_PAGE).map(asField);
  return ordered.length > FIELD_PAGE
    ? { notes: page, next: page[page.length - 1].note }
    : { notes: page };
}

function asField(note: NodeView): FieldNote {
  return {
    note: note.ref,
    title: note.title,
    ...(note.address === undefined ? {} : { address: note.address }),
    ...(note.parent === undefined ? {} : { parent: note.parent }),
    tags: [...note.tags],
    ...(resolveAppearance(note.appearance).preview.pictures.length > 0
      ? { picture: true as const }
      : {}),
    links: note.links.map((to) => {
      const look = note.edges?.find((one) => one.to === to);
      return {
        to,
        ...(look?.label === undefined ? {} : { label: look.label }),
        ...(look?.direction === undefined ? {} : { direction: look.direction }),
      };
    }),
  };
}

/** How a connection pairs: the code a headset not paired before sends first,
 *  and what the transport remembers of the headsets it has paired. */
export interface Pairing {
  /** The code the desk is showing now. **Undefined is none**, and no headset pairs. */
  code(): ServeCode | undefined;
  /** Whether `connection` comes from a headset paired before. */
  paired(connection: string): boolean;
  /** Told once `connection` pairs by the code, so its headset is let in again
   *  without one, with what the headset calls itself where it said. The code is
   *  then spent: {@link code} answers undefined from here until another is made.
   *  The headset is told it paired only once this settles. */
  pairs(connection: string, name?: string): void | Promise<void>;
}

/** A transport one headset is on. */
export interface ServeConnection extends McpTransport {
  /** Names the connection to {@link Pairing}. */
  connection: string;
  /** Ends the connection once what was answered on it has gone. */
  close(): void;
}

/** {@link servingProjects} over one caller, until it is done. With `pairing`,
 *  a headset not paired before is let in only by a first line of
 *  {@link SERVE_PAIR} with the code it is showing, within {@link SERVE_FIRST_LINE_MS}. */
export async function serveProjects(
  projects: readonly ProjectServed[],
  transport: McpTransport,
  pairing?: undefined,
  options?: ServingOptions,
): Promise<void>;
export async function serveProjects(
  projects: readonly ProjectServed[],
  transport: ServeConnection,
  pairing: Pairing,
  options?: ServingOptions,
): Promise<void>;
export async function serveProjects(
  projects: readonly ProjectServed[],
  transport: McpTransport | ServeConnection,
  pairing?: Pairing,
  options?: ServingOptions,
): Promise<void> {
  const serving = servingProjects(projects, options);
  const connection = "connection" in transport ? transport : undefined;
  let paired =
    pairing === undefined ||
    connection === undefined ||
    pairing.paired(connection.connection);
  let late = false;
  const window = paired
    ? undefined
    : setTimeout(() => {
        late = true;
        transport.answer(
          said(null, { error: { code: UNPAIRED, message: PAIR_TOO_LATE } }),
        );
        connection?.close();
      }, SERVE_FIRST_LINE_MS);
  try {
    for await (const line of transport.calls) {
      if (late) break;
      if (paired) {
        serving.take(
          line,
          (answered) => transport.answer(answered),
          connection?.connection,
        );
        continue;
      }
      const pairs = pairingAnswer(line, pairing?.code());
      if (!pairs.paired) {
        transport.answer(pairs.line);
        connection?.close();
        break;
      }
      paired = true;
      clearTimeout(window);
      if (connection) await pairing?.pairs(connection.connection, pairs.name);
      transport.answer(pairs.line);
    }
  } finally {
    clearTimeout(window);
    if (connection) serving.closed(connection.connection);
  }
  await serving.settled();
}

/** The longest name a headset is remembered by. */
const NAMED_AT_MOST = 64;

/** What the first line from a headset not paired before is answered with, and
 *  whether it paired: only {@link SERVE_PAIR} with `code`, the one shown now,
 *  does, saying in `params.name` what it calls itself if it likes. With no
 *  code shown, a `pair` is refused as a wrong code is. */
export function pairingAnswer(
  line: string,
  code: ServeCode | undefined,
): { line: string; paired: boolean; name?: string } {
  const asked = read(line);
  const id = asked?.id ?? null;
  if (asked?.method !== SERVE_PAIR) {
    const data: ServeNotPaired = { pairing: code !== undefined };
    return {
      line: said(id, {
        error: {
          code: UNPAIRED,
          message: data.pairing ? NOT_PAIRED : NOT_PAIRING,
          data,
        },
      }),
      paired: false,
    };
  }
  const params = objectOf(asked.params);
  const given = params?.code;
  if (code === undefined || code === "" || given !== code) {
    return {
      line: said(id, { error: { code: UNPAIRED, message: WRONG_CODE } }),
      paired: false,
    };
  }
  const name =
    typeof params?.name === "string" && params.name.trim() !== ""
      ? params.name.trim().slice(0, NAMED_AT_MOST)
      : undefined;
  return {
    line: said(id, { result: { paired: true } }),
    paired: true,
    ...(name === undefined ? {} : { name }),
  };
}

/** The line one message is answered with, or nothing for a notification. */
async function answerLine(at: Held, line: string): Promise<string | undefined> {
  const asked = read(line);
  if (asked === undefined) {
    return said(null, { error: { code: -32700, message: "Parse error" } });
  }
  // A message with no id is a notification, which is taken and never
  // answered.
  if (!("id" in asked)) return undefined;
  return said(asked.id, await answering(at, asked));
}

async function answering(
  at: Held,
  asked: Record<string, unknown>,
): Promise<Answered> {
  const method = typeof asked.method === "string" ? asked.method : "";
  switch (method) {
    case "initialize":
      return { result: initialized(at, asked.params) };
    case "ping":
      return { result: {} };
    case "tools/list":
      return { result: { tools: advertised(at) } };
    case "tools/call":
      // Every call is answered, whatever happened: a caller left waiting on an
      // answer that never comes has no way to find out that it never will.
      return await calling(at, asked.params).catch(() => trouble(WENT_WRONG));
    default:
      return {
        error: { code: -32601, message: `No method named ${method}` },
      };
  }
}

/** One JSON object, or nothing where the line is not one. */
function read(line: string): Record<string, unknown> | undefined {
  try {
    return objectOf(JSON.parse(line));
  } catch {
    return undefined;
  }
}

function objectOf(held: unknown): Record<string, unknown> | undefined {
  return typeof held === "object" && held !== null && !Array.isArray(held)
    ? (held as Record<string, unknown>)
    : undefined;
}

function said(id: unknown, answered: Answered): string {
  return JSON.stringify({ jsonrpc: "2.0", id: id ?? null, ...answered });
}

function initialized(at: McpProject, params: unknown): unknown {
  const named = objectOf(params)?.protocolVersion;
  return {
    protocolVersion: typeof named === "string" ? named : MCP_PROTOCOL,
    capabilities: { tools: {} },
    serverInfo: { name: NAME, version: at.version },
  };
}

function advertised(at: McpProject): unknown[] {
  return servedChatTools({
    doctrine: at.doctrine ?? DEFAULT_SERVING.doctrine,
    tools: at.tools ?? DEFAULT_SERVING.tools,
    answers: at.answers ?? DEFAULT_SERVING.answers,
    landOnCode: at.landOnCode ?? DEFAULT_SERVING.landOnCode,
  })
    .filter((act) => !at.without?.includes(act.name))
    .map((act) => ({
      name: act.name,
      description: act.description,
      inputSchema: act.arguments,
    }));
}

/** A call that came to nothing is an answer the caller reads and acts on, not a
 *  protocol error: whatever it is doing goes on. */
function came(answer: ChatToolAnswer): Answered {
  return {
    result: {
      content: [{ type: "text", text: answer.said }],
      isError: answer.trouble === true,
    },
  };
}

function trouble(words: string): Answered {
  return came({ said: words, trouble: true });
}

/** Whose graph the notes are in, asked once. */
function homeOf(at: Held, files: Files): Promise<string | undefined> {
  at.home ??= graphOwnerAt(files);
  return at.home;
}

async function calling(at: Held, params: unknown): Promise<Answered> {
  const held = objectOf(params) ?? {};
  const name = held.name;
  if (typeof name !== "string") {
    return { error: { code: -32602, message: "That call names no tool." } };
  }
  if (!at.files) return trouble(NO_NOTES_HERE);
  const act = SLOPPY_TOOLS.find((one) => one === name);
  if (act === undefined) return trouble(NOT_HERE);
  if (!isChatTool(act)) return trouble(A_BUILD);
  if (at.without?.includes(act) || headsetOnly(act)) return trouble(NOT_HERE);
  const terse = at.answers === "terse";
  const home = terse ? await homeOf(at, at.files) : undefined;
  const given = refsWidened(held.arguments ?? {}, home);
  if (objectOf(given)?.in !== undefined) return trouble(ONE_FOLDER);
  const call = ChatToolCallSchema.safeParse({
    call: ulid(),
    act,
    arguments: given,
  });
  if (!call.success) {
    const says = whatIsWrong(call.error.issues[0]);
    return trouble(says ? `${UNREADABLE} ${says}` : UNREADABLE);
  }
  const done = await performChatCall(at.files, call.data, at.reading === true, {
    landOnCode: at.landOnCode === true,
    ...(at.code === undefined ? {} : { code: at.code }),
  });
  return came({
    said: terse && !done.trouble ? terseAnswer(done.said, home) : done.said,
    ...(done.trouble === undefined ? {} : { trouble: done.trouble }),
  });
}

/** One refusal of the arguments, naming the field it is about. */
function whatIsWrong(
  issue: { path: readonly PropertyKey[]; message: string } | undefined,
): string | undefined {
  if (!issue) return undefined;
  const field = issue.path
    .slice(issue.path[0] === "arguments" ? 1 : 0)
    .map(String)
    .join(".");
  const says = issue.message.replace(/^Invalid input: /, "");
  return field === "" ? says : `${field}: ${says}`;
}
