# Sloppy — Architecture

The detail [`AI.md`](../AI.md) defers to. AI.md states the rules; this file states the
shape they apply to.

> **Status.** Sloppy is early. This document describes the target architecture the
> milestones build toward, and marks what exists today. Where it says "will", nothing has
> been written yet. See the [README](../README.md) for what is actually in the tree.

## Deployment modes

Sloppy is a client application that can run against several backends. The client is
backend-agnostic; the same app serves all three.

- **Hosted** — the default. A Sloppy API and an external syr instance we run.
- **Self-hosted** — a person or a group runs their own Sloppy API and points it at their
  own syr instance. The client must let a user point at an arbitrary endpoint and
  interoperate with it exactly as it would with the default.
- **Local-only** — no network at all. The Tauri app embeds SurrealDB and an IdP that
  reimplements syr's wire contracts, so registration, sign-in, capture, and publishing all
  work on-device. Gated (see "Local-only mode" below) because SurrealDB alone is ~60 MB.

## Monorepo layout

pnpm + Turborepo workspace. TypeScript packages are managed by pnpm; Rust is managed by
Cargo and pnpm never sees it.

```
sloppy/
├── apps/
│   └── sloppy/
│       ├── api/     @sloppy/api     — NestJS backend (hosted & self-hostable)
│       ├── web/     @sloppy/web     — SvelteKit SPA shell
│       └── native/  @sloppy/native  — Tauri + SvelteKit shell (iOS, iPadOS, Android, desktop)
├── packages/
│   ├── ts/
│   │   ├── types/     @sloppy/types     — Zod schemas: node, block, label dimension, ink stroke,
│   │   │                                  publication, syr wire contracts
│   │   ├── client/    @sloppy/client    — backend-agnostic SloppyClient over fetch
│   │   ├── app-core/  @sloppy/app-core  — ALL pages, components, stores, the api layer, the runtime seam
│   │   ├── ui/        @sloppy/ui        — shadcn-svelte vocabulary + app.css design tokens
│   │   ├── data/      @sloppy/data      — SurrealDB repositories, schema.ts, purge.ts
│   │   ├── graph/     @sloppy/graph     — pixi renderer + graphology model + layout worker
│   │   └── idp/       @sloppy/idp       — syr IdP wire contracts + crypto, for local mode
│   └── rust/                            — shared crates (Cargo)
├── docs/
├── scripts/
├── docker-compose.yml   (dev stack: SurrealDB + object storage)
├── pnpm-workspace.yaml  (workspace globs + the version catalog)
├── turbo.json
├── biome.json           (which packages Biome owns; Prettier owns the rest)
└── package.json
```

**The workspace globs are `apps/*/*` and `packages/ts/*`, non-recursive**, and that is
load-bearing rather than tidy. `pnpm-workspace.yaml` carries the measurements.

**The shells are ~200-line boots.** Everything product-shaped lives in `@sloppy/app-core`.
One codebase serves web and native only for as long as that holds.

## The two files that carry the platform seam

- **`app-core/src/lib/runtime.ts`** — an `AppRuntime` interface where **the absence of
  each optional member is meaningful**. `openExternal?` undefined on web means OAuth
  navigates the tab; `createApi?` present on native means local mode is available. The
  shell calls `initRuntime()` from its root layout before any page mounts.
- **`app-core/src/lib/api.ts`** — `api` is a `Proxy` that resolves its implementation on
  first property access, so remote ↔ local swaps without touching a call site.

Platform branching is **compile-time**, via `import.meta.env.TAURI_ENV_PLATFORM`
(`IS_MOBILE`, `IS_APPLE`), with `envPrefix: ['VITE_','PUBLIC_','TAURI_ENV_']` in
`vite.config.ts` so the constants dead-code-eliminate per target. A runtime `if (isIOS)`
ships both branches to every platform.

## The addressing protocol

The part that has to be right first, because peers hold each other's addresses. AI.md § "The
Address Is the Protocol" states the rules; this is the mechanism.

- Root nodes take integers: `1`, `2`, `3`.
- A child alternates segment type: `1` → `1a` → `1a1` → `1a1a`.
- A sibling increments the last segment: `1a` → `1b`.
- Addresses are assigned at creation and **never change**. Moving a node writes an alias;
  it never renumbers.
- The address hashes to a stable **angular sector**, so a subtree radiates in the same
  direction from its origin on every peer's screen. The sector is derived on read, never
  stored.

Determinism is a property test over generated creation sequences: two simulated peers
applying identical operations must produce byte-identical addresses.

## syr integration

### The constraint that shapes everything

**syr has no lexicon system and no extension point for third-party record types.** Its own
comparison document names this as a feature: "third-party repo pollution: structurally
prevented; apps don't write into your identity store." So "use syr for account and content
management" resolves into a split — the same one Slyng made:

| Concern                                    | Owner                                                                 |
| ------------------------------------------ | --------------------------------------------------------------------- |
| Identity, DID, keys, signing               | **syr** — Platform Delegation                                         |
| Profile data                               | **syr** — never stored locally, resolved from the manifest and cached |
| Media blobs (block images, ink rasters)    | **syr** — presign → PUT → complete                                    |
| Emoji, stickers, GIFs, reactions, comments | **syr** — per-DID catalogs, federated                                 |
| **Nodes, addresses, labels, blocks, ink**  | **Sloppy's own API + SurrealDB**                                      |

### Auth: Platform Delegation v0.1

`GET /.well-known/syr` → read `manifest.platform.*` → redirect to `platform.consent` →
callback yields `code` + `delegation_id` → `POST platform.token` →
`{ access_token, did, delegate_public_key, scopes }`. Content is signed via
`POST platform.sign`; the syr instance holds the delegate key, so **Sloppy never touches a
private key.**

Port the implementation, not the spec, from Slyng's `auth.controller.ts` /
`auth.service.ts`. It carries an HMAC-signed `state` holding the instance URL specifically
because **syr does a byte-identical match on `callback_url`** — a detail that costs a day
to rediscover.

### Local-only mode

Slyng's `idp/` tree reimplements syr's wire contracts; it lifts into `@sloppy/idp` with
its crypto. The Nest module is gated on `SLOPPY_LOCAL_IDP`, and the embedded SurrealDB is
gated on a Cargo `local-mode` feature driven from **the same variable** as the frontend
flag, so the two cannot drift. Off by default.

### Federating the graph

syr federation is **pull-only** — no relay, no firehose. Follow a DID → resolve
DID→provider → fetch `/.well-known/syr/{did}` → hit that identity's public endpoints
directly.

Sloppy adds a public read endpoint for published subtrees. A peer follows a DID and pulls
their subtree in as a foreign, read-only region **with its addresses intact** — the
deterministic address is what makes a pulled subtree land in a known shape rather than as
an opaque blob.

**`proxied()` on every remote asset.** Viewing a federated node must never leak the
viewer's IP to the author's instance. The pattern is Slyng's
(`app-core/.../utils/proxy.ts` → `api/src/proxy/proxy.controller.ts`).

## Data model

Own SurrealDB, repository pattern, no ORM — the house pattern across Pendi, syr and Slyng.
The schemas are `@sloppy/types`; the table definitions and the purge are `@sloppy/data`.

A row's key is composite — `table:{ created_by: <did>, id: <ulid> }` — so it is globally
unique the moment it is written, which is what lets a peer hold somebody else's node
without renaming it. A **ref** below is how one row points at another: the string
`<did>/<ulid>`, the form the reference already travels in. Every row also carries
`created_at` and `updated_at` as **iso** — see the timestamp rule below.

```
node:{ created_by: <did>, id: <ulid> }
  created_by  did       the owner, flat and immutable
  address     string    Folgezettel, immutable
  depth       int       the address's segment count; a root is 1, immutable
  parent      ref?      absent on a root
  origin      ref       the root of this node's tree; a root is its own origin
  title       string
  labels      object    { dimension: value }
  links       ref[]     non-genealogical associative links
  published   bool
  created_at  iso       immutable — it is a field of the signed payload
  updated_at  iso
  content_signature, signed_payload_json, signing_device_public_key

block:{ created_by: <did>, id: <ulid> }
  created_by  did
  node        ref
  ord         string    fractional index — reorder without renumbering
  type        paragraph | heading | list | todo | code | image | ink | embed
  content     markdown with :emoji: / ::sticker:: shortcodes
  data?       the type's own payload — InkBlockData for `ink`, nothing for `paragraph`

label_dimension:{ created_by: <did>, id: <ulid> }
  created_by  did
  name        string
  values      string[]
  color_slot  1–8?      the --facet-N slot; absent means declaration order (DESIGN.md)

publication:{ created_by: <did>, id: <ulid> }
  created_by    did
  root          ref       the subtree this makes readable
  root_address  string    what a peer cites
```

The rules AI.md's foundation-wave section states, applied here:

- Every user-owned table has `created_by` and is purged by it. Purging through a parent row
  leaks every orphan, permanently. `schema.ts` makes the column immutable, so ownership
  cannot be reassigned out from under the sweep.
- **`created_by` is a top-level column and not just the `created_by` inside the key**,
  because SurrealDB will not use a composite index whose second column is a nested path.
  Every index leads with it, which is what lets one index serve the user-scoped read and
  the purge both.
