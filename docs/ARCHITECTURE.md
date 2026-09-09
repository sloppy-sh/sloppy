# Sloppy — Architecture

The detail [`AI.md`](../AI.md) defers to. AI.md states the rules; this file states the
shape they apply to.

> **Status.** Sloppy is built and runs end to end. This document describes the
> architecture as it stands and marks, where it says so, what is still ahead. See the
> [README](../README.md) for what a person can do in the tree today.

## Deployment modes

Sloppy is a client application that can run against several backends. The client is
backend-agnostic; the same app serves all three.

- **Hosted** — the default. A Sloppy API and an external syr instance we run.
- **Self-hosted** — a person or a group runs their own Sloppy API and points it at their
  own syr instance. The client must let a user point at an arbitrary endpoint and
  interoperate with it exactly as it would with the default. Settings holds that origin
  per device, so an installed app is re-pointed rather than rebuilt; `AppRuntime.apiHost`
  is the origin the build shipped with, and returning to the default returns to it.
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
│   └── ts/
│       ├── types/     @sloppy/types     — Zod schemas: node, block, document, tag, ink stroke,
│       │                                  publication, syr wire contracts
│       ├── client/    @sloppy/client    — backend-agnostic SloppyClient over fetch
│       ├── app-core/  @sloppy/app-core  — ALL pages, components, stores, the api layer, the runtime seam
│       ├── ui/        @sloppy/ui        — shadcn-svelte vocabulary + app.css design tokens
│       ├── data/      @sloppy/data      — SurrealDB table definitions and the per-user purge
│       ├── graph/     @sloppy/graph     — pixi renderer + graphology model + layout worker
│       └── idp/       @sloppy/idp       — syr IdP wire contracts + crypto, for local mode
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

**`@sloppy/data` is the shape of the store; a repository is the API's.** The table and index
definitions and the per-user purge are what every surface must agree on, so they are shared.
The SurrealQL that reads and writes one entity lives in `apps/sloppy/api/src/<module>/`,
beside the service that owns the concern.

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

## The genealogy and the address

The part that has to be right first, because peers hold each other's graphs. AI.md § "The
Genealogy Is the Protocol" states the rules; this is the mechanism.

**A note is reached by its ref.** `<did>/<ulid>` is the row's own composite key spelled for
the wire, and it is what a link, a publication, a pull and every route are keyed on. No
lookup anywhere resolves a note by address except the one a person types, which is exactly
the citation case the address exists for. Where an address reaches a note that is at it and
one that was carried away from it, the note at it is the answer: `addressLeadsTo` reads the
live row ahead of the alias, and `NodeService.addressed` answers a search out of
`NodeRepository.many`, which no deleted row is in.

**The genealogy is `parent`, `origin` and `created_at`.** `parent` is the note this one
sprang out of, absent on a branch and on an independent note; `origin` is the root of its
tree; `depth` is the parent's depth and one more, so a branch and an independent note are
both 1. Those three are what a peer reads a region's shape out of, and `depth` is the
column a bounded read slices on — `node_owner_origin_depth`.

**A run is a note's children, and a graph's branches are the run under no note at all.**
`runKeyOf` in `@sloppy/types` is that key: the parent's ref, or the graph where there is no
parent. `orderSiblings` is the order within it — the notes that have addresses first, in
address order, then the rest by `created_at`, ties broken by ref so two notes written in
the same millisecond still order the same way on every peer.

- A person keeps one or more **graphs**, and an address is read inside one of them. `graph`
  on a note is the ref of the graph it is in, and `node_owner_graph_address UNIQUE` is what
  makes an address resolve one way there.
- Root nodes take integers: `1`, `2`, `3`.
- A child alternates segment type: `1` → `1a` → `1a1` → `1a1a`.
- A sibling increments the last segment: `1a` → `1b`.
- **A note may hold no address**, and `node.address` is `option<string>` for it. A UNIQUE
  index does not constrain a row whose indexed column is absent — measured on 3.1.3, and
  held by `schema.integration.test.ts` — so any number of notes with no address sit in one
  graph while two with the same address are still refused at the write. That is why the
  index is untouched: absence is not a value in it, which is the behaviour this rule wants.
  A note gives its address up by a write that omits the column; `NULL` is refused by the
  type, so a repository unsets it rather than writing one.
- An address is suggested at creation by the rule above, rewritten when its note is moved,
  and written by the person whenever they want. **A creation may name the address instead.**
  `CreateNodeRequest.address` is optional, and absent leaves the new note to the rule. Given,
  `NodeService.writeNumbered` holds it to everything `setAddress` holds a written label to
  and to the one thing a move's named address is held to as well: it springs from the address
  of the note it is written under, or from nothing where the note opens a branch. A `root`
  placement already names a branch's own number, so a request carrying both is refused rather
  than one of them dropped. A note written under one that has no address is written with none
  too: there is no address for the rule to spring one from, and the
  person numbers it when they number the note above it. `graph` is immutable: a note that changed
  graph would land where its address may already be taken.
- An address is assigned **once** in a graph and never assigned again while the note that
  took it is there. Purging the row does not free it either: `NodeRepository.remove` stamps
  `deleted_at`, and `purgeExpired` writes a `retired_address` row for every note it finally
  takes. `childAddresses` and `addressTaken` answer from the notes and those rows together,
  so `nextChildAddress` steps past a number the graph has spent — a note in the bin
  included, which is what keeps the rule deterministic.
- **A note in the bin yields its address to whoever asks for it.** The rule never offers
  one, but a person writing a number by hand, naming one on a move or writing a new note at
  one is given it where the only thing holding it is a note they have deleted, or an alias
  of one. `NodeService.claim` is that check: `addressLeadsTo` says what the address leads to,
  a note that is there refuses the write as before, and a note in the bin yields.
  `AddressYield` is what it hands the write — the row the address comes off and the
  `node_alias` that keeps it leading there — and `writeAddress`, `insert` and `move` each
  apply it in the transaction that takes the address, so a yield without a taker cannot
  happen. A binned note that had already given its number up yields nothing, its alias
  standing: `node_alias_owner_graph_address` holds one alias per address, and the one there
  leads to the note that left first. The yielded note comes back from the bin with no
  address and its alias intact, which is what the note page reads to say `was 2b`.
- **The rule passes over an address a label already holds.** `childAddresses` reads a run
  by the note the run hangs under, and a label is not a place in the tree, so one written
  on a note in another run is not in what the rule is offered. `NodeService.write` and
  `NodeService.carry` therefore feed back every address the graph turns out to hold and ask
  the rule again, up to `ADDRESS_ATTEMPTS` of them, and refuse in words past that rather
  than leaving the person a write that cannot succeed. A move carries its whole subtree
  along to the next address rather than landing part of it on a label.
- **A move may carry the address a person named instead.** `MoveNoteRequest.address` is
  optional, and absent leaves the landing to the rule above. Given, `NodeService.carryTo`
  holds it to everything `setAddress` holds a written label to — free in the graph, an
  address a note was carried away from its own to take back — and to the one thing a
  standing note is not held to: it springs from the address of the note it lands under, or
  from nothing where the note becomes a branch. Every note the move re-addresses is held to
  that same pair, each against its own spent addresses: a number belongs to the note that
  carried it, so one a note under the moved one left behind is not the moved one's to land
  on. What is beneath rebases off it through `rebaseAddress`, exactly as
  the rule's own landing does, and everything is written in the one call `carry` writes
  through. A named address the graph has already spent is refused in words rather than
  passed over, unless a note in the bin is the only thing holding it: the rule may offer the
  next number, a person's own label may not be moved for them.
- **A mark is seeded off the genealogy, and never off the address.** `seedField` in
  `@sloppy/graph` is handed a note's ref, parent, `created_at` and depth, and nothing else —
  which is the mechanism behind "a label never moves a mark". A note with nothing above it
  in the field, meaning a branch, an independent note, or one whose parent this reader does
  not hold, sits on the root ring at its ref's **angular sector**, `refSector`. Every other
  note leans off its parent's seed, by its place in the run (`orderSiblings`) and by that
  same sector. All of it is derived on read, never stored, and every input travels with the
  note, so a subtree radiates the same way on every peer's screen without anybody shipping
  coordinates. The force pass then resolves the crowding around the shape that fixes.
- A ref hashes the same way wherever it is read, so one note seeds the same direction in
  every field it is drawn in. Between two graphs the reader keeps, what stops that being a
  collision is that each is drawn in its own field, offset from the last — DESIGN.md §
  "Several graphs on one canvas". Between the reader's and another author's, it is that a
  pulled region is drawn on its own, and § "Federating the graph" is where that rule is
  held.
- **Publishing asks for nothing.** A version is written down in the genealogy's own walk —
  each run in `orderSiblings` order, every note ahead of what springs from it — and
  `snapshot_node.ord` is that place, which is what a version's pages are ordered and
  cursored on. What a region IS, on the wire and in the store, is the note it is rooted at;
  `root_address` beside it is the label a person cites and is absent for a branch nobody
  numbered. § "Publishing" carries the rest.

Determinism is a property test over generated operation sequences — writing, deleting and
purging — in `@sloppy/types`' `address.test.ts`: two simulated peers applying identical
operations must produce byte-identical addresses, and neither may assign one twice. A note
written with no address is one of those operations, and what it proves is that such a note
is not in the run at all: it never moves what the rule offers the next note. One replica
holds the high-water mark of each run and the other holds nothing but addresses, in the
three states a graph holds them in, so the union is what the two agree on rather than a
detail either of them remembers. A label somebody wrote by hand is not one of those
operations, and cannot be: the replica that holds nothing but addresses recovers a run from
the addresses themselves, and a label is not a place in the tree. What the server does with
one is held where the server holds it — `node.service.test.ts` and
`domain.integration.test.ts`. The rules above do not mention a graph; what a graph decides
is which run of siblings the next address follows.

**The home graph.** Everybody has a graph before they open a second one, and its local id is
reserved — `HOME_GRAPH_ULID` in `@sloppy/types` — so `homeGraphRef(did)` is a function of the
identity rather than a row to look up, and the boot migration can spell it in SurrealQL.
`ulid()` writes the current time into a ULID's first ten characters, so nothing minted can
collide with it. It is listed, named and written into like any other graph; its row is
written the first time the listing is asked for, which is what gives a rename something to
rename.

**Absent means the home graph**, on the wire and on a row written before graphs existed.
The two columns a UNIQUE index reads — `node.graph` and `pulled_node.source_graph` — are the
exception: they are always present, because SurrealDB does not constrain a row whose indexed
column is absent, and two rows with no `graph` and one address are both accepted, measured on
3.1.3. So `schema.ts` fills them once on a store that predates graphs and then declares both
`TYPE string`, which is what leaves the index holding the address rule rather than the
application's discipline. `schema.integration.test.ts` holds a store built the old way
against both halves. `publication.graph` is in no unique index and stays optional.

