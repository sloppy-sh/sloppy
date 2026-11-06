#!/usr/bin/env node
// The `history` tool set as an MCP server over stdio, for an agent that takes tools only that way.
// Usage: node history-mcp.mjs <project dir>
import { HISTORY_SPECS, runHistory } from "./history.mjs";

const cwd = process.argv[2] ?? process.cwd();
const PROTOCOL_VERSION = "2025-06-18";

const tools = Object.entries(HISTORY_SPECS).map(([name, spec]) => ({
  name,
  description: spec.description,
  inputSchema: spec.parameters,
}));

function answer(message) {
  const { id, method, params } = message;
  if (method === "initialize")
    return {
      protocolVersion: params?.protocolVersion ?? PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: "history", version: "1" },
    };
  if (method === "tools/list") return { tools };
  if (method === "tools/call") {
    const { text, isError } = runHistory(params?.name, params?.arguments, cwd);
    return { content: [{ type: "text", text }], isError };
  }
  if (method === "ping") return {};
  return id === undefined
    ? undefined
    : { error: { code: -32601, message: `No method ${method}.` } };
}

let pending = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  pending += chunk;
  const lines = pending.split("\n");
  pending = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    if (message.id === undefined) continue;
    const result = answer(message);
    const reply = result?.error
      ? { jsonrpc: "2.0", id: message.id, error: result.error }
      : { jsonrpc: "2.0", id: message.id, result };
    process.stdout.write(`${JSON.stringify(reply)}\n`);
  }
});
