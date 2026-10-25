// `sloppy mcp`: Sloppy's own acts served on this command's input and output to
// whatever assistant started it, performed against the folder's own files —
// docs/ARCHITECTURE.md § "An assistant outside the app".

import { readFile } from "node:fs/promises";
import { type Files, performChatCall } from "@sloppy/local";
import {
  advertisedChatTools,
  type ChatToolAnswer,
  ChatToolCallSchema,
  isChatTool,
  SLOPPY_TOOLS,
  ulid,
} from "@sloppy/types";

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

export interface McpServer {
  /** The project's root folder, where its container is. **Absent is a folder
   *  with no notes in it**, where every call is answered in words. */
  files?: Files;
  /** The lines a caller sends, one message each, until it is done. */
  calls: AsyncIterable<string> | Iterable<string>;
  /** One message back to that caller, on a line of its own. */
  answer(line: string): void;
  /** What this build calls itself to a caller that asks. */
  version: string;
}

type Answered =
  | { result: unknown }
  | { error: { code: number; message: string } };

/** Serves until the caller is done with it, one message at a time and in the
 *  order they came: two writes landing together would each read where the
 *  other was about to write. */
export async function serveMcp(at: McpServer): Promise<void> {
  for await (const line of at.calls) {
    const asked = read(line);
    if (asked === undefined) {
      say(at, null, { error: { code: -32700, message: "Parse error" } });
      continue;
    }
    // A message with no id is a notification, which is taken and never
    // answered.
    if (!("id" in asked)) continue;
    say(at, asked.id, await answering(at, asked));
  }
}

async function answering(
  at: McpServer,
  asked: Record<string, unknown>,
): Promise<Answered> {
  const method = typeof asked.method === "string" ? asked.method : "";
  switch (method) {
    case "initialize":
      return { result: initialized(at, asked.params) };
    case "ping":
      return { result: {} };
    case "tools/list":
      return { result: { tools: advertised() } };
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

function say(at: McpServer, id: unknown, answered: Answered): void {
  at.answer(JSON.stringify({ jsonrpc: "2.0", id: id ?? null, ...answered }));
}

function initialized(at: McpServer, params: unknown): unknown {
  const named = objectOf(params)?.protocolVersion;
  return {
    protocolVersion: typeof named === "string" ? named : MCP_PROTOCOL,
    capabilities: { tools: {} },
    serverInfo: { name: NAME, version: at.version },
  };
}

function advertised(): unknown[] {
  return advertisedChatTools().map((act) => ({
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

function trouble(said: string): Answered {
  return came({ said, trouble: true });
}

async function calling(at: McpServer, params: unknown): Promise<Answered> {
  const held = objectOf(params) ?? {};
  const name = held.name;
  if (typeof name !== "string") {
    return { error: { code: -32602, message: "That call names no tool." } };
  }
  if (!at.files) return trouble(NO_NOTES_HERE);
  const act = SLOPPY_TOOLS.find((one) => one === name);
  if (act === undefined) return trouble(NOT_HERE);
  if (!isChatTool(act)) return trouble(A_BUILD);
  const given = held.arguments ?? {};
  if (objectOf(given)?.in !== undefined) return trouble(ONE_FOLDER);
  const call = ChatToolCallSchema.safeParse({
    call: ulid(),
    act,
    arguments: given,
  });
  if (!call.success) {
    const says = call.error.issues[0]?.message;
    return trouble(says ? `${UNREADABLE} ${says}` : UNREADABLE);
  }
  const done = await performChatCall(at.files, call.data);
  return came({
    said: done.said,
    ...(done.trouble === undefined ? {} : { trouble: done.trouble }),
  });
}

/** A stream read a line at a time, blank lines passed over. A line can arrive
 *  in pieces, and the last one need not end in a newline. */
export async function* linesOf(
  stream: AsyncIterable<string | Uint8Array>,
): AsyncIterable<string> {
  const decoder = new TextDecoder();
  let held = "";
  for await (const chunk of stream) {
    held +=
      typeof chunk === "string"
        ? chunk
        : decoder.decode(chunk, { stream: true });
    for (;;) {
      const at = held.indexOf("\n");
      if (at === -1) break;
      const line = held.slice(0, at).replace(/\r$/, "");
      held = held.slice(at + 1);
      if (line.trim() !== "") yield line;
    }
  }
  held += decoder.decode();
  if (held.trim() !== "") yield held;
}

/** The version this package says it is, and "0" where it cannot be read. */
export async function ownVersion(): Promise<string> {
  try {
    const said = objectOf(
      JSON.parse(
        await readFile(new URL("../package.json", import.meta.url), "utf8"),
      ),
    )?.version;
    return typeof said === "string" ? said : "0";
  } catch {
    return "0";
  }
}