**The graph travels with a published region.** `PublishedSubtreePage` and
`PublishedPublication` carry it, because a reader holding two regions of one author cannot
otherwise tell that author's two `1a`s apart. A region lies in one graph — the branch it is
rooted at does — so `publishedSubtreeReader` holds every page of a run to the same one, the
way it holds them to one version.

**A person writes and removes an address wherever one is shown.** `PUT
/nodes/:did/:ulid/address` takes `{ address }`, and `null` takes the label off. The address
it leaves becomes a `node_alias` row, so a citation written before the rename still opens
the note; the address it takes must be one nothing in that graph has ever been assigned,
except one this note itself has carried, which is its own to take back, and one a note in
the bin yields — `NodeRepository.addressLeadsTo` answers whose it is, and the refusal names
that note. `depth`, `parent` and `origin` are untouched: a label is not a place in the tree.

**Moving a note re-addresses it where the run it joins numbers anything, and leaves the
address it had resolving.** The moved note takes the next address in that run by exactly the
rule creation uses: `childAddresses` reads the run and `nextChildAddress` steps past the
greatest address ever assigned in it, so a note dropped between two siblings lands at the
end of their run and neither sibling is renumbered. `rebaseAddress` in `@sloppy/types`
carries the notes beneath: it keeps the segments past the moved note's own, taking the kind
from the alternation its new depth puts it at, so `1a1` under `1a` becomes `2c1` under `2c`
and `3a` under `3`. A note beneath whose label its author wrote outside the moved note's own
run keeps it: that label is theirs, and moving the note above it is not them changing it.
Where the subtree would land on an address the graph already holds — a label anywhere is
free to be one — the whole of it moves along to the next address in the run instead.
Deleted notes move with it — one left where it was would sit under an address no note is at
— and a note cannot be moved under a deleted one for the same reason.

Two moves take no address, both of them the creation rule answering the same way. A note
with none stays with none, and nothing beneath it is touched. And a note carried into a run
nobody numbered — under a note with no address — comes out with none, exactly as a note
written there would: it leaves its old address behind as an alias, and the notes beneath it
keep the labels their author wrote. What sprang from what is read off the parent chain in
both cases, never off the addresses, which is also what refuses a move into the moving
note's own subtree.

`node_alias` is a row per address the subtree leaves — the moved note's own and one for
every note under it — and every address lookup reads them, so a citation written before the
move still opens the note it named. An alias at an address a note LANDS on goes in the same
write, exactly as it does when the address is written by hand: the note is at that number
again rather than away from it. They are never assigned again, which `childAddresses`
and `addressTaken` hold by counting them alongside the live notes, the deleted ones and
`retired_address`. `address` and `depth` are therefore no longer `READONLY` on `node`, while
`graph` and `created_by` still are and the `ASSERT` on `depth` still stands.

`purgeExpired` takes a note's aliases with the row and writes a `retired_address` for each
of them: an alias whose note has gone resolves to nothing, and the number it held has still
been spent.

