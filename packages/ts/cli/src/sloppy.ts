#!/usr/bin/env node
// The `sloppy` command itself: where it is, somewhere to write, and the code
// it answers with. Everything it does is in `run.ts`.

import { linesOf } from "./mcp.js";
import { run } from "./run.js";

const argv = process.argv.slice(2);

process.exitCode = await run(argv, {
  cwd: process.cwd(),
  told: {
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
  },
  // Only `mcp` reads its input; any other command would wait on a terminal.
  ...(argv[0] === "mcp" ? { calls: linesOf(process.stdin) } : {}),
});
