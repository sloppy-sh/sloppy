import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, test } from "node:test";
import api, { keyFor, MAX_TURNS } from "../backends/api.mjs";
import { BENCH_DIR } from "../lib/config.mjs";
import { McpClient } from "../lib/mcp-client.mjs";
import { inside, runTool } from "../tools/local.mjs";
import { tempDir } from "./helpers.mjs";

const KEY = "sk-test-not-a-real-key";
process.env.BENCH_TEST_KEY = KEY;

function repo() {
  const dir = tempDir();
  fs.mkdirSync(path.join(dir, "src"));
  fs.writeFileSync(
    path.join(dir, "src", "a.js"),
    "export const answer = 42;\n",
  );
  execFileSync("git", ["init", "-q"], { cwd: dir });
  return dir;
}

/** A provider that plays back `turns`, one per request, and keeps what it was sent. */
function fakeProvider(turns) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
    });
    req.on("end", () => {
      seen.push({ url: req.url, headers: req.headers, body: JSON.parse(body) });
      const next = turns[Math.min(seen.length - 1, turns.length - 1)];
      res.writeHead(next.status ?? 200, { "content-type": "application/json" });
      res.end(JSON.stringify(next.body));
    });
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({
        seen,
        server,
        url: `http://127.0.0.1:${server.address().port}`,
      }),
    ),
  );
}

const servers = [];
after(() => {
  for (const s of servers) s.close();
});

const request = (provider, over = {}) => ({
  cwd: repo(),
  systemPrompt: "You are working in the project.",
  prompt: "What does src/a.js export?",
  tools: "read",
  timeoutMs: 20_000,
  budgetUsd: 1,
  taskId: "t",
  provider,
  model: provider.models[0],
  ...over,
});

test("an anthropic provider is driven through a tool loop, with the system prompt cached", async () => {
  const fake = await fakeProvider([
    {
      body: {
        model: "claude-x-20990101",
        content: [
          { type: "text", text: "Reading." },
          {
            type: "tool_use",
            id: "tu1",
            name: "read",
            input: { path: "src/a.js" },
          },
        ],
        usage: {
          input_tokens: 100,
          cache_creation_input_tokens: 50,
          cache_read_input_tokens: 0,
          output_tokens: 10,
        },
      },
    },
    {
      body: {
        content: [{ type: "text", text: "It exports answer = 42." }],
        usage: {
          input_tokens: 20,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 50,
          output_tokens: 8,
        },
      },
    },
  ]);
  servers.push(fake.server);
  const provider = {
    id: "fake",
    kind: "anthropic",
    base_url: fake.url,
    key_env: "BENCH_TEST_KEY",
    models: ["claude-x"],
  };
  const a = await api.run(request(provider));
  assert.equal(a.status, "ok", a.error);
  assert.equal(a.text, "It exports answer = 42.");
  assert.equal(a.turns, 2);
  assert.deepEqual(a.toolCalls, { read: 1 });
  assert.deepEqual(a.tokens, {
    input: 120,
    cache_write: 50,
    cache_read: 50,
    output: 18,
    reasoning: 0,
  });
  assert.equal(a.model, "claude-x");
  assert.ok(a.timing.first_tool_ms <= a.timing.answer_ms);
  assert.deepEqual(
    a.iterations.map(({ at_ms: _, ...it }) => it),
    [
      { input: 100, cache_write: 50, cache_read: 0, output: 10 },
      { input: 20, cache_write: 0, cache_read: 50, output: 8 },
    ],
  );
  assert.deepEqual(a.unsupported, []);

  const [first, second] = fake.seen;
  assert.equal(first.url, "/v1/messages");
  assert.equal(first.headers["x-api-key"], KEY);
  assert.deepEqual(first.body.system[0].cache_control, { type: "ephemeral" });
  assert.deepEqual(
    first.body.tools.map((t) => t.name),
    ["read", "grep", "glob"],
  );
  const result = second.body.messages.at(-1).content[0];
  assert.equal(result.type, "tool_result");
  assert.match(result.content, /1\texport const answer = 42;/);
  assert.ok(!JSON.stringify(a).includes(KEY));
});

