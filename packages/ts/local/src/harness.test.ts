// The harness's runner against a fake provider and a stub window — note 1e12b.

import {
  HarnessRunSchema,
  type Window,
  type WindowAsk,
  type WindowComposer,
} from "@sloppy/types";
import { beforeEach, describe, expect, it } from "vitest";
import { containerApi } from "./acts.js";
import { MemoryFiles } from "./files.js";
import {
  DEFAULT_PROVIDERS,
  type HarnessProvider,
  HarnessRefused,
  providerKey,
  runHarness,
} from "./harness.js";

const PROJECT = "/work/kettle";
const KEY = "sk-test-the-key-nobody-may-see";
const MODEL = "claude-sonnet-5";
const ASK: WindowAsk = {
  ask: "Why does the kettle boil twice?",
  budget: 4000,
  depth: 3,
};
const WINDOW: Window = {
  parts: [
    {
      kind: "note",
      ref: "did:syr:z6MkKettleOwnerAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/01JZZZZZZZZZZZZZZZZZZZZZZZ",
      tokens: 6,
      text: "# The kettle\n\nIt boils twice so the lid seals.",
    },
    {
      kind: "instructions",
      path: "AGENT.md",
      tokens: 4,
      text: "The reasons are in the notes.",
    },
  ],
  budget: 4000,
  cut: [],
};
const anthropic = DEFAULT_PROVIDERS.anthropic as HarnessProvider;

type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown };

interface Sent {
  url: string;
  headers: Record<string, string>;
  body: { messages: { role: string; content: unknown }[]; tools: unknown[] };
}

/** A provider that answers each request with the next reply, and keeps what
 *  it was sent. */
function provider(replies: Block[][]): {
  fetch: typeof globalThis.fetch;
  sent: Sent[];
} {
  const sent: Sent[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    sent.push({
      url,
      headers: init.headers as Record<string, string>,
      body: JSON.parse(init.body as string),
    });
    const content = replies[sent.length - 1] ?? [{ type: "text", text: "" }];
    return new Response(
      JSON.stringify({
        content,
        usage: { input_tokens: 1000, output_tokens: 100 },
      }),
      { status: 200 },
    );
  }) as typeof globalThis.fetch;
  return { fetch, sent };
}

const composed: WindowComposer = async () => WINDOW;

let files: MemoryFiles;

beforeEach(async () => {
  files = new MemoryFiles({ root: PROJECT, data: "/data" });
  await containerApi(files).openProject(PROJECT);
});

function run(
  fetch: typeof globalThis.fetch,
  budget: { turns?: number; spend?: number } = { turns: 5 },
) {
  return runHarness({
    files,
    ask: ASK,
    compose: composed,
    provider: anthropic,
    model: MODEL,
    key: KEY,
    budget: budget as { turns: number },
    fetch,
  });
}

