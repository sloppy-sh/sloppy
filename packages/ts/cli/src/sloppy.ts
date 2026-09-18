#!/usr/bin/env node
// The `sloppy` command itself: where it is, somewhere to write, and the code
// it answers with. Everything it does is in `run.ts`.

import { run } from "./run.js";

process.exitCode = await run(process.argv.slice(2), {
  cwd: process.cwd(),
  told: {
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
  },
});
