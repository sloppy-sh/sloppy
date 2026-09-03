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
│   │   ├── types/     @sloppy/types     — Zod schemas: node, block, document, tag, ink stroke,
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
a subtree in as a foreign, read-only region **with its addresses intact** — the
deterministic address is what makes a pulled subtree land in a known shape rather than as
an opaque blob.

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
navigate or cite — and `<did>/<ulid>` is what a route binds.

**The routes.** Four answer without a session, and they are the ones a peer's instance
calls:

- `GET /api/public/publications/{did}` lists what that identity publishes here — each
  publication's ref, the address it is rooted at, the newest version's title, and that
  version — and nothing that is not already public in it.
- `GET /api/public/publications/{did}/{id}` answers a page of a version: `?version=`
  names one, and absent is the newest.
- `GET /api/public/publications/{did}/{id}/versions` answers the chain, newest first.
- `GET /api/public/publications/{did}/{id}/changes?from=&to=` answers what the writing did
  between two of them.

The first of those is the exposure publishing creates, and the copy at the moment of the
decision has to be true to it: from the moment a subtree is published, anyone holding the
author's DID can see that it exists and read all of it, with no publication address to
withhold and no pull to grant. § "Pictures" says the same of the pictures in it.

The author's own need their session: `POST /api/publications` publishes a subtree —
creating the chain if the note has none, and writing a version either way;
`PATCH /api/publications/{ref}` changes who is invited to comment and publishes nothing;
`DELETE /api/publications/{ref}` takes the whole chain down; and
`GET /api/publications/{ref}/versions` is the author's own history. A published node
travels **without its `depth` and without its look** — a reader recomputes depth, sector
and which addresses lie under which from the address, and draws a pulled mark unstyled.

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
notes go in **lexicographic** address order — the order the `address` column itself gives,
which puts a note's parent ahead of it because a parent's address is a prefix of its
child's. Lexicographic and not `compareAddresses`, which reads `1a2` before `1a10` and is
what a surface sorts by when it shows a person a list: a server paging by one order and
cursoring by the other skips notes across a page boundary, and nothing on the reading side
would catch it. That is what makes the size bounds a defence rather
than a ceiling a graph can hit: a branch of any size is read page by page, and what a
per-page bound refuses is one answer too large to hold, never a subtree too large to
publish.

**The difference between two versions is computed where the versions are.** The instance
holds every version and the reader holds none, so a phone asking what changed between two
snapshots of a ten-thousand-note branch reads the difference rather than both sides of it.
One entry per note — arrived, gone, or changed — in the same address order a version's own
pages take, carrying both sides of the note and both sides of only the sections that
differ, which is what a review-shaped diff needs and no more. A note that is gone carries
no sections: what it said is in the version that still has it, and that is a read a reader
makes when they want it. Where one address holds a different note in each version, the
reader is told both: one note gone and another arrived. `PublishedNoteChange` in `@sloppy/types` is the shape and
`publishedChangesReader` the boundary.

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
keeps their graph here — and answers what that identity publishes there. The request is
made by the reader's instance, so the instance asked learns an instance and never a reader,
and a `pull` row keeps the origin in `source_url` so refreshing a region asks the same
instance again.

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
  changes version half way through a region, roots one region at two addresses, carries a
  note attributed to somebody else, carries one outside the region that was asked for, puts
  a second note at an address another note in the region already has, springs a note from
  anything but the note at its own parent address, names a link to a note somebody else
  wrote, writes a timestamp at a width other than `TimestampSchema`'s, refers to a note it
  did not send, or hands back a history whose numbering stops falling is answering a
  question nobody asked. A page that does any of it is refused WHOLE, and a refused page
  leaves the reader holding exactly what it held before — the reader is writing rows under
  the author's name, so half a page is not a thing to store. A listing followed to its end
  goes through `publishedIndexReader`, which holds a run of pages the same way: one entry
  per publication, so a publication listed twice is refused the way a second note at a
  taken address is.

  Two of those refusals are the address protocol, held on rows a peer handed us. Two
  notes at one address is `node_owner_address UNIQUE`: our own rows cannot do it, and a
  copy of somebody else's may not either, or a citation of that author's `1a1` resolves two
  ways in the reader's graph. Where a note hangs is the other half of the same rule — a
  mark's position seeds from its address alone, so a genealogy that disagrees with the
  addresses draws a shape the two peers do not share, and a CYCLE of parents is that
  disagreement at its worst: our own rows cannot hold one, so the walk up a note's
  ancestors does not guard against one and the first draw of that region would never
  return. And every reference is held to its author because the published shape reaches an
  anonymous caller: a `links` entry naming one of the READER's own notes would otherwise
  draw a stranger's note into their graph as a link they had drawn themselves. The one
  timestamp width is the last of them — a signature is over the bytes the author sent, so a
  published node is not something to normalize on arrival, and one encoding on the wire is
  what leaves the stored copy checkable.

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

