// Code quoted into a note through the acts an agent calls —
// docs/ARCHITECTURE.md § "Code quoted into a note".

import {
  type ChatToolCall,
  NotesFoundSchema,
  NoteReadSchema,
  NoteWrittenSchema,
  type OwnedRef,
} from "@sloppy/types";
import { digestOfText } from "@sloppy/vault";
import { beforeEach, describe, expect, it } from "vitest";
import { containerApi, performChatCall } from "./acts.js";
import { type CodeReader, codeIndexOf } from "./code-index.js";
import { symbolsIn } from "./code-symbols.js";
import { MemoryFiles } from "./files.js";
import { foundElsewhereIn } from "./snippets.js";

const PROJECT = "/work/compiler";
const PARSER = "src/parser.ts";
const SAYS = "export function parse() {}\nconst two = 2;\nconst three = 3;\n";

let files: MemoryFiles;

const sha256 = digestOfText;

async function code(text: string): Promise<void> {
  await files.write(PARSER, new TextEncoder().encode(text));
}

async function done(call: Omit<ChatToolCall, "call">, code?: CodeReader) {
  return performChatCall(
    files,
    { call: "c", ...call } as ChatToolCall,
    false,
    code === undefined ? {} : { code },
  );
}

/** An index of the project's files at `paths`, read as they are when asked. */
function indexing(paths: readonly string[]): CodeReader {
  return async () =>
    codeIndexOf(
      await Promise.all(
        paths.map(async (path) => {
          const bytes = await files.read(path);
          const text =
            bytes === undefined ? "" : new TextDecoder().decode(bytes);
          return { path, symbols: symbolsIn(path, text) };
        }),
      ),
    );
}

async function wrote(sections: string[]): Promise<OwnedRef> {
  const answer = await done({
    act: "write_note",
    arguments: { about: PARSER, sections, tags: ["parsing"] },
  });
  expect(answer.trouble).toBeUndefined();
  return NoteWrittenSchema.parse(JSON.parse(answer.said)).note;
}

async function read(note: OwnedRef, quoted?: "all", code?: CodeReader) {
  const answer = await done(
    {
      act: "read_note",
      arguments: { note, ...(quoted === undefined ? {} : { quoted }) },
    },
    code,
  );
  expect(answer.trouble).toBeUndefined();
  return NoteReadSchema.parse(JSON.parse(answer.said));
}

const ASKED = `## Constants\n\nThe two constants:\n\n\`\`\`code:${PARSER}#L2-L3\n\`\`\``;
const QUOTED = "const two = 2;\nconst three = 3;";

beforeEach(async () => {
  files = new MemoryFiles({ root: PROJECT, data: "/data" });
  await code(SAYS);
  await containerApi(files).openProject(PROJECT);
});