test("an openai-compatible provider is driven through function calls, cached tokens split out", async () => {
  const fake = await fakeProvider([
    {
      body: {
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "c1",
                  type: "function",
                  function: { name: "grep", arguments: '{"pattern":"answer"}' },
                },
                {
                  id: "c2",
                  type: "function",
                  function: { name: "bash", arguments: '{"command":"ls"}' },
                },
              ],
            },
          },
        ],
        usage: {
          prompt_tokens: 300,
          completion_tokens: 40,
          prompt_tokens_details: { cached_tokens: 200 },
          completion_tokens_details: { reasoning_tokens: 15 },
        },
      },
    },
    {
      body: {
        choices: [{ message: { role: "assistant", content: "answer, 42" } }],
        usage: {
          prompt_tokens: 50,
          completion_tokens: 5,
          prompt_cache_hit_tokens: 10,
        },
      },
    },
  ]);
  servers.push(fake.server);
  const provider = {
    id: "fake",
    kind: "openai-compatible",
    base_url: `${fake.url}/v1`,
    key_env: "BENCH_TEST_KEY",
    models: ["m"],
  };
  const a = await api.run(request(provider, { subagents: true }));
  assert.equal(a.status, "ok", a.error);
  assert.equal(a.text, "answer, 42");
  assert.deepEqual(a.unsupported, ["subagents"]);
  assert.equal(a.iterations.length, a.turns);
  assert.deepEqual(a.tokens, {
    input: 140,
    cache_write: 0,
    cache_read: 210,
    output: 30,
    reasoning: 15,
  });
  assert.deepEqual(a.toolCalls, { grep: 1, bash: 1 });
  const [first, second] = fake.seen;
  assert.equal(first.url, "/v1/chat/completions");
  assert.equal(first.headers.authorization, `Bearer ${KEY}`);
  assert.equal(first.body.messages[0].role, "system");
  const tools = second.body.messages.filter((m) => m.role === "tool");
  assert.match(tools[0].content, /src\/a\.js:1:export const answer/);
  assert.match(tools[1].content, /no tool called bash/);
});

test("the api backend stops at its turn cap, answers a provider's refusal as an error, and times out", async () => {
  const looping = await fakeProvider([
    {
      body: {
        choices: [
          {
            message: {
              role: "assistant",
              tool_calls: [
                {
                  id: "x",
                  function: {
                    name: "glob",
                    arguments: '{"pattern":"**/*.js"}',
                  },
                },
              ],
            },
          },
        ],
      },
    },
  ]);
  const refusing = await fakeProvider([
    { status: 401, body: { error: "bad key" } },
  ]);
  servers.push(looping.server, refusing.server);
  const p = (url) => ({
    id: "fake",
    kind: "openai-compatible",
    base_url: url,
    key_env: "BENCH_TEST_KEY",
    models: ["m"],
  });
  const loop = await api.run(request(p(looping.url)));
  assert.equal(loop.status, "error");
  assert.equal(loop.turns, MAX_TURNS);
  assert.match(loop.error, /40 turns/);
  const refused = await api.run(request(p(refusing.url)));
  assert.equal(refused.status, "error");
  assert.match(refused.error, /401/);

  const silent = http.createServer(() => {});
  await new Promise((r) => silent.listen(0, "127.0.0.1", r));
  servers.push(silent);
  const slow = await api.run(
    request(p(`http://127.0.0.1:${silent.address().port}`), { timeoutMs: 300 }),
  );
  assert.equal(slow.status, "timeout");
});

test("a missing key is refused by the variable's name", () => {
  assert.throws(
    () => keyFor({ id: "deepseek", key_env: "NOT_SET_ANYWHERE_KEY" }, {}),
    /Set NOT_SET_ANYWHERE_KEY in the environment to run deepseek/,
  );
});

