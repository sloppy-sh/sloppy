import {
  CHAT_TOOL_SPECS,
  CHAT_TOOLS,
  FIELD_LIST,
  FIELD_PAGE,
  headsetOnly,
  type FieldListed,
  LOOK_READ,
  type LookServed,
  type NodeView,
  NotesListedSchema,
  PICTURE_LONGEST,
  PICTURE_READ,
  PROJECTS_LIST,
  SERVE_FIRST_LINE_MS,
} from "@sloppy/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { containerApi } from "./acts.js";
import { MemoryFiles } from "./files.js";
import { body } from "./local.test-support.js";
import {
  fieldPage,
  type McpProject,
  namedProjects,
  NO_LOOK,
  NO_NOTES_HERE,
  NOT_PAIRED,
  NOT_PAIRING,
  PAIR_TOO_LATE,
  type Pairing,
  type PictureShrink,
  type ProjectServed,
  serveMcp,
  serveProjects,
  servingProjects,
  UNPAIRED,
  WRITING_ACTS,
  WRONG_CODE,
} from "./serving.js";

const VERSION = "1.2.3";

function message(
  id: number,
  method: string,
  params?: unknown,
  project?: string,
): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id,
    method,
    ...(params === undefined ? {} : { params }),
    ...(project === undefined ? {} : { project }),
  });
}

function calling(act: string, args: object = {}, id = 1, project?: string) {
  return message(id, "tools/call", { name: act, arguments: args }, project);
}

function came(answer: Record<string, unknown> | undefined): {
  text: string;
  isError: boolean;
} {
  const result = answer?.result as
    | { content: { type: string; text: string }[]; isError: boolean }
    | undefined;
  if (!result) throw new Error(`No result: ${JSON.stringify(answer)}`);
  return { text: result.content[0].text, isError: result.isError };
}

async function aProject(root: string, about: string): Promise<MemoryFiles> {
  const files = new MemoryFiles({ root, data: `${root}-data` });
  await files.write(about, new TextEncoder().encode("export const a = 1;\n"));
  await containerApi(files).openProject(root);
  return files;
}

async function served(project: McpProject, lines: string[]) {
  const answers: Record<string, unknown>[] = [];
  await serveMcp({
    ...project,
    calls: lines,
    answer: (line) => answers.push(JSON.parse(line)),
  });
  return answers;
}

async function servedMany(projects: ProjectServed[], lines: string[]) {
  const answers: Record<string, unknown>[] = [];
  await serveProjects(projects, {
    calls: lines,
    answer: (line) => answers.push(JSON.parse(line)),
  });
  return answers;
}

let one: MemoryFiles;
let two: MemoryFiles;

beforeEach(async () => {
  one = await aProject("/work/one", "src/one.ts");
  two = await aProject("/work/two", "src/two.ts");
  await serveMcp({
    files: two,
    version: VERSION,
    calls: [
      calling("write_note", {
        about: "src/two.ts",
        title: "Only in two",
        sections: ["## Why\n\nIt is the second."],
      }),
    ],
    answer: () => {},
  });
});

describe("the serving loop", () => {
  it("takes a notification and answers nothing", async () => {
    const answers = await served({ files: one, version: VERSION }, [
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      message(2, "ping"),
    ]);

    expect(answers).toEqual([{ jsonrpc: "2.0", id: 2, result: {} }]);
  });

  it("answers a line that is not a message with a parse error", async () => {
    const answers = await served({ files: one, version: VERSION }, [
      "this is not json",
      "[1,2]",
    ]);

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
    const answers = await served({ files: one, version: VERSION }, [
      message(4, "resources/list"),
    ]);

    expect(answers[0]).toMatchObject({ id: 4, error: { code: -32601 } });
  });

  it("answers each message in the order it came", async () => {
    const answers = await served({ files: one, version: VERSION }, [
      calling("list_notes", {}, 1),
      message(2, "ping"),
      calling("list_tags", {}, 3),
    ]);

    expect(answers.map((answer) => answer.id)).toEqual([1, 2, 3]);
  });

  it("answers every call in a folder with no notes with how to start them", async () => {
    const answers = await served({ version: VERSION }, [
      calling("list_notes", {}, 1),
    ]);

    expect(came(answers[0])).toEqual({ text: NO_NOTES_HERE, isError: true });
  });
});

