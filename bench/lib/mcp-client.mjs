// A Model Context Protocol client over stdio, enough to bridge a server's tools into the api backend.
import { spawn } from "node:child_process";

const PROTOCOL_VERSION = "2025-06-18";

export class McpClient {
  #child;
  #next = 1;
  #waiting = new Map();
  #pending = "";
  #stderr = "";
  #closed;

  constructor(child) {
    this.#child = child;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => this.#read(chunk));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      this.#stderr = (this.#stderr + chunk).slice(-5000);
    });
    this.#closed = new Promise((resolve) => {
      child.on("close", (code) => {
        const words = `The MCP server exited (${code}): ${this.#stderr.trim().slice(-500) || "no output"}`;
        for (const { reject } of this.#waiting.values())
          reject(new Error(words));
        this.#waiting.clear();
        resolve();
      });
      child.on("error", (err) => {
        for (const { reject } of this.#waiting.values()) reject(err);
        this.#waiting.clear();
      });
    });
  }

  /** Starts `command args` in `cwd` and completes the initialize handshake. */
  static async start({ command, args = [], cwd, timeoutMs = 30_000 }) {
    const child = spawn(command, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const client = new McpClient(child);
    try {
      const init = await client.request(
        "initialize",
        {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "sloppy-bench", version: "0" },
        },
        timeoutMs,
      );
      client.serverInfo = init.serverInfo;
      client.notify("notifications/initialized", {});
      return client;
    } catch (err) {
      client.close();
      throw err;
    }
  }

  #read(chunk) {
    this.#pending += chunk;
    const lines = this.#pending.split("\n");
    this.#pending = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      const waiter = this.#waiting.get(message.id);
      if (!waiter) continue;
      this.#waiting.delete(message.id);
      if (message.error)
        waiter.reject(
          new Error(message.error.message ?? JSON.stringify(message.error)),
        );
      else waiter.resolve(message.result);
    }
  }

  request(method, params, timeoutMs = 120_000) {
    const id = this.#next++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#waiting.delete(id);
        reject(new Error(`The MCP server did not answer ${method} in time.`));
      }, timeoutMs);
      this.#waiting.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.#child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
      );
    });
  }

  notify(method, params) {
    this.#child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`,
    );
  }

  /** @returns {Promise<Array<{ name: string, description?: string, inputSchema: object }>>} */
  async listTools() {
    const tools = [];
    let cursor;
    do {
      const page = await this.request("tools/list", cursor ? { cursor } : {});
      tools.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor);
    return tools;
  }

  /** The call's text content joined, and whether the server marked it an error. */
  async callTool(name, args) {
    const result = await this.request("tools/call", {
      name,
      arguments: args ?? {},
    });
    const text = (result.content ?? [])
      .map((c) => (c.type === "text" ? c.text : JSON.stringify(c)))
      .join("\n");
    return { text, isError: result.isError === true };
  }

  async close() {
    this.#child.stdin.end();
    this.#child.kill();
    await this.#closed;
  }
}