Two things follow the subtree rather than staying where they were. A mark's seed is a
function of its address alone (`layout/geometry.ts`), so a moved subtree radiates from where
it now is, which is what a genealogy edge drawn from `parent` (`@sloppy/graph`'s `model.ts`)
already says. And `origin` and `depth` are the columns `node_owner_origin_depth` slices a
tree by, so a move between trees rewrites both for every note beneath the one that moved.

**Publishing wants no address.** A branch rooted at a note nobody numbered publishes,
pages, is pulled and is compared like any other, and so does one holding such a note:
`snapshot_node.address` and `publication.root_address` are `option<string>`, and what
orders and cursors a version is `snapshot_node.ord`, the place the genealogy's own walk
gives each note. The label a person cites is carried beside the ref that identifies the
region — never instead of it.

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
| Who somebody follows                       | **syr** — kept with the identity, served per-DID                      |
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

Sloppy adds public read endpoints for published subtrees. A peer follows a DID and pulls
a subtree in as a foreign, read-only region **with its addresses intact** — the genealogy
a region carries, what each note sprang from, is what makes a pulled subtree land in a
known shape rather than as an opaque blob, and the addresses are what a reader cites it
by.

**Publishing takes a SNAPSHOT, and a peer reads the snapshot.** Publishing copies the
notes, their sections and every asset those sections cite into a version of the
publication's own. Nothing the author does to their own graph afterwards reaches it:
editing a note, replacing a picture, deleting a custom emoji, deleting the note itself — a
peer goes on reading what was published, whole. The alternative, serving the live rows
through a window, is what makes a published document a set of citations into an author's
private library, and every one of those citations is something that can break or leak
later.

What does reach it is an erasure, and only an erasure: deleting the publication. Erasing
means erasing, or a person cannot trust the word.

Four consequences follow, and they are the product's to state at the moment of the
decision rather than gaps to close:

- **Publishing again does not retract what was published.** It writes another version
  beside the one before it, and both stay readable.
- **Deleting a note does not reach the versions that carry it.** It leaves the author's
  graph, and the snapshots it was already in are unchanged.
- **Deleting the publication is what stops this instance serving any of it** — and a peer
  who has already pulled a version keeps the writing, which nothing here can take back.
- **A published copy is reached by deleting the publication and by nothing else.** There
  is no act that removes a picture from the library — the milestone that adds one owes
  the copies with it, in every version that drew it, because a person who erases a
  picture has to be erasing it and not filing it somewhere they cannot see.

**A publication is a chain of versions, the way a commit history is.** Each version is
self-contained, carries the moment it was made, and is numbered from 1 in publishing
order — the number a person cites. Publishing writes one every time, the way a commit
does, so the history says when the author published and never only when the writing
moved. Versions are appended and never edited: a peer is reading one.

**A publication is addressed by its own ref, never by its root address.** An address is a
human-readable label inside somebody's graph rather than a machine identifier, so
`root_address` is something a publication CARRIES — shown wherever it helps a person
navigate or cite, absent where its author gave the branch no number — and `<did>/<ulid>`
is what a route binds. The note the region is rooted at rides beside it as `root`, which is
what a run of pages is held to: a label neither identifies a region nor stays put, and a
person who renumbers the note their branch is rooted at is cited by the new number from the
next publish on while every version already published goes on saying what its own copy of
that note says.

**A version is written down in the genealogy's own walk**, each run in `orderSiblings`
order and every note ahead of what springs from it. `snapshot_node.ord` is that place, and
it is what the pages of a version are ordered and cursored on, so a reader never meets a
note before the one it springs from and a branch nobody numbered pages like any other. The
addresses in a version are labels it carries, and nothing reads a shape out of them.

**The routes.** Four answer without a session, and they are the ones a peer's instance
calls:

- `GET /api/public/publications/{did}` lists what that identity publishes here — each
  publication's ref, the address it is rooted at where its author gave it one, the notebook
  that address is read in and what the author calls it, the newest version's title, and that
  version — and nothing that is not already public in it.
- `GET /api/public/publications/{did}/{id}` answers a page of a version: `?version=`
  names one, and absent is the newest when the first page is asked for. Every page after
  that answers at the version its cursor was minted against, so publishing again moves
  what a fresh read gets and never what a read already under way is part of.
- `GET /api/public/publications/{did}/{id}/versions` answers the chain, newest first.
- `GET /api/public/publications/{did}/{id}/changes?from=&to=` answers what the writing did
  between those two versions, one entry per note and in the same order a version's own pages
  take.

The first of those is the exposure publishing creates, and the copy at the moment of the
decision has to be true to it: from the moment a subtree is published, anyone holding the
author's DID can see that it exists and read all of it, with no publication address to
withhold and no pull to grant. § "Pictures" says the same of the pictures in it.

**The notebook's name travels with the branch.** An address resolves one way inside one
graph, so an author who publishes `1a` from their thesis and `1a` from their garden hands a
reader two labels that read alike — and the reader may hold both at once, `pulled_node`
being unique per author's GRAPH and address. The graph's ref is what tells them apart and
is no use in front of a person, so `graph_title` rides beside it on the listing and on
every page of a version, optional and absent reading as a notebook with no name to send.
It is a name a reader shows and never a key: what a region is found by is the publication's
ref, and what its addresses are read in is `graph`. The name is one more thing publishing
puts out, so the copy at the decision has to say so.

The author's own need their session: `POST /api/publications` publishes a subtree —
creating the chain if the note has none, and writing a version either way;
`PATCH /api/publications/{ref}` changes who is invited to comment and publishes nothing;
`DELETE /api/publications/{ref}` takes the whole chain down; and
`GET /api/publications/{ref}/versions` is the author's own history. A published node
travels **without its `depth`** — a reader walks depth down the parent chain the region's
pages carry, and reads a note's sector off its ref. **A look's shape travels and its
pictures do not:** ring
weight, ring style and size are plain shape and go in `PublishedNode.look`, absent reading
as unstyled, so every version published before one could travel is unchanged; a picture is
an upload in the author's own store and stays there (§ "Pictures"). DESIGN.md § "A note's
look never uses colour" carries the ruling.

**Publishing several notes at once is one act, and it puts each of them out once.** `POST
/api/nodes/bulk` carries a `publish` act beside `tag`, `set_appearance` and `delete`, and
each chosen note becomes a publication rooted at itself. Which of them go out is one
decision — `publishRootsOf` in `@sloppy/types`, read both by the surface that says what a
publish widens and by the service that does it, because two answers to that question is
how somebody is promised a version that some chain never gets. A chosen note that already
roots a publication takes another version wherever it sits, including inside another
chosen note: that chain is its own, and a carrier's snapshot does not advance it. A chosen
note with no publication of its own goes out inside the chosen note carrying it rather
than opening a second one, since publishing both would put one piece of writing out twice,
in two snapshots each with their own terms and their own history. Sending a chain again is
a different act from putting out what is not out yet, so the question says how much of the
set it is before it is answered. A chosen note counts as already published only where a
publication is rooted at it: `node.published` is true of every note inside a published
branch and answers a different question. So a chosen note that a branch above already
carries opens a publication of its own, which the question names before it is answered,
and a chain that is already out keeps the terms its author set on it. Each note is
published on its own, so a request that stops partway leaves the ones that went out
readable — the surface says so and reads the branches again rather than reporting that
nothing landed. Some of a set going out and some not is the ordinary case rather than a
failure, and `reached` and `missed` on `NodeBulkResult` carry it: a chosen note is reached
where its own chain took the version, or where the chosen note carrying it went out. Where
nothing went out at all, the refusal itself is the answer.

**Deleting a publication cascades.** Every version, every copied note and section, and
every copied asset — a copy exists only to serve what that publication published, so
nothing outlives it here. What it cannot undo is what was already read: a peer who pulled
keeps the writing, and while the publication stood its pictures were readable by anybody
who knew the author's DID, so a copy somebody else took is theirs (§ "Pictures").

**Every public route answers a page at a time**, and `?cursor=` asks for the next one. The
cursor is minted by the instance that served the page and handed back to it untouched, so
what it means is that instance's own business and no reader reads one; absent on the
answer means there is no more. A version's pages are ordered so that every reference
resolves in the page carrying it or in one already sent: notes go before sections, and
notes go in the order `snapshot_node.ord` gives, which is the walk that version was written
down in and puts a note's parent ahead of it. The key is compared as a plain string, on the
server and in the cursor alike: a server paging by one order and cursoring by another skips
notes across a page boundary, and nothing on the reading side would catch it. What a person
reads a list in is `orderSiblings`, which is the run order the walk itself is built from.
That is what makes the size bounds a defence rather
than a ceiling a graph can hit: a branch of any size is read page by page, and what a
per-page bound refuses is one answer too large to hold, never a subtree too large to
publish.

**The difference between two versions is computed where the versions are.** The instance
holds every version and the reader holds none, so a phone asking what changed between two
snapshots of a ten-thousand-note branch reads the difference rather than both sides of it:
one entry per note — arrived, gone, or changed — in the same order a version's own pages
take, carrying both sides of the note and both sides of only the sections that differ,
which is what a review-shaped diff needs and no more. A note that is gone carries no
sections, what it said being in the version that still has it; where one place in the walk
holds a different note in each version the reader is told both, one gone and one arrived. A
note whose place moved between the two versions is read where the LATER version has it, so
it is reported once however far the two are apart. `PublishedNoteChange` in `@sloppy/types`
is that shape and `publishedChangesReader` its boundary, which holds a run of pages to one
region by the `root` ref each carries. **The author's own instance answers it as a peer's does** — `/changes` above is
public, so the surface a person reads it on asks over `GET /api/peers/changes` whether the
publication is theirs or somebody else's, and one path serves both.

**What a branch has done SINCE its newest version is a different question, and is answered
without comparing a document.** A draft is not a snapshot: its sections cite the author's
own uploads rather than the copies a publication owns (§ "Pictures"), so running the
comparison above over one would report a difference for every picture in it and call
writing changed that nobody touched. What does not need a document is which notes the
branch has gained and lost, which were renamed or retagged, and which have been written in
since — a section's own `updated_at` against the version's `published_at` says the last
of them. `GET /api/publications/{did}/{id}/unpublished` answers that,
`UnpublishedChange` in `@sloppy/types` is the shape, and it is read at the decision to
publish again rather than afterwards: PRODUCT.md § "Design Principles" 5 puts the truth
about a publish in front of the person making it.

**Who is invited to comment is the publication's to say, and it is an invitation rather
than a lock.** `CommentAccess` is an enum on the publication — `anyone` by default, which
is what a syr identity from any instance gets, and `nobody` for an author who is not
taking answers here. A narrower invitation is a value there and a branch where a
conversation is assembled, never a column. Three things about it are load-bearing:

- **The publication answers, and nothing else does.** A per-author preference would be a
  second authority for one question; where one later exists it decides what a new
  publication is created WITH, and the publication still answers. **Where more than one
  publication covers a note, the one being READ answers** — a snapshot is a self-contained
  copy, so a reader holding the tree is reading the tree's, and the branch's own snapshot is
  a different artifact with its own. The consequence is the author's to know and belongs in
  front of them when they publish: **publishing a tree opens everything under it on the
  tree's terms, including a branch they had published on narrower ones.**
- **It cannot stop anybody writing a comment.** A comment lives in the store of whoever
  wrote it and syr asks no permission to hold one, so what this decides is what an instance
  serves and what a surface offers. Copy that says it blocks people is claiming something
  Sloppy cannot do; copy that says the author is not taking comments here is true.
- **The set is open at the far end, so the value is closed going out and open coming in.**
  `CommentAccessSchema` is what an author may ask for — storing an invitation this build
  would then not honour is worse than a request that fails — and
  `ReceivedCommentAccessSchema` is the same field off a peer's answer, where one this
  build has never heard of reads as `nobody`. A page is refused whole, so a closed enum on
  the wire would cost a reader every note in a region the day somebody publishes a
  narrower invitation.

**A DID names a person, never a place.** An identity manifest describes that identity's
own store — profile, uploads, comments, reactions, who they follow — and says nothing
about where their GRAPH is served, so following somebody yields nothing to pull and no
instance to ask, and nothing a peer says about themselves can corroborate one. Where is
carried rather than resolved: `GET /api/peers/publications` takes a DID and the instance to
ask, which is this one unless the caller names another — the whole of it for somebody who
keeps their graph here — and answers what that identity publishes there.
`GET /api/peers/versions` is the same mediation for a publication's history and
`GET /api/peers/changes` for what its writing did between two of them, both named by the
publication rather than by an address. Every one of those requests is made by the reader's
instance, so the instance asked learns an instance and never a reader, and a `pull` row
keeps the origin in `source_url` so refreshing a region asks the same instance again.

**A named origin is a signed-in caller telling this instance to go and fetch something, so
what it may name is bounded in three places and none of them is a server's own idea.**

- **It is an ORIGIN and not a URL.** `PeerOrigin` in `@sloppy/types` is the shape — one
  canonical spelling of `scheme://host[:port]`, `http` or `https`, nothing else on it — so
  the caller names an instance and the instance names the path. A value carrying a path, a
  query or credentials would make this a way to have Sloppy fetch an address of somebody's
  choosing and hand the answer back, and the single spelling is also what keeps one peer
  from becoming two `pull` rows. `peerOrigin` turns what a person typed into one; a surface
  never assembles it by hand.
- **Which ADDRESSES it may reach is `api/src/media/remote-host.ts`, unchanged and not
  re-answered.** That module already decides what this instance will connect to on
  somebody else's say-so — it resolves the name itself, refuses unless every address it
  resolves to passes, checks every redirect hop, and drops a credential that would leave
  the origin it was for. A peer fetch goes through `fetchReachable` for the same reason a
  picture does, and a second policy written beside it would be a second answer to one
  question. Its refusal is WORDED for the picture route it was written for, and a second
  caller has to word its own: somebody who typed an instance address this instance will not
  reach is told about the instance they named, never about a picture.
- **The answer is held to the question.** `parsePublishedIndex`, `publishedSubtreeReader`,
  `publishedVersionsReader` and `publishedChangesReader` in `@sloppy/types` are that
  boundary: an instance that answers about a different identity or a different publication,
  changes version half way through a region, roots one region at two addresses, opens a
  region at a note that is not at the address it says the region is rooted at, carries a
  note attributed to somebody else, carries one outside the region that was asked for, puts
  a second note at an address another note in the region already has, sends a note that
  springs from nothing else it sent, names a link to a note somebody else wrote, writes a timestamp at a width other than `TimestampSchema`'s, refers to a note it
  did not send, or hands back a history whose numbering stops falling is answering a
  question nobody asked. A page that does any of it is refused WHOLE, and a refused page
  leaves the reader holding exactly what it held before — the reader is writing rows under
  the author's name, so half a page is not a thing to store. A listing followed to its end
  goes through `publishedIndexReader`, which holds a run of pages the same way: one entry
  per publication, so a publication listed twice is refused the way a second note at a
  taken address is.

  Two of those refusals are the address protocol, held on rows a peer handed us. Two notes at
  one address is `node_owner_graph_address UNIQUE`, and a region lies in one graph: our own rows
  cannot do it, and a copy of somebody else's may not either, or a citation of that author's
  `1a1` resolves two ways in the reader's graph. Where a note hangs is the other half of the
  same rule — a mark's position seeds from its address alone, so a genealogy that disagrees with
  the addresses draws a shape the two peers do not share, and a CYCLE of parents is that
  disagreement at its worst: our own rows cannot hold one, so the walk up a note's ancestors
  does not guard against one and the first draw of that region would never return. And every
  ref is held to its author because the published shape reaches an anonymous caller: a
  `links` entry naming one of the READER's own notes would otherwise draw a stranger's note into
  their graph as a link they had drawn themselves. The one timestamp width is the last of them —
  a signature is over the bytes the author sent, so a published node is not something to
  normalize on arrival, and one encoding on the wire is what leaves the stored copy checkable.

  `MAX_PUBLISHED_NODES_PER_PAGE`, `MAX_PUBLISHED_BLOCKS_PER_PAGE`,
  `MAX_PUBLISHED_PUBLICATIONS_PER_PAGE`, `MAX_PUBLISHED_VERSIONS_PER_PAGE` and
  `MAX_PUBLISHED_CHANGES_PER_PAGE` bound one answer, and `MAX_PUBLISHED_PAGES` is how many
  a reader asks for before it stops: a pull is an outbound fetch, so the reader's own
  request limits protect nothing, and what arrives is whatever the author's instance chose
  to send — including, from a hostile one, an answer that never ends. Those are counts, and
  a count is only reachable once a body is whole, so they are not what stops that answer:
  `MAX_PUBLISHED_PAGE_BYTES` bounds the bytes of one, and **the fetch is where it is
  enforced** — the read gives up there rather than at the parse. An instance serving pages
  keeps one under it, the way it keeps one under the counts. What a refused answer SAID is
  not passed on either: the words in front of a person come from Sloppy, and a peer's
  server is not one of the servers AI.md § "User-Facing Copy" means by "where the server
  explains itself".

**A published node carries only refs a peer may follow.** The shape reaches an
anonymous caller, and a `<did>/<ulid>` is not readable on its own but still says a note
exists and when it was written. So `origin` on a published node is the root of the REGION
rather than of the author's tree, which for a publication rooted below depth 1 would
otherwise be a note nobody published; the region's root carries no `parent`, its parent
being outside the publication; and `links` carries only targets the same author had
published when the version was made, a link to an unpublished note being dropped rather
than named. The reader's copy is a tree rooted at the region root, so it satisfies the same
`ref === origin` a root always does.

**The canvas draws ONE author's graph at a time**, and that is how a foreign region is
read: the reader's own graph, or a region they hold, entered and left from the graph's own
chrome (`app-core/src/lib/pages/graph.svelte`). A mark's position seeds from its address
alone (`packages/ts/graph/src/layout/geometry.ts`), so a peer's `1a` and the reader's own
`1a` seed identically, and `graph.addNode` is keyed by ref, so two held regions that
overlap would answer the shared notes twice. Neither is a defect in the layout — it is what
makes one person's graph readable in the same shape by another — and drawing one graph at a
time is what makes them true rather than a collision: an address is a place in the graph it
was written in, so a peer's `1a` sitting where the reader's own `1a` sits would claim a
genealogy neither author wrote. **Every act the canvas offers is off in a held region** —
choosing, tagging, the look, deleting, pointing a link — because none of them is something
to offer on somebody else's note; the region names its author in the chrome, and its marks
draw as `pulled` off the viewer. The tag rail is the legend for the graph on screen, so it
counts the region's notes while one is up.

**A held note opens on the same reading surface a note of the reader's own does**, and
nothing on it writes: its sections come from `GET /api/pulls/nodes/{did}/{ulid}/blocks` and
are drawn in the writing surface's own element kinds with the surface not editable, so a
kind the writer knows is a kind a peer's note draws in. Two of those kinds address something
outside the document, and both are answered by this instance rather than by the author's: a
picture cites the public copy its author published and is read through the reader's own
instance (`SloppyClient.publishedPicture`), and an emoji's stored picture address — which
the author's own instance minted — is dropped before the document is drawn, the shortcode
resolving instead against the author's catalog as this instance cached it. A reference
inside a held note resolves within the region or not at all; the reader's own graph is not
the one on screen.

**A follow belongs to the reader's identity store, not to Sloppy.** Identity is syr's half
of the table above, syr already keeps a follow list and serves it at an identity's
`public_following` endpoint, and a second list here would be a second answer to "who does
this person follow" that nothing reconciles. So `GET`/`POST`/`DELETE /api/following` reads
and writes that store with the reader's delegation, and Sloppy stores nothing. The
provider URL the store recorded beside a DID is the first step of resolving it; absent, the
DID is resolved from scratch. **The embedded provider keeps one like any other store** —
`idp_follow`, the owner's `/follows` routes and a `public_following` endpoint on its
identity manifest — so following works in the fully-local deployment mode too. Whether a
store keeps a list at all is read off its manifest rather than off a failed request: one
that declares no `public_following` has no follows rather than an error, and somebody using
it is told they can still pull a branch by its address.

**Where a followed identity's GRAPH is served is a guess, and is shown as one.** A DID
names a person and never a place, and syr's manifest answers for an identity's own store
and not for the graph beside it, so asking somebody what they publish starts at the
instance a region of theirs already came from, else at the provider recorded beside their
DID. That lands in the field the reader can edit rather than behind the button, because on
the two of the three deployment modes where a person's store and their graph are one
instance it is the right answer, and on the third the reader has to be able to see which
instance was asked before they can name the right one.

**A follow is private, and following somebody is not publishing that you did.** Who a
person reads is theirs. A store's `public_following` endpoint serves the follows its owner
made public — syr's `is_public`, false unless set — and Sloppy asks for none, so a follow
written here is readable by its owner and by nobody else. The embedded provider answers the
same way rather than a laxer one: which deployment mode somebody runs is not a choice about
who can see who they read.

**A pulled region is stored, and the reader owns the copy.** The alternative — re-fetching
the author's instance on every read — cannot be reconciled with what the product already
promises at the moment of publishing: that a peer who has pulled a subtree keeps the
writing after you unpublish (§ "Pictures" says where that promise stops). It would also make reading a foreign region depend on somebody else's
server being up, on a phone, which is the case the mobile-first stance optimises for. So a
pull writes rows:

- `pull` is the region: one row per reader and publication, `version` is the snapshot the
  copy is of, `source_url` is the instance it came from, and `updated_at` is when the copy
  was last refreshed. Pulling the same publication again refreshes that row rather than
  growing a second beside it. It keys on the publication and not on the address for the
  reason a route does, and `version` is what stops a surface telling somebody their copy is
  current when the author has published since. **`POST /api/pulls` refuses the reader's
  own publication.** Nothing in the keys excludes it, and the result would be one ref
  answered by two notes — the live one and a frozen copy wearing the reader's own DID,
  which `provenanceOf` reads as their own published note. Previewing what a peer sees is a
  read of the publication, never a copy of it.
- `pulled_node` and `pulled_block` are the copy, and **a node is held once however many
  regions serve it.** Pulling `1` when `1a` is already held refreshes the rows the two
  share instead of colliding with them, which is the ordinary act of reading a branch and
  then wanting the trail it came from. Where two regions carry one note from different
  versions, the copy is of whichever was pulled last.
- `pull_member` is **which region served which note, recorded rather than derived.** An
  address says which regions COVER a note; only the answer says which one handed it over,
  and the difference is what a refresh and a drop are made of. This is not the rule about
  deriving from an address (AI.md § "The Genealogy Is the Protocol") bent: what a peer's
  instance chose to send is not a fact any address states.
- **A note whose own signature refutes it is left out; the branch around it still
  arrives.** `PublishedNodeSchema` bounds what a reader may claim — one that cannot verify
  a signature still renders the note, one that can and finds it wrong must not present it
  as the author's — and not presenting ONE note as its author's is not the same as refusing
  the two hundred that verify. So `attribution.ts` answers per note, the page is written
  without it, and it is not among what the sweep below counts as served, which lets go of a
  copy the reader can no longer put the author's name to. An answer that is not the branch
  that was ASKED for is the other case entirely and is still refused whole: what a peer
  sent about the shape of its own subtree is either the answer to the question or not.
- **A refresh removes what its region served and the new answer no longer carries.** The
  sweep runs when the last page is in and never on a run that failed partway, because an
  incomplete answer is not evidence that a note is gone. Without it, a note its author
  dropped from a later version stays readable in the reader's copy forever. **The sweep
  reaches sections too**: a note that survives it keeps only the blocks the new answer
  carried, because a block belongs to exactly one note and a note losing a section is the
  ordinary case. It runs over the whole accumulated answer rather than page by page — a
  note's blocks can span pages, and a per-page sweep would take the ones that had not
  arrived yet. It also **replaces a held note that the new answer puts a different note at
  the address of** — `pulled_node` is UNIQUE on author and address, and an author who
  deletes every child of a branch and writes a new first one hands out an address a reader
  is still holding. The answer just received is what that version says, and the reader's
  copy is a copy of it. **A drop — `DELETE /api/pulls/{ref}` — removes that region's rows
  and takes the notes no surviving region serves, with their blocks.** A note two regions
  serve survives the first of them, and one merely covered by a wider region's address does
  not: the wider region's answer never carried it, so nothing there serves it.
- `created_by` on all four is the **reader**, because they are the one whose purge has to
  reach it — a row owned by the author would be swept when the author erased their identity
  here and left behind when the reader erased theirs, which is backwards in both
  directions. Who wrote the node is `source_did`, beside `source` rather than read out of
  it because an index cannot seek on half a column; `pulledNodeView` in `@sloppy/types` is
  what turns a held row into the `NodeView` the graph draws, and `provenanceOf` reads it as
  foreign off the author, given the viewer beside it.
- The published node is carried **untouched**, because a signature is over what the author
  sent and a reader that reshaped it could no longer check one. `depth` beside it is the
  reader's own, walked down the parents the region's pages carry, so it is the depth the note
  sits at in the AUTHOR's graph and a bounded read slices on the same number there and here.
  It is walked before a note whose signature refutes it is dropped, so the notes under a
  dropped one still know where they sit.

**Comments and reactions are syr's records, addressed by an opaque pair.** A note is
`post_did` + `post_id` — the two halves of its `<did>/<ulid>` — and the store never learns
it is a note, which is what keeps Sloppy's vocabulary out of an identity store that has no
extension point for it. `syrPostRefFor` is that conversion and the only place it is spelled.
A comment the reader writes goes to their own instance with their delegation; Sloppy holds
none of it.

**A comment is cited the way the store that issued it cites one**, `<did>:<local id>` —
which is the form syr writes into a thread's ancestor chain, so a reply's `reply_to`
compares to an ancestor without either side taking one apart. `StoreRef` in
`@sloppy/types` is that form and `splitStoreRef` the one place it is split, by matching the
DID rather than counting colons — the local half is the issuing store's to mint, is not a
ULID everywhere, and may carry colons of its own, which is also why this is not an
`OwnedRef` and why a route binds one as a single segment.

Two consequences follow from pull-only discovery, and both are the product's to state
rather than gaps to close:

- **A note shows the comments and reactions written by the reader, by the identities they
  follow, and — on the reader's OWN note — by whoever left a pointer on it.** Each of those
  is read from the store that holds it, and the reader's own store is one of them — nobody
  follows themselves, and a reader whose own comment vanished on reload would be reading a
  thread they are not in. A surface that implies it is showing every comment on a note is
  lying, and there is no total to show beside one either — nobody can compute one, which is
  also why nothing here counts toward a score (PRODUCT.md § "Anti-references").
- **A comment can be signed, and is signed in a second step.** syr's create route drops
  the signed envelope it accepts, so the comment is written unsigned and a `comment@v1`
  payload is signed through `platform.sign` and patched onto it; an identity's public
  listing then serves `content_signature`, `signed_payload_json` and
  `signing_device_public_key`, so a reader receives whatever landed. The rule is the one a
  node's signature already carries: a reader that cannot verify a signature still renders
  the comment, a reader that can and finds it wrong must not present it as the author's,
  and an absent one says nothing either way — a comment whose second step never landed is
  unsigned, not suspect. Nothing may present a comment as attributed on the strength of a
  signature it has not checked. **A reaction is the other way round:** syr stores the same
  three fields on one and its public listing does not serve them, so a reaction never
  arrives with anything to check, and no surface may claim otherwise.

**A pointer is how a stranger's answer arrives, and it is a claim that is checked before
it is kept.** Pull-only federation has no relay and no firehose, so an instance is never
told that somebody it has never heard of answered one of its notes. `POST
/api/nodes/{did}/{localId}/replies` is where that is said: public, because the identity
saying it has no relationship with the author, and it carries **no words and no place** —
one DID and one comment's citation. A `comment_pointer` row is the author's, not the
depositor's (`created_by` is the note's author, so their purge reaches it and their note's
deletion takes it), and it is written only where one of the author's own snapshots both
carries that note and invites `anyone`. A deposit that is taken answers 204 whatever
became of it: whether a bound refused it, whether the note takes answers, and whether the
identity resolves are all facts about somebody else's graph. The one thing a caller can
learn is how much of this instance they have already spent, which is their own — a rate
limit answers 429.