describe("several projects served read-only", () => {
  const both = (): ProjectServed[] => [
    { id: "a", name: "One", server: { files: one, version: VERSION } },
    { id: "b", name: "Two", server: { files: two, version: VERSION } },
  ];

  const titles = (answer: Record<string, unknown> | undefined) =>
    NotesListedSchema.parse(JSON.parse(came(answer).text)).notes.map(
      (note) => note.title,
    );

  it("lists what it serves, in order", async () => {
    const answers = await servedMany(both(), [message(1, PROJECTS_LIST)]);

    expect(answers).toEqual([
      {
        jsonrpc: "2.0",
        id: 1,
        result: {
          projects: [
            { id: "a", name: "One" },
            { id: "b", name: "Two" },
          ],
        },
      },
    ]);
  });

  it("asks the project a message names, and the first where it names none", async () => {
    const answers = await servedMany(both(), [
      calling("list_notes", {}, 1),
      calling("list_notes", {}, 2, "b"),
      calling("list_notes", {}, 3, "a"),
    ]);
    const byId = new Map(answers.map((answer) => [answer.id, answer]));

    expect(titles(byId.get(1))).not.toContain("Only in two");
    expect(titles(byId.get(2))).toContain("Only in two");
    expect(titles(byId.get(3))).toEqual(titles(byId.get(1)));
  });

  it("refuses a project it does not serve, in words", async () => {
    const answers = await servedMany(both(), [
      calling("list_notes", {}, 7, "elsewhere"),
    ]);

    expect(answers[0]).toMatchObject({
      id: 7,
      error: {
        code: -32602,
        message: expect.stringContaining("projects/list"),
      },
    });
  });

  it("leaves out every act that writes, neither offered nor answered", async () => {
    expect(WRITING_ACTS).toEqual(
      CHAT_TOOLS.filter((act) => CHAT_TOOL_SPECS[act].writes),
    );
    expect(WRITING_ACTS).toContain("write_note");

    const answers = await servedMany(both(), [
      message(1, "tools/list", undefined, "b"),
      calling(
        "write_note",
        { about: "src/two.ts", sections: ["## Why\n\nAgain."] },
        2,
        "b",
      ),
      calling("list_notes", {}, 3, "b"),
    ]);
    const byId = new Map(answers.map((answer) => [answer.id, answer]));
    const names = (
      byId.get(1)?.result as { tools: { name: string }[] }
    ).tools.map((tool) => tool.name);

    expect(names).toEqual(
      CHAT_TOOLS.filter(
        (act) => !WRITING_ACTS.includes(act) && !headsetOnly(act),
      ),
    );
    expect(came(byId.get(2)).isError).toBe(true);
    expect(titles(byId.get(3))).toEqual(["Only in two"]);
  });

  it("answers each project's lines in order, and each to the caller that asked", async () => {
    const serving = servingProjects(both());
    const first: number[] = [];
    const second: number[] = [];
    const id = (line: string) => JSON.parse(line).id as number;

    serving.take(calling("list_notes", {}, 1, "a"), (line) =>
      first.push(id(line)),
    );
    serving.take(message(2, "ping", undefined, "b"), (line) =>
      second.push(id(line)),
    );
    serving.take(calling("list_tags", {}, 3, "a"), (line) =>
      first.push(id(line)),
    );
    serving.take(message(4, "ping", undefined, "a"), (line) =>
      second.push(id(line)),
    );
    await serving.settled();

    expect(first).toEqual([1, 3]);
    expect(second).toEqual([2, 4]);
  });
});

describe("projects named for a caller", () => {
  it("are named by what they are called, a second of a name told apart", () => {
    const server = { version: VERSION };
    expect(
      namedProjects([
        { name: "notes", server },
        { name: "garden", server },
        { name: "notes", server },
        { name: "notes", server },
      ]).map(({ id, name }) => ({ id, name })),
    ).toEqual([
      { id: "notes", name: "notes" },
      { id: "garden", name: "garden" },
      { id: "notes-2", name: "notes" },
      { id: "notes-3", name: "notes" },
    ]);
  });
});

describe("a folder served read-only", () => {
  it("holding no graph is left as it was", async () => {
    const store = new Map<string, Uint8Array>();
    const bare = new MemoryFiles({ root: "/work/bare", data: "/data", store });
    await bare.write("src/a.ts", new TextEncoder().encode("export {};\n"));
    const before = new Map(store);

    const answers = await servedMany(
      [{ id: "bare", name: "bare", server: { files: bare, version: VERSION } }],
      [calling("list_notes", {}, 1), calling("read_graph", {}, 2)],
    );

    expect(answers).toHaveLength(2);
    expect([...store.keys()].sort()).toEqual([...before.keys()].sort());
  });
});