- **A link is a ref, not a SurrealDB record link.** Measured on 3.1.3: an index on a column
  holding a _composite_ record id still enforces `UNIQUE`, but the planner never chooses
  it — `EXPLAIN` gives a TableScan for an equality on such a column and an IndexScan for
  the same equality on a string. So the composite id is the row's own key and nothing
  else's column.
- **A timestamp is an ISO-8601 UTC string at millisecond precision** — `TimestampSchema`
  in `@sloppy/types`, minted by `nowIso()` — in the row, on the wire to a peer, and inside
  a signed payload. It is one encoding rather than two because the alternative has no
  quiet failure mode: the pinned `surrealdb` client decodes a stored datetime to its own
  `DateTime` class, for which `instanceof Date` is false, so a row written with
  `time::now()` is a row no reader can validate. `schema.ts` therefore defines the columns
  `TYPE string`, which makes such a write fail where it is made. Fixed precision is part
  of the rule: the same instant written two widths is two byte strings, and a signature is
  over the bytes. Lexicographic order over these strings is chronological order, so
  `ORDER BY created_at` needs nothing further.
- **Nothing derivable from the address is stored, except `depth`** — AI.md § "The Address
  Is the Protocol" states the rule, and this is the one ratified exception to it. The
  angular sector and subtree membership stay functions in `address.ts`.

  The read that buys the exception is level of detail. It collapses a subtree past a
  threshold measured from the node in focus, which reads at first like something a stored
  absolute cannot serve — but `depth(focus)` is known before the query is sent, so the
  relative threshold arrives absolute:
  `created_by = $did AND origin = $origin AND depth <= $max`. Without the column, a peer
  pulling a foreign region fetches the whole tree and filters on the client, which is
  exactly the case the mobile-first stance optimises for. The cost is one integer and one
  index now; the alternative is a migration on the protocol's core table later.

  A second copy of a truth is only safe while it cannot drift, so the exception is
  conditioned on holding `depth = parseAddress(address).length` by construction. `depth` is
  written from `addressDepth()` and nothing else; `parseNode()` in `@sloppy/types` is where
  every row is held to the equality, in both directions, because the column is immutable and
  a row that gets past it is wrong for as long as it exists. `ASSERT $value > 0` pins the
  convention on top of that: a root is 1, so a writer that counted from the other end fails
  at its first write rather than mis-slicing every region it goes on to store.

- `schema.ts` is one contiguous string literal, so it is foundation-wave territory rather
  than per-track. Production SurrealDB serves only `DEFINE`d tables; dev does not enforce
  it, so an undeclared table passes locally and fails in production.

Tables are `SCHEMALESS`, and `DEFINE FIELD` is spent only where the database has to enforce
something the application cannot be trusted to. Four things qualify, all of them stated
above: `node.address` and every table's `created_by`, made immutable with `READONLY`;
`created_at` / `updated_at` as `TYPE string`, which is what makes a write in the wrong
encoding fail at the write; and `node.depth`, immutable like the address it mirrors and
`TYPE int ASSERT $value > 0`, because it is read as a range and a range is where a string or
a zero would go wrong quietly. `created_at` is immutable too, being a field of the signed
payload. Everything else is a plain column, which is what keeps a later track from having to
edit the shared literal to add a field.

**`READONLY` and not the `VALUE $before OR $value` idiom**, measured on 3.1.3: that idiom
keeps the old value only while the old value is truthy, so a row first written with `""` in
one of these columns is freely mutable ever after — and a `created_by` reassigned out from
under the purge is somebody's writing still answering after they asked to be gone. `READONLY`
refuses whatever the column holds, and refuses loudly, the stance the `UNIQUE` address index
already takes. Re-sending a value unchanged is not a change and still goes through, and a
`CONTENT` that omits the column keeps it, so a whole-row save needs no list of which columns
are immutable.

**`ord` as a fractional index and composite record ids are both chosen with the future CRDT
layer in mind** — they are the two things that would otherwise have to be retrofitted.
Shared notes on a linked graph are explicitly future work: they need a CRDT and a realtime
transport that syr's pull-only federation does not provide.

## Graph rendering

`@sloppy/graph`: **graphology** (model) + **d3-force** in a Web Worker (layout) +
**pixi.js v8** (render). All three are permissively licensed, which is the whole reason the
renderer is ours.

> Logseq's graph view is exactly the right architecture and exactly these three libraries,
> but that repo is **AGPL-3.0**; copying it would place Sloppy under AGPL. We adopt the
> approach and write the renderer.
>
> xyflow was the alternative and is rejected: it renders nodes as DOM, which is excellent
> for a few hundred richly-interactive nodes and unusable for the tens of thousands a mature
> Zettelkasten produces, especially on tablet hardware.

**No `SharedArrayBuffer`, no wasm threads.** Cross-origin isolation is not available to us
on the Apple `WKWebView` shell. The layout worker stays plain single-threaded JS; if it
proves too slow on device, the fallback is a Rust command, not cross-origin isolation.