Four rules make an unauthenticated deposit safe to hold. The first is the one the rest
hang off:

- **The claim is checked on the way IN, not drawn on the way out.** A deposit names an
  identity and a comment; the instance resolves that identity and asks its store for that
  comment, and keeps the pointer only where the store serves it, in that name and about
  that note. A DID costs nothing to mint, so the alternative — store the claim and
  believe it at read time — spends a note's slots on answers nobody can ever be shown,
  and lets whoever mints fastest fill it. A verified pointer cannot be minted in bulk,
  because the comment behind each one has to exist.
- **Where a voice's store answers is resolved, never carried.** A DID names a person and
  never a place, and **nothing in syr binds one to the other**: an identity manifest is
  whatever the origin serving it says, so a depositor naming the store would be vouching
  for the identity they claim to be, and any instance could put words under any name. The
  deposit therefore asks the AUTHOR's own instance to place the claimed DID
  (`providerFor`), which is the one party to a deposit that is not the depositor —
  `publication.identity_store` is where the author's own instance is written down, so a
  branch published before it was kept takes no answers until it is published again. syr's
  per-identity manifest is a local lookup, so this reaches identities kept where the
  author's is and refuses the rest; a stranger on another instance needs a comment's
  signature checked against the key its DID already carries, and no signature is verified
  anywhere in this build (§ below).