describe("the field a headset reads", () => {
  async function aField(count: number): Promise<MemoryFiles> {
    const files = await aProject("/work/field", "src/field.ts");
    const api = containerApi(files);
    let branch = await api.createNode({ title: "Note 0" });
    for (let at = 1; at < count; at++) {
      const note = await api.createNode({
        from: { relation: "under", note: branch.ref },
        title: `Note ${at}`,
        tags: at % 2 === 0 ? ["even"] : [],
      });
      if (at % 10 === 0) branch = note;
    }
    return files;
  }

  it("answers every note of a 300-note graph in one answer", async () => {
    const files = await aField(300);
    const api = containerApi(files);
    const [first] = await api.listNodes({});
    const [second] = (await api.listNodes({ origin: first.ref })).filter(
      (note) => note.parent === first.ref,
    );
    await api.updateNode(first.ref, {
      links: [second.ref],
      edges: [{ to: second.ref, label: "leads to", direction: "to" }],
    });

    const answers = await servedMany(
      [{ id: "f", name: "Field", server: { files, version: VERSION } }],
      [message(1, FIELD_LIST, { project: "f" })],
    );

    expect(answers).toHaveLength(1);
    const listed = answers[0].result as FieldListed;
    expect(listed.notes).toHaveLength(300);
    expect(listed.next).toBeUndefined();
    expect(new Set(listed.notes.map((note) => note.note)).size).toBe(300);
    expect(listed.notes.find((note) => note.note === first.ref)).toMatchObject({
      title: "Note 0",
      links: [{ to: second.ref, label: "leads to", direction: "to" }],
    });
    expect(listed.notes.filter((note) => note.parent).length).toBe(299);
  });

  it("pages a graph past the most one answer carries", () => {
    const notes = Array.from(
      { length: FIELD_PAGE + 3 },
      (_, at) =>
        ({
          ref: `did:key:z6Mk/${String(at).padStart(26, "0")}`,
          title: "",
          tags: [],
          links: [],
        }) as unknown as NodeView,
    );

    const first = fieldPage(notes);
    const rest = fieldPage(notes, first.next);

    expect(first.notes).toHaveLength(FIELD_PAGE);
    expect(first.next).toBe(first.notes[FIELD_PAGE - 1].note);
    expect(rest.notes).toHaveLength(3);
    expect(rest.next).toBeUndefined();
  });

  it("is refused to a headset not paired", async () => {
    const answers: Record<string, unknown>[] = [];
    let closed = false;
    await serveProjects(
      namedProjects([
        { name: "garden", server: { version: VERSION, files: one } },
      ]),
      {
        connection: "c1",
        calls: [message(1, FIELD_LIST, { project: "garden" })],
        answer: (line) => answers.push(JSON.parse(line)),
        close: () => {
          closed = true;
        },
      },
      { code: () => "042917", paired: () => false, pairs: () => {} },
    );

    expect(answers).toEqual([
      {
        jsonrpc: "2.0",
        id: 1,
        error: { code: UNPAIRED, message: NOT_PAIRED, data: { pairing: true } },
      },
    ]);
    expect(closed).toBe(true);
  });
});

