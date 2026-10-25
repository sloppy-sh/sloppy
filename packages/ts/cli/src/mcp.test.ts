import { IDENTITIES_FILE, keepingDataAt, MemoryFiles } from "@sloppy/local";
import {
  CHAT_TOOLS,
  NotesListedSchema,
  NoteWrittenSchema,
  splitOwnedRef,
} from "@sloppy/types";
import { beforeEach, describe, expect, it } from "vitest";
import { linesOf, MCP_PROTOCOL, NO_NOTES_HERE } from "./mcp.js";
import { FINE, run } from "./run.js";

const PROJECT = "/project";

let device: Map<string, Uint8Array>;
let disk: MemoryFiles;

interface Served {
  code: number;
  /** Every line the caller was answered with, parsed. */
  answers: Record<string, unknown>[];
  err: string[];
}

async function served(lines: string[], cwd = PROJECT): Promise<Served> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(["mcp"], {
    cwd,
    told: { out: (line) => out.push(line), err: (line) => err.push(line) },
    filesAt: (root, data) => keepingDataAt(disk.at(root), data),
    calls: lines,
  });
  return { code, answers: out.map((line) => JSON.parse(line)), err };
}

function message(id: number, method: string, params?: unknown): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id,
    method,
    ...(params === undefined ? {} : { params }),
  });
}

function calling(act: string, args: object = {}, id = 1): string {
  return message(id, "tools/call", { name: act, arguments: args });
}

/** What the one tool call came to. */
function came(answer: Record<string, unknown> | undefined): {
  text: string;
  isError: boolean;
} {
  const result = answer?.result as
    | { content: { type: string; text: string }[]; isError: boolean }
    | undefined;
  if (!result) throw new Error(`No result: ${JSON.stringify(answer)}`);
  expect(result.content[0].type).toBe("text");
  return { text: result.content[0].text, isError: result.isError };
}

async function aProject(): Promise<void> {
  const encode = (said: string) => new TextEncoder().encode(said);
  await disk.at(PROJECT).write("package.json", encode('{"name":"it"}'));
  await disk
    .at(PROJECT)
    .write("src/parser.ts", encode("export const one = 1;\n"));
  const out: string[] = [];
  expect(
    await run(["init"], {
      cwd: PROJECT,
      told: { out: (line) => out.push(line), err: (line) => out.push(line) },
      filesAt: (root, data) => keepingDataAt(disk.at(root), data),
    }),
  ).toBe(FINE);
}

/** Every file on the disk, so a test says nothing was written. */
function everyFile(): string[] {
  return [...device.keys()].sort();
}

beforeEach(() => {
  device = new Map();
  disk = new MemoryFiles({ root: "/", store: device });
});

