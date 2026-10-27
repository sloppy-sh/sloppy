# Working on Sloppy

How to run it, what is in the tree, and the conventions a change is held to. For what
Sloppy is and who it is for, see [`README.md`](README.md).

**The rules a change is held to live in [`AI.md`](AI.md)** — the protocol the genealogy
is, what a block is, where Sloppy's vocabulary may and may not go, how comments and
user-facing copy are written, and how work is split when it is big enough to need it. Every
agent-config filename in the root (`CLAUDE.md`, `AGENTS.md`, `CONVENTIONS.md`, `.rules`
and the rest) is a symlink to that one file. Read it before a first change; it is the
document the review is against.

## Where it stands

**It is built and runs end to end**, and [`README.md`](README.md) says what that means for
somebody using it. For somebody changing it, the parts worth knowing before you start:

`pnpm test` is about 7,600 tests across some four hundred files. A dozen of those files are
integration suites that want a database listening, and a run has to ask for them, so a
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
On Linux, make `db/data` first and open it (`mkdir -p db/data && chmod 777 db/data`): the
database runs as a non-root user, and a directory Docker creates for the mount belongs to
root.

| Service         | URL                       |
| --------------- | ------------------------- |
| Web shell       | http://localhost:8030     |
| API             | http://localhost:8020/api |
| SurrealDB       | `ws://localhost:8010/rpc` |
| Object storage  | http://localhost:9010     |
| Storage browser | http://localhost:9011     |

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

## This repository's own notes

Sloppy keeps its own reasoning in `.sloppy/`, and the `sloppy` command is how anything
working here reads and writes it. Build it once:

```bash
pnpm build:packages
node packages/ts/cli/dist/sloppy.mjs check
```

`.mcp.json` at the root names the `sloppy` server — `sloppy mcp`, from that build — so an
assistant opened in this repository reaches the notes through Sloppy's own acts rather
than by editing the files. What it writes lands in `.sloppy/notes/` like any other edit,
and is reviewed in the diff with the rest of the change. docs/ARCHITECTURE.md § "An
assistant outside the app" is what it serves and what it leaves out.

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