describe("the look a headset reads", () => {
  const GRAPHITE: LookServed = {
    name: "Graphite",
    based_on: "graphite",
    style: "hardline",
    density: "compact",
    effect: [],
    fonts: { ui: "atkinson", heading: "system", mono: "system" },
  };

  function garden() {
    return namedProjects([
      { name: "garden", server: { version: VERSION, files: one } },
    ]);
  }

  it("is what the desk is wearing when it is asked", async () => {
    let wearing = GRAPHITE;
    const serving = servingProjects(garden(), { look: () => wearing });
    const answers: Record<string, unknown>[] = [];
    const answer = (line: string) => answers.push(JSON.parse(line));

    serving.take(message(1, LOOK_READ), answer);
    await serving.settled();
    wearing = { ...GRAPHITE, name: "Paper", based_on: "paper" };
    serving.take(message(2, LOOK_READ, undefined, "nowhere"), answer);
    await serving.settled();

    expect(answers).toEqual([
      { jsonrpc: "2.0", id: 1, result: GRAPHITE },
      {
        jsonrpc: "2.0",
        id: 2,
        result: { ...GRAPHITE, name: "Paper", based_on: "paper" },
      },
    ]);
  });

  it("is said not to be shared where nothing serves one", async () => {
    const answers = await servedMany(garden(), [message(1, LOOK_READ)]);

    expect(answers).toEqual([
      { jsonrpc: "2.0", id: 1, error: { code: -32601, message: NO_LOOK } },
    ]);
  });

  it("is refused to a headset not paired, and never asked for", async () => {
    const answers: Record<string, unknown>[] = [];
    const look = vi.fn(() => GRAPHITE);
    await serveProjects(
      garden(),
      {
        connection: "c1",
        calls: [message(1, LOOK_READ)],
        answer: (line) => answers.push(JSON.parse(line)),
        close: () => {},
      },
      { code: () => "042917", paired: () => false, pairs: () => {} },
      { look },
    );

    expect(answers).toEqual([
      {
        jsonrpc: "2.0",
        id: 1,
        error: { code: UNPAIRED, message: NOT_PAIRED, data: { pairing: true } },
      },
    ]);
    expect(look).not.toHaveBeenCalled();
  });

  it("is read by a paired headset", async () => {
    const answers: Record<string, unknown>[] = [];
    await serveProjects(
      garden(),
      {
        connection: "c1",
        calls: [message(1, LOOK_READ)],
        answer: (line) => answers.push(JSON.parse(line)),
        close: () => {},
      },
      { code: () => "042917", paired: () => true, pairs: () => {} },
      { look: async () => GRAPHITE },
    );

    expect(answers).toEqual([{ jsonrpc: "2.0", id: 1, result: GRAPHITE }]);
  });
});

