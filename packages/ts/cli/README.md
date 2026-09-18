# @sloppy/cli

Sloppy at the command line. `docs/ARCHITECTURE.md` § "Tooling and the review" is the doc
of record — what each command does, and what it may not; this file is only how a caller
wires it up.

Nothing here talks to a server or a browser. It reads and writes a project's container
with the same `@sloppy/vault` and `@sloppy/local` code the app runs, over a `Files` on
this disk.

```
sloppy init [dir]      start the notes in a project, and write what the tree can tell
sloppy draft [paths…]  a note in detail per file named, never over somebody's writing
sloppy review [dir]    what the code has left behind
sloppy check [dir]     read every note and say what doesn't hold
```

`--json` answers in JSON instead of lines. `init` takes `--identity <file>` to write
under an identity carried from somewhere else rather than one made for this project, and
`review` takes `--strict` to say there is something to fix rather than only listing it.
The exit code is **0** where there is nothing to fix, **1** where there is and it has
been listed, and **2** where the command did nothing at all — one nobody has, or a
folder with no notes in it to read.

## Driving it from somewhere else

`run` is the whole command, given where it is and somewhere to write, so a test drives it
without a process:

```ts
import { MemoryFiles } from "@sloppy/local";
import { run } from "@sloppy/cli";

const disk = new MemoryFiles({ root: "/" });
const lines: string[] = [];
const code = await run(["check"], {
  cwd: "/project",
  told: { out: (line) => lines.push(line), err: (line) => lines.push(line) },
  filesAt: (root) => disk.at(root),
});
```

`filesAt` is given the folder and where what is nobody else's business goes for it —
what `dataPath` answers, which for a project is inside the container's own sidecar.

`NodeFiles` is the `Files` this disk answers with, rooted at one folder; `check` is the
check itself over a container, for a caller that wants the defects rather than the lines.