describe("sloppy mcp", () => {
  it("says what it is to a caller opening, in the version it was asked for", async () => {
    await aProject();

    const { code, answers } = await served([
      message(1, "initialize", { protocolVersion: "2025-03-26" }),
      message(2, "initialize", {}),
    ]);

    expect(code).toBe(FINE);
    expect(answers[0]).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: "2025-03-26",
        capabilities: { tools: {} },
        serverInfo: { name: "sloppy" },
      },
    });
    expect(answers[1]).toMatchObject({
      result: { protocolVersion: MCP_PROTOCOL },
    });
  });

  it("advertises the chat's sixteen acts and no build's", async () => {
    await aProject();

    const { answers } = await served([message(1, "tools/list")]);
    const tools = (answers[0].result as { tools: Record<string, unknown>[] })
      .tools;

    expect(tools.map((tool) => tool.name)).toEqual([...CHAT_TOOLS]);
    expect(tools).toHaveLength(16);
    for (const tool of tools) {
      expect(typeof tool.description).toBe("string");
      expect(tool.inputSchema).toMatchObject({ type: "object" });
    }
  });

  it("lists the notes the folder holds", async () => {
    await aProject();

    const { answers } = await served([calling("list_notes")]);
    const listed = came(answers[0]);

    expect(listed.isError).toBe(false);
    expect(
      NotesListedSchema.parse(JSON.parse(listed.text)).notes.length,
    ).toBeGreaterThan(0);
  });

  it("writes a note into the folder's own files, as the container", async () => {
    await aProject();
    const before = everyFile();

    const { answers } = await served([
      calling("write_note", {
        about: "src/parser.ts",
        title: "The parser",
        sections: ["## Why\n\nIt reads one token at a time."],
      }),
      calling("list_notes", {}, 2),
    ]);
    const written = NoteWrittenSchema.parse(JSON.parse(came(answers[0]).text));

    expect(written.done).toBe("written");
    const file = `${PROJECT}/.sloppy/notes/${splitOwnedRef(written.note).localId}.md`;
    expect(before).not.toContain(file);
    expect(new TextDecoder().decode(device.get(file))).toContain(
      "It reads one token at a time.",
    );
    const listed = NotesListedSchema.parse(JSON.parse(came(answers[1]).text));
    expect(listed.notes.find((one) => one.note === written.note)?.title).toBe(
      "The parser",
    );
  });

  it("writes as the container, under the identity in the container's own sidecar", async () => {
    await aProject();
    const sidecar = `${PROJECT}/.sloppy/.sloppy/`;
    const kept = () => everyFile().filter((path) => path.startsWith(sidecar));
    const before = kept();

    await served([
      calling("write_note", {
        about: "src/parser.ts",
        sections: ["## Why\n\nIt reads one token at a time."],
      }),
    ]);

    expect(before).toContain(`${sidecar}${IDENTITIES_FILE}`);
    expect(kept()).toEqual(before);
    expect(everyFile().some((path) => !path.startsWith(PROJECT))).toBe(false);
  });

  it("keeps an identity for the container where the folder came without one", async () => {
    await aProject();
    const sidecar = `${PROJECT}/.sloppy/.sloppy/`;
    for (const path of everyFile()) {
      if (path.startsWith(sidecar)) device.delete(path);
    }

    const { answers } = await served([
      calling("write_note", {
        about: "src/parser.ts",
        sections: ["## Why\n\nIt reads one token at a time."],
      }),
    ]);

    expect(came(answers[0]).isError).toBe(false);
    expect(everyFile()).toContain(`${sidecar}${IDENTITIES_FILE}`);
  });

  it("serves the project above the folder it was started in", async () => {
    await aProject();

    const { answers } = await served([calling("list_notes")], `${PROJECT}/src`);

    expect(came(answers[0]).isError).toBe(false);
  });

  it("refuses a build's act in words, which was never advertised", async () => {
    await aProject();

    const answer = came((await served([calling("plan_build")])).answers[0]);

    expect(answer.isError).toBe(true);
    expect(answer.text).toContain("in front of Sloppy");
  });

  it("answers a tool it has none of in words", async () => {
    await aProject();

    const answer = came((await served([calling("rename_graph")])).answers[0]);

    expect(answer.isError).toBe(true);
    expect(answer.text).toContain("nothing here by that name");
  });

  it("refuses another folder, since it serves the one it was started in", async () => {
    await aProject();

    const answer = came(
      (await served([calling("list_notes", { in: "lexer" })])).answers[0],
    );

    expect(answer.isError).toBe(true);
    expect(answer.text).toContain("`in`");
  });

  it("answers arguments that do not read in words", async () => {
    await aProject();

    const answer = came(
      (await served([calling("read_note", { note: 7 })])).answers[0],
    );

    expect(answer.isError).toBe(true);
    expect(answer.text).toContain("arguments are not right");
  });

  it("names the field an argument that does not read is in", async () => {
    await aProject();

    const answer = came(
      (await served([calling("write_note", { sections: ["## Why\n\nIt."] })]))
        .answers[0],
    );

    expect(answer.isError).toBe(true);
    expect(answer.text).toContain("about: expected string, received undefined");
  });

  it("writes nothing but the protocol to its output, whatever it was asked", async () => {
    for (const argv of [
      ["mcp", "--json"],
      ["mcp", "--help"],
    ]) {
      const out: string[] = [];
      const err: string[] = [];
      await run(argv, {
        cwd: PROJECT,
        told: { out: (line) => out.push(line), err: (line) => err.push(line) },
        filesAt: () => {
          throw new Error("unreadable");
        },
        calls: [],
      });

      expect({ argv, out }).toEqual({ argv, out: [] });
      expect({ argv, err }).not.toEqual({ argv, err: [] });
    }
  });

  it("answers every call in a folder with no notes with how to start them, and starts none", async () => {
    const before = everyFile();

    const { code, answers, err } = await served([
      message(1, "initialize", {}),
      calling("list_notes", {}, 2),
      calling("write_note", { about: "src/a.ts", sections: ["Hello."] }, 3),
    ]);

    expect(code).toBe(FINE);
    expect(answers[0]).toHaveProperty("result.serverInfo.name", "sloppy");
    for (const answer of answers.slice(1)) {
      expect(came(answer)).toEqual({ text: NO_NOTES_HERE, isError: true });
    }
    expect(err).toEqual([NO_NOTES_HERE]);
    expect(everyFile()).toEqual(before);
  });

  it("takes a notification and answers nothing", async () => {
    await aProject();

    const { answers } = await served([
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      message(2, "ping"),
    ]);

    expect(answers).toEqual([{ jsonrpc: "2.0", id: 2, result: {} }]);
  });

  it("answers a line that is not a message with a parse error", async () => {
    await aProject();

    const { answers } = await served(["this is not json", "[1,2]"]);

    expect(answers).toEqual([
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      },
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      },
    ]);
  });

  it("answers a method it has none of as one", async () => {
    await aProject();

    const { answers } = await served([message(4, "resources/list")]);

    expect(answers[0]).toMatchObject({ id: 4, error: { code: -32601 } });
  });

  it("answers each message in the order it came", async () => {
    await aProject();

    const { answers } = await served([
      calling("list_notes", {}, 1),
      message(2, "ping"),
      calling("list_tags", {}, 3),
    ]);

    expect(answers.map((answer) => answer.id)).toEqual([1, 2, 3]);
  });
});

describe("the lines a caller sends", () => {
  async function read(chunks: (string | Uint8Array)[]): Promise<string[]> {
    const held: string[] = [];
    for await (const line of linesOf(
      (async function* () {
        yield* chunks;
      })(),
    )) {
      held.push(line);
    }
    return held;
  }

  it("are put back together where one arrives in pieces", async () => {
    const bytes = new TextEncoder().encode('{"id":1}\r\n\n{"id"');

    expect(await read([bytes, ":2}\n", '{"id":3}'])).toEqual([
      '{"id":1}',
      '{"id":2}',
      '{"id":3}',
    ]);
  });
});