describe("quoting code from the write path", () => {
  it("takes the lines and their digest from the file, whatever the fence held", async () => {
    const note = await wrote([
      `## Constants\n\n\`\`\`code:${PARSER}#L2-L3\nconst two = 22;\n\`\`\``,
    ]);
    const whole = await read(note, "all");
    expect(whole.sections.at(-1)?.markdown).toContain(
      `\`\`\`ts code:${PARSER}#L2-L3 ${await sha256(QUOTED)}\n${QUOTED}\n\`\`\``,
    );
    expect(whole.quoted).toEqual([
      { at: `${PARSER}#L2-L3`, state: "unchanged" },
    ]);
    expect(whole.about).toContain(PARSER);
  });

  it("refuses lines the file has not got, and writes nothing", async () => {
    const answer = await done({
      act: "write_note",
      arguments: {
        about: PARSER,
        sections: [`## Past the end\n\n\`\`\`code:${PARSER}#L3-L9\n\`\`\``],
        tags: ["parsing"],
      },
    });
    expect(answer.trouble).toBe(true);
    expect(answer.said).toContain("no lines 3-9");
    const listed = await done({ act: "list_notes", arguments: {} });
    expect(JSON.parse(listed.said).notes).toEqual([]);
  });

  it("keeps the lines of a quote written back as it was read, lines left out", async () => {
    const note = await wrote([ASKED]);
    const lean = await read(note);
    const section = lean.sections.at(-1)?.markdown ?? "";
    expect(section).not.toContain(QUOTED);
    await code(`// a comment\n${SAYS}`);
    const again = await done({
      act: "write_note",
      arguments: {
        about: PARSER,
        sections: [section.replace("The two", "Both")],
      },
    });
    expect(again.trouble).toBeUndefined();
    const whole = await read(note, "all");
    expect(whole.sections.at(-1)?.markdown).toContain(QUOTED);
    expect(whole.quoted).toEqual([
      { at: `${PARSER}#L2-L3`, state: "moved", now: `${PARSER}#L3-L4` },
    ]);
  });

  it("starts a note holding only a quote about its place, so the next write about it lands there", async () => {
    const note = await wrote([ASKED]);
    await done({
      act: "write_note",
      arguments: {
        about: "src/lexer.ts",
        start: true,
        sections: [
          `## Beside\n\nIt hands [the parser](code:${PARSER}) tokens.`,
        ],
        tags: ["parsing"],
      },
    });
    expect(await wrote([ASKED.replace("The two", "Both")])).toBe(note);
  });
});

describe("what a read says of each quote", () => {
  it("says moved, changed and removed in turn, with the lines only where broken", async () => {
    const note = await wrote([ASKED]);

    await code(`// a comment\n${SAYS}`);
    const moved = await read(note);
    expect(moved.quoted).toEqual([
      { at: `${PARSER}#L2-L3`, state: "moved", now: `${PARSER}#L3-L4` },
    ]);
    expect(moved.sections.at(-1)?.markdown).not.toContain(QUOTED);

    await code(
      "export function parse() {}\nconst two = 20;\nconst three = 3;\n",
    );
    const changed = await read(note);
    expect(changed.quoted).toEqual([
      {
        at: `${PARSER}#L2-L3`,
        state: "changed",
        now: `${PARSER}#L2-L3`,
        says: "const two = 20;\nconst three = 3;",
      },
    ]);
    expect(changed.sections.at(-1)?.markdown).toContain(QUOTED);

    await files.remove(PARSER);
    const removed = await read(note);
    expect(removed.quoted).toEqual([
      { at: `${PARSER}#L2-L3`, state: "removed" },
    ]);
  });

  it("names a moved quote's code where it is now among the places a lean read lands on", async () => {
    const note = await wrote([ASKED]);
    await code(`// a comment\n${SAYS}`);
    const answer = await performChatCall(
      files,
      { call: "c", act: "read_note", arguments: { note } } as ChatToolCall,
      false,
      { landOnCode: true },
    );
    const lean = NoteReadSchema.parse(JSON.parse(answer.said));
    expect(lean.code).toContain(`${PARSER}#L3-L4`);
    expect(lean.code).not.toContain(`${PARSER}#L2-L3`);
  });

  it("says nothing, in a long note's outline, of the quotes in the sections it leaves out", async () => {
    const long = "The parser reads one token at a time. ".repeat(160);
    const note = await wrote([
      `## Constants\n\nThe first:\n\n\`\`\`code:${PARSER}#L2-L2\n\`\`\``,
      `## Why\n\n${long}\n\n\`\`\`code:${PARSER}#L3-L3\n\`\`\``,
    ]);
    await code(
      "export function parse() {}\nconst two = 20;\nconst three = 30;\n",
    );
    const answer = await performChatCall(
      files,
      { call: "c", act: "read_note", arguments: { note } } as ChatToolCall,
      false,
      { landOnCode: true },
    );
    const outlined = NoteReadSchema.parse(JSON.parse(answer.said));
    expect(outlined.outline?.map(({ heading }) => heading)).toEqual(["Why"]);
    expect(outlined.quoted).toEqual([
      expect.objectContaining({ at: `${PARSER}#L2-L2`, state: "changed" }),
    ]);
    expect(outlined.code).toContain(`${PARSER}#L3-L3`);
  });

  it("refreshes a broken quote when it is asked for again", async () => {
    const note = await wrote([ASKED]);
    await code(
      "export function parse() {}\nconst two = 20;\nconst three = 3;\n",
    );
    await wrote([ASKED.replace("The two constants", "Two is now twenty")]);
    const whole = await read(note, "all");
    expect(whole.quoted).toEqual([
      { at: `${PARSER}#L2-L3`, state: "unchanged" },
    ]);
    expect(whole.sections.at(-1)?.markdown).toContain(
      "const two = 20;\nconst three = 3;",
    );
  });

  it("says where each quote a search found stands", async () => {
    await wrote([ASKED]);
    await code(
      "export function parse() {}\nconst two = 20;\nconst three = 3;\n",
    );
    const answer = await done({
      act: "search_notes",
      arguments: { words: "constants", detail: "line" },
    });
    const found = NotesFoundSchema.parse(JSON.parse(answer.said)).found;
    expect(found[0]?.quoted?.map((one) => one.state)).toEqual(["changed"]);
  });
});