The ownership line between Svelte and pixi, and level-of-detail as the perf strategy, are
in [`DESIGN.md`](../DESIGN.md) § "The canvas" — they are design contracts, not just
implementation notes.

## Blocks and ink

**TipTap 3 + `@tiptap/markdown`, storing Markdown.** Slyng's `post-editor` was itself
ported from Pendi's `journal-editor`, so we extend that lineage rather than start over:
the WYSIWYG surface, `emoji-node.ts` (a TipTap inline atom serializing back to
`:code:`/`::code::`), `emoji-suggestion`, and `media-node.ts` with its upload-in-progress →
final-URL replacement and durable-ref pattern.

The emoji tokenizer's ordering is load-bearing and must be carried across: **mention spans
are captured first** (a `did:syr:…` contains colons that would false-match `:syr:`),
stickers before emoji, then linkify. Size comes from the syntax used, not a stored flag.

**`InkNode` is new.** A TipTap atom holding stroke data (point, pressure, tilt, timestamp)
rendered to canvas, with a rasterized PNG pushed to syr blob storage so peers who cannot
re-render strokes still see the drawing.

**TipTap's editor instance must not be `$state`** — Svelte's deep proxy corrupts its
internals. Use a separate `ready` flag for post-mount UI.

## Native shell

Mirrors Pendi's `src-tauri` (`tauri 2.11.2`, `tauri-build 2.6.2`, `@tauri-apps/cli ^2.5.0`).

- **Platform-split capabilities** — `default.json`, `mobile.json`
  (`platforms: ["android","iOS"]`), `apple.json` (`["iOS","macOS"]`), `android.json`, each
  with a `description` explaining _why_.
- **Plugins grouped by `cfg`** in `Cargo.toml`. Inherit `tauri-plugin-safe-area-insets-css`
  (mobile) and `tauri-plugin-system-components` (Apple/Android).
- **`iOS.minimumSystemVersion` is `16.0`**, and the newer pointer-event APIs are
  feature-detected. Requiring 18.2 app-wide to get smooth ink is the wrong trade.
- **The iPad-first patch.** `tauri ios init` generates `gen/apple/project.yml` with
  `LSRequiresIPhoneOS: true`. Sloppy needs **`false`** with `TARGETED_DEVICE_FAMILY: "1,2"`.
  The file is regenerated, so this is a documented post-generate patch step, not an edit
  somebody makes once and loses.
- **`scripts/tauri.sh`** bakes env and raises a Cloudflare dev tunnel, so a physical iPad
  reaches the local API and syr instance on one origin. `vite.config.ts` reads
  `TAURI_DEV_HOST` and binds to the LAN address with a separate HMR port during mobile dev;
  `svelte.config.js` uses `adapter-static` with `fallback: 'index.html'`.

**Apple Pencil, precisely.** Tauri v2 on iOS renders through `WKWebView`, so Pencil arrives
as Pointer Events: `pointerType === 'pen'`, `pressure`, `tiltX`/`tiltY`,
`altitudeAngle`/`azimuthAngle`, and `getCoalescedEvents()`/`getPredictedEvents()` — the
last three landed in **Safari 18.2** and are what make ink smooth rather than polygonal.
There is **no simultaneous pen + touch** (WebKit drives one input type at a time), which is
what the gesture split in DESIGN.md is built on. There are **no Pencil Pro gestures** on
the web layer. Latency will not match native PencilKit, which is acceptable because ink is
a block type and an annotation layer here, not the product itself.

## Verification

- `pnpm check`, `pnpm lint`, `pnpm test` from the root via turbo; `cargo fmt --check` and
  `cargo clippy -D warnings` against `src-tauri`.
- **The schema against a running server.** Immutability, the unique index and the timestamp
  type are claims about an engine, not about a string, so `@sloppy/data` asserts them over
  the dev stack. The suite skips when nothing is listening and fails when something is: it
  is also what catches a `surrealdb` client and a server image that no longer pair.
- **Address determinism as a property test** — two simulated peers, identical creation
  sequences, byte-identical addresses. This is the protocol claim; prove it, never assert it.
- **syr round trip** — bring up syr's own docker-compose, complete Platform Delegation end
  to end, and verify a `platform.sign` signature independently with `@syr-is/crypto`.
- **Local mode** — set `SLOPPY_LOCAL_IDP` with no external syr reachable; register, sign
  in, create a node, publish a subtree.
- **On-device Pencil check** — `pnpm tauri ios dev` on a physical iPad. Log `pointerType`,
  the `pressure` range, and `getCoalescedEvents().length` during a fast stroke. Pressure
  must vary; coalesced length must exceed 1.
- **Graph perf** — seed 10k nodes and measure frame time on device, not in the simulator.