describe("a headset pairing", () => {
  const CODE = "042917";

  /** A desk showing `shown`, or no code where it is null, which spends it on
   *  the first headset to pair by it, and tells which connections paired. */
  function desk(shown: string | null = CODE) {
    let code = shown ?? undefined;
    const pairs: string[] = [];
    const pairing: Pairing = {
      code: () => code,
      paired: () => false,
      pairs: (connection, name) => {
        code = undefined;
        pairs.push(name === undefined ? connection : `${connection} ${name}`);
      },
    };
    return { pairing, pairs };
  }

  /** One connection's lines, what it was answered, whether it was closed,
   *  and which connections the transport was told paired. */
  async function connected(
    lines: string[],
    pairedBefore = false,
    at = desk(),
    connection = "c1",
  ): Promise<{
    answers: Record<string, unknown>[];
    closed: boolean;
    pairs: string[];
  }> {
    const answers: Record<string, unknown>[] = [];
    let closed = false;
    await serveProjects(
      namedProjects([
        { name: "garden", server: { version: VERSION, files: one } },
      ]),
      {
        connection,
        calls: lines,
        answer: (line) => answers.push(JSON.parse(line)),
        close: () => {
          closed = true;
        },
      },
      { ...at.pairing, paired: () => pairedBefore },
    );
    return { answers, closed, pairs: at.pairs };
  }

  it("is let in by the code as its first line, and remembered", async () => {
    const { answers, closed, pairs } = await connected([
      message(1, "pair", { code: CODE, name: " Quest " }),
      message(2, PROJECTS_LIST),
    ]);

    expect(answers[0]).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: { paired: true },
    });
    expect(answers[1]).toMatchObject({
      id: 2,
      result: { projects: [{ id: "garden" }] },
    });
    expect(closed).toBe(false);
    expect(pairs).toEqual(["c1 Quest"]);
  });

  it("is told it paired only once the headset is remembered", async () => {
    const happened: string[] = [];
    await serveProjects(
      namedProjects([{ name: "garden", server: { version: VERSION } }]),
      {
        connection: "c1",
        calls: [message(1, "pair", { code: CODE })],
        answer: () => happened.push("answered"),
        close: () => {},
      },
      {
        code: () => CODE,
        paired: () => false,
        pairs: async () => {
          await new Promise((settle) => setTimeout(settle, 5));
          happened.push("remembered");
        },
      },
    );

    expect(happened).toEqual(["remembered", "answered"]);
  });

  it("is refused in words and let go on the wrong code, and nothing after it is read", async () => {
    const { answers, closed, pairs } = await connected([
      message(1, "pair", { code: "000000" }),
      message(2, PROJECTS_LIST),
    ]);

    expect(answers).toEqual([
      { jsonrpc: "2.0", id: 1, error: { code: UNPAIRED, message: WRONG_CODE } },
    ]);
    expect(closed).toBe(true);
    expect(pairs).toEqual([]);
  });

  it("is refused in words when its first line asks for anything else", async () => {
    const { answers, closed } = await connected([message(1, PROJECTS_LIST)]);

    expect(answers).toEqual([
      {
        jsonrpc: "2.0",
        id: 1,
        error: { code: UNPAIRED, message: NOT_PAIRED, data: { pairing: true } },
      },
    ]);
    expect(closed).toBe(true);
  });

  it("is told to ask the desk for a code where it is showing none", async () => {
    const { answers, closed } = await connected(
      [message(1, PROJECTS_LIST)],
      false,
      desk(null),
    );

    expect(answers).toEqual([
      {
        jsonrpc: "2.0",
        id: 1,
        error: {
          code: UNPAIRED,
          message: NOT_PAIRING,
          data: { pairing: false },
        },
      },
    ]);
    expect(closed).toBe(true);
  });

  it("is refused as a wrong code is where the desk shows none", async () => {
    const { answers, pairs } = await connected(
      [message(1, "pair", { code: CODE })],
      false,
      desk(null),
    );

    expect(answers).toEqual([
      { jsonrpc: "2.0", id: 1, error: { code: UNPAIRED, message: WRONG_CODE } },
    ]);
    expect(pairs).toEqual([]);
  });

  it("pairs one headset by a code, and the next is refused it", async () => {
    const shown = desk();
    const first = await connected(
      [message(1, "pair", { code: CODE })],
      false,
      shown,
      "c1",
    );
    const second = await connected(
      [message(1, "pair", { code: CODE })],
      false,
      shown,
      "c2",
    );

    expect(first.answers[0]).toMatchObject({ result: { paired: true } });
    expect(second.answers[0]).toMatchObject({
      error: { code: UNPAIRED, message: WRONG_CODE },
    });
    expect(shown.pairs).toEqual(["c1"]);
  });

  it("needs no code once paired before", async () => {
    const { answers, closed, pairs } = await connected(
      [message(1, PROJECTS_LIST)],
      true,
    );

    expect(answers[0]).toMatchObject({
      id: 1,
      result: { projects: [{ id: "garden" }] },
    });
    expect(closed).toBe(false);
    expect(pairs).toEqual([]);
  });

  it("is let go when the code does not come in time", async () => {
    vi.useFakeTimers();
    try {
      let send: (line: string) => void = () => {};
      let end: () => void = () => {};
      const lines = (async function* () {
        while (true) {
          const line = await new Promise<string | null>((done) => {
            send = done;
            end = () => done(null);
          });
          if (line === null) return;
          yield line;
        }
      })();
      const answers: Record<string, unknown>[] = [];
      let closed = false;
      const serving = serveProjects(
        namedProjects([{ name: "garden", server: { version: VERSION } }]),
        {
          connection: "c1",
          calls: lines,
          answer: (line) => answers.push(JSON.parse(line)),
          close: () => {
            closed = true;
            end();
          },
        },
        { code: () => CODE, paired: () => false, pairs: () => {} },
      );
      await vi.advanceTimersByTimeAsync(SERVE_FIRST_LINE_MS + 1);
      send(message(1, "pair", { code: CODE }));
      await serving;

      expect(closed).toBe(true);
      expect(answers).toEqual([
        {
          jsonrpc: "2.0",
          id: null,
          error: { code: UNPAIRED, message: PAIR_TOO_LATE },
        },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the picture a mark wears", () => {
  const LOGO = new Uint8Array([137, 80, 78, 71]);

  /** Answers the bytes it was given with one more, at the size it was asked for. */
  const shrink: PictureShrink = async (bytes, _mime, longest) => ({
    png: new Uint8Array([...bytes, 9]),
    width: longest,
    height: longest / 2,
  });

  async function aPictured() {
    const files = await aProject("/work/pictured", "src/logo.ts");
    const api = containerApi(files);
    const plain = await api.createNode({ title: "Plain" });
    const worn = await api.createNode({ title: "Logo" });
    const ticket = await api.createUpload({
      role: "block",
      filename: "logo.png",
      mime_type: "image/png",
      size: LOGO.byteLength,
    });
    await api.sendUpload(ticket, body(LOGO));
    await api.completeUpload({ upload_id: ticket.upload_id });
    await api.updateNode(worn.ref, {
      appearance: { preview: ticket.upload_id },
    });
    return { files, worn: worn.ref, plain: plain.ref };
  }

  function asked(server: McpProject, lines: string[]) {
    return servedMany([{ id: "pictured", name: "pictured", server }], lines);
  }

  it("answers a pictured note's picture made small, and says in the field which notes wear one", async () => {
    const { files, worn, plain } = await aPictured();
    const [listed, picture] = await asked({ files, version: VERSION, shrink }, [
      message(1, FIELD_LIST),
      message(2, PICTURE_READ, { note: worn }),
    ]);

    const notes = (listed.result as FieldListed).notes;
    expect(notes.find((note) => note.note === worn)?.picture).toBe(true);
    expect(notes.find((note) => note.note === plain)?.picture).toBeUndefined();
    const said = picture.result as {
      picture: string;
      width: number;
      height: number;
    };
    expect(
      [...atob(said.picture)].map((letter) => letter.charCodeAt(0)),
    ).toEqual([...LOGO, 9]);
    expect(Math.max(said.width, said.height)).toBeLessThanOrEqual(
      PICTURE_LONGEST,
    );
  });

  it("answers null for a note that wears none, or one it is not", async () => {
    const { files, plain } = await aPictured();
    const answers = await asked({ files, version: VERSION, shrink }, [
      message(1, PICTURE_READ, { note: plain }),
      message(2, PICTURE_READ, { note: "not a note" }),
      message(3, PICTURE_READ, {}),
    ]);

    expect(answers.map((answer) => answer.result)).toEqual([
      { picture: null },
      { picture: null },
      { picture: null },
    ]);
  });

  it("answers null where nothing here can make it small enough", async () => {
    const { files, worn } = await aPictured();
    const larger: PictureShrink = async (bytes) => ({
      png: bytes,
      width: PICTURE_LONGEST + 1,
      height: 10,
    });
    const answers = [
      ...(await asked({ files, version: VERSION }, [
        message(1, PICTURE_READ, { note: worn }),
      ])),
      ...(await asked({ files, version: VERSION, shrink: larger }, [
        message(2, PICTURE_READ, { note: worn }),
      ])),
    ];

    expect(answers.map((answer) => answer.result)).toEqual([
      { picture: null },
      { picture: null },
    ]);
  });

  it("is refused to a headset not paired", async () => {
    const { files, worn } = await aPictured();
    const answers: Record<string, unknown>[] = [];
    await serveProjects(
      namedProjects([
        { name: "pictured", server: { version: VERSION, files, shrink } },
      ]),
      {
        connection: "c1",
        calls: [message(1, PICTURE_READ, { note: worn })],
        answer: (line) => answers.push(JSON.parse(line)),
        close: () => {},
      },
      { code: () => "042917", paired: () => false, pairs: () => {} },
    );

    expect(answers).toEqual([
      {
        jsonrpc: "2.0",
        id: 1,
        error: { code: UNPAIRED, message: NOT_PAIRED, data: { pairing: true } },
      },
    ]);
  });
});

describe("a headset not paired while no code is shown", () => {
  it.each([
    PROJECTS_LIST,
    FIELD_LIST,
    LOOK_READ,
    PICTURE_READ,
  ])("is refused %s, and nothing is asked", async (method) => {
    const answers: Record<string, unknown>[] = [];
    const look = vi.fn(() => {
      throw new Error("asked");
    });
    const shrink = vi.fn<PictureShrink>(() => {
      throw new Error("asked");
    });
    let closed = false;
    await serveProjects(
      namedProjects([
        { name: "garden", server: { version: VERSION, files: one, shrink } },
      ]),
      {
        connection: "c1",
        calls: [message(1, method, { project: "garden", note: "x" })],
        answer: (line) => answers.push(JSON.parse(line)),
        close: () => {
          closed = true;
        },
      },
      { code: () => undefined, paired: () => false, pairs: () => {} },
      { look },
    );

    expect(answers).toEqual([
      {
        jsonrpc: "2.0",
        id: 1,
        error: {
          code: UNPAIRED,
          message: NOT_PAIRING,
          data: { pairing: false },
        },
      },
    ]);
    expect(closed).toBe(true);
    expect(look).not.toHaveBeenCalled();
    expect(shrink).not.toHaveBeenCalled();
  });
});