- **A resolved store is still an address somebody else chose**, so reading one goes through
  `media/remote-host.ts` — the same answer a picture's address is held to, on every hop, and
  within a bound on how much of the answer is read. `SyrService.readJson` takes that policy
  for a store this instance was pointed at and none for the deployment's own.
- **A full note refuses what arrives next, and a read is bounded by the stores it will
  ask.** `POINTERS_PER_NOTE` and `POINTERS_PER_VOICE` bound the rows; `VOICES_PER_NOTE`
  bounds the DISTINCT identities one read reaches, which is what the work costs, because a
  store is asked once for a voice however many times that voice answered. Past it the
  voices that answered earliest are the ones read. An identity that resolves to nothing is
  remembered for as long as one that resolves, and the deposit route is rate-limited per
  caller the way `/api/proxy` is — the two unauthenticated routes that can send this
  instance to fetch something.

**An author can refuse one voice without withdrawing the invitation.** `CommentAccess` is
the whole branch's terms, so the only lever it gives somebody being harassed on one note is
to silence every good-faith reader at once. `refused_voice` is the proportionate one: a row
the person doing the refusing owns, naming a voice and — optionally — the note it is
refused on, absent refusing that voice wherever they read. It decides what this instance
ASSEMBLES for its owner and nothing else. A comment lives in the store of whoever wrote it,
so a refusal takes nothing away from anybody, tells the refused voice nothing, and reaches
neither the author's publication nor another reader's copy. The filter goes where a note's
voices are assembled as a whole rather than on the pointer branch alone: a refused voice the
author also FOLLOWS would otherwise come back through the follow branch. It is purged with
its owner, like every other row they own.

**An identity's answer is held to that identity.** Each of those listings is one
identity's own public endpoint asked about one note, so a record carrying anybody else's
DID is dropped rather than drawn — `fromEveryVoice` in `api/src/social/social.service.ts`
is the one comparison, made where the record and the store that served it are still
together. A pointer is checked against the same line when it is deposited and again when
it is read, because a store can stop serving what it once served. It is the rule
§ "Federating the graph" applies to a peer's published notes, and
here it is the only line there is: a reaction arrives with nothing to check at all, and no
signature is verified anywhere in this build. Without it any instance could put words
under any name and face the reader knows, including the reader's own.

**A conversation hangs off the note, not off whose graph it is in.** A store is handed
`post_did` + `post_id` and never learns whose surface asked, so answering a note pulled from
a peer is the same act as answering one's own and reaches the same two routes, which take
any note's ref and check nobody's ownership. Both surfaces that show a note offer one on the
same two conditions: the publication BEING READ invites answers, and the reader's own
identity is one that can hold a conversation. That is what PRODUCT.md § "The peer" costs —
"they read, they comment, they branch" is one person on somebody else's writing.

**Whether somebody can hold a conversation is what their own store SERVES, never where
their identity lives.** A comment lives in the store of whoever wrote it and is read back
from that store's public listing, so a store that takes one and publishes no listing hands
the writer a comment that is gone on the next read. The capability is therefore per
identity and declared on its manifest, the way `keepsFollows` already reads a follow list:
`Converses` in `@sloppy/types` is the answer, one boolean for comments and one for
reactions, served for the SIGNED-IN identity by an authenticated route and read by
`identity.svelte.ts` in `@sloppy/app-core`. Location cannot stand in for it in either
direction — `@sloppy/idp` advertises no `public_comments` or `public_reactions`, so the
fully-local deployment has no conversation and an identity kept on ANOTHER Sloppy's
embedded provider has none either though it is delegated from here; and an embedded
provider that gained the endpoints would be refused by a gate that asked where rather than
what. **A surface has to know before it offers anybody a conversation**, or a control
refuses every time it is used. Until the answer is in, nothing is offered and nothing
alarming is said, which are opposite defaults and deliberately so.

## Pictures

Who may read a picture is decided once, by the folder its bytes land in, and everything
else follows from that. `folderPathFor` in `api/src/media/media.service.ts` is the whole
policy:

