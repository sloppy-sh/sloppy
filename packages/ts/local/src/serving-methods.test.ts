import { CHAT_SAY, PROJECTS_LIST, SERVE_REFUSALS } from "@sloppy/types";
import { describe, expect, it } from "vitest";
import { containerApi } from "./acts.js";
import { MemoryFiles } from "./files.js";
import {
  namedProjects,
  type ServeMethod,
  ServeRefused,
  servingProjects,
} from "./serving.js";

const VERSION = "1.2.3";

function message(
  id: number | undefined,
  method: string,
  params?: unknown,
  project?: string,
) {
  return JSON.stringify({
    jsonrpc: "2.0",
    ...(id === undefined ? {} : { id }),
    method,
    ...(params === undefined ? {} : { params }),
    ...(project === undefined ? {} : { project }),
  });
}

async function aProject(root: string): Promise<MemoryFiles> {
  const files = new MemoryFiles({ root, data: `${root}-data` });
  await files.write(
    "src/a.ts",
    new TextEncoder().encode("export const a = 1;\n"),
  );
  await containerApi(files).openProject(root);
  return files;
}

async function garden() {
  return namedProjects([
    {
      name: "garden",
      server: { version: VERSION, files: await aProject("/work/garden") },
    },
    {
      name: "orchard",
      server: { version: VERSION, files: await aProject("/work/orchard") },
    },
  ]);
}

/** A method that answers once it is let go, saying which project it was asked of. */
function held(queued: boolean) {
  let letGo = () => {};
  const waiting = new Promise<void>((done) => {
    letGo = done;
  });
  const method: ServeMethod = {
    queued,
    handle: async (params, project) => {
      await waiting;
      return { project: project.id, params };
    },
  };
  return { method, letGo: () => letGo() };
}

describe("a method a track adds to the table", () => {
  it("is answered with what it resolves, for the project the line names", async () => {
    const asked: string[] = [];
    const serving = servingProjects(await garden(), {
      methods: {
        "echo/one": {
          queued: true,
          handle: async (params, project, connection) => {
            asked.push(connection.id);
            return { project: project.id, said: params.said };
          },
        },
      },
    });
    const answers: unknown[] = [];

    serving.take(
      message(1, "echo/one", { said: "hi" }, "orchard"),
      (line) => answers.push(JSON.parse(line)),
      "7",
    );
    serving.take(
      message(2, "echo/one", {}, "nowhere"),
      (line) => answers.push(JSON.parse(line)),
      "7",
    );
    await serving.settled();

    expect(answers).toEqual([
      expect.objectContaining({
        id: 2,
        error: expect.objectContaining({ code: -32602 }),
      }),
      { jsonrpc: "2.0", id: 1, result: { project: "orchard", said: "hi" } },
    ]);
    expect(asked).toEqual(["7"]);
  });

  it("refuses in the words it refused with, and answers anything else it throws as a failure", async () => {
    const serving = servingProjects(await garden(), {
      methods: {
        "no/speech": {
          queued: false,
          handle: async () => {
            throw new ServeRefused(
              SERVE_REFUSALS.NO_SPEECH,
              "No speech here.",
              { why: 1 },
            );
          },
        },
        "it/broke": {
          queued: false,
          handle: async () => {
            throw new Error("internal");
          },
        },
      },
    });
    const answers: Record<string, unknown>[] = [];
    const answer = (line: string) => answers.push(JSON.parse(line));

    serving.take(message(1, "no/speech"), answer);
    serving.take(message(2, "it/broke"), answer);
    await serving.settled();

    expect(answers).toEqual([
      {
        jsonrpc: "2.0",
        id: 1,
        error: {
          code: SERVE_REFUSALS.NO_SPEECH,
          message: "No speech here.",
          data: { why: 1 },
        },
      },
      {
        jsonrpc: "2.0",
        id: 2,
        error: {
          code: -32603,
          message: expect.not.stringContaining("internal"),
        },
      },
    ]);
  });

  it("answers an unqueued method while a queued line of the same project still waits", async () => {
    const slow = held(true);
    const quick = held(false);
    const serving = servingProjects(await garden(), {
      methods: { "slow/one": slow.method, "quick/one": quick.method },
    });
    const order: number[] = [];
    const answer = (line: string) => order.push(JSON.parse(line).id);

    serving.take(message(1, "slow/one"), answer);
    serving.take(message(2, "field/list"), answer);
    serving.take(message(3, "quick/one"), answer);
    quick.letGo();
    await new Promise((done) => setTimeout(done, 10));
    expect(order).toEqual([3]);

    slow.letGo();
    await serving.settled();
    expect(order).toEqual([3, 1, 2]);
  });

  it("never replaces a method every loop answers", async () => {
    const serving = servingProjects(await garden(), {
      methods: {
        [PROJECTS_LIST]: { queued: false, handle: async () => "mine" },
      },
    });
    const answers: Record<string, unknown>[] = [];

    serving.take(message(1, PROJECTS_LIST), (line) =>
      answers.push(JSON.parse(line)),
    );
    await serving.settled();

    expect(answers[0].result).toEqual({
      projects: [
        { id: "garden", name: "garden" },
        { id: "orchard", name: "orchard" },
      ],
    });
  });

  it("is not run for a notification", async () => {
    let ran = 0;
    const serving = servingProjects(await garden(), {
      methods: {
        "count/one": {
          queued: false,
          handle: async () => {
            ran++;
            return {};
          },
        },
      },
    });
    const answers: string[] = [];

    serving.take(message(undefined, "count/one"), (line) => answers.push(line));
    await serving.settled();

    expect(ran).toBe(0);
    expect(answers).toEqual([]);
  });
});

describe("a line the desk sends that answers nothing", () => {
  it("goes on the connection the method was asked on, until that connection has gone", async () => {
    const closed: string[] = [];
    let later: ((said: string) => void) | undefined;
    const serving = servingProjects(await garden(), {
      methods: {
        [CHAT_SAY]: {
          queued: false,
          handle: async (_params, _project, connection) => {
            connection.notify("chat/event", { said: "now" });
            later = (said) => connection.notify("chat/event", { said });
            return {};
          },
        },
      },
      closed: (connection) => closed.push(connection),
    });
    const lines: Record<string, unknown>[] = [];

    serving.take(
      message(1, CHAT_SAY, { thread: "t", said: "hi" }),
      (line) => lines.push(JSON.parse(line)),
      "4",
    );
    await serving.settled();
    later?.("still here");
    serving.closed("4");
    later?.("gone");

    expect(lines).toEqual([
      { jsonrpc: "2.0", method: "chat/event", params: { said: "now" } },
      { jsonrpc: "2.0", id: 1, result: {} },
      { jsonrpc: "2.0", method: "chat/event", params: { said: "still here" } },
    ]);
    expect(closed).toEqual(["4"]);
  });
});

describe("the act that takes a reader to a note", () => {
  it("is neither offered nor answered over the served acts", async () => {
    const serving = servingProjects(await garden());
    const answers: Record<string, unknown>[] = [];
    const answer = (line: string) => answers.push(JSON.parse(line));

    serving.take(message(1, "tools/list"), answer);
    serving.take(
      message(2, "tools/call", {
        name: "show_note",
        arguments: { note: "did:syr:x/01J00000000000000000000000" },
      }),
      answer,
    );
    await serving.settled();

    const tools = (
      answers[0].result as { tools: { name: string }[] }
    ).tools.map((one) => one.name);
    expect(tools).not.toContain("show_note");
    expect((answers[1].result as { isError: boolean }).isError).toBe(true);
  });
});
