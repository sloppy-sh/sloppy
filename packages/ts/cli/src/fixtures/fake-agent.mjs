#!/usr/bin/env node
// An agent for `organise.test.ts` that needs no model: started the way Claude
// Code is, it starts the notes' server from the config it was handed, carries
// the first proposed move, draws and labels the first proposed line, and
// answers the way Claude Code's `--output-format json` does.

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const after = (flag) => args[args.indexOf(flag) + 1];
const prompt = after("-p");
const allowed = after("--allowedTools").split(",");
const server = JSON.parse(readFileSync(after("--mcp-config"), "utf8"))
  .mcpServers.sloppy;
const proposals = JSON.parse(
  prompt.slice(prompt.indexOf("```json") + 7, prompt.lastIndexOf("```")),
);

const child = spawn(server.command, server.args, {
  stdio: ["pipe", "pipe", "inherit"],
});
const waiting = new Map();
let held = "";
child.stdout.on("data", (chunk) => {
  held += chunk;
  for (let at = held.indexOf("\n"); at !== -1; at = held.indexOf("\n")) {
    const answer = JSON.parse(held.slice(0, at));
    held = held.slice(at + 1);
    waiting.get(answer.id)?.(answer);
  }
});
let id = 0;
const ask = (method, params) =>
  new Promise((done) => {
    id += 1;
    waiting.set(id, done);
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
    );
  });
const act = async (name, a) => {
  if (!allowed.includes(`mcp__sloppy__${name}`)) {
    throw new Error(`${name} is not allowed`);
  }
  const answer = await ask("tools/call", { name, arguments: a });
  if (answer.result.isError) throw new Error(answer.result.content[0].text);
  return answer.result.content[0].text;
};

await ask("initialize", {});
const said = [];
const move = proposals.moves[0];
if (move) {
  await act("read_note", { note: move.note });
  await act("move_note", {
    note: move.note,
    to: move.to.note,
    relation: "under",
  });
  said.push(`Moved ${move.title}: it continues ${move.to.title}.`);
}
const line = proposals.links[0];
if (line) {
  await act("link_notes", { note: line.note, to: [line.to.note] });
  await act("style_edge", {
    note: line.note,
    to: line.to.note,
    label: "continues it",
  });
  said.push(`Linked ${line.title} and ${line.to.title}.`);
}
child.stdin.end();
child.on("close", () => {
  process.stdout.write(
    `${JSON.stringify({ type: "result", subtype: "success", is_error: false, result: said.join("\n"), total_cost_usd: 0 })}\n`,
  );
});
