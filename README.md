# Sloppy

A Zettelkasten-structured, socially-shareable knowledge graph.

Notion imposes a tree; Obsidian imposes nothing. Sloppy takes a third position: **the
shape of the graph is part of the protocol, not a per-user accident.** Every node's
address derives from where the thought came from — `1`, `1a`, `1a1`, `1b` — by rules that
are the same on every peer, so one person's subtree can be published, pulled into
somebody else's graph, and land in a shape they can read, with its addresses intact.

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

**The contracts exist; the product does not yet.** What is in the tree today is the build
foundation and the seams every later branch reads: `@sloppy/types` (the address protocol,
the node/block/tag/publication schemas, and the API's wire shapes), `@sloppy/data` (the
table definitions and the per-user purge), `@sloppy/client` (the whole method surface, over
`fetch`), `@sloppy/app-core` (the platform seam and the api proxy), `@sloppy/ui` (the design
tokens), `@sloppy/idp` (syr's wire contracts and crypto, served by the API when it is asked
to be the identity provider itself) and `@sloppy/api` (a NestJS API that signs people in
through syr; its node and block modules are still empty).

So `pnpm dev` brings up the web shell over an API that can start a session and little
else, and there is no graph to put in it yet. `pnpm test` is real: it holds the address
protocol, the schema against a live SurrealDB, and the design system's contrast floors.

## Stack

pnpm + Turborepo monorepo. The rows marked ✓ are in the tree; the rest are ahead.

| Path                   | Package            | Tech                                              |     |
| ---------------------- | ------------------ | ------------------------------------------------- | --- |
| `apps/sloppy/api`      | `@sloppy/api`      | NestJS API                                        | ✓   |
| `apps/sloppy/web`      | `@sloppy/web`      | SvelteKit (SPA shell)                             | ✓   |
| `apps/sloppy/native`   | `@sloppy/native`   | Tauri + SvelteKit (iOS, iPadOS, Android, desktop) |     |
| `packages/ts/types`    | `@sloppy/types`    | Shared Zod schemas                                | ✓   |
| `packages/ts/client`   | `@sloppy/client`   | Backend-agnostic API client                       | ✓   |
| `packages/ts/app-core` | `@sloppy/app-core` | Every page, component, store and API call         | ✓   |
| `packages/ts/ui`       | `@sloppy/ui`       | shadcn-svelte components + design tokens          | ✓   |
| `packages/ts/data`     | `@sloppy/data`     | SurrealDB repositories, schema, purge             | ✓   |
| `packages/ts/graph`    | `@sloppy/graph`    | pixi.js v8 + graphology + d3-force                |     |
| `packages/ts/idp`      | `@sloppy/idp`      | syr IdP contracts + crypto, for local mode        | ✓   |

Identity, profiles, media blobs, emoji and reactions come from **syr**; nodes, addresses,
tags, blocks and ink are Sloppy's own. That split is not a preference — see
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Run it

Requires Docker. `corepack enable` too, for the native shell and the workspace scripts —
the pnpm version is pinned in `package.json`, so corepack fetches that one.

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
talks to the API in Docker, which is where it looks by default:

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

## Common tasks

```bash
pnpm build         # build every package and app
pnpm check         # type-check the workspace
pnpm lint          # biome + eslint, per package
pnpm format        # write formatting
pnpm test          # run tests
```

Run the heavy ones — a forced rebuild, the whole suite — against a detached stack rather
than an attached `pnpm dev`. They write thousands of files at once, and under that much
churn the watcher can miss an edit or recreate the containers under you.

The integration suites run against the dev SurrealDB and skip when nothing is listening, so
`pnpm stack:up` before `pnpm test` is what exercises the table definitions, the indexes and
the purge, the delegation round trip, and Sloppy signing in against its own provider for
real. `SLOPPY_SURREALDB_URL` points them elsewhere.

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