**A published node carries only references a peer may follow.** The shape reaches an
anonymous caller, and a `<did>/<ulid>` is not readable on its own but still says a note
exists and when it was written. So `origin` on a published node is the root of the REGION
rather than of the author's tree, which for a publication rooted below depth 1 would
otherwise be a note nobody published; the region's root carries no `parent`, its parent
being outside the publication; and `links` carries only targets the same author had
published when the version was made, a link to an unpublished note being dropped rather
than named. The reader's copy is a tree rooted at the region root, so it satisfies the same
`ref === origin` a root always does.

**Where a foreign region is DRAWN is not settled here, and a surface must settle it before
it builds one graph out of two.** A mark's position seeds from its address alone
(`packages/ts/graph/src/layout/geometry.ts`), so a peer's `1a` and the reader's own `1a`
seed identically, and `graph.addNode` is keyed by ref, so two held regions that overlap
answer the shared notes twice. Neither is a defect in the layout — it is what makes one
person's graph readable in the same shape by another — and both are the pull surface's to
answer.

**A follow belongs to the reader's identity store, not to Sloppy.** Identity is syr's half
of the table above, syr already keeps a follow list and serves it at an identity's
`public_following` endpoint, and a second list here would be a second answer to "who does
this person follow" that nothing reconciles. So `GET`/`POST`/`DELETE /api/following` reads
and writes that store with the reader's delegation, and Sloppy stores nothing. The
provider URL the store recorded beside a DID is the first step of resolving it; absent, the
DID is resolved from scratch.

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
  deriving from an address (AI.md § "The Address Is the Protocol") bent: what a peer's
  instance chose to send is not a fact any address states.
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
  reader's own mint from the address, held to the address by `parsePulledNode` exactly as
  `parseNode` holds a node's.

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

- **A note shows the comments and reactions written by the reader and by the identities
  they follow, and cannot show more.** Each of those is read from the store that holds it,
  and the reader's own store is one of them — nobody follows themselves, and a reader whose
  own comment vanished on reload would be reading a thread they are not in. Reaching a
  stranger's comment would need a firehose syr does not have. A surface that implies it is showing every comment on a note is lying, and there is
  no total to show beside one either — nobody can compute one, which is also why nothing
  here counts toward a score (PRODUCT.md § "Anti-references").
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

**Local-only mode has neither.** `@sloppy/idp` serves files, emoji and a profile, and its
identity manifest advertises no `public_comments`, `public_reactions` or `public_following`
— so an instance running on the embedded provider can publish, be pulled from, and pull,
and has no conversation and no follow list at all.

## Pictures

Who may read a picture is decided once, by the folder its bytes land in, and everything
else follows from that. `folderPathFor` in `api/src/media/media.service.ts` is the whole
policy:

