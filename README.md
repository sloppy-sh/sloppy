# Sloppy

A Zettelkasten-structured, socially-shareable knowledge graph.

Notion imposes a tree; Obsidian imposes nothing. Sloppy takes a third position: **the
shape of the graph is part of the protocol, not a per-user accident.** What a note sprang
out of, and the order it was written in, are read the same way on every peer, so one
person's subtree can be published, pulled into somebody else's graph, and land in the shape
its author saw. On top of that shape a note carries an **address** — `1`, `1a`, `1a1`,
`1b` — the label its author cites it by, offered by the Folgezettel rule and theirs to
change or leave off.

A note carries **tags** — plain strings, nothing declared first — so sets intersect
_across_ the tree. Selecting several **highlights** the notes that carry them and dims the
rest, so the answer is read against the shape of the graph rather than instead of it. A
subtree collapses into a mega-node that expands on tap. A note's interior is a stack of
**blocks**, each one a section its author added deliberately and wrote as many paragraphs,
lists, pictures and Apple-Pencil drawings into as they liked.

Mobile and tablet are the primary surface. Desktop is the same product with more room.

- Product direction: [`PRODUCT.md`](PRODUCT.md) · Visual system: [`DESIGN.md`](DESIGN.md)
- Architecture, the syr split, the data model: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Contributor and agent instructions: [`AI.md`](AI.md)

## Status

**The product is built and runs end to end.** From a clone, `pnpm dev` brings up something
you can use: sign in — against a syr instance, or against the API's own identity provider
with nothing else running anywhere — keep as many graphs as you want a notebook for, and
write notes that are offered a Folgezettel address by rules every peer applies the same way.
A note's interior is a stack of blocks, each holding paragraphs, headings, lists, code,
pictures and Apple-Pencil ink. Tags cut across the genealogy and highlight rather than
filter. The graph itself is a pixi canvas: a subtree collapses into a mega-node, detail
drops away as you pull back, and a reader may put a picture behind the field. A subtree can
be published and a peer's published region pulled into a graph of your own and
read there, with profiles, comments, reactions and emoji coming from the identity side.
Everything you have written comes back out as one file whenever you ask for it.

`pnpm test` is about 3,600 tests across roughly two hundred files. A dozen of those files
are integration suites that want a database listening, and a run has to ask for them, so a
clone with nothing else running still gets a green suite; Common tasks below is how to ask.

What is still ahead is narrower than what is behind it. The native shell's on-device store
is off by default, so an installed app still talks to an API rather than working with no
network at all; and the page a browser lands on when it resolves somebody's identity has
nothing answering it yet.

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
included. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) § "Local-only mode". Set it
to `0` to require an instance elsewhere.

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
