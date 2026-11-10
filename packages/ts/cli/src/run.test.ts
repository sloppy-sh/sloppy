import { AGENT_MD, containerDataAt, MemoryFiles } from "@sloppy/local";
import { encodeText, graphFile, type VaultGraph } from "@sloppy/vault";
import type { Window, WindowAsk } from "@sloppy/types";
import { describe, expect, it } from "vitest";
import {
  FINE,
  NOTHING_DONE,
  parse,
  run,
  running,
  type RunningWith,
  TO_FIX,
} from "./run.js";

const DID = "did:syr:z6MktEXAMPLEEXAMPLEEXAMPLEEXAMPLE";
const A = "01J0000000000000000000000A";
const BLOCK = "01J000000000000000000000B1";

const SAID: VaultGraph = {
  format: 1,
  graph: "01J000000000000000000000GR",
  name: "A project",
  owner: DID,
  project: "..",
};

function note(body: string): string {
  return [
    "---",
    `ref: ${DID}/${A}`,
    "title: A note",
    "---",
    "",
    `<!-- block ${BLOCK} -->`,
    "",
    body,
    "",
  ].join("\n");
}

interface Ran {
  code: number;
  out: string[];
  err: string[];
}

async function ran(argv: string[], files: MemoryFiles): Promise<Ran> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(argv, {
    cwd: "/project",
    told: { out: (line) => out.push(line), err: (line) => err.push(line) },
    filesAt: (root) => files.at(root),
  });
  return { code, out, err };
}

async function wrote(body: string): Promise<MemoryFiles> {
  const root = new MemoryFiles({ root: "/" });
  const container = root.at("/project/.sloppy");
  await container.write("graph.json", graphFile(SAID));
  await container.write(`notes/${A}.md`, encodeText(note(body)));
  return root;
}

describe("sloppy", () => {
  it("checks the folder it was run in", async () => {
    const { code, out } = await ran(["check"], await wrote("Nothing to see."));
    expect(code).toBe(FINE);
    expect(out).toEqual(["1 note read. Nothing to fix."]);
  });

  it("lists what doesn't hold, and says so in its exit code", async () => {
    const files = await wrote("[gone](code:src/gone.ts)");
    const { code, out } = await ran(["check", "/project"], files);
    expect(code).toBe(TO_FIX);
    expect(out).toEqual([
      `notes/${A}.md: Points at code that isn't there: src/gone.ts`,
    ]);
  });

  it("answers in JSON where it was asked to", async () => {
    const files = await wrote("[gone](code:src/gone.ts)");
    const { code, out } = await ran(["check", "--json"], files);
    expect(code).toBe(TO_FIX);
    expect(JSON.parse(out[0])).toEqual({
      command: "check",
      notes: 1,
      defects: [
        {
          kind: "missing-code",
          file: `notes/${A}.md`,
          note: `${DID}/${A}`,
          said: "Points at code that isn't there: src/gone.ts",
        },
      ],
    });
  });

  it("says a folder with no notes in it has none, and does nothing", async () => {
    const { code, err } = await ran(["check"], new MemoryFiles({ root: "/" }));
    expect(code).toBe(NOTHING_DONE);
    expect(err).toEqual(["There are no notes in that folder yet."]);
  });

  it("answers in JSON where a run read nothing", async () => {
    const { code, out, err } = await ran(
      ["check", "--json"],
      new MemoryFiles({ root: "/" }),
    );
    expect(code).toBe(NOTHING_DONE);
    expect(err).toEqual([]);
    expect(JSON.parse(out[0])).toEqual({
      command: "check",
      said: "There are no notes in that folder yet.",
    });
  });

  it("says a folder it cannot read in words a person can act on", async () => {
    const files = new MemoryFiles({ root: "/" });
    await files.at("/project/.sloppy").write("graph.json", encodeText("{"));
    const { code, err } = await ran(["check"], files);
    expect(code).toBe(NOTHING_DONE);
    expect(err).toEqual(["This file isn't a Sloppy graph."]);
  });

  it("says a folder with no notes in it has none, whatever was asked of it", async () => {
    for (const argv of [["check"], ["draft", "a.ts"]]) {
      const { code, err } = await ran(argv, new MemoryFiles({ root: "/" }));
      expect(code).toBe(NOTHING_DONE);
      expect(err).toEqual(["There are no notes in that folder yet."]);
    }
    const { out } = await ran(
      ["draft", "a.ts", "--json"],
      new MemoryFiles({ root: "/" }),
    );
    expect(JSON.parse(out[0])).toEqual({
      command: "draft",
      said: "There are no notes in that folder yet.",
    });
  });

  it("says what it can do where nobody said", async () => {
    const { code, out } = await ran([], new MemoryFiles());
    expect(code).toBe(NOTHING_DONE);
    expect(out[0]).toContain("sloppy");
    expect(out.join("\n")).toContain("sloppy check [dir]");
  });

  it("says when there is no such command", async () => {
    const { code, err } = await ran(["publish"], new MemoryFiles());
    expect(code).toBe(NOTHING_DONE);
    expect(err).toEqual(["No such command: publish"]);
  });

  it("takes --help on a command", async () => {
    const { code, out } = await ran(["check", "--help"], new MemoryFiles());
    expect(code).toBe(FINE);
    expect(out.join("\n")).toContain("--json");
  });

  it("writes as the identity the container keeps, wherever it is run from", async () => {
    const asked: { root: string; data: string }[] = [];
    const files = await wrote("Nothing to see.");
    await run(["check", "/project"], {
      cwd: "/somewhere/else",
      told: { out: () => {}, err: () => {} },
      filesAt: (root, data) => {
        asked.push({ root, data });
        return files.at(root);
      },
    });
    expect(asked.length).toBeGreaterThan(0);
    for (const { root, data } of asked) {
      expect(data).toBe(containerDataAt(root));
    }
  });
});

