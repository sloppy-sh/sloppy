import assert from "node:assert/strict";
import { test } from "node:test";
import {
  countOpened,
  findabilityOf,
  grepFiles,
  notesOpened,
  shellReads,
} from "../lib/findability.mjs";

test("a file counts once however often it is read, and a listing opens nothing", () => {
  const f = countOpened(
    [
      { name: "Read", input: { file_path: "/w/src/a.js" }, result: "x" },
      {
        name: "Read",
        input: { file_path: "src/a.js", offset: 10 },
        result: "x",
      },
      {
        name: "Glob",
        input: { pattern: "**/*.js" },
        result: "src/a.js\nsrc/b.js",
      },
      { name: "Grep", input: { pattern: "a" }, result: "src/c.js" },
      {
        name: "Read",
        input: { file_path: "src/missing.js" },
        result: "no",
        isError: true,
      },
    ],
    "/private/w",
  );
  assert.deepEqual(f, { files: 1, notes: 0, opened: 1 });
});

test("a content search opens the files its lines came from", () => {
  assert.deepEqual(grepFiles("src/a.js:3:x\nsrc/a.js:9:y\nlib/b.ts-4-z"), [
    "src/a.js",
    "lib/b.ts",
  ]);
  assert.deepEqual(grepFiles("3:x", "src/one.js"), ["src/one.js"]);
  assert.deepEqual(grepFiles("No matches found"), []);
  assert.deepEqual(grepFiles("Note: 3: something"), []);
});

test("a note is opened when an act hands back its text, never by a search hit or a gist", () => {
  assert.deepEqual(
    notesOpened("read_note", { note: "did:a/01X" }, '{"note":"did:a/01X"}'),
    ["01X"],
  );
  assert.deepEqual(
    notesOpened(
      "read_note",
      { note: "Title" },
      "That call's arguments are not right.",
    ),
    [],
  );
  assert.deepEqual(
    notesOpened(
      "brief",
      {},
      JSON.stringify({
        notes: [
          { ref: "01A", text: ["t"] },
          { ref: "01B", text: [] },
        ],
        near: [{ ref: "01C", gist: "g" }],
      }),
    ),
    ["01A"],
  );
  assert.deepEqual(
    notesOpened(
      "search_notes",
      {},
      JSON.stringify({ found: [{ note: "did:a/01Z" }] }),
    ),
    [],
  );
});

test("a shell command opens the files it prints", () => {
  assert.deepEqual(
    shellReads("cat src/a.js | head -20 && sed -n 1,40p lib/b.ts; ls src"),
    ["src/a.js", "lib/b.ts"],
  );
  assert.deepEqual(shellReads("npm test"), []);
});

test("the api backend's exchanges and the mock's calls are read the same way, and codex is not told", () => {
  const api = [
    {
      ms: 1,
      event: {
        type: "exchange",
        request: { messages: [{ role: "user", content: "q" }] },
        response: {
          content: [
            {
              type: "tool_use",
              id: "a",
              name: "grep",
              input: { pattern: "x" },
            },
          ],
        },
      },
    },
    {
      ms: 2,
      event: {
        type: "exchange",
        request: {
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: "a",
                  content: "src/a.js:1:x\nsrc/b.js:2:x",
                },
              ],
            },
          ],
        },
        response: {
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    id: "b",
                    function: {
                      name: "read",
                      arguments: '{"path":"src/c.js"}',
                    },
                  },
                ],
              },
            },
          ],
        },
      },
    },
    {
      ms: 3,
      event: {
        type: "exchange",
        request: {
          messages: [{ role: "tool", tool_call_id: "b", content: "1\tx" }],
        },
        response: { content: [] },
      },
    },
  ];
  assert.deepEqual(findabilityOf("api", api), {
    files: 3,
    notes: 0,
    opened: 3,
  });
  assert.deepEqual(
    findabilityOf("mock", [
      {
        ms: 0,
        event: {
          type: "tool",
          name: "mcp__sloppy__read_note",
          input: { note: "a/01Q" },
          result: '{"note":"a/01Q"}',
        },
      },
    ]),
    { files: 0, notes: 1, opened: 1 },
  );
  assert.equal(findabilityOf("codex", [{ ms: 0, event: {} }]), undefined);
  assert.equal(findabilityOf("claude-code", []), undefined);
});

test("a commit, a log or a blame read for its reasons counts as a place opened", () => {
  const f = countOpened(
    [
      {
        name: "mcp__history__git_show",
        input: { commit: "HEAD" },
        result: "x",
      },
      {
        name: "mcp__history__git_show",
        input: { commit: "HEAD" },
        result: "x",
      },
      { name: "mcp__history__git_log", input: { path: "src" }, result: "x" },
      {
        name: "mcp__history__git_blame",
        input: { path: "src/a.js" },
        result: "x",
      },
      { name: "Read", input: { file_path: "src/a.js" }, result: "x" },
    ],
    "/w",
  );
  assert.deepEqual(f, { files: 3, notes: 0, opened: 3 });
});
