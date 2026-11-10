import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { runHarnessBackend } from "../backends/harness.mjs";
import { findabilityOf } from "../lib/findability.mjs";
import { makeSubject, tempDir, write } from "./helpers.mjs";

const PROVIDER = {
  id: "anthropic",
  kind: "anthropic",
  key_env: "ANTHROPIC_API_KEY",
  models: ["claude-sonnet-5"],
};

/** A CLI whose `running` asks the model twice through the fetch it is handed, then prints `run`. */
function fakeCli(run) {
  const dir = tempDir();
  fs.writeFileSync(
    path.join(dir, "index.mjs"),
    `export async function running(asked, context, json, using) {
  globalThis.harnessAsked = { asked, cwd: context.cwd, json, env: using.env };
  const body = (messages) => ({ method: "POST", body: JSON.stringify({ model: "m", messages }) });
  await using.fetch("https://model.test/v1/messages", body([{ role: "user", content: "ask" }]));
  await using.fetch("https://model.test/v1/messages", body([
    { role: "user", content: "ask" },
    { role: "assistant", content: [] },
    { role: "user", content: "answered" },
  ]));
  context.told.out(JSON.stringify(${JSON.stringify({ command: "run", ...run })}));
}
`,
  );
  return path.join(dir, "sloppy.mjs");
}

const turn = (acts, spent) => ({ sent: "", reply: "", acts, spent });

const ANSWERED = {
  ask: { ask: "why?", budget: 16000 },
  model: "claude-sonnet-5",
  budget: { turns: 40 },
  stop: "answered",
  turns: [
    turn(
      [
        {
          act: "read_note",
          input: { note: "did:x/01AAA" },
          outcome: "answered",
          answer: JSON.stringify({ note: "did:x/01AAA", text: "why" }),
        },
      ],
      { sent: 100, answered: 10, recalled: 5, kept: 7 },
    ),
    {
      ...turn([], { sent: 20, answered: 30, thought: 4 }),
      reply: " Because. ",
    },
  ],
};

const request = (cli, over = {}) => ({
  cwd: makeSubject(),
  systemPrompt:
    "Base line.\n\nThis project's notes are reachable through the sloppy tools.",
  prompt: "Why is it so?",
  tools: "read",
  harness: { cli },
  model: "claude-sonnet-5",
  timeoutMs: 5000,
  provider: PROVIDER,
  ...over,
});

test("the harness backend runs Sloppy's own runner and answers in the record's shape", async () => {
  const sent = [];
  const fetch = async (url, init) => {
    sent.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ content: [], usage: {} }));
  };
  const answer = await runHarnessBackend(
    request(fakeCli(ANSWERED), {
      provider: { ...PROVIDER, key_env: "BENCH_OWN_KEY" },
    }),
    { fetch, env: { BENCH_OWN_KEY: "k" } },
  );
  const { asked, json, env } = globalThis.harnessAsked;
  assert.equal(env.ANTHROPIC_API_KEY, "k");
  assert.equal(json, true);
  assert.deepEqual(asked.paths, ["Why is it so?"]);
  assert.equal(asked.options.get("provider"), "anthropic");
  assert.equal(asked.options.get("model"), "claude-sonnet-5");
  assert.equal(asked.options.get("turns"), "40");

  assert.ok(sent.every((b) => b.system === request("").systemPrompt));
  const exchanges = answer.events.filter((e) => e.event.type === "exchange");
  assert.deepEqual(
    exchanges.map((e) => e.event.request.messages.length),
    [1, 2],
  );
  assert.equal(exchanges[1].event.request.system, undefined);

  assert.equal(answer.status, "ok");
  assert.equal(answer.text, "Because.");
  assert.equal(answer.turns, 2);
  assert.deepEqual(answer.tokens, {
    input: 120,
    cache_write: 7,
    cache_read: 5,
    output: 40,
    reasoning: 4,
  });
  assert.deepEqual(answer.mcpCalls, { read_note: 1 });
  assert.deepEqual(answer.toolCalls, {});
  assert.deepEqual(answer.unsupported, ["read"]);
  assert.equal(answer.iterations.length, 2);
  assert.deepEqual(
    answer.events.map((e) => e.event.type),
    ["exchange", "tool", "exchange"],
  );
  assert.deepEqual(findabilityOf("harness", answer.events), {
    files: 0,
    notes: 1,
    opened: 1,
  });
});

test("a run that stops without answering is an error, in the runner's words", async () => {
  const cli = fakeCli({
    ...ANSWERED,
    stop: "error",
    error: "The run stopped before it was done.",
    turns: [],
  });
  const fetch = async () => new Response("{}");
  const answer = await runHarnessBackend(request(cli), { fetch, env: {} });
  assert.equal(answer.status, "error");
  assert.equal(answer.error, "The run stopped before it was done.");
  assert.equal(answer.text, "");
});