| Role                         | Folder             | Who can read it                                          |
| ---------------------------- | ------------------ | -------------------------------------------------------- |
| `avatar`, `banner`           | `public/sloppy/…`  | anyone — a peer resolving the DID has to see them        |
| `emoji`                      | `public/sloppy/…`  | anyone — a federated `:shortcode:` renders for everybody |
| `block` (a note's picture)   | `sloppy/notes`     | its owner alone                                          |
| `wallpaper` (behind a graph) | `sloppy/wallpaper` | its owner alone                                          |

A mark's pictures are deliberately that same role rather than a new one: the folder is the
access rule, a mark's picture wants exactly the note picture's rule, and one library means a
picture already in a note can go on its mark without being sent twice.

The ground is the one that gets its own, and a role is what carries that: it wants the note
picture's access rule and a DIFFERENT library. `GET /api/media/uploads?role=` names which —
`wallpaper` for what somebody added as a ground, absent or `block` for what is in their
notes, and nothing else. The ground's picker offers both libraries and the note picker
offers the note one alone; DESIGN.md § "The wallpaper" is the ruling.

Publishing adds a placement and no further role: the copies below land in
`public/sloppy/notes` and anyone may read them. It is deliberately **not** a value of
`MediaRole`, because a role is what a caller asks for — one that placed bytes straight into
a public folder would let anybody have this instance mint a durable public address for
whatever they sent. A copy is minted at publish, out of bytes the store already holds.

**A note's pictures are private, and stay private however much of the note is published.**
The owner reads one back through `GET /api/media/uploads/{did}/{localId}`, which asks their
own store for it as them; nothing else can, and the original is not listed among an
identity's public uploads. `GET /api/media/uploads` lists the ones they put in a note,
newest first, so a picture can be used twice without being sent twice — the same folder
decides what is in it, so nothing from a profile is. That route needs the reader's session
and an `<img>` sends none, so `SloppyClient.ownPicture` fetches the bytes with the reader's
own credential and hands back something the browser can draw from memory. On the web shell
that session is a token and not a cookie — sign-in there finishes through the hand-off in
`auth.controller.ts`, so an address alone would reach this route as a stranger. It is the
only way one of these draws, which is why a `MediaAsset` carries an `upload_id` and no
address at all: who may read a picture is the store's answer, not the row's.

**A picture is the person's to take back.** `DELETE /api/media/uploads/{did}/{localId}`
takes one out of their own store, and only one of their own: the `did` in the address has
to be the caller's. A section, a mark or a ground still citing it then has nothing left to
draw, which is what the surfaces ask about before they call it. A publication's own copy is
a different upload in a different folder and is untouched — taking that branch down is what
releases it.

**A publication carries its own copy of every asset its sections cite.** Publishing
duplicates the bytes into `public/sloppy/notes` in the author's own store and writes the
published section citing the copy, so what a peer holds answers for them and cannot be
changed or broken from the other end. There is no original to widen and no citation into a
private library: that is the snapshot, applied to pictures.

`citedUploads` in `@sloppy/types` is what "cites" means — an `attrs` key named `upload_id`,
or one ending `_upload_id`. That is a convention across elements rather than a list of
them, so an element kind this build has no renderer for still has its pictures copied with
it, which is AI.md § "A Block Is a Section" applied to the walk.

A custom emoji is the one element `citedUploads` deliberately does not reach, because it
names its picture by a shortcode and carries no upload at all. Publishing resolves that
shortcode itself and writes the copy's upload onto the published element under
`EMOJI_UPLOAD_ATTR` — `emoji_upload_id`, which ends `_upload_id`, so from then on the walk
reaches it like any other picture and a peer draws the emoji out of the snapshot rather
than out of a catalog its author can empty. The catalog it resolves against is the note
AUTHOR's own: a note's shortcodes resolve against their catalog and nobody else's
(`emojiCatalogs.of(author, …)`), and taking somebody else's emoji into a note is
`CopyEmojiRequest`, which re-uploads the bytes under the caller's identity first. So both
halves of a `snapshot_asset` row are the author's, and publishing never fetches a
stranger's blob.

The duplicate storage is the accepted cost, and it is accepted for a reason the product
requires: one library backs every note, so a picture is legitimately in several of them
(`ownPictures` lists that folder, and the picker exists so a picture is used again
rather than sent again). A picture that MOVED would take an unpublished note's picture
public along with it, decided by a publish somewhere else in the graph. `snapshot_asset`
pairs the original with its copy, one row per publication, so a second version citing the
same picture reuses that copy rather than sending the same bytes public again under a new
address — and the library is untouched: a picture that has been published still appears in
the picker, because the row it lists never moved. `source_upload` is what the author's own
note cites the picture BY, which is an upload for a picture and a catalog entry for an
emoji; both are `<did>/<local id>` under the author, and one read of these rows is what
answers "already copied?" for a whole branch.

**Publishing is the only moment bytes go public, and it is always a deliberate act.** A
picture dropped into a note inside a published branch is in no version until its author
publishes again, so nothing crosses that line while somebody is writing.

A mark's pictures are not among them: a published node carries the shape of its look and
never a picture of one, so nothing a peer holds ever cites one and they stay private.
**A public copy is public to anybody, not only to somebody holding the address.** syr
decides `is_public` from the folder a blob is in, and an identity's `uploads` endpoint
serves every public one it has, paginated, with its filename and size — so from the moment
a subtree is published, the pictures in it are enumerable by anyone who knows the author's
DID, with no publication address and no pull. That is the exposure publishing actually
creates, and it is what the copy at the moment of the decision has to be true to.

**Deleting the publication deletes its copies**, because a copy exists only to serve what
that publication published. It is the take-it-back act, and it is the only one: Sloppy has
no act that removes a picture from the library, and the milestone that adds one owes this
same sweep, wherever that picture was published. Short of deleting the publication, while
one stands every version of it stays readable and so does everything the versions draw.

That is also where the promise about a peer's copy stops, and the product says which half
is which: the notes somebody pulled are theirs and stay theirs, and the pictures in them
were being served out of the author's store all along, so those stop when the publication
does. Nothing here can reach a copy of the bytes a peer made for themselves.

**A peer's picture is fetched by this instance, never by the reader's browser.**
`GET /api/media/published/{did}/{localId}` is that route — `publishedPicture` in
`@sloppy/client` is the caller — and it holds two invariants: the author's store learns
the reader's instance and never the reader, and nothing is served that that store has not
said is public. syr offers no single-upload public read, only the paginated listing at an
identity's `uploads` endpoint, so finding one is a search of that listing rather than a
lookup, and the listing is not short — the copies above go into it, so somebody who
publishes a branch full of pictures has a long one.

`api/src/media/held-pictures.ts` is what puts that search behind an `<img>`. It walks the
listing a page at a time and stops at the picture asked for, and it holds what a walk
passed for a few minutes, per author and per instance, so a note of twelve figures is one
search rather than twelve. Which instance is asked comes off the region the reader holds
and never off the request, so a caller cannot aim this one somewhere it was not already
reading. Two consequences are accepted and both are the reader's, not the author's: a
picture made public just after a walk reached the end of the listing is not found until
that walk is forgotten, and a listing longer than ten thousand rows is walked no further.
**A page shorter than the one asked for is not the end of a listing** — the far end is a
stranger's instance and pages how it likes, so only an empty page ends the walk;
concluding otherwise makes every picture past a peer's page size permanently unfindable.

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
graph:{ created_by: <did>, id: <ulid> }
  created_by  did       the owner, flat and immutable
  title       string    what they call it

node:{ created_by: <did>, id: <ulid> }
  created_by  did       the owner, flat and immutable
  graph       ref       the graph its address is read in, immutable
  address     string?   the label its author cites it by; absent is a note with none
  depth       int       the parent's and one more; a branch and a free note are 1
  parent      ref?      absent on a root
  origin      ref       the root of this node's tree; a root is its own origin
  title       string
  tags        string[]  normalized, deduplicated, sorted — @sloppy/types' TagsSchema
  links       ref[]     non-genealogical associative links, drawn by hand
  references  ref[]?    the notes its own blocks cite, derived; absent is none derived
  published   bool
  appearance  object?   the look its author gave the mark; absent is unstyled
  deleted_at  iso?      when its author deleted it; absent is a note that is there
  created_at  iso       immutable — it is a field of the signed payload
  updated_at  iso
  content_signature, signed_payload_json, signing_device_public_key

block:{ created_by: <did>, id: <ulid> }
  created_by  did
  node        ref
  ord         string    fractional index — reorder without renumbering
  content     object    the section's whole document, as the editor wrote it
  text        string?   the section's words, plain, derived; absent is none derived
  deleted_at  iso?      when it went with its note; absent is a section that is there

retired_address:{ created_by: <did>, id: <ulid> }
  created_by  did       the owner, flat and immutable
  graph       ref       the graph the address is read in, immutable
  parent      ref?      the note it hung under, immutable; absent for a branch
  address     string    the address, immutable

node_alias:{ created_by: <did>, id: <ulid> }
  created_by  did       the owner, flat and immutable
  graph       ref       the graph the address is read in, immutable
  parent      ref?      the note it hung under, immutable; absent for a branch
  address     string    an address the note was at before a move, immutable
  note        ref       the note it still resolves to, immutable

**A deleted note keeps its row, and `deleted_at` is the whole of the difference.** Absent
is a note that is there, which is every row written before this column existed, so nothing
has to be filled in. A stamped note and its sections are still stored, still the author's,
and still at their addresses — what a person can put back is exactly what is still there to
find. A deleted branch is listed by `GET /nodes/deleted` and put back by
`POST /nodes/:did/:localId/restore` until the window closes. How long that window is is
`DELETED_KEPT_FOR_DAYS` in `@sloppy/types`, read by the sweep that ends it and by the
confirmation that promises it, so what a person is told cannot outlive what is kept. The reads that decide a NEW
address are the ones that deliberately do not filter it:
`childAddresses` and `addressTaken` count a deleted note among what a graph has assigned,
because the rule offers no number a deleted note is holding. What a person names by hand is
the one thing that reaches past that — § "The genealogy and the address" carries the yield —
so a note put back comes back with whatever address it still holds, and `NodeService.restore`
answers through `asRead` for the alias that says what it gave up.

**A deleted note leaves its address behind.** `retired_address` is a row per note a purge
takes, and it is what makes the address protocol survive a deletion: the run a new address
follows is the live notes, the deleted ones and these together, so nothing is ever assigned
twice inside one graph. It carries the graph and the parent rather than the note, because
the note is what has gone — the parent is how one index answers both the children of a note
and the branches of a graph, `parent = NONE` standing for a branch as it does on `node`.
Nothing reads it but address assignment, and the per-DID purge takes it with the graph.

**A moved note leaves its old address resolving.** `node_alias` is a row per address a move
leaves behind, and it carries the note `retired_address` cannot, because the note is still
there: the row exists to resolve a citation as well as to say that a number is spent. It
carries the parent too, and for the reason `retired_address` does — the run an address was
spent in is what `childAddresses` has to read it back into. So it has three indexes:
`node_alias_owner_graph_address UNIQUE` is the address rule over aliases, one per address
inside a graph, and is how a citation made before the move is resolved;
`node_alias_owner_graph_parent` is the run; `node_alias_owner_graph_note` is a note's own
aliases, which is what a reader of it is shown. Every column is immutable, this row being
the whole of that fact, and the per-DID purge takes it with the notes.

**A run is read by the parent it was spent under, and filtered by the address it is under
now.** `parent` on `retired_address` and on `node_alias` is the note the address hung under
when it was spent, and a note's address changes when it is moved — so a row read through
either index can name an address from a run its parent has since left. `nextChildAddress`
keeps only the addresses that are children of the parent's address now, which is what stops
a move from carrying a spent number into the run it lands in. The addresses it drops stay
spent where they were: nothing will ever be written under an address no note is at.

**A deleted note leaves its inbound links behind.** `links` is an array of refs on the
*linking* node, so removing a note cannot reach the notes that pointed at it — deletion takes
the subtree, not the mentions. The note surface renders a missing target honestly ("A note
that is no longer here.") with its own unlink control, so nobody is shown a row that waits
forever, but nothing sweeps the stale refs. Whichever milestone adds a sweep owns deciding
whether it runs on delete or on read; until then the stored array is a superset of what
resolves. `references` is a superset the same way and has no unlink control, because what
points at the deleted note is the writing: removing those words is what removes the ref.

**A connection may cross into another of its author's graphs, and it is an ordinary
connection.** A `links` or `references` entry is a ref, and a ref names one note across
every graph its author keeps, so nothing refuses one that points out of the graph it was
written in and the note surface resolves and opens it — `GET /api/nodes/{did}/{ulid}` is
addressed by ref and is not scoped to a graph. The canvas draws the edge wherever both ends
are on it — across two fields as readily as inside one — and draws none for a target that is
not, exactly as it draws none for a target in a subtree that is not loaded. What is drawn is
a subset of what is stored; what is stored resolves either way.

**`references` is derived, so only the server writes it.** It is `citedNotes` over the
note's blocks in `ord` order without repeats, recomputed whenever that stack changes — a
block written, added or removed alike — which is what makes deleting the words delete the
line, whether they went a sentence or a whole section at a time. The order is fixed rather
than incidental so that re-deriving an unchanged note produces the array it already holds.
It is therefore absent from `PATCHABLE` and from every create and update request: a client
that could set it could draw a line out of a note it is not allowed to read. It carries no
`DEFINE FIELD` for the same reason `links` carries none, and absent on a row is a note
nothing has derived them for, read as none. DESIGN.md § Edges is the ruling: a reference is
drawn whole and a hand-drawn link broken, one line for a pair that carries both. The canvas
still draws them as one dashed line, and that section names the gap.

**`text` is derived, so only the server writes it.** It is the plain words of a section's
`content`, written in the same statement as the document they are taken from, so the words
a search reads and the document behind them can never disagree about what a section says.
It is therefore absent from `PATCHABLE` and from every create and update request, for the
reason `references` is: a client that could write it could be found by words its document
does not carry. `BlockView` has no field for it, and `blockView` in `@sloppy/types` is how
a stored block becomes one — a reader of a stack already holds the document those words
come from, and spreading the row would send them whatever the view type says.
`pulled_block` carries the same column, derived when the copy arrives, because a search
that reached only somebody's own writing would answer "nothing" about a note they are
holding and reading.

**The index is one column, so the owner is an equality beside the match.** `sloppy_text` is
the analyzer — class tokens, lowercased, accent-folded, English-stemmed — and `block_text`
and `pulled_block_text` are `FULLTEXT` indexes over `text` alone: the server takes exactly
one column in a full-text index, unlike every other index here, so a search reads
`WHERE text @1@ $words AND created_by = $did` and that equality is the whole of what keeps
one person's writing out of another's results. Nothing new is stored per person, so the
per-DID purge takes the words with the sections that hold them.

**`GET /nodes/search?q=&graph=` answers what somebody wrote, `GET /nodes/recent?graph=&limit=`
what they wrote last.** A search names its hits by `SearchHit` — the note, the address, the
graph that address is read in, the title, and the writing around what matched — and reaches
the caller's own notes and what they hold of somebody else's, `held` saying which. Recent is
ordered by when a note's SECTIONS were last written, never by `node.updated_at`: that column
moves only when a title, tags, links or a look change, so a note somebody spent an afternoon
writing into would otherwise rank as untouched since the day it was made.

**What a document counts as a citation is a key, not a list of element kinds.** `citedNotes`
in `@sloppy/types` reads an `attrs` key named `note` holding a `<did>/<ulid>`, wherever it
sits — the same convention `citedUploads` reads a picture by, so an element kind this build
has no renderer for is walked like any other and a mark on a run of text counts. Publishing
reads the same key to decide what it must reach and blanks the citations it may not, so the
two answers cannot drift: one function, in `@sloppy/types`, and `snapshot.ts` shares it.

**A published node carries no `references`.** `PublishedNodeSchema` fixes what a peer
receives and has no field for them, so a pulled copy draws its `links` alone — fewer lines
than the writing it carries. DESIGN.md § Edges states that as the gap it is; closing it is
the publishing milestone's, and costs deciding what a peer may be told about a note they
cannot follow.

publication:{ created_by: <did>, id: <ulid> }
  created_by    did
  root          ref       the subtree it publishes, immutable
  root_address  string?   the label a person cites, restated by each publish;
                          absent is a branch its author gave no number
  graph         ref?      the graph that label is read in, immutable; absent is home
  comments      string    who the author invites to answer it

publication_version:{ created_by: <did>, id: <ulid> }
  created_by    did
  publication   ref       the chain it belongs to, immutable
  sequence      int       1-based, in publishing order, immutable and unique per chain
  created_at    iso       the moment this snapshot was made

snapshot_node:{ created_by: <did>, id: <ulid> }
  created_by    did       the author
  version       ref       the snapshot it belongs to, immutable
  source        ref       the note it was copied from, immutable
  ord           string    its place in the walk this version was written in, and
                          what the version's pages are ordered and cursored on
  address       string?   the label its author gave it, immutable; absent is none
  node          object    the published node, in the shape a peer receives

snapshot_block:{ created_by: <did>, id: <ulid> }
  created_by    did       the author
  version       ref       immutable
  source        ref       the section it was copied from, immutable
  node          ref       the note it belongs to, immutable
  ord           string
  content       object    citing the publication's own copies, never a private upload

snapshot_asset:{ created_by: <did>, id: <ulid> }
  created_by    did       the author; both uploads are theirs
  publication   ref       what the copy is deleted with, immutable
  source_upload id        the upload the note reads, private
  public_upload id        the copy a published section cites, immutable once minted

The four rows below hold a region pulled from somebody else. `created_by` on every one
of them is the READER holding the copy, never the author who wrote it — § "Federating the
graph" says why that is the only ownership the purge can work with.

pull:{ created_by: <did>, id: <ulid> }
  created_by    did       the reader
  publication   ref       the region, as its author's instance names it, immutable
  version       object    which snapshot this copy is of
  root_address  string?   the label the answer carried; absent is a branch its
                          author gave no number
  graph         ref?      the AUTHOR's graph the region is in; absent is their home one
  graph_title   string?   what the author calls it; absent is a name that did not travel
  comments      string    who the author invites, as of the last refresh
  source_url    url       the instance that served it, and the one a refresh asks
  updated_at    iso       when the copy was last refreshed

pull_member:{ created_by: <did>, id: <ulid> }
  created_by    did       the reader
  pull          ref       the region that served the note, immutable
  source        ref       the note, as its author addresses it, immutable

pulled_node:{ created_by: <did>, id: <ulid> }
  created_by    did       the reader
  source        ref       the node as its AUTHOR addresses it, immutable
  source_did    did       who wrote it, immutable
  source_graph  ref       which of their graphs addressed it, immutable
  address       string?   the label its author gave it; absent is a note with none
  depth         int       the reader's own mint from the region's shape, immutable
  node          object    the published node, carried untouched

pulled_block:{ created_by: <did>, id: <ulid> }
  created_by    did       the reader
  source        ref       the block as its author addresses it
  node          ref       the node it belongs to, as its author addresses it
  ord           string
  content       object
  text          string?   the held section's words, plain, derived; absent is none
```

**A version is what makes a subtree readable. `node.published` is not.** A peer reads
`snapshot_node` and `snapshot_block` rows and never the notes they were copied from, so
deleting a publication — with its versions, its copies and its assets — is unpublishing.
`node.published` is a separate column on the note, and `provenanceOf` in `@sloppy/graph` is
the only thing that reads it: it decides whether a mark draws as own or as published, and
nothing else follows from it. `apps/sloppy/api`'s `publication/` serves the author's own
routes and the four public ones; `peer/` serves the mediated reads beside them and the pull
side of § "Federating the graph".

**A publication with no version is a first publish that did not finish.** Nothing serves
one and no listing carries one, and publishing that root again completes it — reusing the
copies the failed attempt had already paired, rather than sending the same bytes public
twice.

**`published` says a version carries this note, and is maintained from the snapshot rows.**
Not "a publication covers it": under a snapshot a note inside a published branch is
readable by nobody until the author publishes again, and a mark that claimed otherwise
would be the interface lying about what has left (PRODUCT.md § "Design Principles" 3 and
5). So the API writes the column across the notes a new version carries, and clears it for
the notes no surviving version carries when a publication is deleted — a note created under
a published ancestor is untouched, because publishing is what makes it readable and nothing
else does. Deriving the column instead was the other candidate, and a held foreign node
rules it out: no row on this instance says whether its author still publishes it.
`pulledNodeView` asserts the column instead — what was true when the copy arrived — and
`provenanceOf` reads the author before it reads the column, so a held node draws as pulled
wherever the viewer is beside it. **That is a requirement on whoever builds the graph, not
a nicety:** with no viewer there is no author to compare, the read falls through to the
column, and a foreign region draws as the reader's OWN published notes, which PRODUCT.md
§ "Design Principles" 4 forbids outright. Two things the maintenance must not leave behind:
a note drawing as published that no version carries, and a note drawing as own while a
version that carries it survives.

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
  user-scoped read and the purge both. A held row copies `source_did` and `address` out
  beside the published node it carries for the same reason, and `parsePulledNode` is where
  each is held to the node it was copied from.
- **`node_tags` is the exception to that, and it is read pinned.** An index over an array
  column holds one entry per element, so `tags = $tag` is a membership seek — but only
  while that index is the one answering it, and plain array equality otherwise. Measured
  on 3.1.3, a read the planner hands to any other index comes back with **zero rows and no
  error**, and a composite `created_by, tags` fails the same silent way. Which index
  answers a read is the planner's to decide and changes as the index set does, so the pin
  is the guarantee rather than a workaround: the owner is a filter over the seek rather
  than the leading column, and every tag read is written
  `FROM node WITH INDEX node_tags WHERE tags = $tag AND created_by = $did`.
  `tags CONTAINS $tag` is always correct and never uses the index; it is not the spelling.
  `schema.integration.test.ts` holds both halves against a running server, forcing the
  failing half with `WITH NOINDEX` so the claim does not rest on which other indexes
  happen to exist.

  **`snapshot_node_owner_source` is pinned for a milder version of the same reason.**
  Asking which versions carry a note orders by version, and the planner prefers an index
  that satisfies the ordering — `snapshot_node_owner_version_source` — then filters across
  everything its owner has ever published. The answer is right and the cost grows with the
  graph, so that read is written
  `FROM snapshot_node WITH INDEX snapshot_node_owner_source`, and the same test holds the
  plan.

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
  `NodeView`, `BlockView`, `PublicationView` and `PullView` from the entity schemas and
  converts with `entityView()`, so the wire cannot drift from the row. The substitution is
  what makes a row expressible as JSON at all: the key is a SurrealDB `RecordId`, and no
  JSON encoding round-trips back into the class that validates one. `PublicationView` adds
  the chain's newest version beside the row, which is read from the versions rather than
  kept on it. `PublishedSubtreePage` is the separate, deliberately narrower shape a foreign
  reader gets. Two answers are counted rather than copied and so are shapes of their own:
  `DeletedBranch`, one row per branch that can still be put back with the size of what
  comes back with it, and `GraphExport`, one person's graphs, live notes and sections as
  JSON they can hold.
- **Nothing derivable is stored, and `depth` is not derived from the address** —
  AI.md § "The Genealogy Is the Protocol" states the rule. The
  angular sector and subtree membership stay functions in `address.ts`. `graph` is not an
  exception and not a derived value: nothing computes which graph a note is in, its author
  chose one, and it is the scope the address is unique under rather than a fact the address
  states.

  `depth` is the ratified exception to the wider rule, that a derived value is computed
  rather than stored. It is derived from the GENEALOGY — the parent's depth and one more,
  1 for a branch and for a note written with no parent — which is what lets a note with no
  address have one at all.

  The read that buys the exception is level of detail. It collapses a subtree past a
  threshold measured from the node in focus, which reads at first like something a stored
  absolute cannot serve — but `depth(focus)` is known before the query is sent, so the
  relative threshold arrives absolute:
  `created_by = $did AND origin = $origin AND depth <= $max`. Without the column, a peer
  pulling a foreign region fetches the whole tree and filters on the client, which is
  exactly the case the mobile-first stance optimises for. The cost is one integer and one
  index now; the alternative is a migration on the protocol's core table later.

  A second copy of a truth is only safe while it cannot drift, so the exception is
  conditioned on the column being written from the parent chain and from nothing else: a
  note is written and moved with its parent's depth and one more, and `ASSERT $value > 0`
  pins the convention that a branch is 1, so a writer that counted from the other end fails
  at its first write rather than mis-slicing every region it goes on to store. The equality
  `depth = addressDepth(address)` is no longer an invariant and `parseNode()` no longer
  holds a row to it: a person may write `5` on a note three deep, and the label is theirs.
  What the suggestion rule offers still agrees with the parent chain, which is why nothing
  a person has not renamed by hand looks any different.

- **`appearance` is authored, and that is what makes storing it right.** The rule it looks
  like it breaks — nothing derivable is stored — is about facts the ref and the genealogy
  ALREADY state: the sector, the collapse key, the depth. Nothing computes a note's look
  from anything; a person chose it, so there is no function for the row to fall out of step
  with, and the only other place it could live is a second store. It is a plain column on a
  SCHEMALESS table, because the database has nothing to enforce about it that
  `@sloppy/types`' `appearance.ts` does not — and that schema bounds it by SHAPE rather than
  by vocabulary, the way a block's document is bounded, so a look this build has no renderer
  for is carried untouched instead of refused. Where a bound is Sloppy's own — how many
  pictures a series holds, how slowly it may turn — it is held on the way IN, by
  `WrittenAppearanceSchema`, which every request that sets a look is read through: a request
  carrying more than this build draws can be refused and asked again, where a stored row
  carrying it has to go on opening the note it is on. DESIGN.md § "The mark" is the doc of
  record for which channel means what, and for the ruling that none of them is a colour.

  A mark's pictures are stored as upload ids and never as addresses or URLs — § "Pictures"
  is why. An id outlives the bytes: a picture deleted from the person's store leaves it
  standing, and the mark then draws exactly as a mark with no picture, because nothing sweeps
  a row for a blob somebody else's store no longer holds.

  A mark may wear several, taking turns — DESIGN.md § "A picture that takes turns" is the
  model, and `@sloppy/types`' `picture.ts` is where the ground under the graph reads the same
  one. The row spells that series across `preview` and `preview_more` so a note styled before
  there could be more than one goes on parsing unchanged, and `resolveAppearance` is where
  the two become the single list every renderer reads: nothing downstream sees them apart, so
  there is no second spelling to keep in step. Splitting a series across two channels is what
  lets one be written without the other, which stores pictures nothing will draw;
  `seriesIsWhole` is the rule that names that shape, and the API is where a request is held
  to it. It is a free predicate rather than a check on the schema because a refinement makes
  `.omit()` and `.partial()` throw at import, and the surfaces that build a look reshape
  `WrittenAppearanceSchema`.

- `schema.ts` is one contiguous string literal, so it is foundation-wave territory rather
  than per-track. Production SurrealDB serves only `DEFINE`d tables; dev does not enforce
  it, so an undeclared table passes locally and fails in production.

Tables are `SCHEMALESS`, and `DEFINE FIELD` is spent only where the database has to enforce
something the application cannot be trusted to. What qualifies is all of it stated above:
`node.graph`, `pulled_node.source_graph` and `publication.graph`, each immutable because a row
that changed one would move a note into a graph where its address may already be taken, or
answer for a region it is not a copy of; every table's `created_by`, made immutable with
`READONLY`; `created_at` / `updated_at` as `TYPE string`, which is what makes a write in the
wrong encoding fail at the write; `node.address` and `pulled_node.address` as
`TYPE option<string>`, so a note with no label is a row the database takes and any number of
them sit in one graph, while the UNIQUE index still refuses a second note at a label one
holds; `node.depth` and
`pulled_node.depth` as `TYPE int ASSERT $value > 0`, because a depth is read as a range and a
range is where a string or a zero would go wrong quietly — `pulled_node.depth` immutable like
the address beside it, `node`'s two left writable because a move and a rename rewrite them; a held row's
`source`, `source_did` and `address`, a `pull`'s publication and a `pull_member`'s two halves,
immutable for the reason `created_by` is — a row that changed one would quietly become a copy
of a different node, of the same node by somebody else, or the record of a region that never
served it; what a publication is rooted at, which chain a version belongs to and its number in
it, and which version each copied note and section sits in, because a peer is reading those and
a row that moved would answer for something it is not a snapshot of; every column of a
`retired_address` and of a `node_alias`, each row being nothing but the fact that one graph has
spent one number and, for an alias, the note it still leads to, so a row that moved either
would free a number a peer holds a citation to or answer that citation with a different note;
and a copied asset's two halves, because a copy pointing at a different original takes the
wrong bytes public, and one whose public half changed strands the address a published section
already cites. `created_at` is immutable too, being a field of the signed payload. Everything
else is a plain column, which is what keeps a later track from having to edit the shared
literal to add a field.

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

**A block is a section, and it holds a whole document.** AI.md § "A Block Is a Section"
is the ruling; this is what it costs and what it buys. One `block` row carries one
TipTap/ProseMirror document — as many paragraphs, headings, lists, drawings and pictures
as somebody wrote into that section — and a note is an ordered stack of those rows.
Adding one is an explicit act, so the row count is the number of sections a person made
rather than the number of times they pressed Enter, and the drag handle moves a thought
rather than a line. A block belongs to one note at a time and may be carried between two
notes of the same owner, which is what `node` on `UpdateBlockRequest` asks for.

**The stored shape is the editor's own, stored losslessly.** Markdown cannot carry ink
strokes or a picture's dimensions, and a single side-payload column cannot describe a
section holding three drawings; converting on the way in and out is what forces both
compromises. The cost is a real one and is accepted: a change to the editor's node schema
is a migration of stored documents, not a rendering detail.

**`BlockDocumentSchema` bounds it by shape, never by vocabulary.** It checks that a
document is a `doc` whose nodes each name a `type` and nest under `content`, `marks` and
`attrs` — the whole of ProseMirror's JSON encoding — and it reads no further. Enumerating
the editor's node types here would make every editor change a schema change, and would
refuse the documents stored before it; accepting `unknown` would let a malformed value
reach a renderer that cannot defend itself. So an element kind this version has no
renderer for still parses and is carried untouched, and an `attrs` payload — an ink
element's strokes, a picture's upload id — is validated by whichever renderer claims it,
not at the storage boundary. Keys outside ProseMirror's five are dropped on parse.

**A renderer's claim is a predicate, registered where the stack is opened.** `readsAsInk`
answers for `InkElementData`, and `document.ts` maps it to the `ink` element; a kind
nobody claims is simply carried. An element whose attributes its own renderer will not
take is then treated exactly as a kind we have no renderer for — the row is carried
untouched and the note opens around it — rather than reaching a node view that will
draw it and fail, which takes the whole interior with it.

**Depth is the one thing bounded by size rather than shape.** SurrealDB's JavaScript
driver stops answering a write once a value nests past ninety-six objects and arrays:
the promise it returned never settles, so a save hangs instead of failing and the note
sits on "Saving…" for the life of the surface. `MAX_DOCUMENT_NESTING` is 48 — half of
what was measured, so the bound holds even if a driver version spends its levels
differently, and it still takes a list indented ten times. It counts every level rather
than every element, because `attrs` is where an unbounded payload would otherwise hide.

**`section` is the only node a note's document holds at the top, and one section is one
row.** `document.ts` in `@sloppy/ui` owns that correspondence: it opens a stack as one
document, reads the rows back out of it, and works out what has to reach the API.
`section-node.ts` is what makes Enter behave — the node is `isolating`, so a split stays
inside it and a join cannot pull the section before it in, and `addSection` is the only
thing that makes another. A section with nothing in it is not a row until it is one: the
empty section a new note opens on never becomes one on its own, and a section already
saved keeps its row when it is emptied.

**TipTap 3 for the surface.** Slyng's `post-editor` was itself ported from Pendi's
`journal-editor`, so we extend that lineage rather than start over: the WYSIWYG surface,
`emoji-node.ts` (a TipTap inline atom holding the shortcode it was written as),
`emoji-suggestion`, and `media-node.ts` with its upload-in-progress → final-URL
replacement and durable-ref pattern. Markdown shorthands are still how prose is typed;
`@tiptap/markdown` is gone with the storage format that needed it.

**`reference-node.ts` is Sloppy's own inline atom, on that same footing.** `[[` opens a
menu of notes and writes the one picked into the sentence; what is STORED is the note's
ref — which outlives every rename — beside the words it was cited under, so a note that
has since gone still reads as something. It is an element inside a stored document like any
other — no column and no row — and it is also an edge: `citedNotes` in `@sloppy/types` reads
the notes a document names, and `node.references` is that read. It writes no `links` entry,
which stays what a hand drew; DESIGN.md § Edges rules on both.

**A shape leaves no trace of itself.** `templates.ts` in `@sloppy/ui` turns a shape into
a list of documents and `writeTemplate` creates one row for each, after whatever the note
already holds — so a seeded section is an ordinary block the moment it exists. Nothing
records which shape a note came from: there is nothing to validate a note against later,
and changing a shape cannot reach a note already written from it.

The emoji tokenizer's ordering is load-bearing and must be carried across: **mention spans
are captured first** (a `did:syr:…` contains colons that would false-match `:syr:`),
stickers before emoji, then linkify. Size comes from the syntax used, not a stored flag.

**`InkNode` is new.** A TipTap atom holding stroke data (point, pressure, tilt, timestamp)
rendered to canvas, with a rasterized PNG pushed to syr blob storage so peers who cannot
re-render strokes still see the drawing. It is an element inside a block's document, so a
section can hold several drawings and prose between them.

**Ink over the CANVAS is not this, and has no row.** A pen over the graph leaves a
drawing on the field rather than an element inside a note, so it is neither a block nor a
table: it is kept on the device for the person signed in, under the graph it was drawn
over, and nothing of it reaches a note, a publication or a peer. There is no `graph_ink`
table and no route to write one — DESIGN.md § "The canvas" is the ruling. What the two
share is the stroke code in `@sloppy/ui`'s `ink.ts`, because pressure, tilt, coalesced
samples and the rough-line fallback are the same wherever a pen is read; what differs is
the coordinates the points are kept in, which over the canvas are the field's.

**TipTap's editor instance must not be `$state`** — Svelte's deep proxy corrupts its
internals. Use a separate `ready` flag for post-mount UI.

**A write to a section may carry the version it was planned against.**
`UpdateBlockRequest`'s `expects` is the `updated_at` the surface last read off that row.
Absent asks for no precondition and writes over whatever is there, which is what a lone
surface has always done; a value that does not match the row means the section was written
somewhere else in between — the same note open on a phone and a tablet — and the write is
refused instead of taking that writing with it. The row already carries the timestamp, so
this adds a field to a request and nothing to the store.

**A section goes and comes back with the note that holds it.** `deleted_at` on `block`
says the note went, so it is stamped and cleared alongside the note's; taking one section
out of a note on its own is still the row going, and no timestamp.

## Tagging a note

**The tag axis is read inside one graph.** `GET /api/nodes/tags` counts the notes of one
graph — the caller's home graph where they name none — because the rail is the legend for
the canvas beside it, and a count that includes notes that canvas will never light is a
number nobody can act on. Selecting tags still intersects sets across the genealogical tree,
which is the axis AI.md means; what it does not cross is a graph.

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

- **Platform-split capabilities** — `default.json` and `mobile.json`
  (`platforms: ["android","iOS"]`), each with a `description` explaining _why_. A
  capability is granted where something calls it and withdrawn where nothing does.
- **Plugins grouped by `cfg`** in `Cargo.toml`. `tauri-plugin-safe-area-insets-css` is
  mobile-only; deep-link and opener are everywhere; single-instance is desktop.
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
- **Sign-in returns over the scheme, not the origin.** A webview's own origin
  (`tauri://localhost`, `http://tauri.localhost`) is not an address the system browser can
  navigate to, so the native shell answers `AppRuntime.signInRedirect` with
  `sloppy://auth/callback` — one of the four shapes `isAllowedRedirect` accepts. The link
  comes back through `src/lib/deep-link.ts`, which re-enters the document at `/` with the
  query intact, because the session is opened as the app boots and only then. A link is
  remembered the moment it is entered, and the boot read skips what this session has already
  been through: the deep-link plugin keeps answering with the same link for the life of the
  process, and re-entering the document brings that read round again.
- **A link to a note opens the app.** `tauri.conf.json` declares `sloppy.sh`'s `/n` paths as
  app links beside the custom scheme, which puts `autoVerify` on the Android intent filter
  and the associated-domains entitlement in the iOS project. Both halves of the claim are
  the domain's to answer: `apps/sloppy/web/static/.well-known/` carries the two association
  files, and each names an identifier that only exists once the app is signed —
  `$APPLE_TEAM_ID` and `$ANDROID_SIGNING_SHA256` stand in until then, and until they are
  filled a tapped link opens in the browser as it did before.
- **Android's back gesture belongs to the app.** `MainActivity.kt` offers the press to the
  webview as a cancelable `sloppy:back` event and lets the system have it only where nothing
  was cancelled; `src/routes/+layout.svelte` closes the sheet on top (`overlay.closeTop()`),
  then walks back off a note, then leaves. It walks only for somebody signed in: the frame
  decides where a signed-out person stands, so walking back off sign-in would land on a page
  the frame sends them straight back from.

**Apple Pencil, precisely.** Tauri v2 on iOS renders through `WKWebView`, so Pencil arrives
as Pointer Events: `pointerType === 'pen'`, `pressure`, `tiltX`/`tiltY`,
`altitudeAngle`/`azimuthAngle`, and `getCoalescedEvents()`/`getPredictedEvents()` — the
last three landed in **Safari 18.2** and are what make ink smooth rather than polygonal.
There is **no simultaneous pen + touch** (WebKit drives one input type at a time), which is
what the gesture split in DESIGN.md is built on. There are **no Pencil Pro gestures** on
the web layer. Latency will not match native PencilKit, which is acceptable because ink is
an element inside a block and an annotation layer here, not the product itself.

## Verification

- `pnpm check`, `pnpm lint`, `pnpm test` from the root via turbo; `cargo fmt --check` and
  `cargo clippy -D warnings` against `src-tauri`. `.github/workflows/verify.yml` runs all
  of it on push and pull request, with the datastores up and `SLOPPY_INTEGRATION` set.
- **The schema against a running server.** Immutability, the unique index and the timestamp
  type are claims about an engine, not about a string, so `@sloppy/data` asserts them over
  the dev stack. The suite runs where `SLOPPY_INTEGRATION` asks for it, and asked with
  nothing listening it fails rather than skips, so a green run cannot be a silent one: it
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