test("the local tools stay inside the project and edit exactly", () => {
  const dir = repo();
  fs.symlinkSync("/etc", path.join(dir, "out"));
  assert.throws(() => inside(dir, "../x"), /outside the project/);
  assert.throws(() => inside(dir, "out/hosts"), /outside the project/);
  assert.equal(
    runTool("read", { path: "/etc/hosts" }, dir, "read").isError,
    true,
  );
  assert.equal(
    runTool("write", { path: "b.txt", content: "x" }, dir, "read").isError,
    true,
  );
  assert.equal(
    runTool(
      "write",
      { path: "new/b.txt", content: "one two one" },
      dir,
      "write",
    ).isError,
    false,
  );
  assert.match(
    runTool(
      "edit",
      { path: "new/b.txt", old_string: "one", new_string: "1" },
      dir,
      "write",
    ).text,
    /more than once/,
  );
  assert.equal(
    runTool(
      "edit",
      { path: "new/b.txt", old_string: "two", new_string: "2" },
      dir,
      "write",
    ).isError,
    false,
  );
  assert.equal(
    fs.readFileSync(path.join(dir, "new/b.txt"), "utf8"),
    "one 2 one",
  );
  assert.match(
    runTool("glob", { pattern: "**/*.txt" }, dir, "read").text,
    /new\/b\.txt/,
  );
  assert.match(
    runTool("bash", { command: "echo hi" }, dir, "write").text,
    /exit 0\nhi/,
  );
});

const cli = path.resolve(BENCH_DIR, "..", "packages/ts/cli/dist/sloppy.mjs");

test(
  "the MCP bridge lists and calls the tools of a real sloppy mcp",
  {
    skip: !fs.existsSync(cli) && "the Sloppy CLI is not built",
  },
  async () => {
    const dir = repo();
    execFileSync(process.execPath, [cli, "init"], { cwd: dir, stdio: "pipe" });
    const client = await McpClient.start({
      command: process.execPath,
      args: [cli, "mcp"],
      cwd: dir,
    });
    try {
      const tools = await client.listTools();
      const names = tools.map((t) => t.name);
      assert.ok(names.includes("search_notes"), names.join(","));
      assert.ok(names.includes("write_note"));
      const found = await client.callTool("search_notes", {
        words: "anything",
      });
      assert.equal(found.isError, false);
      assert.match(found.text, /found/);
    } finally {
      await client.close();
    }
  },
);

test(
  "the api backend bridges sloppy's tools under mcp__sloppy__ and counts them by act",
  {
    skip: !fs.existsSync(cli) && "the Sloppy CLI is not built",
  },
  async () => {
    const fake = await fakeProvider([
      {
        body: {
          content: [
            {
              type: "tool_use",
              id: "a",
              name: "mcp__sloppy__search_notes",
              input: { words: "x" },
            },
          ],
          usage: {},
        },
      },
      {
        body: {
          content: [{ type: "text", text: "nothing written" }],
          usage: {},
        },
      },
    ]);
    servers.push(fake.server);
    const provider = {
      id: "fake",
      kind: "anthropic",
      base_url: fake.url,
      key_env: "BENCH_TEST_KEY",
      models: ["m"],
    };
    const req = request(provider, {
      mcp: { command: process.execPath, args: [cli, "mcp"] },
    });
    execFileSync(process.execPath, [cli, "init"], {
      cwd: req.cwd,
      stdio: "pipe",
    });
    const a = await api.run(req);
    assert.equal(a.status, "ok", a.error);
    assert.deepEqual(a.mcpCalls, { search_notes: 1 });
    assert.deepEqual(a.toolCalls, {});
    assert.ok(
      fake.seen[0].body.tools.some((t) => t.name === "mcp__sloppy__write_note"),
    );
    const result = fake.seen[1].body.messages.at(-1).content[0];
    assert.equal(result.is_error, false);
    assert.match(result.content, /found/);
  },
);
