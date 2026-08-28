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
│   │   ├── types/     @sloppy/types     — Zod schemas: node, block, tag, ink stroke,
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
├── docker/dev/          (the one image api, web and the package builder share)
├── docker-compose.yml   (the whole dev stack, watching this machine's source)
├── pnpm-workspace.yaml  (workspace globs + the version catalog)
├── turbo.json
├── biome.json           (which packages Biome owns; Prettier owns the rest)
└── package.json
```

**The workspace globs are `apps/*/*` and `packages/ts/*`, non-recursive**, and that is
load-bearing rather than tidy. `pnpm-workspace.yaml` carries the measurements.

**The shells are ~200-line boots.** Everything product-shaped lives in `@sloppy/app-core`.
One codebase serves web and native only for as long as that holds.

**`apps/sloppy/api/src/app.module.ts` is a foundation file.** A shared import list is the
one file every branch edits and then every branch conflicts on, so a milestone fills one of
the feature modules it already imports — auth, idp, node, block, media, profile, emoji —
and a new entry is added in the foundation wave, before any track forks, or not at all. An
entry earns its place only by owning a concern none of the others does. `IdpModule` is a
dynamic module for a related reason: local mode is gated on whether it registers anything,
and that decision has to live inside it.

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
| **Nodes, addresses, tags, blocks, ink**    | **Sloppy's own API + SurrealDB**                                      |

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

**The embedded provider holds files, emoji and a profile, because a provider that does not
is not one.** Avatars, banners, emoji and block pictures are syr's to keep (the table
above), so an instance whose identity provider serves no `/uploads`, `/folders`, `/emojis`
or `/user/profile` has no media, no custom emoji and no editable profile at all — the
routes that answer are `api/src/idp/{owner,blob}.controller.ts` and the rules behind them
are `@sloppy/idp`'s `files.ts` and `emojis.ts`.

- **The bytes go to object storage; the row goes to SurrealDB.** `idp_upload` names where
  a blob sits and what it is; `BlobStore` is the S3 client that holds it. Every object is
  private and reads are served by `GET /api/idp/blob/{did}/{localId}`, so the store is
  never exposed to the internet and an asset URL stays valid for the upload's life.
- **A folder named `public` is the whole access rule.** An upload under one is readable by
  anyone and is listed by `GET /api/idp/public/uploads/{did}`; anything else answers only
  its owner's token, including `GET /api/idp/uploads`, which lists one folder back to the
  person who owns it. Which folder a role writes into is § "Pictures" below.
- **`upload_url` is opaque by contract.** This provider signs a URL to its own route
  rather than presigning an S3 one; `@sloppy/types`' `media.ts` is written so a caller
  cannot tell the difference.
- **Scopes are recorded on the delegation and enforced.** `posts:write` is what the
  consent screen asks for and what every write above checks — a delegation without it can
  read and nothing more.

### Federating the graph

syr federation is **pull-only** — no relay, no firehose. Follow a DID → resolve
DID→provider → fetch `/.well-known/syr/{did}` → hit that identity's public endpoints
directly.

Sloppy adds a public read endpoint for published subtrees. A peer follows a DID and pulls
their subtree in as a foreign, read-only region **with its addresses intact** — the
deterministic address is what makes a pulled subtree land in a known shape rather than as
an opaque blob.

## Pictures

Who may read a picture is decided once, by the folder its bytes land in, and everything
else follows from that. `folderPathFor` in `api/src/media/media.service.ts` is the whole
policy:

| Role                       | Folder            | Who can read it                                          |
| -------------------------- | ----------------- | -------------------------------------------------------- |
| `avatar`, `banner`         | `public/sloppy/…` | anyone — a peer resolving the DID has to see them        |
| `emoji`                    | `public/sloppy/…` | anyone — a federated `:shortcode:` renders for everybody |
| `block` (a note's picture) | `sloppy/notes`    | its owner alone                                          |

**A note is private until its subtree is published, so its pictures are too.** The owner
reads one back through `GET /api/media/uploads/{did}/{localId}`, which asks their own
store for it as them; nothing else can, and it is not listed among an identity's public
uploads. `GET /api/media/uploads` lists the ones they put in a note, newest first, so a
picture can be used twice without being sent twice — the same folder decides what is in
it, so nothing from a profile is. That route needs the reader's session and an `<img>`
sends none, so `SloppyClient.ownPicture` fetches the bytes with the reader's own
credential and hands back something the browser can draw from memory. On the web shell
that session is a token and not a cookie — sign-in there finishes through the hand-off in
`auth.controller.ts`, so an address alone would reach this route as a stranger. It is the
only way one of these draws, which is why a `MediaAsset` carries an `upload_id` and no
address at all: who may read a picture is the store's answer, not the row's.

**Open gap, and the milestone that owns it: publishing a subtree does not yet make its
pictures reachable.** A peer who pulls a published subtree today gets addresses that
answer 404, because the bytes sit outside `public/`. Federation-side publishing is what
has to close this — by moving or re-publishing a published node's blobs — and it must
close it deliberately: an address a peer already holds is load-bearing (AI.md § "The
Address Is the Protocol"), so a URL minted public cannot quietly become private later.
That is why the default is private now and widened at publish, never the other way round.

**Every renderable address is minted by the API, and none of them is a URL.** `AssetLinks`
(`api/src/media/asset-link.ts`) signs the address a picture actually lives at and hands
back a path — `/proxy?ref=…` — because this instance answers at several addresses and
cannot see which of them a shell can reach: a web shell forwards `/api` from its own
origin, the native shell dials a host and port a person configured. An origin chosen here
would be a guess, and on a phone a wrong one. `proxied()` in `@sloppy/client`'s `host.ts`
is the client half: it resolves a minted path against the host this shell reaches, and
sends anything absolute — a look-alike from a peer included — to the asset route unsigned,
where it is refused rather than fetched.

`GET /api/proxy` fetches what the signature names and nothing a caller typed, so a route
that has to be public (an `<img>` carries no credential) is still not somewhere a stranger
can aim this instance. It refuses anything the far end answers with that is not one of the
image types `media.service.ts` enumerates, because a signature alone would still let a
redirect launder a document. Which addresses it will connect to is
`api/src/media/remote-host.ts` — **every** redirect hop is checked there, not only the
address a link named, and a credential is dropped the moment a hop leaves the origin it
was for.

**How much it will carry is enforced on the bytes that arrive**, because a declared length
is the far end's claim and can be absent. A body that runs past the cap has its transfer
dropped: the head is out by then, so there is no status left to say it with, and a
truncated file delivered as a whole one is worse than a broken image. `picture-relay.ts`
drives the writes from one place for exactly this reason — a cap that ends the response
while something else is still piping into it ends the process instead of the transfer.

**Nothing a caller sends names a picture by address.** A profile and an emoji name an
upload or a catalog entry, and the API reads the address back out of the caller's own
store — otherwise a signed-in caller could have this instance mint a durable public link
for a URL of their choosing and fetch it from this instance's address for every reader.
**Owning a picture is not enough to use it for anything**, either: `ownPicture` is told
what the picture is about to be used AS, and a note's picture named as an avatar or a
banner is refused. A profile is read by strangers, so accepting one would write a private
blob's address into a public record and leave a picture nobody — its owner included — can
see.

**The route rations fetches per caller**, which is what stands between a public route and
a stranger's fetch loop. A link this instance did not mint spends nothing, so a caller
holding no link cannot empty anybody's ration. Who the caller is comes from the session,
or from `req.ip` — and behind a reverse proxy that is the proxy unless the instance is
told otherwise, which would put every anonymous reader on one shared ration.
`SLOPPY_TRUSTED_PROXIES` is that setting: how many proxies forward here, or which
addresses they have. Development trusts the private network by default, because the web
shell's dev server stands in for the shared origin.

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
  tags        string[]  normalized, deduplicated, sorted — @sloppy/types' TagsSchema
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

**A deleted note leaves its inbound links behind.** `links` is an array of refs on the
*linking* node, so removing a note cannot reach the notes that pointed at it — deletion takes
the subtree, not the mentions. The note surface renders a missing target honestly ("A note
that is no longer here.") with its own unlink control, so nobody is shown a row that waits
forever, but nothing sweeps the stale refs. Whichever milestone adds a sweep owns deciding
whether it runs on delete or on read; until then the stored array is a superset of what
resolves.

publication:{ created_by: <did>, id: <ulid> }
  created_by    did
  root          ref       the subtree this makes readable
  root_address  string    what a peer cites
```

The rules AI.md's foundation-wave section states, applied here:

- Every user-owned table has `created_by` and is purged by it. Purging through a parent row
  leaks every orphan, permanently. `schema.ts` makes the column immutable, so ownership
  cannot be reassigned out from under the sweep.
- **Erasing an identity erases its bytes too, and the signature says so.**
  `purgeIdentity` in `@sloppy/idp`'s `store.ts` takes the object-store removal as a
  parameter, because a sweep that drops the upload rows and leaves the objects has not
  deleted anybody's pictures — and the store belongs to the API, not to the package that
  owns the rows. The rows go second, so a store that was down for the first attempt leaves
  a second one something to work from.
- **`created_by` is a top-level column and not just the `created_by` inside the key**,
  because SurrealDB will not use a composite index whose second column is a nested path.
  Every index over scalars leads with it, which is what lets one index serve the
  user-scoped read and the purge both.
- **`node_tags` is the exception to that, and it is read pinned.** An index over an array
  column holds one entry per element, so `tags = $tag` is a membership seek — but only
  while that index is the one answering it, and plain array equality otherwise. Measured
  on 3.1.3, an unpinned read the planner hands to another index (an `ORDER BY` is enough)
  comes back with **zero rows and no error**, and a composite `created_by, tags` fails the
  same silent way. So the owner is a filter over the seek rather than the leading column,
  and every tag read is written
  `FROM node WITH INDEX node_tags WHERE tags = $tag AND created_by = $did`.
  `tags CONTAINS $tag` is always correct and never uses the index; it is not the spelling.
  `schema.integration.test.ts` holds both halves against a running server.
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
- **A row crosses the wire as a view of itself**, with the composite key replaced by the
  `<did>/<ulid>` ref the row is already pointed at by. `@sloppy/types`' `api.ts` derives
  `NodeView`, `BlockView` and `PublicationView` from the entity
  schemas and converts with `entityView()`, so the wire cannot drift from the row. The
  substitution is what makes a row expressible as JSON at all: the key is a SurrealDB
  `RecordId`, and no JSON encoding round-trips back into the class that validates one.
  `PublishedSubtree` is the separate, deliberately narrower shape a foreign reader gets.
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

## Tagging a note

`TagPicker`, in `@sloppy/ui`'s `components/tags/`, is the one surface that edits a note's
tags. It is **controlled and does not persist**:

```ts
tags: readonly string[];                 // what the note carries now
known: readonly TagCount[];              // what to complete against, most-used first
onassign: (tags: string[]) => Promise<void>; // the WHOLE set, never a delta
refused?: string | null;                 // the server's own words for a set that would not save
```

The page that owns the note writes it, through `nodes.update`. The picker writing for itself
would race the save path, the optimistic state and the error copy that page already owns, and
two writers to one node is the bug that costs a person their edit. `onassign` returning a
promise is what lets the picker hold its own pending state while the host saves.

**`onassign` must REJECT when the save fails, and set `refused` before it does.** The
rejection is the whole failure signal: the picker catches it, and that catch is the only
thing that renders the message. A host that resolves on failure gets a chip that snaps
silently back with nothing said to the person who tapped it — the type `Promise<void>`
cannot express this, which is why it is written down.

**A tag the picker hands back need not be normalized.** `TagsSchema` is where the rules
live — the trimming, the case, the canonical form, the set — and the server parses through
it either way; a picker that re-implements them is a second copy of them.

**`known` is a prop rather than a store read, and that is structural.** `@sloppy/ui` is
depended on _by_ `@sloppy/app-core`, so a component here reaching into an app-core store
would close the loop `ui → app-core → ui`, which the workspace has no build order for.
Every component in this package takes its data as props for that reason — see
`GraphSurface` and `BlockStack`.

**The page owns the trigger; the picker is only the surface behind it.** A component that
mounted its own floating control would fight the layout of whatever hosts it — the note page
is already reconciling a fixed-position editor toolbar in the same region.

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
  reaches the local API on an https origin. The app declares no App Transport Security
  exception, so iOS refuses plain http to this machine's LAN address exactly as it refuses
  a remote one — the tunnel is what every physical device needs, not only one on another
  network. Sign-in needs the syr instance on that same origin, which is a route the API
  fronts rather than a second tunnel; until that route exists, device sign-in needs a syr
  instance the device can already reach. `vite.config.ts` reads `TAURI_DEV_HOST` and binds
  to the LAN address with a separate HMR port during mobile dev; `svelte.config.js` uses
  `adapter-static` with `fallback: 'index.html'`.

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