describe("a run", () => {
  it("answers in one turn when the model asks for no act", async () => {
    const { fetch, sent } = provider([
      [{ type: "text", text: "To seal the lid." }],
    ]);

    const done = await run(fetch);

    expect(HarnessRunSchema.parse(done).stop).toBe("answered");
    expect(done.turns).toHaveLength(1);
    expect(done.turns[0]).toMatchObject({
      reply: "To seal the lid.",
      acts: [],
    });
    expect(sent).toHaveLength(1);
  });

  it("puts the ask, then the window's text, in front of the model first", async () => {
    const { fetch, sent } = provider([[{ type: "text", text: "Done." }]]);

    const done = await run(fetch);

    const text =
      "Why does the kettle boil twice?\n\n# The kettle\n\nIt boils twice so the lid seals.\n\nThe reasons are in the notes.";
    expect(sent[0].body.messages[0]).toEqual({ role: "user", content: text });
    expect(done.turns[0].sent).toBe(text);
  });

  it("offers the acts in the provider's own words", async () => {
    const { fetch, sent } = provider([[{ type: "text", text: "Done." }]]);

    await run(fetch);

    expect(sent[0].url).toBe("https://api.anthropic.com/v1/messages");
    expect(sent[0].body.tools).toContainEqual(
      expect.objectContaining({
        name: "list_notes",
        input_schema: expect.any(Object),
      }),
    );
  });

  it("applies an act the model asks for, sends back what it answered, and goes round", async () => {
    const { fetch, sent } = provider([
      [{ type: "tool_use", id: "t1", name: "list_notes", input: {} }],
      [{ type: "text", text: "There are no notes yet." }],
    ]);

    const done = await run(fetch);

    expect(done.stop).toBe("answered");
    expect(done.turns).toHaveLength(2);
    const act = done.turns[0].acts[0];
    expect(act).toMatchObject({ act: "list_notes", outcome: "answered" });
    const answer = act.outcome === "answered" ? act.answer : "";
    expect(sent[1].body.messages.at(-1)).toEqual({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "t1", content: answer }],
    });
    expect(done.turns[1].sent).toBe(answer);
  });

  it("stops when the turns it was given are spent", async () => {
    const asking: Block[] = [
      { type: "tool_use", id: "t", name: "list_tags", input: {} },
    ];
    const { fetch, sent } = provider([asking, asking, asking]);

    const done = await run(fetch, { turns: 2 });

    expect(done.stop).toBe("turns_spent");
    expect(done.turns).toHaveLength(2);
    expect(sent).toHaveLength(2);
  });

  it("stops when the spend it was given is spent, counting cost as the run so far", async () => {
    const asking: Block[] = [
      { type: "tool_use", id: "t", name: "list_tags", input: {} },
    ];
    const { fetch } = provider([asking, asking, asking, asking]);

    // Each turn is 1000 sent at $2/M and 100 answered at $10/M: $0.003.
    const done = await run(fetch, { spend: 0.005 });

    expect(done.stop).toBe("spend_spent");
    expect(done.turns.map((turn) => turn.spent.cost)).toEqual([0.003, 0.006]);
  });

  it("will not hold a spend limit to a model it cannot price", async () => {
    const { fetch, sent } = provider([]);

    const done = await runHarness({
      files,
      ask: ASK,
      compose: composed,
      provider: anthropic,
      model: "a-model-with-no-price",
      key: KEY,
      budget: { spend: 1 },
      fetch,
    });

    expect(done.stop).toBe("error");
    expect(sent).toHaveLength(0);
  });

  it("hands an act that came to nothing back to the model, and goes on", async () => {
    const { fetch, sent } = provider([
      [
        {
          type: "tool_use",
          id: "t1",
          name: "read_note",
          input: {
            note: "did:syr:z6MkrAnotherPersonWritingHereAAAAAAAAAAAAAAAA/01HZZZZZZZZZZZZZZZZZZZZZZZ",
          },
        },
      ],
      [{ type: "text", text: "That note is not here." }],
    ]);

    const done = await run(fetch);

    expect(done.stop).toBe("answered");
    expect(done.turns[0].acts[0]).toMatchObject({
      act: "read_note",
      outcome: "answered",
    });
    expect(sent[1].body.messages.at(-1)).toMatchObject({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "t1", is_error: true }],
    });
  });

  it("stops at an act Sloppy does not have, and applies nothing after it", async () => {
    const { fetch, sent } = provider([
      [
        {
          type: "tool_use",
          id: "t1",
          name: "run_shell",
          input: { command: "ls" },
        },
        { type: "tool_use", id: "t2", name: "list_notes", input: {} },
      ],
    ]);

    const done = await run(fetch);

    expect(done.stop).toBe("act_refused");
    expect(done.turns[0].acts).toEqual([
      {
        act: "run_shell",
        input: { command: "ls" },
        outcome: "refused",
        reason: "There is no act called run_shell.",
      },
    ]);
    expect(sent).toHaveLength(1);
  });

  it("ends in error when the provider does not answer in time", async () => {
    const hanging = ((_url: string, init: RequestInit) =>
      new Promise((_, reject) => {
        init.signal?.addEventListener("abort", () =>
          reject(init.signal?.reason),
        );
      })) as unknown as typeof globalThis.fetch;

    const done = await runHarness({
      files,
      ask: ASK,
      compose: composed,
      provider: anthropic,
      model: MODEL,
      key: KEY,
      budget: { turns: 5 },
      fetch: hanging,
      timeoutMs: 20,
    });

    expect(done.stop).toBe("error");
    expect(done.stop === "error" && done.error).toMatch(/had not finished/);
  });

  it("ends in error, in the provider's own words, when it turns the request down", async () => {
    const fetch = (async () =>
      new Response(
        JSON.stringify({ error: { message: `invalid x-api-key ${KEY}` } }),
        { status: 401 },
      )) as unknown as typeof globalThis.fetch;

    const done = await run(fetch);

    expect(done.stop).toBe("error");
    expect(done.stop === "error" && done.error).toMatch(
      /turned the request down \(401\)/,
    );
  });

  it("never carries the key on what it records", async () => {
    const { fetch, sent } = provider([
      [{ type: "tool_use", id: "t1", name: "list_notes", input: {} }],
      [{ type: "text", text: `The key is ${KEY.length} long.` }],
    ]);
    const failing = (async () =>
      new Response(JSON.stringify({ error: { message: `bad key ${KEY}` } }), {
        status: 401,
      })) as unknown as typeof globalThis.fetch;

    const runs = [await run(fetch), await run(failing)];

    expect(sent[0].headers["x-api-key"]).toBe(KEY);
    for (const done of runs) expect(JSON.stringify(done)).not.toContain(KEY);
  });
});

