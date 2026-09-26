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
- **Local-only** — no Sloppy anywhere. The native app opens a folder on the device and the
  vault in it is the whole store (§ "A graph on disk"); the identity that owns it is made on
  first run with nothing asked, or is one the person already keeps at an identity store and
  signs in to, which settles who they write as and nothing else. What genuinely needs a
  server — publishing, peers, pulling, conversation — is not offered there, and a graph
  crosses between this mode and a hosted one as an archive. See "Local-only mode" below.

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
│       ├── idp/       @sloppy/idp       — syr IdP wire contracts + crypto, for local mode
│       ├── openpgp/   @sloppy/openpgp   — checking an OpenPGP signature; the one place that speaks that dialect
│       ├── vault/     @sloppy/vault     — a graph as files: the vault folder and the archive
│       ├── local/     @sloppy/local     — the graph served off this device: files, a local identity, the vault client
│       └── cli/       @sloppy/cli       — the `sloppy` command: a project's notes read, checked and written
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
  navigates the tab; `createApi?` present on native means the graph can be served off the
  device, and `mode()` says whether it is being served that way right now. `saveFile?` and
  `openFile?` are how a file leaves and arrives where a webview cannot do what a tab does,
  and `assetSrc?` is how a stored picture becomes an address this page can load — absent,
  that is the API's proxy, which is what keeps a viewer's IP off somebody else's instance.
  The shell calls `initRuntime()` from its root layout before any page mounts, and
  `updateRuntime()` where it settles a member again while it is running — a field passed as
  `undefined` there puts that member's documented absence back. Nothing watches the seam, so
  a shell that swaps where the graph is served from settles it BEFORE the state a surface
  does watch, and then says `seamSettledAgain()` (`app-core/src/lib/seam.svelte.ts`): every
  answer a surface read through `seam()` — `session.onDevice`, and what a tab can do with
  graphs — is read again.
- **`app-core/src/lib/api.ts`** — `api` is a `Proxy` that resolves its implementation on
  first property access, so remote ↔ local swaps without touching a call site. The port it
  resolves to is `SloppyApi`, the `SloppyClient` surface taken structurally, so an adapter
  satisfies it by shape and never by cast; `serverOnly` is a whole method body for what an
  adapter cannot serve.

**What fills those on native is `@sloppy/local`.** `Files` is the shell's own file access —
read, write, list, remove, exists, mkdir under one root, a folder picker, the app's private
data path, and the address a picture in the vault loads from;
`apps/sloppy/native/src/lib/files.ts` is the Tauri-backed adapter and `MemoryFiles` is what
a test runs against. `LocalApi` is the `SloppyApi` implementation over it, and
`makeLocalIdentity` is the identity that owns what it writes.

Platform branching is **compile-time**, via `import.meta.env.TAURI_ENV_PLATFORM`
(`IS_MOBILE`, `IS_APPLE`), with `envPrefix: ['VITE_','PUBLIC_','TAURI_ENV_']` in
`vite.config.ts` so the constants dead-code-eliminate per target. A runtime `if (isIOS)`
ships both branches to every platform.

## The genealogy and the address

The part that has to be right first, because peers hold each other's graphs. AI.md § "The
Genealogy Is the Protocol" states the rules; this is the mechanism.

**A note is reached by its ref.** `<principal>/<ulid>` is the row's own composite key spelled
for the wire — § "Who a person is" says what the first half may be — and it is what a link, a
publication, a pull and every route are keyed on. No lookup anywhere resolves a note by
address except the one a person types, which is exactly
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
- **A retired row names the note that spent the address, and answers to it.** `note` on
  `retired_address` is the ref the number was purged off, so `addressLeadsTo` reads a
  retired address back as `deleted` beside that note and `NodeService.claim` lets that one
  note — and no other — write the number again. What that buys is the round trip: a graph
  exported, taken back in and settled note by note reaches its own notes at their own
  numbers. `note` is absent on a row written before the column existed, and such a row is
  refused to everyone, which is what a retired address was to everyone before this.
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
  leads to the note that left first. `NodeService.keptBehind` is the same rule on the other
  side, so the note that took the number and then renames, unnumbers or carries itself away
  leaves nothing behind. The yielded note comes back from the bin with no address and its
  alias intact, which is what the note page reads to say `was 2b`.
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

**The home graph is a graph, and its ulid is its own.** Everybody has one before they open a
second, and it is minted the way every other graph's is: `GraphService.home` writes the row
the first time anybody asks for it and `home` on that row is what finds it again. No two
people's home graphs share a ulid, which is what lets somebody export the graph they started
with, bring it back, and have it settle into itself rather than open a stranger beside it —
and what stops an archive of one person's first graph from reading as another person's
first graph. The flag is the whole of what makes it home: it is listed first, it is where a
note that names no graph goes, and it is the one graph its owner cannot close.

**A ulid every identity shared is what this replaces**, and the `HOME_GRAPHS` statements in
`@sloppy/data`'s `schema.ts`, which `defineCoreSchema` applies, are the crossing. They run on
every open beside the rest of the schema, mint one home graph per identity that has rows and
none, and rewrite `node.graph`, `node_alias.graph`, `retired_address.graph`,
`publication.graph` — including a publication written before that column existed, which would
otherwise be left naming a graph none of its own notes are in — and the
`pulled_node.source_graph` of an author this instance itself holds, from
`<did>/00000000000000000000000000` to the minted ref. It is
idempotent because it is bounded by what still spells that ulid, and a second run over a
store it has already crossed reads nothing to write. The statements commit one at a time, so
a run that stops part way leaves an identity minted and its rows still spelling the old ulid;
the next run carries them to the home graph already flagged rather than passing that identity
over, which is why the mint is what is gated and never the carrying.
`schema.integration.test.ts` holds it against a store built the old way and against one whose
crossing stopped after the mint.

**One home graph per person is the database's rule**, not the application's:
`graph_owner_home` is UNIQUE, and a graph that is not home leaves the column out rather than
writing `false`, so an index that does not constrain an absent column leaves every other graph
alone. The mint draws a fresh ulid, so two processes crossing one uncrossed store together
would each open one; the index is defined a few statements after the crossing and refuses the
second, which fails the schema rather than leaving a person two home graphs, one of them
empty. A store is crossed by one process.

**A graph nobody named** is what that ulid is now, and `UNNAMED_GRAPH_ULID` in `@sloppy/types`
is the constant: `graphRef(owner, undefined)` answers it, and it is what a peer serving a page
from before a page carried its graph leaves out. Nothing mints it — `ulid()` writes the current
time into a ULID's first ten characters — so no graph anybody keeps is ever at it, and a
`pulled_node` of a peer this instance does not hold keeps it rather than being given a home
graph ulid nobody here can know. An archive taken out before every graph had one names it in
`graph.json`; both surfaces open a graph of its own for it rather than settling it into the
graph the importer started with — `ArchiveImportService`'s landing and `LocalGraph.open`.

The two columns a UNIQUE index reads — `node.graph` and `pulled_node.source_graph` — are never
absent, because SurrealDB does not constrain a row whose indexed column is absent, and two rows
with no `graph` and one address are both accepted, measured on 3.1.3. So `schema.ts` fills them
once on a store that predates graphs and then declares both `TYPE string`, which is what leaves
the index holding the address rule rather than the application's discipline.
`schema.integration.test.ts` holds a store built the old way against both halves.
`publication.graph` is in no unique index and stays optional.

**The graph travels with a published region.** `PublishedSubtreePage` and
`PublishedPublication` carry it, because a reader holding two regions of one author cannot
otherwise tell that author's two `1a`s apart. A region lies in one graph — the branch it is
rooted at does — so `publishedSubtreeReader` holds every page of a run to the same one, the
way it holds them to one version.

**A person writes and removes an address wherever one is shown.** `PUT
/nodes/:did/:ulid/address` takes `{ address }`, and `null` takes the label off. The address
it leaves becomes a `node_alias` row, so a citation written before the rename still opens the
note — unless the graph already leads back by that address, which is the earlier note's; the
address it takes must be one nothing in that graph has ever been assigned,
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

### Whose writing a note carries

**The ref's owner says whose graph a note is in. Whose writing it is, is a list on the
note.** Three fields on `NodeSchema` carry it, and every one of them travels — the hosted
row, the vault's front matter, the archive, a published snapshot and a pulled copy:

- `owner` — who gates the note's writing. Absent is an **open** note, which is every note
  written before this rule.
- `authors` — everybody whose writing the note carries, in the order they first wrote into
  it. **Absent, and empty, read as the ref's own owner alone**; `authorsOf` in `@sloppy/types` is
  the one reader of that fallback, so no surface spells it twice. The writer writes the list
  out whenever it is anything else, which is the canonical form the vault round trip is
  lossless up to.
- `contributors` — everybody whose offered change the owner has taken in, in the order they
  were taken. Absent, and empty, are none.

`created_by` keeps meaning what it always meant: whose rows these are, and what the purge
sweeps by.

**One function decides what a write does, and every surface calls it.** `writeOutcome(note,
writer)` in `@sloppy/types`:

- `owner` absent → the write **lands**, and `withAuthor` appends the writer to `authors`
  where they are not in it yet.
- `owner` is the writer → the write **lands**, and `authors` is untouched. Ownership is not
  writing.
- `owner` is somebody else → the write does not land. An ordinary write is **refused in
  words**, and the surface that was writing composes the change and offers it instead, so
  nothing is offered on somebody's behalf without their asking. One offer per person per
  note — offering again writes the offer already standing rather than stacking a second,
  which is what `amendment_owner_note_by UNIQUE` holds.

Setting, changing and removing `owner` is the graph owner's act and the current owner's act.
A contributor cannot claim a note, and an offer carries the note's **writing** — title, tags,
look, sections — and never its place: nobody moves, renumbers or re-parents a note somebody
else gates. **The graph's own owner places every note in it whatever its gate says** — the
genealogy and the numbers are the graph's, and handing a note's writing on does not hand
those with it. Handing the gate on is likewise not writing, so a request that does only that
is not held to the gate it is taking off, while one that also writes is.

**An act that carries a subtree is held to the gate on every note it carries.** Deleting,
moving and renumbering by moving take everything that sprang from a note with it, so a note
in that subtree somebody else gates stops the act, and the refusal names that note rather
than the one the person acted on — a gate a person cannot reach through the note above it is
the whole of what a gate is. The graph's own owner is exempt here as everywhere: what they
place is theirs to place. In a folder on a device that is `NoteWriter`'s own rule; on a
hosted instance every row an act reaches is scoped by `created_by`, so the only person who
can carry a subtree there is the graph's owner.

**A graph decides the default for the notes written in it.** `Graph.ownership` is `open` or
`owned`, absent is `open`. `owned` stamps `owner = writer` on every note at creation; `open`
stamps nothing. Changing it reaches the notes written from then on and leaves the ones
already written as they are — a person changes a note's own owner wherever its details are
shown.

**An amendment is a row and a file.** The `amendment` table's `created_by` is whose graph the
note is in — the owner half of the note's own ref, the way `comment_pointer`'s is, and never
whoever gates the note, which a graph owner may have handed on. It is what the offer's own
`<did>/<ulid>` is built from, what a note's offers are read by, and what carries them away
with the notes they stand on when that identity is erased. `by` is who offered it. **The
sections it proposes ride on that row**, in order, rather than in a table of their own —
nothing reads one without the offer it belongs to, so there is no second row for the purge
to miss. Each is named by the ULID of the note section it stands for: a ref the note has is
that section kept or rewritten, one the note does not have is a section the offer adds, and
a section of the note the offer does not name is one it takes out. **One naming a section of
another note is a section the offer adds too** — an offer carries the note's own writing, so
taking it in never moves a section off the note it is on, and the section it adds is written
under a reference of its own. An offer proposes the
note's body whole, which is also what lets it be written as a file in the note's own shape.
In a vault it is `amendments/<ulid>.md` (§ "A graph on disk"), committed like any note, so
it travels through the folder's history and rides in archives; the bin does not hold one.
**A hosted graph has one writer**, so nothing on a hosted instance offers a change in the
first place: the table is there so a graph arriving as an archive with offers standing on
it loses none of them, and so its owner can settle them, and `POST /amendments` says plainly
that this is not something to do here.

**Approving replaces the note's writing with the offer, whole** — title, tags, look,
sections — bumps `updated_at`, adds the proposer to `contributors` and removes the offer.
`authors` is untouched: an owned note's authorship stays the owner's. Declining removes the
offer and records nothing; a proposer may withdraw their own. The owner is shown the
difference between the note as it stands and the offer, section by section, in the language
DESIGN.md § "A difference between two states" already has. **Taking part of an offer is a
later theme** — there is no section-level picking, and an offer is taken or turned down
whole.

The routes: `GET /nodes/:did/:ulid/amendments` lists what has been offered on one note,
**oldest offer first** — the order they arrived in, and the order they are read in on every
surface. On a hosted instance the notes are one person's rows, so what that route answers is
that person's: the offers standing on a note in their own graph. A folder read by more than
one identity is where the other half holds — whoever the note's writing lands for reads every
offer on it, and whoever made one reads their own, which is what lets a proposer see the
offer standing in their name and take it back. `POST /amendments` offers one or writes the
one already standing; `DELETE /amendments/:did/:ulid` withdraws it;
`POST /amendments/:did/:ulid/approve` and `/decline` settle it. An amendment is addressed by its own `<did>/<ulid>` like every other
row here, and that DID is the graph owner's.

## Who a person is

