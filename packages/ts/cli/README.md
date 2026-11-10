# @sloppy/cli

Sloppy at the command line. `docs/ARCHITECTURE.md` § "Tooling" is the doc
of record — what each command does, and what it may not; this file is only how a caller
wires it up.

Nothing here talks to a server or a browser. It reads and writes a project's container
with the same `@sloppy/vault` and `@sloppy/local` code the app runs, over a `Files` on
this disk.

```
sloppy init [dir]      start the notes in a project, and write what the tree can tell
sloppy draft [paths…]  a note in detail per file named, never over somebody's writing
sloppy check [dir]     read every note and say what doesn't hold
sloppy organise [dir]  propose where notes would hang better and what would join them
sloppy mcp [dir]       serve these notes to an assistant, under the rules the app keeps
sloppy run <ask>       put what the notes say about an ask in front of a model, and let it work
sloppy hook            how to have each prompt you give Claude Code arrive with what the notes say about it
```

`--json` answers in JSON instead of lines. `init` takes `--identity <file>` to write
under an identity carried from somewhere else rather than one made for this project. The
exit code is **0** where there is nothing to fix, **1** where there is and it has
been listed, and **2** where the command did nothing at all — one nobody has, or a
folder with no notes in it to read.

With `--json`, a quote of code whose lines have moved, changed or gone since it was quoted
is a defect of kind `quoted-code` carrying `quote`: where it was quoted from (`at`), its
`state`, where its text is now (`now`, where it moved) and what the lines say now (`says`,
where they changed).

## Organising the notes

```
sloppy organise                     every proposal, changing nothing
sloppy organise --loose             only notes hung straight under a branch's first note,
                                    or under one they relate to little
sloppy organise --notes <refs>      only these; --since <commit> only those changed since
sloppy organise --agent claude-code [--model <name>] [--budget <dollars>]
sloppy organise --review <branch>
```

`--agent` makes a branch `sloppy/organise/<day>` off the project's last commit, with the
notes as they stand now, checks it out under the system's temporary folder, and runs the
agent there over `sloppy mcp` with nothing allowed but reading the notes, `relate`,
`move_note`, `link_notes` and `style_edge`. The person's checkout is never touched; the
branch is what is left, and `--review` reads it note by note. Taking it is `git merge`.
The budget is a dollar a run unless `--budget` says otherwise. Given to `run`, `self` is
how the command starts itself again as that server, and `agentAt` where an agent's own
program is.

## Serving an assistant

`sloppy mcp` speaks the Model Context Protocol on its own input and output, one message a
line, until its input ends; § "An assistant outside the app" is its doc of record. A
repository configures it once, in a `.mcp.json` at its root. Where the CLI is installed:

```json
{ "mcpServers": { "sloppy": { "type": "stdio", "command": "sloppy", "args": ["mcp"] } } }
```

In a checkout of this repository, once the packages are built:

```json
{ "mcpServers": { "sloppy": { "type": "stdio", "command": "node", "args": ["packages/ts/cli/dist/sloppy.mjs", "mcp"] } } }
```

It serves lean unless told otherwise: the acts ordinary work needs in short words, the same
facts in fewer words, and each note naming the exact lines of code it points at.

```
sloppy mcp --profile full      every act, in the chat's words, answered as the chat reads it
sloppy mcp --tools default     every act; beside a profile, --tools or --answers overrides its part
sloppy mcp --answers default   the chat's own words
sloppy mcp --doctrine notes-first
```

In a `.mcp.json` they go after `"mcp"` in `args`, as in `["mcp", "--profile", "full"]`.

Beside the app chat's acts it serves `find_code`: where a name or a few words are in the
project's code, each place as the lines to read and the notes explaining that file. It reads
what git keeps and would keep, and keeps what each file defines in the system's temporary
folder, never in the project, so a second start reads only what changed.

Given to `run`, the lines it reads are `calls` and its answers go to `told.out`; anything
meant for a person goes to `told.err`, whatever flags it was given.

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