const KEY = "sk-test-a-key-for-the-run-command";
const WINDOW: Window = {
  parts: [
    {
      kind: "instructions",
      path: "AGENT.md",
      tokens: 4,
      text: "The reasons are in the notes.",
    },
  ],
  budget: 16_000,
  cut: [],
};

/** A provider answering each request with the next reply. */
function replying(replies: unknown[][]): {
  fetch: typeof globalThis.fetch;
  bodies: { messages: { content: unknown }[] }[];
} {
  const bodies: { messages: { content: unknown }[] }[] = [];
  const fetch = (async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(init.body as string));
    return new Response(
      JSON.stringify({
        content: replies[bodies.length - 1] ?? [],
        usage: { input_tokens: 1000, output_tokens: 100 },
      }),
    );
  }) as typeof globalThis.fetch;
  return { fetch, bodies };
}

async function ranAsking(
  argv: string[],
  files: MemoryFiles,
  using: RunningWith,
): Promise<Ran> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await running(
    parse(["run", ...argv]),
    {
      cwd: "/project",
      told: { out: (line) => out.push(line), err: (line) => err.push(line) },
      filesAt: (root) => files.at(root),
    },
    argv.includes("--json"),
    using,
  );
  return { code, out, err };
}

describe("sloppy run", () => {
  const asks: WindowAsk[] = [];
  const compose = () => async (ask: WindowAsk) => {
    asks.push(ask);
    return WINDOW;
  };
  const env = { ANTHROPIC_API_KEY: KEY };

  it("puts the ask to the model, says each act as it happens, and ends on the answer", async () => {
    const { fetch, bodies } = replying([
      [{ type: "tool_use", id: "t1", name: "list_notes", input: {} }],
      [{ type: "text", text: "One note, about nothing yet." }],
    ]);

    const { code, out } = await ranAsking(
      ["what", "is", "here?"],
      await wrote("Nothing to see."),
      { compose, env, fetch },
    );

    expect(code).toBe(FINE);
    expect(asks.at(-1)?.ask).toBe("what is here?");
    expect(bodies[0].messages[0].content).toBe(
      "what is here?\n\nThe reasons are in the notes.",
    );
    expect(out[0]).toBe("  Reading the notes");
    expect(out).toContain("One note, about nothing yet.");
    expect(out.join("\n")).not.toContain(KEY);
  });

  it("gathers the window from the project's own notes when none is handed it", async () => {
    const { fetch, bodies } = replying([[{ type: "text", text: "Done." }]]);

    const { code } = await ranAsking(
      ["why", "is", "quince", "the", "stock?"],
      await wrote("Quince stock keeps the apple tree small."),
      { env, fetch },
    );

    expect(code).toBe(FINE);
    const first = bodies[0].messages[0].content as string;
    expect(first.startsWith("why is quince the stock?\n\n")).toBe(true);
    expect(first).toContain("Quince stock keeps the apple tree small.");
    expect(first).toContain(AGENT_MD.split("\n\n")[1].replaceAll("\n", " "));
  });

  it("exits non-zero when it stops before answering", async () => {
    const asking = [
      { type: "tool_use", id: "t", name: "list_tags", input: {} },
    ];
    const { fetch } = replying([asking, asking]);

    const { code, out } = await ranAsking(
      ["tidy", "up", "--turns", "1"],
      await wrote("Nothing to see."),
      { compose, env, fetch },
    );

    expect(code).toBe(TO_FIX);
    expect(out.at(-2)).toContain("Give it more with --turns.");
  });

  it("names the option that is wrong, and not the one beside it", async () => {
    const { code, err } = await ranAsking(
      ["why?", "--turns", "abc", "--budget", "1"],
      await wrote("Nothing."),
      { compose, env },
    );

    expect(code).toBe(NOTHING_DONE);
    expect(err).toEqual(["Say the most turns to take: --turns 10."]);
  });

  it("says a run that cost under a cent did not cost nothing", async () => {
    const { fetch } = replying([[{ type: "text", text: "Done." }]]);

    const { out } = await ranAsking(["why?"], await wrote("Nothing."), {
      compose,
      env,
      fetch,
    });

    expect(out.at(-1)).toBe("It cost under a cent.");
  });

  it("asks for the key by where it is read from, and calls nothing without one", async () => {
    const { fetch, bodies } = replying([]);

    const { code, err } = await ranAsking(["why?"], await wrote("Nothing."), {
      compose,
      env: {},
      fetch,
    });

    expect(code).toBe(NOTHING_DONE);
    expect(err).toEqual([
      "Set ANTHROPIC_API_KEY in the environment to run with this provider.",
    ]);
    expect(bodies).toHaveLength(0);
  });

  it("answers the whole run in JSON, with no key on it", async () => {
    const { fetch } = replying([[{ type: "text", text: "Done." }]]);

    const { out } = await ranAsking(
      ["why?", "--json"],
      await wrote("Nothing."),
      {
        compose,
        env,
        fetch,
      },
    );

    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0])).toMatchObject({
      command: "run",
      stop: "answered",
    });
    expect(out[0]).not.toContain(KEY);
  });

  it("says what to do where it is given no ask", async () => {
    const { code, err } = await ran(["run"], await wrote("Nothing."));
    expect(code).toBe(NOTHING_DONE);
    expect(err[0]).toMatch(/^Say what to do/);
  });
});