A person Sloppy names is a **principal**, and a principal is a URI whose scheme says how it
is read. There are two: `did:syr:z…`, a syr identity whose method-specific part IS an Ed25519
public key, and `mailto:alice@example.com`, an email address. `PrincipalSchema` in
`@sloppy/types`' `common.ts` is the union, and a third way of being named is an arm of it —
never a second field beside the first, and never a boolean (AI.md § "Provider-Agnostic Data
Shapes").

**A `mailto:` is lowercased on the way in and compared byte for byte afterwards.** The
binding it will be resolved through — Web Key Directory — lowercases the local part before it
hashes it, so lowercasing is what the mechanism already does; and an access list in which
`Alice@…` and `alice@…` are two people is a way to be locked out of your own graph. It is
normalised at the schema boundary, so no caller has to remember. Everything downstream treats
a principal as opaque — it is compared, it is half of a ref, and it is the column a person's
rows are swept by.

**What a `mailto:` may hold is narrower than RFC 6068**, and a second implementation must
match it or mint refs this one refuses: an unquoted local part, at a domain of two or more
labels of letters, digits and hyphens. A quoted local part (`"alice smith"@…`), a domain
literal (`alice@[192.0.2.1]`) and a single-label domain (`alice@localhost`) are all refused —
the binding this scheme resolves through needs a real domain to ask. `/` is refused because it
separates the halves of a ref, and `%` because it would give one address two spellings.

**A ref is `<principal>/<ulid>`.** Each half is held to its own schema rather than to one
regex spanning both, and the split is at the LAST `/`. A row's key is the same two halves as
an object — `table:{ created_by: <principal>, id: <ulid> }` — so an `@` or a `.` reaches the
driver as a value and is never spelled into a query.

### Narrow and wide, and which is which

`DidSyr` did not go away, and blanket-renaming it would have been the wrong answer. The line:

- **Wide — a principal.** What the genealogy and a graph's policy NAME: `created_by` on every
  row, both halves of every ref, a note's `owner`, `authors` and `contributors`, a role's
  `members`, an override's target, an amendment's `by`, the identity a `Vouch` is about, the
  `Viewer.did` a session answers with, a peer's `PublishedIndex` with the follow and
  peer-lookup queries that reach one, the declaration that says where a graph is served, and
  `NodeSignedPayloadV2`. These are strings the system compares and never resolves.
- **Narrow — a `did:syr`.** What this build RESOLVES, FETCHES FROM, or DERIVES A KEY FROM:
  syr's own wire in `syr.ts` and everything in `@sloppy/idp`, `StoreRef` and the two
  functions that make and split one, the `SessionRow` a delegation is held under, a comment's
  author and a reaction's, a profile, an emoji catalog, a folder's own `VaultGraph.owner` and
  the archive preview that mirrors it. `NodeSignedPayloadV1` sits in that file and is narrow
  with it, which is the whole of why V2 exists beside it.

The test, site by site: **does this value get compared, or does it get dereferenced?** A
compared one is wide. A dereferenced one is narrow, because dereferencing is per-scheme and
this build has one scheme's machinery. An identifier CARRIED into a fetch is not thereby
dereferenced: what names the instance a listing is read from is the origin beside it, named
by the reader or declared by its subject, and the identifier itself is only ever compared to
what came back. A parameter follows what it is FOR rather than what today's caller happens
to hand it: one whose contract is "the person signed in here" stays narrow though it is only
ever compared, and one whose contract is "who gates this note" or "whose graph this copy came
from" is wide though every caller today hands it a `did:syr`.

Two of those narrow ones are narrow for a reason worth stating. `VaultGraph.owner` is the
identity a device writes a folder under, and `makeLocalIdentity()` mints only `did:syr` there,
which is what lets `graphAsItWas` derive a public key from it. A note in that folder may
still be OWNED by a `mailto:` — the folder's owner and a note's owner are different
questions. `SessionRow.created_by` is the same split at a sign-in: it is a `did:syr` because
Platform Delegation is the only door, while the `Viewer.did` the session answers with is a
principal, compared against the names written on a graph and resolved by nothing.

**One site hands a wide value into a slot that resolves it**, and nothing in the types catches
it. `syrPostRefFor` takes a note's ref and gives an identity store the owner half as `post_did` —
the identifier a comment and a reaction are filed under. Every ref minted here still holds a
`did:syr` there, because `created_by` is the signed-in viewer; the door below is what changes
that, and a note whose ref is owned by an email address has nowhere to hang a conversation until
it does.

**Every authenticated route names its caller through `viewerDid`, which answers with a principal,
while the services beneath it still declare that caller a `did:syr`** — and since both schemas
infer to `string`, the compiler says nothing either way. Nothing under there resolves it: it is
compared, and it is written to `created_by`, which is wide. A route that speaks to an identity
store takes `viewerDelegation` instead, and that carries the narrow `SessionRow.created_by`. So a
viewer who is not a syr identity is already served correctly beneath the declaration; widening
those signatures belongs with the sign-in that mints one, and each is held to the test above — a
parameter that turns out to dereference is one to narrow rather than widen.

### Which key speaks for a principal

`KeyBinding` in `key-binding.ts` answers "which key speaks for this identifier right now?" —
the question a signature check cannot answer out of the payload it is checking, and the half
§ "Whose a signed row is" adds to it.

One implementation per principal scheme, reached by `bindingFor(principal, bindings)` so a
caller never learns which schemes exist. `syrKeyBinding` in `@sloppy/idp` is one: syr answers
from the identifier itself, nothing is fetched, and the key it returns is marked
`signs: "delegations"` — it stands behind the keys that sign content rather than signing any,
which is precisely why holding it is not yet knowing whose a note is. A `null` answer is a
binding that did not answer; an empty list is an identifier nobody holds a key for, and that
is an answer.

`mailtoKeyBinding` in `@sloppy/openpgp` is the other, and it answers by asking. The person's
own domain first, through Web Key Directory — the advanced form
`https://openpgpkey.<domain>/.well-known/openpgpkey/<domain>/hu/<hash>` and then the direct
one, where `<hash>` is z-base-32 over SHA-1 of the lowercased local part, which is why the
local part is lowercased at the schema boundary. A public keyserver answers after the domain,
in the same shape and with the same `BoundKey` out, and the default is one that serves an
address only to somebody who proved they hold it. The first key found is the answer and
`BoundKey.from` says which address served it. A key is kept only where a user ID names that
address and the primary key is neither revoked nor expired, because the question is which key
speaks for somebody RIGHT NOW; what comes back is marked `signs: "content"`, so unlike syr's
it is a key a signature is checked against.

**Nothing in `@sloppy/openpgp` fetches.** Every address it builds comes out of a domain
somebody else chose, so the binding takes a `ReadKeyAt` and the API supplies one that goes
through `media/remote-host.ts` like every other outbound read — `identity/key-fetch.ts`,
which bounds the hosts, the time and the bytes, and answers `unreachable` for a refusal
rather than turning one into a statement about anybody.

`IdentityVouchService` is what a caller asks about a principal, holding one `VouchResolver`
per scheme the way `bindingFor` holds one binding per scheme. For an email address the
binding IS the resolution: a key found anywhere is `vouched` with `Vouch.instance` naming
where, every address answering and none serving one is `anonymous`, and nothing answering is
`unknown`. So `VouchState` stays three states.

A signed row also says what scheme its signature is in. `signature_scheme` is a bounded
string rather than an enum on the wire, for the reason `BlockDocumentSchema` carries an
element kind it has no renderer for: a signature in a scheme a reader has never heard of must
arrive whole rather than take the row down with it. **Absent is `ed25519-multibase`**, which
is what every signature written before the tag is, and `signatureSchemeOf` is the one reader
of that. A scheme this build cannot name is one it cannot check, so the note is held rather
than presented as altered.

Checking a signature in the `openpgp` scheme is `verifyOpenPgpSignature` in
`@sloppy/openpgp`, the one package in the repo that speaks that dialect, the way
`@sloppy/idp` is the one that speaks syr's — neither imports the other. It takes the bytes a
signature is over, the signature and the public key, in armoured or binary form, and answers
whether they agree. Nothing is fetched and no key is discovered: the caller has already
decided which key it is asking about, which is why a signature that checks out says the
payload has not been altered and never says whose key it is.

### Whose a signed row is

Holding both halves is what lets a reader say "written by Alice" and mean it. `attribution.ts`
in `api/src/identity` is the one place the two meet, and it answers in three:

- **`theirs`** — the signature checks out under a key that author holds. The key is asked to
  check the same signature rather than compared to the one on the row, because one spelling of
  a key is not another and what settles whose a signature is, is which key made it.
- **`unattributed`** — it checks out, and nobody has been SHOWN to hold the key it checks out
  under. An instance that did not answer lands here, so does an author who publishes no key,
  and so does a key that author has rotated away or revoked: a listing answers what signs NOW
  and the signature was made THEN. None of the three is evidence against anybody, so
  **neither unreachability nor staleness is refutation** and no surface may draw either as one.
- **`refuted`** — the row does not say what it was signed saying. That is the whole of it: a
  row contradicting its own signed statement is the one thing a reader settles without asking
  anybody, and **the only thing a copy is destroyed over**. A listing never refutes, because a
  reader who dropped a note over a key its author retired would cost that author their words
  for rotating one.

**What is asked, and how often.** `IdentityKeysService.contentKeysFor` takes a map keyed by
principal and answers one keyed the same way, so a page of fifty notes by three people costs
three asks — a pull that asked per row would aim this instance at a stranger's network once per
note. `peer/attribution.ts` and `social/comment-attribution.ts` are handed the ask rather than
making one, and make it **at most once, and only where something on the page carries a
signature worth weighing**: a region of unsigned notes, which is every note written here so
far, asks nobody anything. A pull holds that one answer across every page of a region, every
note in it being answered for by the same person. The asks themselves go out in runs rather
than all at once, because the people a page names are as many as it has voices.

**Which keys count.** Only a `BoundKey` whose `signs` is `content`, and only in the signature's
own scheme: the key a `did:syr` IS stands behind the keys that sign rather than signing, so
holding it settles nothing. What an identity's instance has approved is the listing
`delegated-keys.ts` reads, at a `TrustedInstance` the reader named or wrote down and never one
carried by the content — a principal naming its own instance would be vouching for itself. That
is the bound a vouch is held to and no more: a reader who names the address a branch came from
has trusted that host, and the answer is worth what the address is worth. Unasked is `null` and
is not an author with no key.

**A listing nobody bounded is unasked too.** Every key in it is tried against every signature
its identity's rows carry, so an unbounded one is a stranger spending this instance's afternoon
once per note. Past a bounded number the listing answers `null` rather than its first few —
`identity-keys.service.ts` carries why giving up must not answer for an author with their own
key unread.

**What a reader is told.** A note or a comment nothing weighed says nothing either way, which
is every unsigned one. A refuted note is left out of a pull and a refuted comment is not drawn.
An unattributed one is drawn, with one line saying nobody could be shown to have written it —
and that is the whole of what a person reads about any of this.

### Where a person's graph is

**No identifier names a place, a `did:syr` included.** Resolving one reaches that identity's
own STORE, which is where their graph is served only where a person's store and their graph
are one instance — § "Federating the graph" is where that guess is made, and shown to the
reader as one. A `mailto:` resolves to a KEY, so it does not even guess. **What answers, for
either of them, is the person's own declaration.** Where their graph is served is something
they SAY, so moving instance is one edit of theirs rather than a link everybody who follows
them has to be handed again.

`Whereabouts` in `@sloppy/types` is that fact — whose graph, the domain they say is theirs
and the instance they say answers for it — and it is said from two directions, asked in this
order:

1. **A domain they control says it.** By default that is the domain of their own address,
   which is the same domain Web Key Directory already asks about the addresses at it, and
   somebody already on one says nothing to get it. Everybody else says which domain is
   theirs — somebody at a mailbox provider, and anybody named a way that carries no address
   at all — and `Whereabouts.domain` is where they say it, **inside the declaration**. So
   the second source below hands a reader that domain once and the domain answers from then
   on, which is what keeps a person who controls one from being stuck on the lesser source
   for the want of somewhere to name it.
2. **Else the instance named alongside the identifier**, which serves the declaration its
   subject wrote there: `DeclaredWhereabouts`, one row per person, `created_by` the subject
   because where a person is, is theirs to say. This is the way in for somebody who controls
   no domain at all, or has not named one yet, and it is the lesser of the two — the first is
   a person's own domain saying where they are, and this one is a host serving the same words
   on their behalf. AI.md § "Sloppy's Vocabulary Stays Out of the Identity Store" is the rule
   that keeps the second from becoming a home.

**One document either way, at one address.** `WhereaboutsDocumentSchema` is what a domain
serves and what an instance serves out of the row, and both serve it at
`/.well-known/sloppy-whereabouts/<principal>` — at the site root, where a peer resolves syr's
own documents. So a reader builds one URL and which of the two answered is the resolver's own
business. It names its own subject, and `parseWhereabouts` is what
holds it to the person asked about — the boundary `parsePublishedIndex` is for a listing —
because a domain answers for every address at it and an instance answers for whoever signed
in there, so a declaration about somebody else would send a reader wherever the server liked.

**A declaration is an address a stranger chose, twice over.** It names a domain to ask AND an
instance to read, both supplied by somebody else, so every fetch either one leads to goes
through `api/src/media/remote-host.ts` like every other outbound read — a declaration that
names a private address, or redirects into one, is refused there. `PeerOrigin` bounds the
spelling and nothing else; it is never a permission to connect. § "Federating the graph"
carries the same rule for the origin a reader names by hand.

`peer/whereabouts.ts` is the order and its termination: the domain is asked, then the
instance, and a domain named by what the instance served is asked ONCE and never followed
further, so no two declarations can pass a reader back and forth. `whereabouts.service.ts` is
what asks — reading this instance's own row rather than connecting to itself — and
`WhereaboutsService.instanceFor` is what every read of somebody's graph goes through.
**An instance a reader named is where a declaration of theirs is asked for, not where their
graph is**: it is where a read lands when no declaration answers, so a link somebody was
handed keeps working, and where one does answer, its author moves by saying so rather than by
handing every reader a new link. `PUT /api/whereabouts` is where somebody writes their own.

### What the vocabulary is for, and what is still to be built on it

Somebody named by an email address is resolved, signs in, and has their signature checked.
The shapes federation needs to reach one are in hand too, and nothing a person can see has
moved yet — what landed is vocabulary:

- **The federation shapes take a principal.** `FollowedIdentity`, `FollowRequest`,
  `PeerPublicationsQuery`, `PeerIdentity` and a peer's `PublishedIndex` each hold any
  identifier and each KEEP the field name every deployed peer, route and client already
  reads them by: a published shape is one peers hold copies of, so widening one is
  protocol-visible and additive, and renaming one would cost every reader on the other side.
- **`NodeSignedPayloadV2`** carries a principal where V1 carries a `did:syr`, and its
  address is optional because a note is allowed no label. V1 is untouched and verifies
  exactly as it did, being what every note signed so far carries. `nodePayloadVersionOf`
  says which version is in hand, the way `signatureSchemeOf` says which scheme a signature is
  in, and **a version this build cannot name is held rather than refused**; a version it CAN
  name whose shape then refuses to parse is the other answer, and a reader may hold that one
  against the row.
- **The declaration** above: `Whereabouts` — whose graph, the domain they say is theirs and
  the instance that answers — the document it is served as, and the row an instance keeps on
  somebody's behalf, swept by `created_by` like every other user-owned table. The row and the
  request are the document minus its subject, taken off it rather than spelled out again, so
  the three cannot say different things.

Two things build on it, and both are here.

- **Reaching an email person's graph — here.** The resolver above is `peer/whereabouts.ts`,
  the routes that serve a declaration and write one are `peer/whereabouts.controller.ts`, and
  the public publication routes take a principal, so a peer that has resolved somebody named
  by an address can read what they publish and pull a branch of it. Every address a
  declaration names is a stranger's, so each fetch goes through
  `api/src/media/remote-host.ts` and answers `unreachable` rather than refusing the person.
  **A follow list that can hold one is not.** `POST` and `DELETE /api/following` both take a
  principal, so nothing can be followed and not unfollowed; what stops there is the store,
  whose follow record names a DID, and `PeerService.follow` says so in words rather than
  letting somebody meet the store's own refusal. Lifting that is teaching a store to keep a
  principal, and it is where the words go when it is. And nothing a person can SEE writes a
  declaration: the route is there and no screen reaches it, so somebody's whereabouts are
  said through the API until one does.
- **A signature says whose it is — here.** `peer/attribution.ts` and
  `social/comment-attribution.ts` no longer stop at "this row was not altered": they ask
  `IdentityKeysService` who holds the key that signed it — **once per author, never once per
  note**, because a pull that asked per row would aim this instance at a stranger's network as
  many times as the region has notes. A signature that checks out under a key its author is
  shown to hold is theirs; one under a key nobody can be shown to hold is unattributed; and an
  instance that said nothing leaves a note unattributed rather than accusing its author.

Two gaps are outside it. **`signature_scheme` is absent on every comment**,
syr's own comment record having no such column, so every comment reads as
`ed25519-multibase`. And `syrPostRefFor` hands an identity store the owner half of a note's
ref as `post_did`, so a note whose ref is owned by an email address still has nowhere to hang
a conversation.

The `publicKeyFromDid` calls in `@sloppy/local` — `identity.ts` and `api.ts` — check no
signature and were never part of this: they derive a key from a `did:syr` for an identity and
for a graph view, which is this question asked of a folder rather than of a person.

`@sloppy/idp` is not part of any of it. It SERVES syr identities; GPG needs no provider,
because people already have keys.

### Signing in with a key of your own

The second way in, beside Platform Delegation: somebody who goes by an address they already
hold a key for signs a short piece of text, and that is the whole of it. They keep the key,
Sloppy keeps nothing of theirs, and what they get is a graph of their own on the instance
rather than a name written in somebody else's.

**Sloppy hands out something to sign, and the text says what it is for.** `POST /auth/challenge`
takes a principal and answers with a statement: the identity, this instance's origin, and one
opaque line that is an HMAC-signed token over those two. `challenge.ts` is the only writer and
the only reader of it, and reading REBUILDS rather than parses — the statement a person weighed
above their signature is therefore exactly the statement the signature is held to, and a
statement issued by another Sloppy, or altered in any line, is refused before a key is asked
about. It is good for ten minutes and spent when it is used, held the way `signed-token.ts` holds
a consent state and bounded the same way. Line endings and a last empty line are taken back
out on the way in, because somebody signs a file and what wrote the file decided those.

**`POST /auth/answer` takes the statement and the signature, and settles a session.** The order
matters: the statement is read, the keys that speak for its principal are asked for, the
signature is checked, and only then is the statement spent. A paste that went wrong therefore
costs nothing, and a signature that checked out cannot be presented twice. What is pasted may
be the signature alone or the signed text with the signature in it — the text a signature is
held to is the statement this instance issued either way. Both routes are public and both are
rate-limited per caller, because both answer without a session.

**Neither route says whether a key was found for an address.** A refusal reads the same
whether the signature was wrong, the key was somebody else's, or nobody publishes one for
that address — so a caller working through addresses learns nothing here. An instance that
could not reach the binding at all says so instead, because that is somebody's afternoon
rather than their credential.

**Which key is asked about is `bindingFor`'s answer and nothing else.** Nothing here fetches,
resolves or discovers a key: a `KeyBinding` is injected, `null` from one is an instance having a
bad afternoon rather than a statement about anybody, and an empty list is an identity nobody
holds a key for. **Only a key whose `signs` is `content` authenticates** — the key that stands
behind the keys that sign is not one that signs. A `BoundKey`'s `scheme` decides which check
runs, and a scheme this build cannot check authenticates nobody.

**A session settled this way has no identity store behind it.** `SessionRow`'s three delegated
columns are absent together, `Viewer.syr_instance_url` and `Viewer.delegate_public_key` are
absent together, and `viewerDelegation` refuses the routes that act on a store — as forbidden,
never as unauthorized, because a client reads a 401 as a credential that has died and would sign
somebody out of a session that is perfectly good. Sloppy signs nothing on their behalf and
could not: it holds no key of theirs, which is the same rule that holds everywhere else.

The expiry is the whole of what ends such a session: there is nobody to ask whether it still
stands, so it is measured in days rather than carried indefinitely.

## Who may write where

The note's own gate — § "Whose writing a note carries" — says what a write does once a
graph has let it through. This says whether the graph lets it through at all, and whether
anybody stands behind the identity making it.

**A graph with none of this written on it behaves, for everybody it is kept for, exactly as
every graph did before it existed.** No roles, no overrides, nothing asked of a writer:
`writeDecision` answers what `writeOutcome` and `withAuthor` answer. A person writing alone in
a folder on their own device is somebody it is kept for, and never meets any of it. What is
new is only the answer for somebody it is _not_ kept for, who used to be nobody: on a graph
served to several people that is anyone it has not named, and they now hold nothing.

**Nothing holds a write to any of this yet.** The vocabulary, the evaluator, the rows and
the resolver are here; `gate.ts` still asks `writeOutcome` alone, and the sites that call
`writeDecision` land with the work that forks from this.

### Whether anybody stands behind an identity

A `did:syr` binds a key and no host — syr's did-method spec is explicit that no part of the
identifier names a server. So an identity travels with an **instance hint**: where a record
may be found, and never a fact about the DID.

**What is read there is the whole of what the answer rests on, and syr serves it unsigned.**
What is resolved today is syr's listing of root-signed platform delegations, which syr's own
mandates spec calls a chain of length one — and the listing carries no signature, so a host
that serves an identity manifest and one unrevoked entry says `vouched` about whatever DID
it is asked for. § "Federating the graph" already rules on this shape where a stranger's
comment arrives: an identity manifest is whatever the origin serving it says, so a principal
naming its own store would be vouching for the identity it claims to be. Three things follow,
and the first is the one the rest hang off:

- **A resolution starts only from an address this reader already trusts.**
  `TrustedInstance` carries the address and whose word it is, and there are three words: the
  instance that identity signed in to Sloppy through, an address the person in front of us
  typed, and this reader's own `known_identity` row — written by an earlier resolution from
  one of the first two. **There is no word for an address that arrived with a DID from a
  peer**, and adding one would be deciding that a principal may name its own voucher.
- **A trusted address is still an address somebody else chose**, so both reads — the
  identity's record, and the listing of the authority held for it — go through
  `media/remote-host.ts` on every hop, under the policy a picture's address is held to, and
  within a bound on how much of an answer is read.
- **The mandate chain is what makes this a signature check.** Root, then agent, then whoever
  holds the grant: it lands behind `VouchResolver` as a different reading, and a caller still
  reads `Vouch.state` and nothing else.

Resolution answers one of three things, and **the third is not a formality**:

- `vouched` — an instance serving that identity holds authority its root key approved, and
  that authority still stands.
- `anonymous` — resolution answered, and nobody holds any. An identity minted on a device is
  this one, and on the device that minted it nothing asks anybody to stand behind it.
- `unknown` — nothing answered just now. **It grants no authority an identity did not already
  carry, and takes none away.** `SyrService.delegationState` has drawn the same three-way
  distinction for the same reason since delegations landed: an instance having a bad afternoon
  is not a statement about anybody, and treating it as one makes somebody else's outage ours.

`standingVouch` is the one function that turns a just-now `unknown` back into what resolution
last settled on, so no surface decides on its own that an unreachable instance means somebody
lost their access. The last settled answer is kept on a `known_identity` row — the principal,
the address, what was settled, and when — one per identity per person who wrote it down. An
`unknown` never writes over it.

**Nothing a writer says about itself decides any of this.** There is no column a peer can
write that carries it; it is derived by resolution here and cached here.

**A graph says whether it asks.** `Graph.vouching` is `optional` or `required`, and absent is
`optional` — every graph written before the column, and every folder somebody keeps to
themselves. `required` refuses a write by an identity resolved `anonymous`. Where nothing
answered it neither admits nor evicts: a writer the note already carries — its owner, or
somebody in its `authors` — writes on, and anybody else has their change **offered** rather
than landed, because admitting a stranger on an `unknown` would be granting authority nobody
answered for. A graph never holds its own owner to any of it: an identity minted on a device is
anonymous, and asking to be vouched must not shut out the person asking for it.

### The cascade

Sloppy's scopes are **graph, then note**. A role belongs to a graph, because a graph is the
unit people collaborate in, and an override is written on the graph or on one note in it.
An override's target is a **role** or one **identity**.

**A graph is kept for somebody, or it is not, and that is decided before any layer runs.**
Somebody it is not kept for folds to `NO_PERMISSIONS` — no writing, no offering, not even
reading — whatever the roles say, and the role _everybody_ holds does not let them in:
"everybody" there means everybody the graph is kept for. A graph nobody has written a policy
on is therefore **closed to a stranger, not open to one**. The graph's own owner is never
shut out this way.

Who counts is a fact about the surface asking, not a rule the cascade owns, and the two
surfaces answer it differently on purpose:

- **A graph served to several people names them.** Its owner, or an identity a role lists by
  DID — `namedInGraph`. Nobody else, however they reached it.
- **A graph somebody holds on their own device is kept for whoever holds it.** There is
  nobody to arbitrate between. What they write travels as a contribution somebody else
  accepts — a pull request on the remote the folder is pushed to — so the acceptance happens
  where the collaboration does, not in a cascade on this machine.

**`DEFAULT_PERMISSIONS` is the floor the cascade folds from** for somebody the graph _is_
kept for: the verbs a note's own gate already governs — reading, writing, starting, deleting
and placing notes, offering a change, taking one in, and joining a note's authorship — and
none of the ones that are the graph's alone: publishing, and saying who may do what in it. So
the first role or override written on a graph **takes nothing off anybody already there**,
and a graph closes a verb off by denying it on the role everybody holds.

`resolvePermissionFold` folds from there, lowest priority first, each layer
`perms = (perms & ~deny) | allow`:

1. the roles the writer holds, in ascending `position`
2. the graph-scoped override written on that identity
3. note-scoped overrides on the roles they hold, in ascending role position
4. the note-scoped override written on that identity

A graph-scoped override on a ROLE is not a layer: a role carries its graph-wide allow and deny
in layer 1, so `overrideIsWellFormed` refuses one rather than letting a row be written that
the fold would drop. `ADMINISTRATOR` short-circuits after layer 2, so nothing written on a note
takes a verb off an administrator. **The graph's own owner holds every verb**, whatever is
written — a first role written on a graph must not lock its own author out.

The verbs are a closed enum of bits in `permission.ts`, stored as a decimal string because no
store here has a number that wide surviving a round trip. **A bit's position is written once
and never moved**: a role stores the number the bits make, so renumbering one would silently
re-grant every role already written, and no read anywhere would fail.

Two of them carry more than their name:

- `PLACE_NOTES` — moving a note and writing its address. An offer carries a note's writing and
  never its place — § "Whose writing a note carries" — so this is a verb of its own and
  `WRITE_NOTES` never implies it.
- `CO_AUTHOR` — writing into a note somebody else has already written into, and so joining its
  `authors`. Without it such a write does not land and is offered instead. That is what keeps
  `authors` the whole truth about whose writing a note carries: a graph can decide who may
  join a note's authorship, and can never produce a note whose list leaves somebody out.

### What a write comes to

`writeDecision` is the one function that answers it, and it is the note's gate and the graph's
policy in one place. It is told what the writer holds and what resolving them said — never
left to read an absent argument as leave to do anything:

1. a graph that asks for vouched writers refuses an `anonymous` one, lets its own owner
   through, and offers rather than lands the change of one nothing answered for who has
   written nothing there yet;
2. the note's gate decides next — `writeOutcome` unchanged — and a gated note's write is
   **offered** where the writer may offer and **refused** where they may not;
3. a write that lands needs `WRITE_NOTES`, and `CO_AUTHOR` besides where it would put the
   writer into an open note's `authors`; short of either it falls to **offered**, or to
   **refused** where the graph takes no offers.

`refused` is the one verdict that is new, and it is reachable only where somebody has written
a policy on the graph or asked its writers to be vouched. `hasPolicy` is what a caller asks to
skip the fold rather than a second answer: a graph with no roles and no overrides folds to
`DEFAULT_PERMISSIONS` for anybody but its owner, which `constantPermissionFold` hands back
without reading a row.

### The rows

`graph_role` and `permission_override` are the graph owner's, as every row in their graph is:
somebody named in a role holds nothing of it, and the purge sweeps both by `created_by` with
the rest of that person's graph. `known_identity` is likewise the reader's own — their address
book, about other people, swept with them the way a refused voice is. `graph_role.everyone`
marks the one role everybody in a graph holds and is written only as `true`, because the UNIQUE
index that holds one of those per graph does not constrain a row whose column is absent.
`permission_override.scope` is written out as the note's ref or the graph's own rather than
left absent for the graph, for the same reason: UNIQUE is what makes one override per target
per scope a rule rather than a hope. `permission_override.target` is `role` or `principal`,
and `target_id` is the role's ref or the identifier itself — flat beside the discriminant,
because an index cannot seek on a nested path. Both of those are claims about a server rather
than about a string, so `schema.integration.test.ts` is where they are checked.

## syr integration

### The constraint that shapes everything

**syr has no lexicon system and no extension point for third-party record types.** Its own
comparison document names this as a feature: "third-party repo pollution: structurally
prevented; apps don't write into your identity store." So "use syr for account and content
management" resolves into a split — the same one Slyng made:

| Concern                                    | Owner                                                                         |
| ------------------------------------------ | ----------------------------------------------------------------------------- |
| Identity, DID, keys, signing               | **syr** — Sloppy is a platform holding a grant; it holds no key of the person |
| Profile data                               | **syr** — never stored locally, resolved from the identity and cached         |
| Media blobs (block images, ink rasters)    | **syr** — presign → PUT → complete                                            |
| Emoji, stickers, GIFs, reactions, comments | **syr** — per-DID catalogs, federated                                         |
| Who somebody follows                       | **syr** — kept with the identity, served per-DID                              |
| **Nodes, addresses, tags, blocks, ink**    | **Sloppy's own API + SurrealDB**                                              |

**A platform holds an agent, not an identity.** A person's root key lives on their own
devices — carried as a Sigil, managed by Syner — and a platform that needs to act on
their behalf holds an **agent** key under a **mandate**: a root-signed statement in the
identity record naming that key, the **powers** it carries, its expiry and what it may
appoint beneath itself. What Sloppy holds is one step further down: a **grant**, signed by
that agent, short-lived, carrying its mandate inline, never published. So Sloppy verifies
a chain — root → agent → Sloppy — rather than trusting whichever host served the token.
syr's own specification is the document of record: `architecture/mandates` and
`architecture/authority-model` in the syr docs site.

**And no instance is a home.** Where profile bytes, media and catalogs come from is one
**service** entry per kind in the identity record, each naming the agent that serves it,
so a reader resolves a kind and verifies signed bytes rather than asking a particular
host. Today Sloppy reaches all of it through one instance URL per DID —
`SyrService.identityManifest()` in `apps/sloppy/api/src/syr/syr.service.ts` reads
`/.well-known/syr/{did}` from the instance a person signed in against — because that is
what syr serves. When a second agent appears, fetch-then-verify is unchanged — what changes
is that the host every one of those methods takes becomes a choice per kind, read off the
record, instead of the one URL threaded through them today.

### Auth: Platform Delegation v0.1

`GET /.well-known/syr` → read `manifest.platform.*` → redirect to `platform.consent` →
callback yields `code` + `delegation_id` → `POST platform.token` →
`{ access_token, did, delegate_public_key, scopes }`. Content is signed via
`POST platform.sign`; the identity store holds the delegate key, so **Sloppy never touches a
private key.**

**What changes when syr lands the authority model, and what does not.** The wire shapes
above are what syr serves today, and the delegation Sloppy receives is signed by the
person's root. At the target the same delegation is a **grant** signed by an agent key
holding the `delegate` power, carrying that agent's root-signed mandate inline — so
verifying it becomes: read the DID's identity record for the root key, check the mandate
under that root, check the grant under the agent's key, check that `delegate` is among the
mandate's powers and that neither has expired, check that the record does not dismiss that
agent at or after the mandate, and check the grant against the agent's own status list or a
freshness staple. Those last two are the withdrawal channels, and a verifier that skips them
accepts a grant from an agent the root has already dismissed. `scopes` become powers from a
closed enum.
Sloppy still holds no private key and still signs by calling `platform.sign`. This is a
syr change, not a Sloppy one; nothing here moves until it lands, and
`architecture/mandates` in the syr docs site is the specification.

Port the implementation, not the spec, from Slyng's `auth.controller.ts` /
`auth.service.ts`. It carries an HMAC-signed `state` holding the instance URL specifically
because **syr does a byte-identical match on `callback_url`** — a detail that costs a day
to rediscover.

### Local-only mode

Two independent things wear this name, and they are worth separating before either is
read. **An API can serve identities itself** — Slyng's `idp/` tree reimplements syr's wire
contracts and lifts into `@sloppy/idp` with its crypto, and the Nest module is gated on
`SLOPPY_LOCAL_IDP`, off by default. That is the rest of this section. **The native app can
serve a whole graph with no API at all**, and that is the paragraphs immediately below.

#### A graph off the device

**The vault is the local store.** There is no database in the native app: `SLOPPY_LOCAL_MODE`
decides whether the shell opens a folder on the device, and a native build does unless that
variable says `false` — the app is the local one, and a build that talks to a server is the
exception somebody asks for. The folder is § "A graph on
disk" exactly as an archive holds it, read and written by the one `@sloppy/vault`. The
shell carries file access and nothing else; `@sloppy/local`'s `LocalApi` is the
`SloppyApi` implementation over it, so every page, store and component reaches a local
graph through the same `api` they reach a hosted one through. Opening a graph builds an
index of it in memory — its notes, sections, tags, links, addresses and aliases — kept in
step on every write, and search reads that index. The address rules are the same functions
from `@sloppy/types` the API runs: a suggestion made here and a suggestion made on a
server are the same suggestion, which is what lets a graph cross between them.

**A device holds identities, plural, and each one says where it came from.** The app's
private data holds `identities.json`: a list, each entry a DID, its public key and a
`source` — `IdentitySourceSchema` in `@sloppy/types`, keyed on **whether the key is usable
here** and never on which product keeps it or which file it arrived in, so a key manager
nobody has written yet is a value here and not a field. Three values:

- **`device`** — made here with nothing asked, the key in a file in the app's own private
  data. There is no password over it, because there is nothing a password would protect it
  from that reaching the file would not already have defeated. A lone `identity.json` from
  before the list reads as one `device` identity, and the list is written back.
- **`sealed`** — the key is here and shut under a passphrase the device does not keep. The
  entry names the file it is kept in, kept exactly as it arrived. The public key is on the
  outside of that file, so the DID, the name on the row and who writes here need nothing
  asked of anybody; the seed comes out only for an act that must sign with it, the
  passphrase is asked at that moment, and the seed is wiped after. Nothing in local mode
  signs today — an identity names whose graph a note is in and no more — so nothing asks at
  all: carrying one on hands over the sealed file as it stands, which needs no key. A
  brought-in identity stays sealed wherever it goes, and this device never writes the key
  down in the clear. Which format that file is in
  is `@sloppy/idp`'s business — `sigil.ts` reads and writes syr's portable one, the same
  construction as Aegis (§ "An API that serves identities itself") and reproduced byte for
  byte so a file written here opens on a syr instance. Nothing above that package names a
  format.
- **`delegated`** — an identity an identity store somewhere else keeps, reached through
  Platform Delegation. The entry carries where that store is, the delegate's public key and
  the token the exchange returned. **No private key is on the device**, which is the same
  delegation model the hosted API runs under. What the app holds is a **grant**: at the target
  an agent under a root-signed mandate issues it, and the app verifies that chain the way the
  API does (§ "Auth: Platform Delegation v0.1"). Where the person's own root key sits is the
  instance's business, not the device's: at the target it is on their own devices and the
  instance holds only an agent, while today an instance may hold the root itself in an Aegis
  bundle — which is what Sloppy's own embedded provider does (§ "An API that serves
  identities itself").

**The first run offers three doors, and Settings offers the same three.** "Start here" mints
a `device` identity and opens the graph — one tap, nothing asked, and still the default.
"Sign in with your identity" takes an instance URL and runs the exchange below — an identity
a person holds in Syner comes in through that same door, because Syner is what the instance's
consent page offers to sign with, and it lands here `delegated` like any other. "Bring an
identity from another device" reads an identity file another device exported. Settings
exports a `device` identity as one file — the DID, the public key and the key — with the
consequence stated where the person chooses: whoever has that file writes as them. One
brought in that way is a `device` identity like any other. One brought in sealed carries on
as the sealed file it arrived as, so the copy is shut the way its owner keeps it and nothing
is asked to make one.

**The app is its own platform.** There is no Sloppy API here to hold the delegation, so the
native app performs Platform Delegation itself. `platform_origin` is the app's public web
origin (`PUBLIC_SLOPPY_APP_ORIGIN`, `https://sloppy.sh` by default and the web app's origin
in development) and the callback is `<origin>/auth/return`, because syr requires an http(s)
callback on the platform's own origin and a custom scheme cannot be one. `apps/sloppy/web`
serves `/auth/return` as a page with no server logic: it forwards its query string into
`sloppy://auth/callback` and offers a way back into the app where the app did not open by
itself. That path is declared as an app link beside `/n`, so a phone opens the app straight
from the link. The app then finishes the exchange itself against the instance, with no
platform secret anywhere in the protocol — the wire shapes are `@sloppy/types`' `syr.ts`,
and the platform half of that dialect is written once for the browser side in
`@sloppy/local`. The API's own `SyrService` is untouched; lifting the shared half out is
worth doing and is not required here. The deep-link return leg (`src/lib/deep-link.ts`) is
the same one a hosted build uses, and in local mode it lands on `@sloppy/local`'s exchange
rather than the API's. It reads both ways back alike — `sloppy://auth/callback`, which the
web page forwards into, and `/auth/return` itself where a phone opened the app from the
link — and re-enters the document on the root with the hand-off intact, because a session is
picked up as the app boots and only then.

**Signing in locally settles which DID this device writes under, and what the person is
called.** The name and picture come from the profile and are written into the owner block of
the graphs that identity owns — and never into a folder somebody else owns, whose own owner
block says who THEY are. They are held beside the identity as well as written into a graph,
so a folder started under that identity later, on a run long after the sign-in, is written in
with them too. It grants nothing else: publishing, peers and pull still need
a server. A token that lapses leaves the identity held — the DID is a fact, not a
permission — and marks it as signed out of its store until the person signs in again;
nothing local needs the token after the exchange except refreshing the name and the picture.

**Which identity writes.** The graph in front of somebody is owned by the DID in its
`graph.json`. Where this device holds that identity, the person writes as the owner. Where it
does not — a folder shared through git, or one brought from somebody else — they write as a
CONTRIBUTOR under one of the identities this device holds, chosen in Settings and defaulting
to the one most recently used; `whoWrites` settles that and `LocalApi`'s `writer` carries it,
absent being the identity this device writes under by default. A folder started here is owned
by the identity that was writing when it was started. **Switching who is writing changes
nothing already written**: refs never re-key on a switch, and a folder somebody else owns
keeps its own — a ref's DID says whose graph a note is in, so writing in their folder joins
their notes' `authors` rather than making the notes this device's. What a write then does to
a note is § "Whose writing a note carries", the same rule the server runs.

The one thing a first run still asks is a desktop's, and it is asked once: where the graph
should live, because a folder there is a person's to put anywhere. A phone and a tablet keep
their graphs in the app's own documents folder, so there is nothing to ask and the app opens
straight into the graph — and because that folder moves with the app, where it is is asked of
the system each launch rather than written down.

**The folder that is open is the graph in front of somebody.** Opening another one from
Settings serves the graph in that folder, starting one there where it holds none, and every
folder this device has opened stays listed beside it. The graph a person started with keeps
the ulid every archive of a first graph names, so a folder becoming a graph beside it takes
one of its own. A folder a graph was written into and that is no longer there is said rather
than started over: the app offers a folder to open instead of writing a fresh empty graph
where a graph somebody moved used to be.

**The folders this device knows ARE its graphs.** `VaultAccess.known` answers one row per
known folder, read from each folder's own `graph.json`, so the picker a person already
chooses a graph in is the same place they choose which folder is open — one list, not two
names for one thing. A folder that is not where this device last saw it has no graph to answer with,
so `VaultAccess.known` is what lists it as unreachable rather than dropping it, because a
person moved it and only they can say where to. Starting a
graph here is starting a folder, and a folder can arrive by being cloned from somewhere
else. **Forgetting a folder takes it off this list and deletes nothing** — it is anybody's
act, on any folder, and the folder is opened again by naming it again. `VaultAccess` in
`@sloppy/app-core` is what a page asks: the `open` it already had, and `known`, `openKnown`,
`forget`, `start` and `clone` beside it. `open` and `start` are one act under the two words
a person chooses it by — opening a folder that holds a graph, or starting one that will —
and `openKnown` is a folder already on the list, named rather than picked.

**Two folders may hold one graph, and a folder is what is open.** Cloning your own remote
beside the original, or bringing an archive of a graph into a second folder, leaves this
device with two folders at one graph ulid, and that is allowed: a picker row is a FOLDER,
told apart by its root and never by the graph in it, which is why the rows come from
`known` and not from `listGraphs`. So every act — the canvas, the writing, the history,
Settings — reads and writes the folder that is open and nothing else. `LocalApi` holds that
line for the store: what it keeps per folder is keyed by that folder's root, and where two
folders answer to one ref the open one is the copy every lookup gets, `listGraphs`
included, so no surface is ever handed the other. `listGraphs` therefore stays one row per
GRAPH, and a count of it is a count of the notebooks somebody keeps rather than of the
folders they keep them in.

**A folder somebody else owns is not yours to close.** Closing or emptying a folder — every
act that takes the graph out of it — is the owner's, the DID its `graph.json` names, and
anybody else is refused with a sentence that says whose it is. Writing in a folder somebody
shared is a contributor's to do (§ "Whose writing a note carries"); ending it is not.

**What only this device knows sits beside the graphs rather than inside one.** The app's
private data holds `identities.json` and the key file each `device` entry names;
`vaults.json`, the list of folders a graph has been put in — a folder cannot remember where
somebody put it; `git.json`, what a folder started here begins with (§ "The vault's
history"); `credentials.json`, what this device was given to reach the hosts a person keeps
folders on; and `signing.key` with `signing.key.pub` beside it, the two halves of the key
this app signs with — both of them out of every folder, because the half a host is given is
this device's to hand over rather than a graph's to carry. What a
person is called is not there: a name and a picture are written into
the owner block of every graph the writing identity owns (§ "A graph on disk"), so a graph
says whose it is wherever it is opened, and there is no profile to read from anywhere else.

**A vault holds the pictures its own notes draw.** A picture is added before anybody knows
which note will draw it, so one that turns out to belong to a note in another graph on the
device is carried into that graph's folder when the note is written — and the archive taken
out of that graph carries it too. A picture reaches the page over the shell's own
`vault:` scheme (`src-tauri/src/vault.rs`), which reads anything in a folder somebody
picked and nothing else — the private data, where the identity's key is, included. It
never writes: **a webview carries no request body to the app it belongs to**, so the
middle step of the three-step upload `@sloppy/types`' `media.ts` describes cannot be a
PUT here. `uploadFile` hands the bytes to the client itself instead when the client can
take them (`sendUpload`), and `LocalApi` writes them over the same bridge every other
write crosses; a store across a network is still sent them.

**What needs a server is not offered, and says so.** Publishing, peers, pulling,
conversation, following, somebody else's profile and somebody else's emoji all need
another machine to exist; `LocalApi` answers each with `serverOnly`, naming the feature,
and the surfaces do not put them in front of anybody in the first place. Signing in is not
among them: it is the app talking to an identity store, which needs nothing of Sloppy's own,
and what it settles is which DID this device writes under and nothing more. A hosted Sloppy
is a **separate mode** — a hosted graph and a local one are two graphs, and the only way one
becomes the other is by exporting it as an archive and importing it, which re-keys its refs
under the receiving identity (§ "A graph on disk").

#### A graph on this device, beside the one a Sloppy serves

The native app's local mode is not the only place a folder can be a graph. **An app that is
served a Sloppy over the network opens a graph kept on the reader's own machine beside it,
and nothing about it touches their account.** That is the hosted web app, and it is equally
a native build somebody asked for a server in.

**Two doors, and neither of them signs anybody in or out.** "Open a folder on this device"
uses `showDirectoryPicker`, so a `Files` over a `FileSystemDirectoryHandle` reads and
writes the folder in place; the browser asks for permission once and the handle is kept for
as long as the browser lets it, so a reader is not asked again every act. "Open an archive"
takes a `.sloppy` file, unpacks it into a `MemoryFiles`, and keeps the changes in memory —
what a reader does with them is "Save a copy", which hands back a new archive. Both doors
serve the graph through `LocalApi`, the same implementation the native app runs, so every
page, store and component reaches it through the `api` they already reach a hosted graph
through, and `runtime.mode()` answers `local` for as long as one is open. `AppRuntime.createApi`
is where that swap happens, and closing the graph puts the hosted one back in front of the
reader — at the graph they were reading, with the canvas they had arranged, because a
folder opened in a tab stands alongside the graphs a Sloppy serves rather than replacing
them (`VaultAccess.alongside`). Who is signed in is asked again on both sides of it: while
one of these graphs is open, the graph on the device is what answers, which is why reading
one needs no account.

**The doors are where somebody with no account lands.** Settings holds them for a reader who
is already in, and the sign-in screen offers them beside the account door, so nobody who has
a graph here is stopped at a screen asking for one they do not have — `graphHere.offered` is
what puts them there, and where nothing can open a graph here nothing about one appears.

**One store, and the shell says how it reaches a folder.** `graphHere.offerHere` takes the
shell's own `FoldersHere` (`packages/ts/app-core/src/lib/folders-here.ts`): asking for a
folder, whether it may be read again without anybody being asked, what its `Files` are, and
whether a folder holding no graph has one started in it. A tab's is the default and is the
browser machinery below; a native build that talks to a server hands over its own
(`apps/sloppy/native/src/lib/folders.ts`), where a folder is a path this device names rather
than a handle a browser hands back, nothing is ever asked twice, and a folder holding no
graph has one started in it exactly as local mode starts one. Everything after that — the
swap, the boot, closing the graph again — is the one store, and a second implementation of a
graph on disk is what this interface exists to prevent.

**The web shell stays a shell.** The doors, the `Files` over a directory handle and the
archive unpacking live in `@sloppy/app-core` (or a browser module beside it), not in
`apps/sloppy/web` — a route added to a shell is a route in the wrong package.

**Nothing leaves the device.** No byte read from the folder or the archive is sent to the
API, and a picture in one of these graphs is drawn straight off the handle or out of memory
rather than through the proxy — there is no remote origin to keep from the viewer, because
the bytes never left. The door's own copy says that as a consequence, once, and
nowhere else.

**What a tab cannot do is absent, and Settings says so where a person would look.** There
is no git in a browser, so the History surface is not there and Settings says the folder's
history is kept by the desktop app. Publishing, peers and pulling need a server and are
answered the way the native app's local mode answers them (§ "A graph off the device").
Signing in and out is not offered while one of these graphs is open, so the identity a
reader writes as is settled when they open it: the signed-in account's DID where somebody is
signed in, and otherwise a device identity minted into the browser's own storage — the
graph's owner block is where a reader is told which of the two they are writing as. Closing
the graph hands the sign-in control back. Starting a second graph and bringing one in from
an archive are absent for the same reason: both want a folder to keep the new graph in, and
a tab can name none — `GraphsStore.startsGraphs` is the one answer every surface asks.

**A tab opens a graph and never starts one.** The folder door reads the folder before
anything is swapped in: one holding no graph — no `graph.json` at its root and no container
inside it — is refused in the door's own words and left exactly as it was, and the handle is
remembered only once the graph opened. `FoldersHere.starts` is what says which, and a tab
answers false because it can name no folder to keep a new graph in; a shell that can says
true, and the door's own words say a folder with nothing in it becomes a graph. A folder that will not read leaves the hosted graph
in front of the reader rather than an empty local one, which is why the swap is rolled back
where the read that follows it fails.

**The remembered folder is served before the first page mounts.** `graphHere.boot()` is what
both shells await where a Sloppy is serving them — the native shell awaits
`openRememberedVault()` instead only in local mode — so no page
reads `api` while the hosted graph is still in place and a note kept on the device is never
asked of the API; where the browser wants a gesture before it hands the folder back, the
door's "Open it again" state stands in front of the pages rather than a hosted read for a
ref the account cannot have.

**An archive is left the same way wherever it is left from.** Its writing is in the tab and
nowhere else, so closing it, opening a folder, opening another archive and leaving the page
all ask the one question first, with "Save a copy" beside the answer — the page itself
through a `beforeunload` guard that stands only while the archive holds writing.

**A browser without the directory picker sees only the archive door.** Feature-detected on
`showDirectoryPicker`, never sniffed from a user agent, so a browser that gains it gains the
door on its own.

#### An API that serves identities itself

**What the embedded provider holds, and what it will hold.** It keeps a root seed in an
Aegis bundle and root-signs each delegation (`packages/ts/idp/src/aegis.ts`,
`packages/ts/idp/src/delegation.ts`), because that is what syr's wire contracts ask for
today. **At the target it holds an agent key under a mandate instead** — a server that
holds somebody's root is exactly what the authority model removes, and an embedded
identity provider is a platform like any other. The contracts here follow syr's and do
not lead them, so that is a change to make when syr's own record lands.

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

**Whose writing a note carries travels with it.** `owner`, `authors` and `contributors` ride
`PublishedNode`, so a snapshot and the copy a peer pulls both say who wrote what, and a
reader of a held region is shown it exactly as its author's own graph shows it. Absent
`authors` is the ref's own owner alone here too — which is every version published before a note
could carry more than one writer — and absent `contributors` is none (§ "Whose writing a note
carries"). A reader writes into neither: what they hold is a copy, and `owner` is a fact
about the author's graph rather than a permission on the reader's.

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

**An identifier names a person, never a place.** An identity manifest describes that
identity's own store — profile, uploads, comments, reactions, who they follow — and says
nothing about where their GRAPH is served, so following somebody yields nothing to pull and
no instance to ask, and nothing a peer says about themselves can corroborate one. Where is
carried rather than resolved: `GET /api/peers/publications` takes an identifier and the
instance to ask, which is this one unless the caller names another — the whole of it for somebody who
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

**Where a followed identity's GRAPH is served is a guess, and is shown as one.** No
identifier names a place, and syr's manifest answers for an identity's own store and not for
the graph beside it, so asking somebody what they publish starts at the instance a region of
theirs already came from, else at the provider recorded beside their identifier. That lands
in the field the reader can edit rather than behind the button, because on the two of the
three deployment modes where a person's store and their graph are one instance it is the
right answer, and on the third the reader has to be able to see which instance was asked
before they can name the right one. What replaces the guess where somebody has made one is
their own declaration — § "Where a person's graph is" is the shape of it, and the reader that
asks for it is still to be written.

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
  copy the reader can no longer put the author's name to. **A note nobody could be shown to
  have written is kept**, its verdict written beside the copy as `pulled_node.attribution` —
  § "Whose a signed row is" carries the three answers, and the middle one is why an instance
  having a bad afternoon does not cost a reader the branch. An answer that is not the branch
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
  signature it has not checked: whose it is, is the same three answers a note's signature
  gets, asked once per voice rather than once per comment. **A reaction is the other way
  round:** syr stores the same three fields on one and its public listing does not serve
  them, so a reaction never arrives with anything to check, and no surface may claim
  otherwise.

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

A row's key is composite — `table:{ created_by: <principal>, id: <ulid> }` — so it is globally
unique the moment it is written, which is what lets a peer hold somebody else's node
without renaming it. The key is an object, so an owner's own characters reach the driver as a
value and are never spelled into a query. A **ref** below is how one row points at another:
the string `<principal>/<ulid>`, the form the reference already travels in. Every row also carries
`created_at` and `updated_at` as **iso** — see the timestamp rule below.

```
graph:{ created_by: <did>, id: <ulid> }
  created_by  did       the owner, flat and immutable
  title       string    what they call it
  home        bool      the one they started with; absent is false

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
  edges       object[]? the looks it sets on its lines, one per note at the other
                        end; absent is a note nobody set one on (§ "A look a
                        person set on a line")
  references  ref[]?    the notes its own blocks cite, derived; absent is none derived
  checked     string?   the commit its author last read its reasoning against, opaque
                        here; absent is a note nobody has confirmed (§ "A project's
                        container")
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
  note        ref?      the note that spent it, immutable; absent is a row
                        written before the column, spent by nobody nameable

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
twice inside one graph. It carries the graph and the parent — the parent is how one index
answers both the children of a note and the branches of a graph, `parent = NONE` standing
for a branch as it does on `node` — and it carries `note`, the ref the number was spent on,
which is the whole of how that one note takes its own number back when a copy of the graph
brings it home again (§ "The genealogy and the address"). Address assignment and that claim
are all that read it, and the per-DID purge takes it with the graph. What
a purge writes none for is a number another note is at, there or in the bin: `addressesLedBy`
reads the rows the sweep is leaving behind, and a note waiting to be put back has not given
its number up.

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
cannot follow. It carries no `checked` either, for a plainer reason: the commit it names is
in a history the reader has not got (§ "A project's container").

publication:{ created_by: <did>, id: <ulid> }
  created_by    did
  root          ref       the subtree it publishes, immutable
  root_address  string?   the label a person cites, restated by each publish;
                          absent is a branch its author gave no number
  graph         ref?      the graph that label is read in, immutable; absent is a row
                          from before graphs, which the home crossing fills
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

## A look a person set on a line

**A look is a note's, and it is a look rather than a fact.** `node.edges` is a list of
`EdgeLook` — `to`, and the three channels `label`, `direction` and `stroke` (`edge.ts` in
`@sloppy/types`). `to` names the note at the other end. What the look does is change how
the line ALREADY between the two is drawn — genealogy, run, reference or link, whichever
one DESIGN.md § Edges says that pair draws — and where the pair draws no line it draws
nothing. It makes no line: carrying one joins two notes to nothing.

**It moves no mark and changes no distance.** The sector a subtree radiates into and the
spacing between two marks are the genealogy's, derived from the ref and the parent chain;
nothing here is an input to either. A look is on the same footing as `appearance`: how a
thing is drawn, never where.

**Absent means the design's own.** An absent `edges` is a note nobody has set a look on,
and an empty list is the same note — `looksWritten` is what collapses the two, so a
person who cleared every channel leaves the note carrying nothing rather than carrying an
empty look. Inside a look, an absent channel is the default for that channel alone: no
arrowhead, the break the line already has, no words on it. The three channels are enums
(`EDGE_DIRECTIONS`, `EDGE_STROKES`) rather than open tokens, so a value this build has
never heard of is refused on the way in rather than stored and ignored.

**One note stores it, and a pair resolves off both ends.** The look is written on the
end already carrying the pair's look, so editing a line edits the look it is drawn under
and clearing it takes that one off — and on the note the person reached the line from
wherever that end is one somebody else gates, because **the app writes only one, and it
is the reader's own**: an owned note's look is the owner's, and a contributor's change to
it is an offer, the same rule every other field is held to (§ "Whose writing a note
carries"). Where NEITHER end is theirs to write, the look goes on the end they reached
the line from and is offered to whoever writes it — the amendment that carries `edges`,
composed against that note's writing as it stands so an offer about one line proposes
nothing else. `lineBetween` answers which note and which of the two outcomes, so the
sheet asks for one and never the other. The other note may carry one for the same pair,
which is what happens when two people each set one. `lookBetween(a, b)` is the whole
answer: the one end that has a
look, or — where both do — the note with the later `updated_at`, with the smaller ref
settling a tie so two peers reading one pair read one look. The answer is the winning
note's own entry, and its `to` is what says which way round `direction` points.

**At most one look per `to`, and a second one costs that look alone.** Two entries naming
one note would be a line drawn two ways. A WRITER is refused: `looksAreOnePerTarget` on
every request, so a person who said two things about one line is told rather than having
one of them quietly dropped. A READER keeps the first: `looksRead`, on every node row
coming back, on a note read out of the vault, and on the looks a canvas is handed, because
the rows a reader meets include a peer's and a hand-edited file's, and refusing one would
cost a whole page of somebody else's notes over a word written on a line. Both are free
predicates rather than a `.refine()`, because a refinement on `NodeSchema` would take
`.omit()` and `.partial()` away from every request built off it.

**It travels, bounded the way `links` is.** The vault writes `edges` in a note's front
matter and an archive carries it (§ "A graph on disk"); `NodeView`, a published snapshot
and a pulled copy all carry it; an offer may carry it, and an offer that names no look
leaves the note's looks alone — a list with nothing in it says no more than no list
does, which is the one thing an offer cannot say that a write can. The bound on a published node is `links`': every
ref on `PublishedNodeSchema` names a note the caller may read, so a look whose `to` the
author has not published is dropped from the snapshot rather than named — `looksReaching`
is that filter. An archive carries the looks both ways: an import writes back the `edges`
a note's file holds, the way it writes back its links.

**The renderer is handed looks, never rows.** `GraphSurfaceProps.edgeLooks` in
`@sloppy/graph` is one resolved look per pair, `from` the note it is stored on and `to`
the other end; the host resolves each through `lookBetween` because which end wins is a
fact about two rows and that package reaches no store. `onEdge` is the answer to a tap
that landed on a line rather than on a mark. DESIGN.md § Edges — "A look a person set" —
is what each channel draws as.

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

**A shape leaves no trace of itself.** `NOTE_TEMPLATES` in `@sloppy/types` is the shapes
themselves — a name and its headings, read by the app and by `.sloppy/AGENT.md` alike, so
the two cannot come to offer different ones; `templates.ts` in `@sloppy/ui` turns one into
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

**A formula and a diagram are elements too.** `math` and `mathBlock` hold the TeX somebody
typed and `diagram` holds a language beside its source — never the picture drawn from
either, so a build with no renderer for a language still carries the diagram whole and a
later one draws it. KaTeX and Mermaid ship with the app rather than off a CDN, and Mermaid
is asked for the first time a diagram is drawn; nothing about drawing one leaves the
device. `elements.ts` is the one list of the kinds that need nothing from the surface they
are drawn on, so the writing surface, a held note and the outline register them together
and a fourth kind is added once.

**What a fence OPENS a diagram in is one list, and what a build DRAWS is another.**
`DIAGRAM_LANGUAGES` in `@sloppy/types` is the first: the editor's input rule and the vault
both read it, so a fence means the same thing in a note as it does in a file — two lists
would let a round trip through a folder turn a code block into a diagram. `DRAWS` in
`@sloppy/ui` is the second, and a language in the first with no renderer in it is carried
whole and shown as its source until a build has one.

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

## The compass

**A compass is an element inside a section, and four lists of citations is all of it.**
`{ type: "compass", attrs: { north, south, east, west } }`, each direction a list of
places, and a place is `{ note: "<did>/<ulid>" }` — the same key a sentence cites a note
under. An empty list is a slot nobody has filled, which is what an absent one reads as.
`COMPASS_DIRECTIONS` in `@sloppy/types` is the order it is written and read in, and
`compassOf` is the one reader — the FIRST compass a document holds is the answer, because
a note points one way and a second one is a hand in the file rather than a second heading.

**The tokens are the wire and the words are copy.** `north`, `south`, `east` and `west`
are what a file and a peer carry; the words a surface draws beside them are free to change
or be translated without moving anything somebody else is holding. Nothing in storage
enumerates the four: the compass is an element kind like any other, carried by
`BlockDocumentSchema` by shape, so a build with no renderer for it keeps it whole
(§ "Blocks and ink").

**A `kind` says which method the four slots are read as, and moves nothing.** The idea
compass — "Part of", "Made of", "Like", "Instead of" — is what a compass that does not say
is in, so **an absent `kind` is the idea compass** and one in that method carries no `kind`
at all: every compass written before methods existed, and every one an older build writes,
reads exactly as it did. `COMPASS_KINDS` in `@sloppy/types` is the closed set — `idea`,
`inquiry` and `argument` — and a fourth is a token there and a row of copy beside it. The slots stay
the wire for all of them, which is what makes switching free: no citation moves, so
switching back finds them where they were. The cost is stated: the file says `north:` where
a person reads "The question".

**Every method names all four, because the compass is two axes and not a dial.** North and
south are where a thought came from and where it leads; east and west are what holds it up
and what pushes against it. So `inquiry` reads north as the question, south as the conclusion,
east as the evidence and west as the counter-evidence; `argument` reads them as the assumption,
the implication, the justification and the objection. A method naming only three would
leave one pole of one axis empty — and that pole, the one that argues back, is the half a
person is most likely to skip and most needs to be asked for.

**Its markdown form is the lines themselves** (§ "A graph on disk"): inside the section,
one line per filled direction, in the fixed order, `north: [[<ref>]] [[<ref>]]`. A
direction with nothing in it is not written, the reader recognises the block by the TOKENS
and never by the words, and anything else a compass node carries — a slot nobody gave it, a
slot naming something that is not a note, **a method other than the idea compass** — goes
as its JSON like any other element markdown cannot say. The method goes that way because
the run of slot lines ends at the first line that is not one: a `kind:` line inside it
would cut one compass into two for every reader that does not expect it, and one outside it
would be prose to them. The JSON comment is the hatch this format already has for what it
cannot say, and a build that has never heard of methods carries one through untouched. The
round trip is held to the strong form by the vault's property tests, so a graph read out of
a folder is the graph that was written into it.

**A slot is a citation, and nothing else changes.** `citedNotes` counts a compass ref
exactly as it counts a note named in a sentence — because it IS that key, rather than a
second convention beside it — so the canvas draws the line it already draws for a
reference, at the same weight, and no mark moves: the genealogy, the addresses and
`node.links` are untouched, and no column is added anywhere. Where direction is drawn at
all is the compass card on the note (DESIGN.md § "The compass card") — the canvas has one
shape and the compass is not part of it.

**Filling somebody else's slot is an offer, because it is writing.** A compass lives in a
section, so a change to one on an owned note travels the amendment path every other change
travels (§ "Whose writing a note carries"); what differs is only how the offer is SHOWN —
the slot that gained a note, and the method it would be read by where the offer changes
that — rather than a diff of a block. An offer that changes only the method moves no
citation, so it is that line with no slot under it.

**The hosted graph carries it with the block.** There is no compass route, no compass
column and nothing for the API to learn: a section holding one is a section, and it is
written, published, pulled and purged as one. That includes what a publication withholds
— a slot pointing at a note outside it is blanked by the rule that blanks a citation in a
sentence, and reads back as a slot nobody filled, which is the whole reason a place is
written under the citation's own key.

**A Decision is a note holding a compass and a section headed "Why".** It joins the
templates a new note can be started from, and nothing marks it: those two together are
what makes a note a decision, and `DECISION_WHY_HEADING` in `@sloppy/types` is the one
copy of the word, so the template that writes the section and the review that reads it
cannot drift apart. A note holding a compass and no such section is an ordinary note and
is never asked to explain itself (§ "Tooling and the review").

## A graph on disk

**The vault is a folder somebody owns, and the archive is that folder zipped.** One
reader and one writer serve both, in `@sloppy/vault` — pure TypeScript with no server and
no browser in it, so the API streams an archive out of the same code the native app reads
a folder with. Nothing in it talks to a store: it is handed rows and hands back files.

```
<vault>/
├── graph.json                       format, the graph's ulid, its name, whose it is, what it gates, whose project it is
├── notes/<ulid>.md                  one note: front matter, then its sections
├── amendments/<ulid>.md             one change offered on a note, in the same shape
├── media/<uploadId>.<ext>           the pictures the notes draw
└── .sloppy/                         what markdown cannot carry
    ├── ink/<block>-<n>.ink.json     one drawing's strokes, and an .svg of it beside
    │                                 an offer's are <offer>-<block>-<n>
    ├── pictures.json                a picture's size, keyed by upload id
    ├── media.json                   what a picture was called and what it is
    ├── emoji/<shortcode>.<ext>      the custom emoji the notes are written with
    ├── emoji.json                   whether a shortcode draws as an emoji or a sticker
    ├── bin/<ulid>.md                a note thrown away, still where it can be put back
    └── bin.json                     when each of those went, and every address spent
```

**`graph.json` says whose the graph is, and not only by DID.** `owner_name` and
`owner_avatar` — a path into this vault's own `media/` — are what a graph carries about
the person who keeps it, so one opened on another device is not anonymous. Both are
optional, and absent is somebody who has not said. Importing somebody else's graph leaves
their name behind with them; a person's own archive brings theirs back.

**`ownership` is what the graph gates the notes written in it by** (§ "Whose writing a note
carries"), and absent is `open` — every graph written before the field. It rides in an
archive rather than being left behind, because it is the graph's own and not a person's: a
folder two people share through git says there that a note written in it is its writer's,
and it says the same on the next device that opens it. A value this build has never heard of
leaves the graph open rather than shutting somebody out of their own notes.

**Every folder's graph has a ulid of its own**, minted when the folder is started, so two
devices' first folders are two graphs and an archive of either settles into itself.
`LocalGraph.open` mints one for a folder still spelling the reserved ulid every first graph
once shared and writes `graph.json` back, which is the local half of the crossing
§ "The genealogy and the address" describes. `vaults.json` records where a folder is and
never which graph is in it, so nothing there has to change.

**The bin is the folder's and never travels.** A deleted note's file moves into
`.sloppy/bin/` and putting it back moves it out again, while `bin.json` holds when each
one went and every address this graph has spent and will not assign again — including the
ones a purge retired. An archive carries
the vault without either, because a graph handed to somebody else is what was written and
not what was thrown away. **`bin.json` records the note beside each number it retired**, so
a retired number is the spending note's alone to take back, and one recorded before the
folder kept that names nobody and stays refused to everyone — the same rule the server holds.

**The markdown is the record, and `.sloppy/` is what markdown has no syntax for.** A
person opens `notes/` in any editor, reads their writing, changes a word and commits it;
the folder is theirs, and a folder of text files is a folder git can keep. So
everything that can be written as markdown is: headings, lists, todos, code, quotes, links, `:shortcode:` for
an emoji, `$…$` and `$$` for a formula, a fence for a diagram, an image link for a picture
and for a drawing. Strokes, a picture's pixel size and the emoji pictures have no markdown
syntax at all, so they sit in `.sloppy/` beside the link that names them. A drawing is
written twice — its strokes as `.ink.json`, and an `.svg` drawn from them — because the
strokes are the record and the SVG is what a viewer that has never heard of Sloppy shows.

**One note is one file, and its sections are marked in the body.** The front matter is the
note as the protocol holds it: `ref`, `parent`, `address`, `aliases`, `owner`, `authors`,
`contributors`, `tags`, `links`, `edges`, `title`, `created`, `updated`, `checked`,
`appearance`.
Absent `parent`
is a branch or an independent note; absent `address` is a note with none; absent `aliases`,
`tags`, `links` or `contributors` is none of them; absent `owner` is an open note; absent
`checked` is a note nobody has confirmed against the code (§ "A project's container"). **Absent
`authors` is the ref's own owner alone**, and that is the one case the file leaves out — a note
only its own author has written into and a note written before anybody else could write into
one are the same bytes, which is what keeps the round trip lossless (§ "Whose writing a note
carries"). `appearance` is a block of its own — the channels the author set on the mark, each
on its own line — and absent is a note nobody styled, which is not itself a look: a
channel that says nothing is not written down, exactly as `isUnstyled` reads one.
`edges` is a list of blocks, one entry per look the note sets on a line, its fields
written `to`, `label`, `direction`, `stroke` and an empty one left out; absent is a note
nobody set a look on (§ "A look a person set on a line"). An item under a dash is kept as
the text it was typed as AND, where it opens a `name: value`, as the fields under it — so a
field is read as a list or as looks by whoever reads it, one item at a time. A colon a hand
typed into a tag costs neither that tag nor the tags beside it, and an item a hand left the
`to:` off costs that look alone. The
body is the note's stack of sections, each opened by `<!-- block <ulid> -->` — so a section
keeps its identity across an export and an import, and a person who moves one in the file
has moved a section rather than made two.

**An offered change is a file in the same shape, in `amendments/`.** Its front matter is
`amends` — the note it is offered on — `by`, `at`, `message`, `title`, `tags`, `edges`
and `appearance`, and its body is the sections it proposes under the note's own block ulids, read
by the same reader a note's are. Its own ulid is the file's name rather than a field: an offer is
read inside the graph that holds it, so the owner half of its reference is that graph's owner
and nothing in the file repeats it. It is committed like any note, so it moves through the
folder's history and rides in an archive — a graph handed over with offers standing on it
loses none of them. Its drawings sit in `.sloppy/ink/` like a note's and are named for the
offer as well as for the section they are in, so an offer proposing a section the note also
holds writes its own drawing rather than over the note's.

**What a vault carries is what a person wrote; what a renderer decided is not carried.** A
note's `depth` and `origin` fall out of the parent chain, its `references` out of its own
writing, and an emoji's picture out of the catalog in `.sloppy/emoji/` — so none of
the four is written down twice. A picture's upload progress is the same. A link is
`[label](href)` and nothing else: where it opens and what it is dressed in — `target`,
`rel`, `class`, `title` — are the link extension's defaults rather than anybody's writing,
so the editor stores none of them and a vault carries none of them. An element kind this
build has no renderer for is carried whole, as an HTML comment holding its JSON, so a vault
written by a newer Sloppy loses nothing on the way through an older one.

**The conversion is lossless, and that is a property test rather than a promise.**
`toMarkdown` and `fromMarkdown` are inverse over the documents the editor writes:
`document -> markdown + sidecars -> document` is identity, and two documents that differ
never write the same files. An element whose markdown would read back as something else —
a code block in a diagram's language, a formula holding a `$`, a fence whose source holds a
line that would open the next section, a link whose address is a note's ref, which a
citation of that note is written exactly like, one upload the note draws at two sizes — is
written as its JSON instead of guessed at. That last one is why a graph is written note by note
against the picture sizes and the emoji the vault already holds: the writer has to see the
first use to know the second disagrees with it.

**An entry that is not inside the vault is not read.** An archive is a file somebody else
made, so `unpack` refuses one carrying a path that climbs out of the folder or names a
place of its own — nothing downstream has to remember the rule before writing a vault to
disk.

**Refs are re-keyed on import; ulids are kept; what somebody wrote stays theirs.** An
archive carries refs under the DID that exported it. Importing into an identity rewrites
`<sourceDid>/<ulid>` to `<targetDid>/<ulid>` through the note's own ref, its parent, its
links, every reference in its writing and the note an offer amends — the aliases ride the
note, so its ref carries them. The ulid half never changes, which is what lets a graph be
recognised on the way back in. An import is refused where the target already holds one of
the ulids arriving in another of its graphs. Addresses arrive as the labels they are, and
are held unique inside the graph by the same rule that writes one.

**Whose writing a note carries is never rewritten; the gate on it moves with the graph.**
`authors`, `contributors` and an offer's `by` are what somebody wrote, and carrying a graph
somewhere else does not make it somebody else's writing. A note's `owner` is a gate rather
than writing, so the one the graph's own owner held moves to the identity importing it,
exactly as `graph.json`'s owner does — a person's own graph comes back writable, and one
carried between a folder and a hosted instance arrives writable by whoever brought it. A
gate somebody else holds stays theirs; the graph's owner clears it wherever the note's
details are shown.

**Importing a graph you already hold is a merge, not a replace.** The graph's own ulid says
which, and where it is one the importer keeps, the two copies are settled note by note: a
note only the archive has arrives, a note only the graph has stays, and a note both sides
hold that differs is a conflict. So is a number the two sides have on different notes. What
a person is handed is the same choice a merge in the folder's history hands them (§ "The
vault's history") — mine or theirs for the note, section by section where both sides wrote
into one note, and which note keeps the number for an address — and no note is ever written
with markers in it. `ImportConflict` and `ImportResolution` in `@sloppy/types` are that
vocabulary; `ArchivePreview.conflicts` is what a person is shown before anything is written,
and `merges` says the archive is a copy of a graph they keep. Absent `conflicts` is none and
absent `merges` is false — what an answer made before an import could merge says.
`ArchivePreview.offers` is how many changes offered on those notes the file carries, counted
from `amendments/` and absent where it carries none, so a person settling two copies of one
graph is never told they agree while an offer is landing. The hosted
app and the local app settle an import the same way, because both read the same preview.
**Both previews answer the conflicts and both imports settle them as chosen**, on the
server and in a folder alike; a settlement that leaves a conflict unsettled refuses the whole
import before anything is written.

**An archive says what it holds before it is opened.** `manifest` reads `graph.json` and
counts the entries out of the zip's own listing without inflating them — its notes, its
offered changes and its pictures — so an import preview can say whose graph it is, what it
is called and how much of it is arriving while the file is still a file. One preview answers
for a folder and one for a server, and both count the same way.

## A project's container

**A project's notes are an ordinary vault at `<project>/.sloppy/`.** It is a folder with a
`graph.json` in it like any other (§ "A graph on disk"), so the archive, the history, offered
changes, the picker and publishing all work on it unchanged, and there is no second kind of
graph anywhere in the code. The vault keeps its own sidecar folder, so a container reads
`<project>/.sloppy/.sloppy/` one level down; accepted as it is, because renaming it would
move every path in a layout other people's folders are already written in.

```
<project>/                           the folder somebody picks
├── src/…                            their code, which Sloppy reads and never writes
└── .sloppy/                         the container: an ordinary vault
    ├── graph.json                   … with `project: ".."` in it
    ├── notes/<ulid>.md
    └── .sloppy/                     the vault's own sidecars, one level down
```

**Opening a project means picking its ROOT.** The known folder on the list is the project
root, and `containerOf` in `@sloppy/local` answers with the vault at `.sloppy/` inside it —
absent where that folder holds no graph, which is a folder nobody has started a container in
rather than a failure. Everything the app reads, the code included, is under the picked
folder, and `projectRootOf` holds `graph.json`'s `project` to that: **only a vault at
`<project>/.sloppy` has a project around it**, and the path it names must land in the folder
that vault sits in or under it. So a graph file a hand has been in cannot point the app above
the folder somebody picked, and `project` written into an ordinary vault names nothing.

**The project root is what the device writes down, and the container is what it serves.** The
shell hands `LocalApi` the folder somebody picked, so the list of folders, the one remembered
across launches and the one the picker shows are all the project's own root, and the graph
read out of it is the container inside. `LocalApi.projectFolder` is the one answer to where
the code is — `AppRuntime.project` is it, and `runtime.history()` is asked of the container,
because the notes are what a version of them is a version of.

**`graph.json` gains `project`: where the code is, as a path from the vault root**, `..` in
the ordinary case. **Absent is a graph that is nobody's project** — an anchor into code in it
draws as an ordinary link and nothing offers to review it, which is every graph written
before the field. `graphFile` and `readGraphFile` both carry it so no build drops it on a
rewrite, and it is the FOLDER's own fact: a graph brought in from an archive arrives without
one, the way somebody else's name does, until the folder it lands in is a project.

**A note points at code with an ordinary link.** `code:<path from the project root>`, with
`#L12`, `#L12-L20` or `#<symbol>` after it; an absent fragment is the whole file. It is a
markdown link the vault already carries losslessly, beside the `sloppy:` scheme a citation
uses, so a note pointing at code is still a file somebody reads on a forge.
`parseCodeAnchor` in `@sloppy/types` is the one reader of one — a path climbing out of the
project or starting at the top of a disk is not an anchor at all — and `anchorsOf` derives
every anchor a section holds from its link marks, exactly as `citedNotes` derives a citation.
A fragment that is not a run of lines is a NAME, found by searching the file for it: there is
no language server behind this, two functions of one name resolve to the first, and a name
that stops matching is itself worth saying. A path this checkout does not have draws as its
label and never as an error. Nothing pins a commit inside the href — `checked` is where that
lives.

**`checked` on a note says when its reasoning was last read against the code.** It holds a
commit, spelled as the folder's history spells one. **Absent is a note nobody has confirmed,
which reads as UNREAD and never as out of date** — every note written before the field, and
every note somebody has not got to yet. It rides in the note's front matter beside `updated`,
on `Node` and through `UpdateNodeRequest`. **It does not travel with a published version**: it
names a commit in a history the reader does not have, and nothing a held copy could do
resolves one. Confirming a note
writes `checked` and nothing else: no section changes, no author joins, nothing moves in the
genealogy.

**The hosted store keeps it and never interprets it.** `checked` is a column on `node`
(§ "Data model") holding whatever the folder's history calls a commit, written by `PATCH
/nodes/:did/:localId` like any other field on a note: there is no route for confirming,
because confirming is a write on the note. It is held to the note's gate — whoever may write
the note is who may confirm it — and it joins nobody to the note's authors, which is one of
the two ways that write differs from every other. The other is `node.updated_at`, which a
confirmation leaves where it was: the note surface reads that column to ask whether a
published branch has changed since it went out, and nothing a confirmation writes reaches a
reader.

It goes out with an archive and comes back with one, so a graph carried between a server and
a folder keeps what its author has read. Settling an archive against a copy of that graph the
server already holds takes the ARRIVING reading — the folder is the copy that sits beside the
code, and a reading the server holds stands only where the archive carries none, because
absent is unread rather than a reading of nothing. Nobody is asked about one, and a note whose
reading alone arrived is confirmed rather than written: its sections stay where they are, and
so does its timestamp.

**The genealogy, refs, addresses, aliases, retired numbers and the section opener are
untouched by all of this.** A container is a vault, a note in it is a note, and an anchor is
a link inside a section.

## Tooling and the review

**`@sloppy/cli` is the container without a window.** One package, `packages/ts/cli`,
running over `@sloppy/vault` and `@sloppy/local` on a `Files` backed by `node:fs/promises`
— never a server, never a browser, and never a second implementation of anything the app
already does. It is what a person runs in a repository and what an agent working in one
reaches for, so the notes a project keeps are writable from where the code is worked on.

```
sloppy init [dir]      start the notes in a project, and write what the tree can tell
sloppy draft [paths…]  a note in detail per file named, never over somebody's writing
sloppy review [dir]    what the code has left behind
sloppy check [dir]     read every note and say what doesn't hold
```

Each prints lines, answers JSON with `--json`, and says what it did in its exit code: **0**
nothing to fix, **1** something to fix and listed, **2** nothing done. `init` starts the
container where there is none and writes the BASIC documentation the tree can be read for —
a note per top-level package or folder the workspace declares, each anchored at its own
folder and at its entry points, and pointing north at the project's own note. `draft` writes
the DETAILED kind for the paths it is named: what a module imports and exports, an anchor
per exported symbol, and what a compass MIGHT hold written as candidates in the note's own
writing. `review` is the signals below. **The CLI never writes a "west" and never writes a
"Why"** — what was decided against, and why, is the author's thinking and not a tool's to
supply.

**`check` is the one that says no.** Every file in `notes/` spelled the way a note file is
spelled reads as one — anything else in the folder is the person's and is left alone —
every front matter field holds to the schema the rest of Sloppy holds it to, every citation
of a note in THIS graph lands on one, and every anchor lands on a path the project has. A citation of
somebody else's note is left alone — this folder is not where that note lives, so its
absence here says nothing — a note in the bin is still there, and a graph that is nobody's
project has nowhere to look for an anchor and is not asked to.

**A note somebody else has written in is never written over — by authorship, never by
ownership.** `draft` writes straight onto a note only where that note's `authors` is the
CLI's own identity and nothing else; on any note a person has written in, alone or beside
the CLI, it offers an amendment, whatever the note's `owner` says (§ "Whose writing a note
carries"). `writesAlone` in `@sloppy/types` is that rule, and the local store reads the same
one, so an offer stands on a note with no owner rather than being refused as a change the
writer could have made. A path with no note yet gets one written outright. **A run nobody is
watching is held to the same rule and no other**:
there is no person behind a job on a runner, so `init` there mints an identity for the machine
it is on, and what an unattended `draft` writes lands or is offered by exactly that rule. What
comes back is a branch somebody reads before it is merged.

**Nothing the CLI does gates somebody's graph.** Ownership is the person's setting, made
where every other graph's is, and `init` leaves it exactly as it finds it. The alternative
is the trap: `init` mints an identity for the machine it runs on, so a container gated in
its name is one the person who later opens the project cannot write a word in.

**`init` writes under an identity of the container's own.** The key goes in the container's
sidecar (`<project>/.sloppy/.sloppy/`) rather than in an app's private data, because there is
no app here — which puts it inside somebody's repository, so `init` also writes
`<project>/.sloppy/.gitignore` telling the history to pass over what is this device's: the
keys, the identities, what this device was told about the folder, and the bin — the list
§ "The vault's history" keeps out of a folder the app opened, and the key files a device's
own store writes beside them. A key committed is a key pushed. **The rest of that sidecar is
the graph's own** — a note's ink, what each picture was called — and commits with the notes,
or a teammate who clones gets the writing with the drawings missing. A file somebody wrote
themselves stays theirs: the lines that are not there are added, and nothing else is touched.
`--identity <file>` writes under an identity carried from another device instead, and the
graph is then that person's rather than the machine's.

**The notes `init` writes are told apart by what they point at, never by a tag** — a tag is
the person's own vocabulary, and a shape leaves no trace of itself. The note about a part of
the project is the one anchored at that part's own folder, and the project's own note is the
one those hang under. That is what a second run reads to know it has already written them,
and what `draft` reads to know that a note pointing at a package's entry point is about the
PACKAGE — so a detailed note about that file is written under it rather than into it.

**`.sloppy/AGENT.md` is what an agent finds where it already looks.** `sloppy init` commits
it, and it carries the WHOLE format: one note per file, the front matter, the sections, the
markdown a section holds, citations, `code:` anchors, the compass and its three methods,
tags, `checked`, the shapes a note starts from, and the pictures and drawings an agent moves
and never redraws. Then the rule that an existing note is changed through an offer, what an
agent may never write, and the commands above. It is the whole format because an agent that
can write only a subset of it produces notes a person cannot finish (§ "Asking a tool to
write the notes"). `AGENT_MD` in `@sloppy/cli` is the one copy of that text, and the shapes
in it come from `NOTE_TEMPLATES` in `@sloppy/types`, which the app writes from too.

**The review is derived, never stored, and computed in one place.** `review()` in
`@sloppy/vault` is given the notes, the project's top-level paths and a way to ask what has
moved, and hands back `ReviewSignal[]`; the app and the CLI both call it, so the two cannot
disagree about what a person is shown. Nothing it says is written down anywhere — there is
no signals table, no cached count and nothing to migrate.

- **`anchor-changed`** — an anchor whose file has moved since the note's `checked`, from the
  history's `changedSince`. **A note with no `checked` yields nothing at all: unread is not
  stale.**
- **`code-without-note`** — a top-level folder or declared package no anchor in the graph
  names or reaches into. It is a signal about the PROJECT, so it carries a `path` and no
  note. **Which places those are is `placesIn` beside it**, so a surface asking the question
  and the terminal writing the notes read one list: what a build wrote into, what a tool
  keeps, and anything behind a dot is nobody's reading, and is neither written about nor
  asked after.
- **`compass-gap`** — a slot nobody has filled. Every method asks all four, so the gap is
  the same shape whichever one a note is read by; a note with no compass at all is not
  missing one. The signal carries the method, so the row asks the question the note itself
  shows.
- **`decision-without-why`** — a decision whose "Why" holds nothing under its heading. A
  note that is not the Decision shape — a compass and that section — is not a decision and
  yields this never.

A signal names a note, a path, or both: **an absent `note` is a signal about the project,
and an absent `path` a signal about a note.** DESIGN.md § "What the code left behind" is how
they are drawn, and the answer there is highlight-and-dim plus one sheet — never a count in
the chrome, never a badge on a mark.

**The folder is read again when it may have changed under the app** — the window coming
back, an act of the History surface, the review sheet opening — and **the note in front of
somebody is read with it.** Whatever serves the graph out of the folder holds its own index,
so it takes the files again first. A pane with nothing waiting to be saved takes the
folder's version outright; one that IS holding writing puts it down for the surface built
in its place, which settles it section by section by block ref — the same settlement a
section written in two places gets — and never as sections added beside what is there.
**A section save reconciles by ref, not by stamp.** A note kept in a folder stamps every
section with the file's own time, so somebody adding a section anywhere in it moves the
stamp on all of them: what says a section was written elsewhere is its words. A ref the
folder still holds is rewritten in place; a ref it no longer holds is offered back as one
new section, once — `410` from the local store is what says so, against `409` for a section
whose words really did change elsewhere. It is offered back where it stood, or as near to it
as the folder still holds, since a file rewritten elsewhere may hold none of the sections it
stood after. **The note says "also written somewhere else" only where both versions of a
section really do stand in it**, and says it the way anything else that happened to the note
is said: nothing of the person's was lost, and nothing is theirs to fix.

## Asking a tool to write the notes

**`@sloppy/cli` is the container without a window; this is the window.** An agent working
in a repository can already start a container and write notes into it, and a maintainer
standing in front of the app cannot ask for the same thing. What this adds is the person:
they say what they want written about, they are shown what a pass over the code proposes,
they settle that list, and what comes back is theirs to take in or turn down.

**Four stages, in that order, because the cheap one decides what the expensive one does.**
An INTENT is what somebody asked for, in their own words. A SURVEY reads the project
against it and proposes places — a folder, a file — each with the reason it was proposed,
and writes nothing. The person REFINES that list: they take places out, and they add what
was missed, which arrives carrying no reason because nobody proposed it to them. The RUN
writes about the places that survived, in the order they stand in. Nothing skips a stage:
a run made straight from an intent is a bill somebody did not agree to.

**What comes back is offered, never landed over somebody's writing.** A run writes through
the same store the app writes through, under a writer of its own, so it is held to the one
rule every write is held to (§ "Whose writing a note carries"): a place with no note yet gets one written outright,
a note carrying nobody's writing but the tool's is written straight onto, and a note a
person has written in is offered an amendment that stands until they take it in. Nothing
here writes a note file by hand — a writer that did would be the one writer in Sloppy that
the note's own gate does not reach.

**Which way that rule falls is decided by WHO is writing, so the run's writer is named
here.** It is the identity the container keeps beside the notes: a `LocalApi` over the
container's own files, which answers with the identity written down in the container's own
data and mints one there the first time, exactly as `sloppy draft` does from a terminal.
**It is never the identity the app writes under.** A run given the app's own api would
write as the person, for whom `writesAlone` is true on every note they have written — so
every one of those would be written over rather than offered, and the amendment this
section is built around would never be made. `DocumentingAccess.run` in `@sloppy/app-core`
carries that obligation where the shell implementing it reads.

**The tool is started, never composed.** The program is the shell's own and fixed there; it
is started directly rather than handed to a shell to interpret; and nothing a survey
proposed or a person typed becomes a program name, an option, or the folder a run works in.
A plan is input the tool reads, all the way down. That is also why the shapes bound what
they carry rather than trusting the pass that filled them: a survey proposes places by
reading a repository, and a checked-out tree — a dependency, a fork, somebody's branch — is
not a thing we vouch for. `ProjectPathSchema` holds every path in these shapes to
`insideProject`: inside the project, no segment that reads as an option, nothing invisible,
and bounded.

**Nothing marks a note as a tool's.** No field in the front matter, no tag, no heading: a
note is read for what it says, and what wrote it leaves no trace of itself (§ "Tooling and
the review", where the same rule decides how `init`'s notes are told apart). `PlaceDone`
says what the run left at each place, and that answer lives in the run rather than on the
note.

**`.sloppy/AGENT.md` is what the tool reads, and it carries the whole format.** Every
element a person can put in a note — the sections, the compass and its three methods, the
citations, the `code:` anchors, the tags, the shapes a note starts from, the pictures and
the drawings — is written down there, because an agent that can only write a subset of the
format produces notes a person cannot finish, and a person editing a note must not be
writing something the next pass cannot read. `AGENT_MD` in `@sloppy/cli` is the one copy of
that text, and the shapes it teaches come from `NOTE_TEMPLATES` in `@sloppy/types` so the
file and the app cannot drift apart.

**Native only, and the web app grows no button for it.** A browser tab cannot run a program
on somebody's machine, and the hosted API must never run one on a server — a graph anybody
can reach is not a shell anybody may have. `AppRuntime.documenting` is absent everywhere but
the native shell, which is what puts nothing in front of a reader in a tab.

**The shapes are `documenting.ts` in `@sloppy/types` and the seam is
`AppRuntime.documenting`.** `DocumentingIntent`, `ProposedPlace`, `DocumentingPlan` and
`DocumentingProgress` are what both ends hold; `DocumentingAccess` in `@sloppy/app-core`'s
runtime is the whole of what a page may ask for — the tools this device can reach, a survey,
a run it watches, and an end to whatever is underway. **A page never learns that a program
is involved**: it asks for a survey and gets places, asks for a run and gets progress and
then offers.

**Which tool does the writing is a value, never a branch.** `DOCUMENTING_TOOLS` is the set,
`DocumentingIntent.tool` carries which one was asked for — absent is whichever this device
has, which is the whole answer while it has one — and `documentingToolName` is the one copy
of what each is called where somebody reads it. A second tool is a value there and a way for
the shell to reach it, and touches no shape and no surface. A device with none is an empty
list from `tools()`, which is what lets the offer say so plainly instead of failing when
somebody takes it.

**How much detail somebody wants is part of what they said.** There is no depth field: the
point of putting a tool behind this rather than a template engine is that it reads the code
and decides what a place warrants, and a surface that set the depth on somebody's behalf
would be deciding it for them.

**A run says what has happened and never guesses at what is left.** `DocumentingProgress`
carries the stage, the place it is on, and the places behind it — and nothing that would
have to be estimated. `stopped` with no `trouble` is a run the person stopped; `stopped`
with words is one that could not go on, and those words are the ones a person can act on.
`progressFits` is the one statement of which of those fields a stage may carry, because a
shape cannot say it without a refinement and a refinement here would take `.omit()` and
`.partial()` with it.

**One run at a time on a device, and stopping one finishes before another begins.** `stop`
resolves after the run underway has settled its own promise, so a surface may ask for a run
the moment it resolves and a second `run` before that is refused rather than queued. A
second tool started into the first one's dying is the failure this orders away.

**Agents outside the app are a later wave, and nothing here is in its way.** An MCP server
reading and writing the same graph would sit where the CLI sits — over `@sloppy/vault` and
`@sloppy/local`, holding no vocabulary of its own — and everything above is already that
shape: the format is in `AGENT.md`, the writing rule is the store's, and the seam carries
no assumption that the tool is on this machine beyond the shell that reaches it.

## The vault's history

**The folder is a git repository, and that is the whole of the history.** A folder of
markdown files is a folder git can keep (§ "A graph on disk"), so the app writes no history
of its own: opening a folder no repository is already keeping initialises one, and everything
below is git doing what git does. The commands run in `src-tauri` over `git2`, because a webview
cannot reach a disk and a second implementation of git in TypeScript is not a thing anybody
should own. `History` in `@sloppy/local` declares every one of them and what its answer
means, and `MemoryHistory` beside it is that surface over `MemoryFiles`, so a page's tests
never need a repository on a disk.

**A vault inside a repository uses that repository, and is a PREFIX inside it.** A
container sits in a project whose history already exists (§ "A project's container"), and
reasoning that moves with the code it is about has to land in the same commit as the code. So
the shell no longer initialises a repository at the vault root wherever it finds one above:
it discovers the enclosing repository, bounded by the folder the person picked so the search
can never wander into whatever is above that, and takes the vault root's path relative to
that repository's workdir as a prefix. `status`, `log`, `readAt` and the staging a commit does
are all read and written under the prefix — so a listing shows the notes changing and never
the person's code, and **a commit Sloppy makes stages only paths under the prefix**. The lines
the folder keeps out move with it too: `<prefix>/.sloppy/bin.json`, `<prefix>/.sloppy/bin/`,
the identities, the signing keys and the saved identity copy. **The commands still take the
VAULT root**, and `History` in `@sloppy/local` is unchanged: its paths are from the vault root
exactly as they were. **A vault that is not inside a repository initialises one at its own
root, exactly as today.**

**A container's repository is the person's, so what it is in the middle of is theirs.** A
rebase, a cherry-pick, a revert or a bisect they began is held in the repository itself, and
an act that moves the folder — committing, switching, merging, settling one of two versions —
would walk through it, or clear it away when it finished. So in a container all four are
refused for as long as the repository is in the middle of anything but a merge this app
began, and the person is told to finish or stop it where they work on the code. **A merge
this app began is written down beside the repository** as it begins, naming the commit it is
taking in, so settling one is told apart from finishing the person's own; that, and only
that, is what clears the state afterwards. A vault that is the whole repository is this app's
alone and behaves exactly as today.

**`changedSince` is the one act whose paths are not the vault's.** It answers which of the
paths it is given a commit after some commit has touched, and those paths are spelled from
the root of what the history is keeping — the project root for a container, the vault root for
a folder that is its own repository — because that is how an anchor into code is written. It
is what tells somebody the code under a note has moved since the note was last confirmed.

**A folder has remotes, and they are the person's own — not federation.** Following a DID
and pulling a published subtree is § "Federating the graph", still pull-only and still
nothing to do with git. A remote here is somewhere a person chose to keep their own folder:
their host, their account somewhere, another disk. They are kept where git keeps them, in
the folder's own config, and a person adds one, calls it something else, points it somewhere
else or takes it away — a rename carries the branches this folder last heard that remote had,
and every branch following one of them, with it. The acts are git's, and each one refuses
what it cannot do in words a person can act on. `fetch` takes what a remote has and leaves
the folder alone. `pull` fetches and then runs the same merge a local one runs, with the
same conflicts settled the same way; nothing to take is `{ merged: true }`, and a branch with
nothing here to merge into is taken whole and follows what it came from, which is what a
folder that arrived as a copy is. `push` puts this
branch's commits where the remote keeps them, follows it from then on where the branch
followed nothing, and is refused where the remote has commits this branch has not taken in —
"Pull first, then push again.", because writing over somebody's writing is not a thing a
push may do quietly. **What a branch takes from and writes back to is the one it follows**,
read out of the config git keeps it in (`branch.<name>.merge`) rather than matched up by
name, because somebody's own git points a branch at whichever of a host's branches they
like and a folder set up that way is one this app opens. `status` carries `ahead`, `behind`
and the branch this one follows. **A `clone` is `Files`' and not `History`'s**, because a
folder that is not here yet has no history to ask. It refuses a folder that already holds
something, before it writes a byte and in the one place that can tell in a single read, so
a folder somebody keeps their own things in is never opened as the copy it was meant to be
and nothing above it walks the folder to ask the same question again.

**What a host says about a refusal is not what a person reads.** Its status line is written
for somebody at a terminal, so the shell answers with what to check instead: a way in that
was turned down says to look at the token or key, an address nothing answers at says to
check the address, and a push a host would not take says to check that what this device was
given may write there.

**What a pull brings in is files; what a number names is the graph's, and a pull does not
settle that.** Two people writing at once are offered the same next number by the same
deterministic rule (AI.md § "The Genealogy Is the Protocol"), so two notes at `1b` in one
graph is an ordinary Tuesday between two disks rather than an edge case, and git merges the
two files without noticing. A merge that leaves the folder holding a pair like that is not
finished: the folder is read again afterwards and the pair is put to the person as the same
conflict a copy of a graph arriving in a file carries — which note keeps the number, the
other keeping it as an alias so a citation still lands (§ "A graph on disk"). `LocalApi`
owns that, with `ImportConflict` and `ImportResolution` as the vocabulary, and `History`
knows nothing about numbers. **The bin travels with neither**, so the numbers a graph has
spent are the folder's own: what a person purged on one device is not known on the other,
exactly as it is not known to a copy carried in an archive.

**Credentials never enter a folder, and the shell holds none.** What a host wants —
a personal access token over https, or an ssh key — lives in the app's private data as
`credentials.json`, an entry per host, keyed by kind so another kind of credential is a
value and not a field (`Credential` in `@sloppy/local`). The TypeScript side reads the one
entry whose host the remote's address is at and passes it with the call that needs it, so
nothing in `src-tauri` remembers a secret between two acts. The bin, the identity and the
credentials stay out of every push exactly as they stay out of every commit.

**Commits are by the configured git user, and that is not who owns the graph.** The author
comes from git config the way git reads it: the folder's own `user.name` / `user.email`
first, then the person's global config. Settings writes the folder's pair, and `git.json`
in private data is the device default a new folder inherits — the shell writes it into a
folder that names nobody the first time it commits there, so it holds for every folder a
person opens rather than only the ones they started from the picker, and a folder that
names somebody keeps them. Where nothing anywhere says, the fallback is the graph's owner
and their DID. **The DID on a note and the author of a commit are two different facts** — whose
writing a note carries is § "Whose writing a note carries", and a commit is who saved this
state of the folder.

**Signing is keyed by kind — `none`, `ssh`, `openpgp`.** An ssh signature is made in this
process, in SSHSIG, with either the ed25519 key this app made (its private half in private
data as `signing.key`, its public half shown for a person to paste where their host wants
it) or a key file they named; in-process is what lets a phone sign at all. An openpgp
signature is made by the program git config names (`gpg.program`, `gpg` by default), which
is a desktop's alone, and a phone says so rather than offering it. The app writes what git
needs so a person's own git agrees with what this one did — `gpg.format`,
`user.signingkey`, `commit.gpgsign`, and for ssh an allowed signers file under `.sloppy/`
(`gpg.ssh.allowedSignersFile`) — and a commit is made as `commit_create_buffer` → sign →
`commit_signed`. A listing says which commits carry a signature and which key made it, and
calls one **verified** where that key is one this app keeps or one the folder's allowed
signers vouch for. **A save is never refused because a signature could not be made**: a
folder set up to sign with a program this machine has not got keeps the commit unsigned and
the setting for wherever that program is. How a folder signs is `signing()`, which a
listing reads beside the versions, so a folder that signs is what makes an unsigned version
worth saying anything about — an unsigned version in a folder that signs nothing is
ordinary. Choosing is where a person can do something about it, so that is where a key this
device cannot open and a program it has not got are refused.

**The whole history is readable as one picture.** `graph(limit, cursor)` answers commits
across every head this folder knows — its branches and the remote-tracking ones — newest
first and never ahead of what they spring from, each carrying the names at it (`main`,
`origin/main`) and its signature. It is paged like `log`. `branches` answers the same two
kinds together — the ones kept here, each with what it follows and how far ahead and behind
of it, and the ones this folder last heard a remote had, each saying whose it is — so a
panel listing them is one answer rather than something assembled out of pages. DESIGN.md
§ "The history as a picture" is how it is drawn.

**The commands the shell answers**, each taking the folder's root first and, where the
contract has one, the credential as the shape `@sloppy/local` declares: `history_graph`,
`history_remotes`, `history_add_remote`, `history_rename_remote`, `history_set_remote_url`,
`history_remove_remote`,
`history_fetch`, `history_pull`, `history_push`, `history_delete_branch`,
`history_branch_at`, `history_git_user`, `history_set_git_user`, `history_signing`,
`history_set_signing`, and `files_clone` beside them. They join `history_status`,
`history_log`, `history_commit`, `history_branches`, `history_branch`, `history_switch`,
`history_merge`, `history_resolve`, `history_read_at` and `history_head`; the page's half of
every one of them is `tauriHistory`.

**What the history holds is the graph; what this device knows about itself stays out.** The
repository the app initialises writes a `.gitignore`, and three things are in it. The
identity's key, the record of which folders hold graphs, this device's git defaults, its
credentials and the private half of the key it signs with live in the app's own private data
rather than in any vault (§ "Local-only mode"), and the ignore names every one of them so a
folder that also holds one never commits it. **A copy of an identity saved out of the app is
the second** — `sloppy-identity*.json`, and the bare name a panel can write without the
extension. That file carries the key. A save offers the person's downloads rather than
whichever folder the app was last in, but where they put it afterwards is theirs, and a
folder with a remote must not turn one they left here into something pushed. It is not the
vault's either (`vaultOwned` in `@sloppy/local`), so no copy of a graph carries it out. The
bin is the third, and its reason is the protocol:
`.sloppy/bin.json` carries every address this graph has spent and will not assign again, and
that ledger only ever grows — a switch to an older commit that handed those addresses back
would let a second note be written at one, which AI.md § "The Genealogy Is the Protocol"
forbids. The bin is the folder's and travels neither in an archive nor through the
history. An ignore alone cannot hold that line, so three things do: the repository
excludes them for itself, a commit lets go of any a folder was already tracking before
the app opened it, and a checkout keeps the folder's own aside and puts them back, so no
switch or merge writes an older bin or identity over the live one. The files themselves
stay where they are throughout — only the history lets go of them. **A checkout that is
refused leaves the folder exactly as it was**, including whatever it moved out of the way
to make room, so a switch nothing could take costs nobody a file.

**Any commit's vault is readable, and reading one moves nothing.** `readAt` answers the
whole vault as it was at a commit — the same `Vault` a folder and an archive already are, so
a past state is read by the code that reads the present one and drawn on the canvas and in
the outline with every act that would change a note gone. Going back to a state is a
`switch` onto a branch, which somebody decides rather than falls into by looking.

**A difference between two states is computed from the two vaults, note by note and section
by section.** `vaultDifference` in `@sloppy/vault` reads both sides as notes and answers
what a person did: which notes arrived, which went, which moved under another parent, which
were retitled or given another address, and which sections of which notes were added, taken
out, reordered or written into. It never reads a text diff. Git's hunks are lines of a file,
and a line of a note's file is not a thing anybody wrote — a section is, and a note is.
DESIGN.md § "A difference between two states" is how one is drawn.

**A conflict is resolved per note or per section, and a note is never shown with markers in
it.** A merge that cannot be taken whole answers with the paths it could not settle; the app
resolves each one — mine or theirs for the note, or section by section in the editor — and
the commit that follows carries both parents. Conflict markers are git's way of handing a
person two versions of a line, and a note's file is markdown carrying block openers: markers
left in one make a note that reads as neither version and a section stack that is neither
stack. So no note is written to disk with markers in it and no surface puts one in front of
anybody.

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
- **An API serving identities itself** — set `SLOPPY_LOCAL_IDP` with no external syr
  reachable; register, sign in, create a node, publish a subtree.
- **On-device Pencil check** — `pnpm tauri ios dev` on a physical iPad. Log `pointerType`,
  the `pressure` range, and `getCoalescedEvents().length` during a fast stroke. Pressure
  must vary; coalesced length must exceed 1.
- **Graph perf** — seed 10k nodes and measure frame time on device, not in the simulator.
