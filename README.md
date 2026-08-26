# Sloppy

A Zettelkasten-structured, socially-shareable knowledge graph.

Notion imposes a tree; Obsidian imposes nothing. Sloppy takes a third position: **the
shape of the graph is part of the protocol, not a per-user accident.** Every node's
address derives from where the thought came from — `1`, `1a`, `1a1`, `1b` — by rules that
are the same on every peer, so one person's subtree can be published, pulled into
somebody else's graph, and land in a shape they can read, with its addresses intact.

Labels are typed dimensions (`domain:biology`, `status:seed`), not free tags, so sets
intersect _across_ the tree. A subtree collapses into a mega-node that expands on tap. A
dimension can be picked up as a **lens** that re-clusters the same nodes along it. Node
interiors are block stacks, including ink blocks drawn with the Apple Pencil.

Mobile and tablet are the primary surface. Desktop is the same product with more room.

- Product direction: [`PRODUCT.md`](PRODUCT.md) · Visual system: [`DESIGN.md`](DESIGN.md)
- Architecture, the syr split, the data model: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Contributor and agent instructions: [`AI.md`](AI.md)

## Status

**The vocabulary exists; the product does not yet.** What is in the tree today is the build
foundation — the conventions, the pnpm + Turborepo workspace, the formatter split, the dev
stack — plus the two packages every later branch reads from: `@sloppy/types` (the address
protocol and the node/block/label/publication schemas) and `@sloppy/data` (the table
definitions and the per-user purge). The apps and the remaining packages are created by the
milestones that follow, so `pnpm dev` currently has nothing to run; `pnpm test` does.

## Stack

pnpm + Turborepo monorepo. The two rows marked ✓ are in the tree; the rest are ahead.

| Path                   | Package            | Tech                                              |     |
| ---------------------- | ------------------ | ------------------------------------------------- | --- |
| `apps/sloppy/api`      | `@sloppy/api`      | NestJS API                                        |     |
| `apps/sloppy/web`      | `@sloppy/web`      | SvelteKit (SPA shell)                             |     |
| `apps/sloppy/native`   | `@sloppy/native`   | Tauri + SvelteKit (iOS, iPadOS, Android, desktop) |     |
| `packages/ts/types`    | `@sloppy/types`    | Shared Zod schemas                                | ✓   |
| `packages/ts/client`   | `@sloppy/client`   | Backend-agnostic API client                       |     |
| `packages/ts/app-core` | `@sloppy/app-core` | Every page, component, store and API call         |     |
| `packages/ts/ui`       | `@sloppy/ui`       | shadcn-svelte components + design tokens          |     |
| `packages/ts/data`     | `@sloppy/data`     | SurrealDB repositories, schema, purge             | ✓   |
| `packages/ts/graph`    | `@sloppy/graph`    | pixi.js v8 + graphology + d3-force                |     |
| `packages/ts/idp`      | `@sloppy/idp`      | syr IdP contracts + crypto, for local mode        |     |

Identity, profiles, media blobs, emoji and reactions come from **syr**; nodes, addresses,
labels, blocks and ink are Sloppy's own. That split is not a preference — see
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Run it

Requires Node ≥ 20 and `corepack enable`. The pnpm version is pinned in `package.json`,
so corepack fetches that one.

```bash
pnpm install
pnpm stack:up      # SurrealDB + object storage, in Docker
pnpm dev           # every app and package, via Turbo
```

`pnpm stack:up` needs no `.env` — every value has a dev default. The published ports are
offset from syr's own dev stack so the two can run side by side:

| Service         | URL                       |
| --------------- | ------------------------- |
| SurrealDB       | `ws://localhost:8010/rpc` |
| Object storage  | http://localhost:9010     |
| Storage console | http://localhost:9011     |

Override any of them with `SURREALDB_PORT`, `S3_PORT`, `S3_CONSOLE_PORT`. `pnpm
stack:down` takes it back down; `db/` and `s3/` hold the volumes and are disposable.

## Common tasks

```bash
pnpm build         # build every package and app
pnpm check         # type-check the workspace
pnpm lint          # biome + eslint, per package
pnpm format        # write formatting
pnpm test          # run tests
```

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