| Role                       | Folder            | Who can read it                                          |
| -------------------------- | ----------------- | -------------------------------------------------------- |
| `avatar`, `banner`         | `public/sloppy/…` | anyone — a peer resolving the DID has to see them        |
| `emoji`                    | `public/sloppy/…` | anyone — a federated `:shortcode:` renders for everybody |
| `block` (a note's picture) | `sloppy/notes`    | its owner alone                                          |

A mark's preview picture is deliberately that same role rather than a new one: the folder
is the access rule, a mark's picture wants exactly the note picture's rule, and one library
means a picture already in a note can go on its mark without being sent twice.

Publishing adds a fifth placement and no fifth role: the copies below land in
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
(`ownPictures` lists the note folder, and the picker exists so a picture is used again
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

A mark's preview picture is not among them: a published node travels without its look, so
nothing a peer holds ever cites one, and it stays private.
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
lookup; the milestone serving the route owns making that cheap enough to sit behind an
`<img>`, and it may not assume the listing is short — the copies above go into it, so
somebody who publishes a branch full of pictures has a long one.

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
  appearance  object?   the look its author gave the mark; absent is unstyled
  created_at  iso       immutable — it is a field of the signed payload
  updated_at  iso
  content_signature, signed_payload_json, signing_device_public_key

block:{ created_by: <did>, id: <ulid> }
  created_by  did
  node        ref
  ord         string    fractional index — reorder without renumbering
  content     object    the section's whole document, as the editor wrote it

**A deleted note leaves its inbound links behind.** `links` is an array of refs on the
*linking* node, so removing a note cannot reach the notes that pointed at it — deletion takes
the subtree, not the mentions. The note surface renders a missing target honestly ("A note
that is no longer here.") with its own unlink control, so nobody is shown a row that waits
forever, but nothing sweeps the stale refs. Whichever milestone adds a sweep owns deciding
whether it runs on delete or on read; until then the stored array is a superset of what
resolves.

publication:{ created_by: <did>, id: <ulid> }
  created_by    did
  root          ref       the subtree it publishes, immutable
  root_address  string    the label a person cites, immutable
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
  address       string    where its author addressed it, immutable
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
  root_address  string    the label the answer carried
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
  address       string    where its author addressed it, immutable
  depth         int       the reader's own mint from the address, immutable
  node          object    the published node, carried untouched

pulled_block:{ created_by: <did>, id: <ulid> }
  created_by    did       the reader
  source        ref       the block as its author addresses it
  node          ref       the node it belongs to, as its author addresses it
  ord           string
  content       object
```

**A version is what makes a subtree readable. `node.published` is not.** A peer reads
`snapshot_node` and `snapshot_block` rows and never the notes they were copied from, so
deleting a publication — with its versions, its copies and its assets — is unpublishing.
`node.published` is a separate column on the note, and `provenanceOf` in `@sloppy/graph` is
the only thing that reads it: it decides whether a mark draws as own or as published, and
nothing else follows from it. `apps/sloppy/api`'s `publication/` serves the author's own
routes and the four public ones; the peer-mediated reads and the pull side of § "Federating
the graph" are not served yet.

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
  on 3.1.3, an unpinned read the planner hands to another index (an `ORDER BY` is enough)
  comes back with **zero rows and no error**, and a composite `created_by, tags` fails the
  same silent way. So the owner is a filter over the seek rather than the leading column,
  and every tag read is written
  `FROM node WITH INDEX node_tags WHERE tags = $tag AND created_by = $did`.
  `tags CONTAINS $tag` is always correct and never uses the index; it is not the spelling.
  `schema.integration.test.ts` holds both halves against a running server.

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
  reader gets.
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

- **`appearance` is authored, and that is what makes storing it right.** The rule it looks
  like it breaks — nothing derivable from an address is stored — is about facts the address
  ALREADY states: the sector, the collapse key, the depth. Nothing computes a note's look
  from anything; a person chose it, so there is no function for the row to fall out of step
  with, and the only other place it could live is a second store. It is a plain column on a
  SCHEMALESS table, because the database has nothing to enforce about it that
  `@sloppy/types`' `appearance.ts` does not — and that schema bounds it by SHAPE rather than
  by vocabulary, the way a block's document is bounded, so a look this build has no renderer
  for is carried untouched instead of refused. DESIGN.md § "The mark" is the doc of record
  for which channel means what, and for the ruling that none of them is a colour.

  The preview picture is stored as an upload id and never as an address or a URL —
  § "Pictures" is why. The id outlives the bytes: a picture deleted from the person's store
  leaves it standing, and the mark then draws exactly as a mark with no picture, because
  nothing sweeps a row for a blob somebody else's store no longer holds.

- `schema.ts` is one contiguous string literal, so it is foundation-wave territory rather
  than per-track. Production SurrealDB serves only `DEFINE`d tables; dev does not enforce
  it, so an undeclared table passes locally and fails in production.

Tables are `SCHEMALESS`, and `DEFINE FIELD` is spent only where the database has to enforce
something the application cannot be trusted to. What qualifies is all of it stated above:
`node.address` and every table's `created_by`, made immutable with `READONLY`; `created_at`
/ `updated_at` as `TYPE string`, which is what makes a write in the wrong encoding fail at
the write; `node.depth` and `pulled_node.depth`, immutable like the addresses they mirror
and `TYPE int ASSERT $value > 0`, because a depth is read as a range and a range is where a
string or a zero would go wrong quietly; a held row's `source`, `source_did` and `address`,
a `pull`'s publication and a `pull_member`'s two halves, immutable for the reason
`created_by` is — a row that changed one would quietly become a copy of a different node,
of the same node by somebody else, or the record of a region that never served it; what a
publication is rooted at, which chain a version belongs to and its number in it, and which
version each copied note and section sits in, because a peer is reading those and a row
that moved would answer for something it is not a snapshot of; and a copied asset's two
halves, because a copy pointing at a different original takes the wrong bytes public, and
one whose public half changed strands the address a published section already cites.
`created_at` is immutable
too, being a field of the signed payload. Everything else is a plain column, which is what
keeps a later track from having to edit the shared literal to add a field.

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
rather than a line.

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
has since gone still reads as something. It is an element inside a stored document like
any other: no column, no row, and no entry in `links`, which DESIGN.md § Edges rules on.

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
an element inside a block and an annotation layer here, not the product itself.

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