test("a run that stops short says how in words", async () => {
  const fetch = async () => new Response("{}");
  for (const [stop, words] of [
    ["turns_spent", /had not answered after 40 turns/],
    ["spend_spent", /spent what it was given/],
    ["act_refused", /could not be done/],
  ]) {
    const cli = fakeCli({ ...ANSWERED, stop });
    const answer = await runHarnessBackend(request(cli), { fetch, env: {} });
    assert.equal(answer.status, "error");
    assert.match(answer.error, words);
  }
});

test("the harness backend stops the model at the time limit and says so", async () => {
  const fetch = (_url, init) =>
    new Promise((_resolve, reject) =>
      init.signal.addEventListener("abort", () => reject(init.signal.reason)),
    );
  const dir = tempDir();
  fs.writeFileSync(
    path.join(dir, "index.mjs"),
    `export async function running(asked, context, json, using) {
  try {
    await using.fetch("https://model.test/v1/messages", { method: "POST", body: "{}" });
  } catch {}
  context.told.out(JSON.stringify({ command: "run", stop: "error", error: "stopped", turns: [] }));
}
`,
  );
  const answer = await runHarnessBackend(
    request(path.join(dir, "sloppy.mjs"), { timeoutMs: 50 }),
    { fetch, env: {} },
  );
  assert.equal(answer.status, "timeout");
});

test("the harness backend refuses a provider its runner cannot reach, and a condition that did not ask for it", async () => {
  await assert.rejects(
    runHarnessBackend(
      request(fakeCli(ANSWERED), {
        provider: { ...PROVIDER, kind: "openai-compatible" },
      }),
    ),
    /reaches a provider of kind anthropic/,
  );
  await assert.rejects(
    runHarnessBackend(request(fakeCli(ANSWERED), { harness: undefined })),
    /only a condition that asks for it/,
  );
});

const cli = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "packages/ts/cli/dist/sloppy.mjs",
);

test(
  "the harness backend drives the built runner over a graph's own notes",
  { skip: !fs.existsSync(cli) && "the Sloppy CLI is not built" },
  async () => {
    const cwd = makeSubject();
    fs.rmSync(path.join(cwd, ".sloppy"), { recursive: true });
    execFileSync(process.execPath, [cli, "init"], { cwd, stdio: "pipe" });
    const { owner } = JSON.parse(
      fs.readFileSync(path.join(cwd, ".sloppy/graph.json"), "utf8"),
    );
    const ref = `${owner}/01J0000000000000000000000A`;
    write(
      cwd,
      ".sloppy/notes/01J0000000000000000000000A.md",
      [
        "---",
        `ref: ${ref}`,
        "address: 1",
        "title: Why the parser reads twice",
        "---",
        "",
        "<!-- block 01J000000000000000000000B1 -->",
        "",
        "The parser reads twice so the second pass sees every name the first one bound.",
        "",
      ].join("\n"),
    );
    const replies = [
      {
        content: [
          {
            type: "tool_use",
            id: "t1",
            name: "read_note",
            input: { note: ref },
          },
        ],
        usage: { input_tokens: 50, output_tokens: 5 },
      },
      {
        content: [{ type: "text", text: "It binds names first." }],
        usage: { input_tokens: 60, output_tokens: 6 },
      },
    ];
    const sent = [];
    const fetch = async (_url, init) => {
      sent.push(JSON.parse(init.body));
      return new Response(JSON.stringify(replies[sent.length - 1]));
    };
    const answer = await runHarnessBackend(
      request(cli, { cwd, prompt: "why does the parser read twice?" }),
      { fetch, env: { ANTHROPIC_API_KEY: "k" } },
    );

    assert.equal(answer.status, "ok", answer.error);
    assert.equal(answer.text, "It binds names first.");
    assert.equal(sent.length, 2);
    assert.ok(sent.every((b) => b.system === request("").systemPrompt));
    assert.match(
      sent[0].messages[0].content,
      /^why does the parser read twice\?/,
    );
    assert.match(sent[0].messages[0].content, /second pass sees every name/);
    assert.ok(sent[0].tools.some((t) => t.name === "read_note"));
    const result = sent[1].messages.at(-1).content[0];
    assert.equal(result.type, "tool_result");
    assert.equal(result.is_error, undefined);
    assert.match(result.content, /second pass sees every name/);
    assert.deepEqual(answer.mcpCalls, { read_note: 1 });
    assert.deepEqual(answer.tokens.input, 110);
    assert.deepEqual(
      answer.events.map((e) => e.event.type),
      ["exchange", "tool", "exchange"],
    );
    assert.equal(findabilityOf("harness", answer.events).opened, 1);
  },
);