describe("an openai-compatible provider", () => {
  const compatible: HarnessProvider = {
    kind: "openai-compatible",
    keyEnv: "COMPATIBLE_KEY",
    baseUrl: "https://models.example/v1/",
    prices: {
      local: { sent: 1, answered: 2, recalled: 0.5, kept: 0, thought: 4 },
    },
  };

  it("is asked in its own shape, hears back by role, and counts each class once", async () => {
    const sent: Sent[] = [];
    const replies = [
      {
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "c1",
              type: "function",
              function: { name: "list_notes", arguments: "{}" },
            },
          ],
        },
      },
      { message: { role: "assistant", content: "No notes." } },
    ];
    const fetch = (async (url: string, init: RequestInit) => {
      sent.push({
        url,
        headers: init.headers as Record<string, string>,
        body: JSON.parse(init.body as string),
      });
      return new Response(
        JSON.stringify({
          choices: [replies[sent.length - 1]],
          usage: {
            prompt_tokens: 1000,
            completion_tokens: 300,
            prompt_tokens_details: { cached_tokens: 400 },
            completion_tokens_details: { reasoning_tokens: 100 },
          },
        }),
        { status: 200 },
      );
    }) as typeof globalThis.fetch;

    const done = await runHarness({
      files,
      ask: ASK,
      compose: composed,
      provider: compatible,
      model: "local",
      key: KEY,
      budget: { turns: 5 },
      fetch,
    });

    expect(done.stop).toBe("answered");
    expect(sent[0].url).toBe("https://models.example/v1/chat/completions");
    expect(sent[0].headers.authorization).toBe(`Bearer ${KEY}`);
    expect(sent[0].body.tools).toContainEqual(
      expect.objectContaining({
        type: "function",
        function: expect.objectContaining({ name: "list_notes" }),
      }),
    );
    expect(sent[1].body.messages.at(-1)).toMatchObject({
      role: "tool",
      tool_call_id: "c1",
    });
    expect(done.turns[0].spent).toEqual({
      sent: 600,
      answered: 200,
      recalled: 400,
      thought: 100,
      cost: (600 * 1 + 200 * 2 + 400 * 0.5 + 100 * 4) / 1e6,
    });
    expect(done.turns.at(-1)?.reply).toBe("No notes.");
  });
});

describe("a provider's key", () => {
  it("is read from the variable the provider names", () => {
    expect(
      providerKey(anthropic, "environment", { ANTHROPIC_API_KEY: KEY }),
    ).toBe(KEY);
  });

  it("is asked for by that variable's name where it is not set", () => {
    expect(() => providerKey(anthropic, "environment", {})).toThrow(
      new HarnessRefused(
        "Set ANTHROPIC_API_KEY in the environment to run with this provider.",
      ),
    );
  });

  it("is not yet read from the keychain, and says what to do instead", () => {
    expect(() =>
      providerKey(anthropic, "keychain", { ANTHROPIC_API_KEY: KEY }),
    ).toThrow(/not here yet\. Set ANTHROPIC_API_KEY/);
  });
});
