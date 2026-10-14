# Sloppy

**A second brain for a project, and the one place the people working on it and the
assistants working beside them keep the same account of what it is for.**

Sloppy is a note-taking app whose notes are a graph: every note knows what it sprang out
of, carries an address you can cite, and wears the tags that put it in a set. Point a
graph at a codebase and it becomes something more particular — the record of _why that
project is the way it is_, written where a person and a machine can both read it, placed
by what each decision came out of rather than filed in a folder somebody invented.

![The graph reading, a project's notes beside its code, with an assistant working in the same graph](docs/images/reading-the-graph.jpg)

## The problem

Large projects fail at the same two seams.

**Between people.** The reasoning behind a system lives in the heads of whoever built it,
in a chat thread nobody can find, or in a document that stopped being true a year ago.
When those people leave, what arrives in their place is a codebase and no account of it.

**Between people and their assistants.** An agent asked to change something either gets a
prompt somebody typed from memory, or it reads the whole repository and burns its context
discovering what two sentences would have told it. Nobody can see what it was given, so
nobody can check what it did against what it was told.

Sloppy's answer to both is the same: **one graph, shared, that the code is answerable
to.** A note says what a thing is for; the code is what somebody built to do it; either
can be checked against the other, and the answer goes back in the note where the next
reader finds it. The notes are ordinary markdown files in the repository, so they are
reviewed, branched and merged with the code they are about.

## Who it is for

- **People leading a project who want to be answerable for the AI in it.** Not "did the
  model do well" — _what was it told, what did it write, and does the result match what
  the note said the thing was for._ Sloppy makes each of those a thing a person can point
  at, after the fact, without having been in the room.
- **Projects that change hands.** A new lead, a new team, an audit, a handover. The graph
  is what you read instead of interviewing people who have gone: the decisions, under what
  they came out of, each pointing at the code it explains — and a way to propose an edit
  the same afternoon you found the problem.
- **Anyone who wants a second brain.** Without a codebase attached it is a note-taking
  app: a graph of your own thinking, with addresses, tags and a canvas. MIT licensed, and
  your notes are files on your disk.

## What it does

### The notes are files, beside the code

A project's graph is a `.sloppy/` folder in the repository: one markdown file per note,
front matter carrying what it sprang from, its address and its tags. Nothing is locked in
a database somewhere — `grep` works, `git log` works, a pull request shows a decision
changing. `.sloppy/AGENT.md` is the format written out for whatever assistant you set to
work, so an agent with no Sloppy installed still writes notes the app and the next person
read the same way.

A note points at the code it explains, and the app says when that code has moved since its
author last read it — the mark on the canvas carries a dot, and the note is the place to
write down whether it still holds.

### Context-aware chat, one per project

![The outline reading, a note's compass and what it proposes](docs/images/reading-the-outline.jpg)

The assistant works **inside the graph it is talking about**. Each project keeps its own
threads; each thread keeps its own draft and its own context, and the dock tells you how
full that context is and what it has cost as you go. You choose the notes a thread reads
rather than pasting them, and what the assistant writes comes back as notes you review
before they land — in a working copy of your folder, merged when you say so, never written
over your files behind your back.

So the chat is not a side channel. What went in is a set of notes anybody can open, and
what came out is a change anybody can read — which is the difference between using AI on a
project and being able to account for it afterwards.

### Build for me

On a graph pointed at a codebase, pick the notes that say what a piece of the project is
for and press **Build this**. Sloppy then runs the work itself rather than handing one
agent a prompt and hoping:

1. **It reads first, and says what is missing.** A session reads the notes you chose and
   answers with a plan — the tasks, the exact notes each one needs, and the **questions**:
   what the notes do not say that the work has to know, and where two notes disagree with
   each other or with the code. **The agent is expected to dispute the documentation**, and
   the questions stand in front of you as a card.
2. **You answer by writing.** An answer is a note in your own words, under the feature
   where it belongs. The intent gets better because somebody asked a precise question
   about it, and the answer stays after the build is over.
3. **It builds on a line of its own.** One fresh session per task, each given the smallest
   context that can do the work — its notes whole, nothing else of the graph — so no
   session runs degraded and none of them touches your folder. A session that fills up
   hands off to a fresh one instead of quietly getting worse.
4. **It reviews what it wrote**, against the notes rather than against taste, and a
   blocking finding goes back to a fresh session.
5. **You are shown the result and the merges.** What was built, which files, what the
   checks said, what notes were written, what was left undone — and the one question that
   is yours: bring it in, or not. Work on that version first if you want to run it.

Nothing lands on a timer. A task the review cannot settle is marked contested and waits
for you, and the line the build worked on is a real branch you can check out, run, or
throw away.

### Three readings of the same graph

![The sets reading, tags drawn as overlapping places with the notes standing in them](docs/images/reading-the-sets.jpg)

The same notes, read three ways, with nothing hidden in any of them:

- **Graph** — the genealogy. Every note placed by what it sprang out of, so a line of
  thinking is a shape you can see. A subtree folds into one mark and opens on a tap.
- **Outline** — the same tree as rows, with a note's interior opening in place.
- **Sets** — the tags as overlapping places, each note standing where it belongs. A note
  in two sets stands where the two cross; drag it into a place to tag it.

Across all three, **a mark wears a band per set it is in** — so which tags a note carries
is readable from the mark itself, before you have asked anything, and the rail beside the
canvas is the legend. Selecting tags highlights what carries them and dims the rest, so
the shape of the graph survives the question instead of being filtered away.

Every note also carries a **compass** — _part of, made of, like, instead of_ — the four
questions that place an idea against the ideas around it. "Instead of" is where a
rejected option goes, which is the half of a decision most projects lose.

### Versions, lines and proposing an edit

A graph pointed at a codebase keeps that repository's own history, read in the column
beside the notes. Standing on an earlier version is a real checkout you can write from, not
a read-only view: open the project as it was a release ago, write what you found, and that
becomes a line. Bringing a line in is a merge — notes settled note by note, a conflict in
the code refused with words rather than guessed at.

This is the path for somebody who has just inherited a system: read the graph, find the
decision that no longer holds, write the correction where you are standing, and hand back a
line somebody can review.

### An address you can cite

A note's address — `1`, `1a`, `1a1`, `1b` — is the label a person cites it by, the way a
page number works inside a book. The Folgezettel rule offers one when you write a note
under another, so numbering is not work you do; it is yours to change or leave off, and an
address a note has ever carried keeps leading to it, so a citation somebody wrote down a
year ago still lands.

**The shape is part of the protocol, not a per-user accident.** What a note sprang out of
and the order it was written in are read the same way by every copy, so a subtree can be
published and pulled into somebody else's graph and land in the shape its author saw. This
is what separates it from a flat mesh of backlinks, where no two people's graphs mean the
same thing.

### Also at the command line

```bash
sloppy init     # start a graph beside this code
sloppy draft    # write a note from the terminal
sloppy check    # read the notes against the code and say what disagrees
```

## Where each part runs

|                                            | Desktop & mobile app                  | Web                  |
| ------------------------------------------ | ------------------------------------- | -------------------- |
| Notes, the three readings, tags, addresses | yes                                   | yes                  |
| A folder on your device as the graph       | yes                                   | opened, not uploaded |
| Version history, lines, merges             | yes                                   | —                    |
| Chat and **Build for me**                  | yes, with an assistant installed here | —                    |

The assistant wired end to end today is **Claude Code**, through Sloppy's own endpoint;
the contract is by role and tool set rather than by vendor, so another program agent is a
row in a table. Sloppy holds no key of yours, and a build never touches your own line or
your folder until you bring it in.

## Reading further

- Product direction: [`PRODUCT.md`](PRODUCT.md) · Visual system: [`DESIGN.md`](DESIGN.md)
- Architecture, the syr split, the data model: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Contributor and agent instructions: [`AI.md`](AI.md)
- The note format an assistant writes to: [`.sloppy/AGENT.md`](.sloppy/AGENT.md)

## Licence

MIT — see [`LICENSE`](LICENSE). The notes you write are markdown files on your disk; there
is nothing to export and nothing holding them.

## Status

**The product is built and runs end to end.** From a clone, `pnpm dev` brings up something
you can use: sign in — against a syr instance, or against the API's own identity provider
with nothing else running anywhere — keep as many graphs as you want a notebook for, and
write notes that are offered a Folgezettel address by rules every copy applies the same
way. A note's interior is a stack of blocks, each holding paragraphs, headings, lists,
code, pictures and Apple-Pencil ink. Tags cut across the genealogy and highlight rather
than filter. The graph itself is a pixi canvas: a subtree collapses into a mega-node,
detail drops away as you pull back, and a reader may put a picture behind the field. A
subtree can be published and a peer's published region pulled into a graph of your own and
read there, with profiles, comments, reactions and emoji coming from the identity side.
Everything you have written comes back out as one file whenever you ask for it.

**The desktop and mobile app opens a folder on your device as a graph**, with no server
anywhere: the notes are files, the history is the repository's own, and standing on an
earlier version is a real checkout you can write from. The chat and **Build for me** run there, against an
assistant installed on the same machine.

`pnpm test` is about 7,600 tests across some four hundred files. A dozen of those files
are integration suites that want a database listening, and a run has to ask for them, so a
clone with nothing else running still gets a green suite; Common tasks below is how to ask.

What is still ahead: an assistant reached by an API key is listed but not yet driven, so
the chat and a build need a program agent on the machine; a build runs on a folder rather
than a hosted graph; and the page a browser lands on when it resolves somebody's identity
has nothing answering it yet.

## Stack

pnpm + Turborepo monorepo. Every row below is in the tree.

| Path                   | Package            | Tech                                               |
| ---------------------- | ------------------ | -------------------------------------------------- |
| `apps/sloppy/api`      | `@sloppy/api`      | NestJS API                                         |
| `apps/sloppy/web`      | `@sloppy/web`      | SvelteKit (SPA shell)                              |
| `apps/sloppy/native`   | `@sloppy/native`   | Tauri + SvelteKit (iOS, iPadOS, Android, desktop)  |
| `packages/ts/types`    | `@sloppy/types`    | Shared Zod schemas                                 |
| `packages/ts/client`   | `@sloppy/client`   | Backend-agnostic API client                        |
| `packages/ts/app-core` | `@sloppy/app-core` | Every page, component, store and API call          |
| `packages/ts/ui`       | `@sloppy/ui`       | shadcn-svelte components + design tokens           |
| `packages/ts/data`     | `@sloppy/data`     | SurrealDB table definitions and the per-user purge |
| `packages/ts/graph`    | `@sloppy/graph`    | pixi.js v8 + graphology + d3-force                 |
| `packages/ts/idp`      | `@sloppy/idp`      | syr IdP contracts + crypto, for local mode         |
| `packages/ts/vault`    | `@sloppy/vault`    | A graph as files: the vault folder and the archive |
| `packages/ts/local`    | `@sloppy/local`    | The graph served off this device, with no server   |
| `packages/ts/cli`      | `@sloppy/cli`      | `sloppy` at the command line                       |

Identity, profiles, media blobs, emoji and reactions come from **syr**; nodes, addresses,
tags, blocks and ink are Sloppy's own. That split is not a preference — see
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Run it

Requires Docker. `corepack enable` too, for the native shell and the workspace scripts —
the pnpm version is pinned in `package.json`, so corepack fetches that one. Node is
pinned in `.node-version`, which most version managers read.

```bash
pnpm dev           # the whole stack, in Docker, watching your source
```

That is the loop: the database, object storage, the shared `@sloppy/*` builds, the API
and the web shell, all in containers. Edit a file on this machine and whatever owns it
reacts — the API comes back up, the web app hot-reloads, a shared package rebuilds and
lands in both. Nothing needs a `.env`: every value has a dev default. Ctrl-C stops it.

| Service         | URL                       |
| --------------- | ------------------------- |
| Web shell       | http://localhost:8030     |
| API             | http://localhost:8020/api |
| SurrealDB       | `ws://localhost:8010/rpc` |
| Object storage  | http://localhost:9010     |
| Storage console | http://localhost:9011     |

The web shell is the address Sloppy is used at: it forwards `/api` and the syr discovery
paths to the API, so the app and the API share an origin the way a deployment does.
`GET /api/health` answers 200 when the API can reach the database and 503 when it cannot.

Sign-in works from a clone with nothing else running: in dev the API also serves identity
itself (`SLOPPY_LOCAL_IDP`, on by default in `docker-compose.yml`), so an identity can be
made and used with no syr instance anywhere — pictures, a name, and a set of emoji
included. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) § "Local-only mode" →
"An API that serves identities itself". Set it to `0` to require an instance elsewhere.

The datastore ports are overridable with `SURREALDB_PORT`, `S3_PORT` and
`S3_CONSOLE_PORT`, offset from syr's own dev stack so both can run at once. 8020 and 8030
are fixed: sign-in comes back to the address in `PUBLIC_URL`, and those two are what it
names.

**One thing costs a rebuild.** A source edit costs nothing — it is copied straight into
the running container. Changing a dependency does: anything that moves `pnpm-lock.yaml`
(or the root `package.json`) rebuilds the image and recreates the API, the web shell and
the package builder, and the log says so as it happens.

```bash
pnpm stack:up      # the same stack, detached — nothing is watched, so edits sit
pnpm stack:logs    # follow it
pnpm stack:down    # stop it
pnpm stack:reset   # stop it and delete the lot: database, storage, package builds
```

`db/` and `s3/` are where the datastores keep their files; `stack:reset` is what
empties them.

### The native shell, and running on the host

Tauri builds an OS app, so `@sloppy/native` cannot run in a container. It runs here and
talks to the API in Docker, which is where it looks by default. It needs Rust — 1.77.2 or
newer, from [rustup](https://rustup.rs) — and so does `pnpm test`, which runs the shell's
own tests along with everything else. The first Rust build compiles an embedded database
and takes a few minutes; `pnpm test:ts` runs the TypeScript suite alone and needs no Rust
at all.

```bash
pnpm install
pnpm dev           # one terminal: the stack, API on 8020
pnpm dev:native    # another: the native shell against it
```

`pnpm dev:native` builds the shared `@sloppy/*` packages once as it starts and then holds
that copy: the containers go on watching them, the native shell does not. Re-run it after
an edit under `packages/ts`.

`pnpm dev:host` runs every dev server here instead, through Turbo, the way they all ran
before any of this was containerised; `pnpm dev:api` and `pnpm dev:web` run one each.
Sign-in on that path needs `PUBLIC_URL` naming the web shell's origin —
[`apps/sloppy/web/README.md`](apps/sloppy/web/README.md) says why.

## Something to look at

A new graph is empty, and most of what Sloppy does only shows at scale: a subtree
collapsing into a mega-node, detail dropping away as you pull back, a tag lighting up a set
that runs right across the tree. Against a running stack, this fills one identity's graph
with about 2,400 notes — deep chains, wide sibling runs, tags that cut across the genealogy,
and interiors divided into sections with real prose in them:

```bash
pnpm --filter @sloppy/api seed
```

With one identity on the stack it fills that one; `--did <did:syr:…>` names which to fill
when there is more than one, and whenever identity comes from a syr instance rather than
this API's own. `--nodes <n>` sizes the graph. An identity that already has notes is left
alone — **`--fresh` is what overrides that, and it erases everything that identity has here:
every graph, everything they published, and every region they pulled from a peer** — before
writing the new one.

## Common tasks

```bash
pnpm build         # build every package and app
pnpm check         # type-check the workspace
pnpm lint          # biome + eslint, per package
pnpm format        # write formatting
pnpm test          # run tests
pnpm test:ts       # the TypeScript ones alone, with no Rust build
```

Run the heavy ones — a forced rebuild, the whole suite — against a detached stack rather
than an attached `pnpm dev`. They write thousands of files at once, and under that much
churn the watcher can miss an edit or recreate the containers under you.

The integration suites run against the dev SurrealDB, and only when a run asks for them:
`pnpm stack:up`, then `SLOPPY_INTEGRATION=1 pnpm test`, is what exercises the table
definitions, the indexes and the purge, the delegation round trip, and Sloppy signing in
against its own provider for real. Asked for and finding nothing listening, they fail
rather than skip; unasked, they skip, so a run that never wanted them cannot be read as
one that had them. `SLOPPY_SURREALDB_URL` points them elsewhere.

## Formatting: who owns what

**Biome owns the pure TS/JS packages; Prettier owns everything Svelte.** The two sets are
mutually exclusive so no file is processed by both.

The split is declared once, in `biome.json`. `.lintstagedrc.mjs` **derives** the
Biome-owned directories by reading that file at runtime rather than keeping a second copy —
a hand-kept copy drifts, and the failure is quiet: a file gets formatted by Prettier at
commit and then rejected by its own package's `format:check`. Adding a package to the
Biome side means editing `biome.json` and nothing else.

`pnpm-workspace.yaml` carries the other convention worth knowing before you change it: the
workspace globs are **non-recursive on purpose**, and the file explains what the recursive
form cost.

Husky runs `lint-staged` on commit and the format + lint gates on push.