const LEXER = "src/lexer.ts";
const UTILS = "src/utils.ts";
const SCAN = "export function scanToken(at: number) {\n  return at + 1;\n}";

describe("a quote whose code moved to another file", () => {
  async function scanQuoted(): Promise<OwnedRef> {
    await code(`export function parse() {}\n${SCAN}\n`);
    await files.write(
      UTILS,
      new TextEncoder().encode("export const one = 1;\n"),
    );
    return wrote([
      `## Scanning\n\nOne token on:\n\n\`\`\`code:${PARSER}#L2-L4\n\`\`\``,
    ]);
  }

  async function moveScan(): Promise<void> {
    await code("export function parse() {}\n");
    await files.write(
      LEXER,
      new TextEncoder().encode(`// Tokens.\n\nconst EOF = -1;\n${SCAN}\n`),
    );
  }

  it("says moved, with the file and lines the code index finds it at", async () => {
    const note = await scanQuoted();
    await moveScan();
    const whole = await read(note, undefined, indexing([PARSER, LEXER, UTILS]));
    expect(whole.quoted).toEqual([
      { at: `${PARSER}#L2-L4`, state: "moved", now: `${LEXER}#L4-L6` },
    ]);
  });

  it("says removed where there is no index to look in", async () => {
    const note = await scanQuoted();
    await moveScan();
    const whole = await read(note);
    expect(whole.quoted?.map((one) => one.state)).toEqual(["removed"]);
  });

  it("finds nothing where another file has the name but not the lines", async () => {
    const note = await scanQuoted();
    await code("export function parse() {}\n");
    await files.write(
      LEXER,
      new TextEncoder().encode(
        "export function scanToken(at: number) {\n  return at + 2;\n}\n",
      ),
    );
    const whole = await read(note, undefined, indexing([PARSER, LEXER, UTILS]));
    expect(whole.quoted?.map((one) => one.state)).toEqual(["removed"]);
  });

  it("looks in the files the index names and nowhere else", async () => {
    await moveScan();
    const looked: string[] = [];
    const project = new Proxy(files, {
      get(target, key) {
        if (key === "read") {
          return (path: string) => {
            looked.push(path);
            return target.read(path);
          };
        }
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const elsewhere = foundElsewhereIn(
      project,
      indexing([PARSER, LEXER, UTILS]),
    );
    const quoted = {
      path: PARSER,
      from: 2,
      to: 4,
      source: SCAN,
      digest: await sha256(SCAN),
    };
    expect(await elsewhere(quoted)).toEqual({ path: LEXER, from: 4, to: 6 });
    expect(looked).not.toContain(UTILS);
    expect(await foundElsewhereIn(files)(quoted)).toBeUndefined();
  });
});
