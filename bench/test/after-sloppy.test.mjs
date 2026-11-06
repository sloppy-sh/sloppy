import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  afterSloppyOf,
  backfillAfterSloppy,
  claudeCodeCalls,
  filesNamed,
  searchesAfterSloppy,
  withAfterSloppy,
} from "../lib/after-sloppy.mjs";
import { newRecord } from "../lib/record.mjs";
import { writeTranscript } from "../lib/transcript.mjs";
import { tempDir } from "./helpers.mjs";

/** A Claude Code stream of the agent's own calls, each answered with `result`. */
function stream(calls) {
  return calls.flatMap(([name, input, result = ""], i) => [
    {
      ms: i * 10,
      event: {
        type: "assistant",
        parent_tool_use_id: null,
        message: {
          id: `m${i}`,
          content: [{ type: "tool_use", id: `t${i}`, name, input }],
        },
      },
    },
    {
      ms: i * 10 + 5,
      event: {
        type: "user",
        parent_tool_use_id: null,
        message: {
          content: [
            { type: "tool_result", tool_use_id: `t${i}`, content: result },
          ],
        },
      },
    },
  ]);
}

const FOUND = JSON.stringify({
  found: [
    {
      place: "app/services/merge_service.rb#L10-L221",
      kind: "class",
      name: "MergeService",
    },
  ],
});

test("the files an answer names, without line ranges", () => {
  assert.deepEqual(
    [...filesNamed(`${FOUND} and ./lib/a.rb, see src/x.ts.`)],
    ["app/services/merge_service.rb", "lib/a.rb", "src/x.ts"],
  );
});

test("counts a search for a file Sloppy had named, by its path, its name, or the read after it", () => {
  const events = stream([
    ["Grep", { pattern: "MergeService", path: "/work/full-0000/app" }],
    ["mcp__sloppy__find_code", { words: "MergeService" }, FOUND],
    [
      "Grep",
      {
        pattern: "def execute",
        path: "/work/full-0000/app/services/merge_service.rb",
      },
    ],
    ["Glob", { pattern: "**/merge_service.rb" }],
    ["Bash", { command: "rg -n merge app/services/merge_service.rb" }],
    ["Grep", { pattern: "execute" }],
    ["Read", { file_path: "/work/full-0000/app/services/merge_service.rb" }],
    ["Grep", { pattern: "unrelated", path: "/work/full-0000/lib" }],
    ["Read", { file_path: "/work/full-0000/lib/other.rb" }],
    ["Bash", { command: "ls app" }],
    [
      "Bash",
      { command: "sed -n 1,9p app/services/merge_service.rb | grep def" },
    ],
  ]);
  assert.equal(searchesAfterSloppy(claudeCodeCalls(events)), 4);
  assert.equal(afterSloppyOf("claude-code", events), 4);
});

test("reads a Grep pattern as words, not as a file it points at", () => {
  const events = stream([
    ["mcp__sloppy__find_code", { words: "x" }, "see packages/ts/local"],
    ["Grep", { pattern: "local" }],
    ["Glob", { pattern: "packages/ts/local" }],
  ]);
  assert.equal(afterSloppyOf("claude-code", events), 1);
});

test("counts nothing before Sloppy answered, and says nothing of a run that never asked it", () => {
  const before = stream([
    ["Grep", { pattern: "x", path: "app/services/merge_service.rb" }],
    ["mcp__sloppy__search_notes", { words: "x" }, '{"found":[]}'],
    ["Grep", { pattern: "x", path: "app/services/merge_service.rb" }],
  ]);
  assert.equal(afterSloppyOf("claude-code", before), 0);
  assert.equal(
    afterSloppyOf("claude-code", stream([["Grep", { pattern: "x" }]])),
    undefined,
  );
  assert.equal(afterSloppyOf("codex", before), undefined);
});

test("leaves out what a subagent did, which never saw the answer", () => {
  const events = [
    ...stream([["mcp__sloppy__find_code", { words: "m" }, FOUND]]),
    {
      ms: 99,
      event: {
        type: "assistant",
        parent_tool_use_id: "t0",
        message: {
          content: [
            {
              type: "tool_use",
              id: "s1",
              name: "Grep",
              input: { path: "app/services/merge_service.rb" },
            },
          ],
        },
      },
    },
  ];
  assert.equal(afterSloppyOf("claude-code", events), 0);
});

test("the backfill counts each run with a transcript once, beside the records, and a reader takes it", () => {
  const dir = tempDir();
  const record = (over) =>
    newRecord({
      subject: {
        name: "sloppy",
        path: "/s",
        sha: "a".repeat(40),
        variant: "full",
      },
      backend: { kind: "claude-code", model: "sonnet" },
      condition: "mcp",
      task: { pack: "sloppy", id: "t", family: "locate" },
      rep: 0,
      seed: 1,
      status: "ok",
      timing: { wall_ms: 1 },
      mcp_calls: { find_code: 1 },
      ...over,
    });
  const counted = record({});
  const own = record({ searches_after_sloppy: 7 });
  const bare = record({ condition: "bare", mcp_calls: {} });
  writeTranscript(
    dir,
    counted.run_id,
    stream([
      ["mcp__sloppy__find_code", { words: "m" }, FOUND],
      ["Glob", { pattern: "**/merge_service.rb" }],
    ]),
  );
  const records = [counted, own, bare];
  assert.deepEqual(backfillAfterSloppy(dir, records), [counted.run_id]);
  assert.deepEqual(backfillAfterSloppy(dir, records), []);
  assert.ok(fs.existsSync(path.join(dir, "derived", "after-sloppy.jsonl")));
  assert.deepEqual(
    withAfterSloppy(dir, records).map((r) => r.searches_after_sloppy),
    [1, 7, undefined],
  );
});
