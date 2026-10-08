# Project Instructions

Common instructions for all AI agents and assistants working in this repository.
This file (`AI.md`) is the single source of truth; every agent-specific configuration
file (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `CONVENTIONS.md`, `.rules`,
`.cursorrules`, `.clinerules`, `.roorules`, `.windsurfrules`) is a symlink to it. If a
new tool wants its own filename, add another symlink — never a second copy.

## Project

**Sloppy** — a Zettelkasten-structured, socially-shareable knowledge graph.

Notion and Obsidian fail at the same thing from opposite ends. Notion imposes a tree:
pages inside pages, structure decided before the thought exists. Obsidian imposes
nothing: a flat mesh of backlinks where the graph view is decorative, because no two
people's graphs mean the same thing.

Sloppy takes a third position — **the shape of the graph is part of the protocol, not
a per-user accident.** Every node's position derives from rules everyone agrees on, so
one person's graph can be read, pulled and reasoned about by another. That agreement
is what makes the graph _social_ rather than merely shared.

Two orthogonal axes:

1. **The genealogical axis (Zettelkasten / Folgezettel).** Every node knows what it
   sprang out of, and carries the address that springs from it — `1`, `1a`, `1a1`,
   `1b` — as the label a person cites it by. This is not containment, it is _sequence
   of thought_: the direction a note springs out from its origin.
2. **The tag axis (multi-dimensional set classification).** A tag is a plain string on
   a note — `biology`, `seed`, `question` — and nothing declares it first. A note
   carries as many as it likes, so selecting several intersects sets _across_ the
   genealogical tree.

A subtree collapses into a **mega-node** that expands on tap. **Selecting tags
highlights the notes that carry them and dims the rest** — highlight, not filter, so
the shape of the graph survives the question. A node's interior is a stack of
**blocks**, each one a section its author added deliberately and wrote as many
paragraphs, lists, pictures and Apple-Pencil drawings into as they liked.

**Platform stance: mobile and tablet are the primary surface.** Desktop is the same
parts given room — stood beside the graph rather than over it, from the width the docks
already stand at — never a third layout, and never a part the phone lacks or one it has
to do without. DESIGN.md § Layout carries the two arrangements.

**Beside a codebase, the graph holds why the project is the way it is.** A developer and
whatever they set to work beside them keep one account of that, placed by what each
decision sprang out of and tagged with the system it is about, so the reasoning is read as
a field and cited rather than hunted for in prose. Every note points at the code it
explains, so either of them can take a piece of the repository and ask whether it is still
doing what it was written to do — whether the code matches what its note says it is for,
and whether the note still reads to somebody arriving now — and write the answer back where
the next reader finds it. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) § "A project's
container" is the mechanism.

**And the documents come first: this is a tool for intent-driven development.** A person
writes down what they want, as exactly as they can say it, with or without something set to
work beside them — and the code sprouts from what is written, with or without it. So a note
is not a record filed beside the code after the decision was taken. It is the intent the code
is answerable to, which is why the check runs in both directions rather than only from the
repository towards the notes. **The consequence is that a version of the project is somewhere
a person WRITES from, not only somewhere they look**: standing on an earlier version keeps
every control it had, writing there opens a line, and bringing that line back is an act this
product carries rather than one it leaves to a terminal.

Domain: `sloppy.sh` · bundle id `sh.sloppy.app` · packages `@sloppy/*`.

## The Genealogy Is the Protocol (required)

Everything else in Sloppy is an implementation detail that can be replaced. **What a note
sprang out of cannot**, because a peer somewhere is holding a copy of that shape. Once a
subtree has been published and pulled, the genealogy inside it is load-bearing on machines
we do not control and cannot migrate.

**A note is identified by its ref, `<did>/<ulid>`, and by nothing else.** That is what a
link holds, what a publication is rooted at, what a pulled region is a copy of, and what
every lookup on the wire and in the store keys on. Nothing keys a note by its address.

**The ref's DID says whose GRAPH a note is in. Whose WRITING it is, is a list on the note.**
`authors` names every DID whose writing the note carries, in the order they first wrote into
it, and absent it is the ref's DID alone — every note written before this rule. `owner` is
who gates the writing, and absent is an open note. The rule, one function, every surface: a
write by the owner, or on a note with no owner, LANDS — appending the writer to `authors`
where the note is open and they are not in it yet. A write by anybody else on an owned note
does NOT land; it is offered to the owner, who takes it in whole or turns it down, and taking
it in adds a `contributor` and leaves `authors` alone, because ownership is not writing.
docs/ARCHITECTURE.md § "Whose writing a note carries" is the mechanism.

**The genealogy is the agreement.** A note's parent — absent on a branch and on an
independent note — and its order among the notes alongside it are the whole of what every
peer reads the same way. Position on the canvas, depth, folding and what a subtree carries
with it are derived from those, so one person's graph draws the same shape on somebody
else's screen without anybody shipping coordinates.

**The address is a person's label.** `1`, `1a`, `1a1`, `1b` — what somebody reads, cites
and navigates by, inside a graph, the way a page number is read inside a book. It is not a
machine identifier and nothing in the system needs one to be there. The rules it is held
to, all of them about what a person can rely on rather than about what the code can find:

- **A note may have no address, and that is an ordinary note.** One written with no parent
  and no address is an independent note: it opens no branch, it is still linked to,
  published and read like any other, and it stays alongside everything else in its graph. A
  person gives it an address later or never.
- **An address is unique inside its graph while a note holds one.** A person keeps as many
  graphs as they like — a notebook each for the thesis, the garden and the company — and
  every one of them has its own `1a`. Two notes at `1a` in one graph would be a citation
  that means two things; two across a person's graphs are two labels, the way two people's
  `1a`s always were. The database holds that rule rather than the code around it, on our
  own rows and on the ones a peer hands us, and an address shown with no graph beside it
  means the graph in front of you.
- **The Folgezettel rule suggests the address at creation, and it stays deterministic.** A
  note written under `1a` is offered `1a1`, one written alongside it `1b`, unless the person
  names one — an address named at creation is held to every rule an address written on a
  standing note is held to, and to one more: it springs from the address of the note it is
  written under, or from nothing where the note opens a branch. Two peers applying the same
  creation operations must produce byte-identical suggestions, so the rule ships as a
  property test over generated operation sequences rather than a handful of hand-picked
  cases. What a graph decides is which run of siblings a suggestion is made against; a
  sibling with no address is not in that run and never moves what the rule offers.
- **A person edits and removes an address wherever one is shown, and a tool they set to
  work may write one for them.** That is the whole of what makes it a label: it is theirs
  to change, not theirs alone to author. The rule already offers one at creation, so a
  machine has always written most of them; an agent naming one is the same act, done where
  it can see the run. Somebody who hands over three hundred notes is not then reading three
  hundred notes to number them. Renumbering the notes AROUND one is still not a thing that
  happens: a person changes their own note's label and nobody else's, and so does anything
  acting for them.
- **Every address a note that is there has carried keeps leading to it, and belongs to it.**
  An address it was moved from, or renamed away from, resolves to that note for as long as
  it is there, and is never given to a second one — a citation somebody wrote down still
  lands where they meant. Where an address reaches both a note that is at it and a note that
  was, the note at it is the answer, and where two notes have left it, the first to leave it
  is: a note that takes a number another note still leads back by, and lets it go again,
  leaves nothing behind. Purging a note takes its aliases with it and retires every one of
  those addresses rather than releasing it — except a number another note is at, there or in
  the bin, which is that note's and stays its own to take back.
- **A retired address carries the note that spent it, and only that note takes it back.** A
  number a purge retired, or one a graph gave up when a copy of itself was written over it,
  is the spent number of one note. That note — the same ref, arriving again in the same
  graph — takes it back, which is what lets somebody carry a graph out of Sloppy and bring
  it home again with their citations intact. No other note may have it, and a retired
  address that names no note is refused to everyone: a row written before one could say
  whose it was is a number this graph has used, and nothing more.
- **A note in the bin holds its address only until a person asks for it.** Deleting a note
  frees nothing on its own: nothing is renumbered, and the rule never offers a number a
  binned note is holding. But a person who writes that number on another note, names it on a
  move, or writes a new note at it is given it. The binned note keeps it as an alias, so a
  citation still leads there while the note at the address is what it resolves to, and it
  comes back from the bin with no number and the one it gave up shown beside it, for its
  author to renumber. Where that number already led back to a note that left it earlier,
  that note keeps it and the one giving it up comes back with nothing beside it. A note
  that is there never yields this way.
- **A move re-addresses a note that has an address and leaves one that has none alone.** A
  moved note takes the next address in the run it joins, by exactly the rule creation uses,
  unless the person names one — an address named on a move is held to every rule an address
  written on a standing note is held to, and to one more: it springs from the address of the
  note it lands under, or from nothing where the note becomes a branch. Everything beneath it
  keeps its place relative to it either way. The addresses left behind become aliases, and the
  person may edit the result afterwards.
- **Within a run, the notes with addresses come first, in address order, and the rest
  follow in the order they were written.** That is one ordering, in one function, so no two
  surfaces can disagree about what a run reads as.

**Derived, never stored — with `depth` the ratified exception.** The angular sector a
subtree radiates into and its collapse key are functions of the ref and the genealogy —
never of the address, which is what keeps a label from moving a mark; persisting one
creates a second copy of a truth that no longer has a single author. `node.depth` is
maintained from the parent chain instead — a branch and an independent note are 1 —
because a range over it is what bounds a region read; `docs/ARCHITECTURE.md` § "Data model"
carries the ruling and the conditions it is held to. **And anything that groups notes by
address needs the graph beside it** — a person's branches are a run within one graph, so
grouping them by author draws a line between two notebooks.

**A change to these rules is a protocol break, and is treated as one.** It does not land
inside a feature commit. If implementation shows a rule is wrong, stop and say so.

## A Block Is a Section (required)

**A block is a visible section of a note, and a person adds one deliberately.** It is
its own bounded region on the page with a handle that reorders it. Inside it they write
freely: many paragraphs, headings, lists, todos, code, pictures, ink. **Enter makes a
new paragraph inside the block, never a new block.** A second block is what you add when
the next thing is a separate thought, and that is what makes the handle mean something —
you reorder sections, not sentences.

- **Nothing creates a block as a side effect of typing.** A surface that maps one editor
  node to one row has rebuilt the model this rule exists to forbid.
- **A block stores the editor's own document**, TipTap/ProseMirror JSON, losslessly.
  Markdown cannot carry ink strokes or picture metadata, and one payload column cannot
  describe a section with three drawings in it. The cost is accepted and stated: the
  stored shape is the editor's, so an editor change is a migration.
- **The element kinds live one level down**, inside that document. Storage does not
  enumerate them: `BlockDocumentSchema` bounds a document by shape, so a kind this build
  has no renderer for is carried untouched rather than refused. A new kind is a node the
  editor knows and a renderer, never a column on the row.
- **The genealogical axis, tags, addresses and the graph are untouched by this.** It is
  the note interior and nothing else.

docs/ARCHITECTURE.md § "Blocks and ink" carries the storage contract and the bound the
stored document is validated against.

## Architecture

The deployment model (hosted, self-hosted, and fully local via the embedded IdP), the
monorepo layout, the syr split, the data model and the graph renderer's ownership line
live in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Keep architecture detail there,
not in this file.

**Stack at a glance:** pnpm + Turborepo monorepo. `apps/sloppy/{api,web,native}` —
NestJS API, SvelteKit web, Tauri native. `packages/ts/{types,client,app-core,ui,data,graph,idp}`
— shared TypeScript packages (`@sloppy/*`). Rust lives in the Tauri app's `src-tauri/`,
managed by Cargo. Shared versions are pinned in the pnpm catalog
(`pnpm-workspace.yaml`). Run `pnpm dev` / `pnpm build` / `pnpm check` from the root.

**The shells are shells.** `apps/sloppy/{web,native}` stay ~200-line boots. Every page,
component, store and API call lives in `@sloppy/app-core`. This is what makes one
codebase serve both surfaces, and it only works if nothing product-shaped leaks into
them. A change that adds a route to a shell is almost always a change that belongs in
app-core.

## Sloppy's Vocabulary Stays Out of the Identity Store (required)

Sloppy is built on **syr** for identity and content, and syr deliberately has no
lexicon system and no extension point for third-party record types — its own comparison
doc names "third-party repo pollution: structurally prevented" as a feature. So the
split is not a preference we could revisit; it is the shape syr enforces:

| Concern                                         | Owner                                                    |
| ----------------------------------------------- | -------------------------------------------------------- |
| Identity, DID, keys, signing                    | **syr** — Sloppy holds a grant, and no key of the person |
| Profile data                                    | **syr** — resolved from the identity and cached          |
| Media blobs (block images, ink rasters)         | **syr** — presign → PUT → complete                       |
| Emoji, stickers, reactions, comments            | **syr** — per-DID catalogs, federated                    |
| **Graphs, nodes, addresses, tags, blocks, ink** | **Sloppy's own API + SurrealDB**                         |

- **`graph`, `node` and `block` are Sloppy's vocabulary.** Putting them in someone's
  identity store is precisely what syr is built to prevent. If a feature seems to need a
  new record type in syr, it needs a table in Sloppy instead.
- **Sloppy is a platform, and a platform holds no identity.** A person's root key lives on
  their own devices. The instance serving that identity holds an **agent** key under a
  **mandate**, a root-signed statement naming its **powers** and its expiry, and what
  Sloppy receives is one step further down: a **grant** that agent signs with its mandate
  carried inline. So Sloppy VERIFIES a chain — root → agent → Sloppy — instead of trusting
  whichever host served the token. syr's `architecture/mandates` and
  `architecture/authority-model` are the specification; syr has not landed it, and the
  delegation Sloppy receives today is root-signed. docs/ARCHITECTURE.md § "syr integration"
  carries what changes and what does not.
- **Sloppy never holds a private key.** Content is signed through `platform.sign`; the
  identity store holds the delegate key. Code that wants to sign locally has misread the
  delegation model. The exception is `@sloppy/idp`, which IS an identity store — it serves
  identities rather than consuming them, so it holds what a syr instance holds: today a
  root seed in an Aegis bundle and a root signature on each delegation
  (`packages/ts/idp/src/aegis.ts`, `packages/ts/idp/src/delegation.ts`), at the target an
  agent key under a mandate and no root at all. `@sloppy/local` holds one too, and for the
  same reason: a `device` identity is minted on the machine and its key written to the app's
  own private data (`makeLocalIdentity()` and `holdDeviceIdentity()` in
  `packages/ts/local/src/identity.ts`), because there is no instance behind it to ask. It
  also keeps a key it cannot use: an identity brought in **sealed** is kept exactly as it
  arrived, shut under a passphrase this device does not have, and the seed is opened only
  for an act that must sign with it — the passphrase asked at that moment, the seed wiped
  after. A sealed key is not a key this device can use, and it is no exemption: nothing
  else here keeps a private key at rest, sealed or otherwise. Those two are identity
  stores. Everything that CONSUMES an identity signs through the delegation.
- **Every remote asset goes through our proxy** (`proxied()`). Viewing a federated node
  must never leak the viewer's IP to the author's instance — a graph you can pull from
  strangers makes this more important, not less. A raw remote URL rendered into an
  `<img>` or a `fetch` is a privacy bug, not a shortcut.
- **Federation is pull-only, and no instance is a home.** syr has no relay and no
  firehose: follow somebody → find where their writing is served → fetch the kind you want
  from there. **No identifier names a place**, so **where somebody is, is their own
  declaration to make and to move** — said by a domain they control, so changing instance
  costs them one edit and breaks nobody's link. An instance named beside the identifier
  serves that same declaration for somebody no domain of theirs speaks for: a way in,
  explicitly the lesser of the two, and never a host to file somebody under. Anything
  designed around a push feed is designed against the platform, and anything that treats
  one host as the identity's home has assumed something the protocol never promises.

## Provider-Agnostic Data Shapes (required)

**Never hard-code a third-party integration's name into a data shape.** Types,
persisted rows, and API/DTO/client shapes must stay agnostic to which vendor (storage
backend, identity provider, OAuth provider, store platform, …) they carry, so a new
provider is a **new value, not a schema change**. The shape is the contract, and a
leaked brand name is debt every future provider pays.

- **Key a collection by a provider enum; never write one field per provider.** A single
  `provider` discriminant + a keyed map/list — `Partial<Record<Kind, T>>` or
  `Array<{ provider: Kind; … }>` — not `lastSyrSyncAt` / `minioBucket` / `hadS3`.
  Adding a provider should touch data, not the type.
- **Model the axis, not the brand.** A capability keys off what it IS — `local` vs
  `delegated` identity, `own` vs `pulled` provenance — not off the product that happens
  to provide it today. Don't conflate "which provider" with "which mode".
- **The same rule governs Sloppy's own open sets.** The kinds of ELEMENT a block's
  document holds — a paragraph, a list, a drawing, a picture — are an open set for
  exactly this reason: a new kind is a node the editor knows and a renderer, never a
  column. A field named `inkStrokes` hanging off every block would be the same mistake
  wearing our own brand.
- **No brand token in a hardcoded branch, wire enum value, or SurrealQL column.** Prefer
  a predicate or a set (`isDelegatedIdentity(kind)`) over
  `mode !== 'syr' && mode !== 'local'`; name events for the concept.
- **Where a brand name IS legitimate:** the provider enum itself; the adapter class /
  `*.provider.ts` internal payload types, which exist to speak one vendor's dialect; env
  var names; and the registry keyed by the enum. The brand lives at the edge, never in
  the shared shape it normalizes into. When in doubt, ask: "does adding a provider force
  a type change here?" If yes, it's pollution — key it by the enum instead.

## Comments & Self-Documenting Code (required)

**The code says what it does; a comment says only what the code cannot.** Names, types
and small functions carry the meaning. A comment that restates them is not free — it is
a second copy of the truth that no compiler checks, no test fails on, and no reviewer
diffs, so it rots into a confident lie while the code beside it stays right. Prose is
the most expensive thing you can put in a source file. Spend it only on what the reader
cannot recover from the code, and spend it in a line or two. The rule, concretely:

- **Never explain an abstraction you are only USING.** How `ResponsiveModal` picks its
  variant, what the layout worker does with a settled position, how `--sysnav-inset-bottom`
  is published — those are their own files' contracts, and a call site that restates one
  creates N copies that all go stale the day the contract moves. The reader who needs it
  can open the file; the reader who doesn't was never served by a paragraph. Name the
  module or say nothing.
- **A comment describes the code, never its history.** No "previously we renumbered on
  move", no "this used to be a hand-kept list". The diff and the commit message already
  own that story, and they stay true because nobody has to maintain them. A file that
  narrates its own past teaches the next reader a version of the code that no longer
  exists.
- **Never restate the next line.** `// set the node's title` above `node.title = x` is
  noise. If a line needs translating into English, the line is the problem.
- **Cut what made the comment necessary, not just the comment.** A paragraph explaining
  a dense expression is a request for a named intermediate; a banner splitting a file
  into `// ---- Helpers ----` is a request for a second file. Prefer the rename, the
  extraction, the type — those the compiler keeps honest.
- **A module header is a few lines: what this is, and the doc of record.**
  `docs/ARCHITECTURE.md`, `DESIGN.md`, `PRODUCT.md` and their siblings are where design
  reasoning belongs, and a link to one stays true because the doc is maintained. An
  algorithm narrated at the top of a file is a spec nobody updates — put it in `docs/`
  and point at it.
- **Exported API gets the same rule, not a JSDoc exemption.** A shared package's public
  symbols are still code, and `childAddress(parent)` needs no paragraph. But the bound
  is what a comment DOES, not how long it is. One that merely disambiguates a name gets
  one line — a unit, a coordinate space, an ordering guarantee, a range. One that states
  an invariant the caller must uphold, or what an ABSENT field means on the wire, earns
  the sentences it takes to say precisely, because a wire contract carries obligations no
  compiler checks and no test on this side of it can fail. What never stays is the
  ARGUMENT for the rule: that belongs in the doc of record, with the type pointing at it.
- **Where a comment IS the right answer:** a WHY the code cannot show. A platform bug
  and its workaround (Android's WebView reporting `env(safe-area-inset-bottom)` as 0;
  `WKWebView` driving one pointer type at a time); an invariant the caller must uphold
  (an address is immutable once published); a deliberate deviation that reads as a
  mistake; an issue link; a `@ts-expect-error` justification; a `TODO` with an owner; a
  license header; a generated-file marker. These are load-bearing — they are what stops a
  future change from reintroducing a real failure. Keep them, and keep them short.

When in doubt, ask: "if I delete this, what does a reader lose that they could not have
worked out?" If the answer is nothing, it was never documentation — it was narration.

## User-Facing Copy Names the Outcome, Never the Mechanism (required)

**A person reads Sloppy's words to learn what happened and what they can do next —
never to learn how Sloppy is built.** Where a blob is stored, that a link is presigned
and expires while the bytes behind it do not, which worker computes a layout, what a
delegation token is: those are our problems, and naming them in product copy hands the
reader a fact they cannot act on and did not ask for. It also ages badly — copy that
describes today's implementation is wrong the day the implementation changes, and
nothing fails when it does. This holds everywhere words reach a person: the app, emails
and notifications, empty states, and the message on a thrown error. The rule,
concretely:

- **The test is whether the reader could act differently.** "This branch is published"
  is the outcome; "the subtree endpoint is public and unauthenticated" is the mechanism.
  If knowing it changes nothing they would choose or do, it does not belong in front of
  them.
- **No infrastructure nouns.** No bucket, CDN, presigned URL, cache, queue, worker,
  webhook, retry, index, DID, record id, or sync interval. The user did not choose our
  storage and cannot fix our worker. Say what they have, or what they can do.
- **An error says what to do next, not what failed.** "Delegation expired", "signature
  rejected", a bare HTTP status, or an internal id tells somebody they have hit a wall
  without telling them where the door is. Where the server explains itself in words meant
  for humans, pass those through; otherwise say what to try.
- **Never surface an internal identifier**, a table name, or a wire enum value. **The
  Folgezettel address is the one exception, and it is not one of these** — it is a
  user-facing part of the product, the thing a person cites and a peer resolves, so show
  it plainly wherever it helps somebody navigate. A record id beside it is still noise.
- **First ask whether the thing can even happen.** A disclosure about something the
  product does not do is worse than silence: it puts a scary sentence in front of
  somebody who did nothing to earn it, and it teaches people to read past notices, so the
  one that matters gets skipped too.
- **Where a consequence really is the user's, say the consequence — never the
  machinery.** Some facts change what a reasonable person would do, and those stay: that
  publishing a subtree makes it readable by anyone who has the address; that a peer who
  has already pulled a node keeps their copy after you unpublish; what leaves the device
  in hosted, self-hosted and local modes. State the consequence and stop — the reason it
  is true is ours to know. **Privacy, legal and safety disclosure is never what this rule
  trims**, so when one is in question, check what the product actually does before
  cutting OR keeping: the answer decides which of these two bullets applies.

When in doubt, ask: "would this sentence still be true, and still worth saying, if we
rebuilt the whole thing behind it tomorrow?" If it would not survive the rewrite, it was
never about the user.

## Design & Product (required reading for any UI work)

The visual and product direction lives in [`DESIGN.md`](DESIGN.md) and
[`PRODUCT.md`](PRODUCT.md). Sloppy should feel like **ink on good paper** — quiet,
legible, unhurried, with the graph carrying all the colour there is. Follow them for any
UI change. In short:

- **shadcn-svelte is the component vocabulary.** Use it wherever a component fits; don't
  hand-roll what shadcn covers. Components live in `@sloppy/ui`; the design system
  (Tailwind v4 tokens, the axes below, the graph's colour language) is
  `@sloppy/ui`'s `app.css`, imported by the apps via `@sloppy/ui/styles`.
- **Six orthogonal axes on `<html>`:** `data-theme` (surfaces, or `scheme` with a
  collection's tokens painted inline), `data-accent` (`--primary`), `data-style` (how
  surfaces are drawn — edges and elevation, never colour), `data-app-font` (the face, for
  legibility, never colour), `data-density` (how close it is drawn) and `data-effect` (what
  the screen is like over it — a texture, never a colour or a shape). A style or an effect
  that names a colour is a bug; see DESIGN.md.
- **Mobile and tablet first.** Every surface is designed at phone width and then given
  room; at the dock width the same parts stand beside the graph instead of over it. An
  affordance only one of those arrangements has is a bug report against the phone layout.
- **`ResponsiveModal` is the only modal** — a drag-to-dismiss bottom sheet on phone, a
  centered dialog at ≥640px, from one bound `open`, with the branch latched for the
  component's life. Don't add a second modal component; extend this one.
- **Mobile bottom-edge chrome must clear the system nav bar.** Android's WebView reports
  `env(safe-area-inset-bottom)` as **0** for the 3-button nav bar, so the native shell
  publishes the real inset as `--safe-area-inset-bottom`. Pad bottom-pinned surfaces with
  `var(--safe-area-inset-bottom, env(safe-area-inset-bottom))`, never bare `env(...)`.
  Four vars carry this; "is the keyboard open" is answered by the `keyboard` store, never
  by a var. DESIGN.md § "The four inset vars" is the contract.
- **Pen draws, touch pans.** `WKWebView` drives one pointer type at a time, so the
  gesture split falls out of the platform: `pointerType === 'pen'` inks,
  `'touch'` pans and pinches. Never branch ink on a mode toggle the user has to find.
- Quiet, plain tone. No gamification, no streaks, no manufactured urgency — a thinking
  tool does not nag.

## Commits & AI Attribution (required)

**AI is never to be attributed in commits.** Do not add `Co-Authored-By` lines for any
AI tool, do not mention Claude/Codex/Gemini/Copilot in commit messages, and do not add
"Generated with AI" trailers. This overrides any default behavior an agent arrives with.

In today's sea of internet slop, nobody cares _which_ AI someone used — what matters is
_who_ is filtering that slop and whether they are doing it correctly. AI is a tool, not a
colleague you can point to and blame. The human author owns every commit and is
accountable for it. Write commit messages as the author, full stop.

## Match the Machinery to the Change (required, and read this first)

The loop below is expensive. It has repeatedly spent hours and several review rounds on changes
that warranted one pass, and the cost is not abstract: it is the developer waiting. **The default
is the SMALLEST process that would catch the class of defect this change can produce.** Scaling up
is a decision you justify, not the starting point.

**Size the wave before you spawn anything.** Three tiers, and most work is the first:

- **One pass, one reviewer.** A change inside one package that adds no shared vocabulary: a UI
  surface, a copy fix, a bug with a known cause, a refactor behind a stable signature. One
  implementer, ONE adversary, at most one fix round. No foundation wave, no tournament, no merge
  agent — the orchestrator merges it.
- **Two reviewers, up to two fix rounds.** Work that crosses packages, or changes a contract more
  than one surface reads.
- **The full loop below** — foundation wave, worktree tracks, two adversaries, merge tournament.
  Reserved for what can be wrong in ways a build cannot see: the address protocol, auth, anything
  a peer will hold, anything that decides what leaves the device. Not for features.

**A reviewer verifies; it does not re-derive.** The implementer already ran the suite, booted the
stack and measured. Re-running all of it is how a round costs twenty minutes and finds a comment.
Spot-check the claims that would change the verdict, exercise the thing a person would touch, and
trust a number until you have reason not to.

**Prose is never blocking after the first round.** A finding about wording, a comment, a doc
sentence or a name is advisory from round two onward, whatever its lens. It is real, and it is not
worth another round-trip; fold it into the next change that touches the file. **A round that
produces only prose findings ends the loop.**

**Rounds end on diminishing returns, not on the cap.** Three rounds is a ceiling, not a target. If
a round's findings are smaller than the round before it, stop — the next one will be smaller still.

**Batch a correction with the work it corrects.** A defect found in review of a change gets fixed
in that change, not in a follow-up wave with its own foundation and its own reviewers.

**The orchestrator does small, mechanical, unambiguous work itself.** Deleting code with no
successor, a one-line fix with a named cause, a formatting pass, a version bump: spawning an agent
to do it costs more than doing it, and adds a review round to something with nothing to review.

## Multi-System Prompts (parallel agents + adversarial review)

When the developer asks for changes to **different systems in the same prompt**, the
master agent parallelizes instead of working through them serially. This is the DEFAULT
for a compound prompt, not an optimization to reach for when a task looks big.

- **One agent per system, each in its own git worktree**, branched from the branch under
  work (not from `main` unless that is the branch under work), with non-overlapping file
  territories so the merge stays conflict-free. State each track's territory AND its
  **hard contracts** — the shared fields and exported signatures it may not change
  because a sibling track is reading them right now — in the prompt itself. A track that
  disagrees with a contract must stop and say so, not change it and hope.
- **Every track gets a one-paragraph statement of its intended effect on the product**,
  written before implementation starts. This is not decoration: the reviewers judge the
  work against it rather than against what they would have built, and the merge agent
  resolves conflicts with it. A track whose intended effect cannot be stated in a
  paragraph is not yet scoped.
- **Adversarial review in a loop, two adversaries per round, distinct lenses.** One
  reviews **technical** correctness — does it fix the verified failure, what regresses,
  are the new tests real, does the COMPOSITION work and not just the unit. The other
  reviews **vision** correctness — DESIGN.md, PRODUCT.md and the rules in this file,
  comment and copy truth, scope discipline. **The exit condition is zero findings from
  BOTH**; anything else is another round with every finding fed back to the implementing
  agent. That agent may reject a finding it believes is wrong, but must say so explicitly,
  so the rejection goes back to the reviewers instead of quietly disappearing.
- **A comment is not how a track answers a finding.** This loop has a failure mode that
  runs one way only: prose is the cheapest thing an implementer can add under review, so a
  round spent justifying the code in a new paragraph closes the finding and leaves the
  file worse. Excess narration is itself a **vision finding** (see "Comments &
  Self-Documenting Code") — a reviewer who accepts an essay as the answer to "why is this
  right?" is not holding the line, and an implementer answers by making the code obvious
  or by saying nothing.
- **Tell the reviewers that an empty findings array is the correct answer for work that
  is actually right.** Without that line they invent findings to look thorough, and every
  track burns its round cap on nits.
- **Cap the loop at three rounds** and surface anything still contested to the developer
  rather than looping forever. A contested track is held OUT of the merge tournament —
  nothing gets merged on a timer.
- **Restart the dev stack** so the developer can review the result running live, and
  report what changed per system. Readiness is `docker compose ps` reporting **healthy**
  for the backing services plus each host dev server's own ready line — never the exit
  code of the restart, which returns while the containers are still `starting`.

### Which model runs which role

**Opus is the default for every agent, and Fable has to earn its call.** A spawned agent
inherits the master agent's model unless it is told otherwise, so state the model explicitly
on every call — `model: 'opus'` on `Agent`, `opts.model` on a workflow `agent()`. Leaving it
off is how every role silently ends up on the most expensive one.

- **Opus — everything implementation-shaped.** The foundation wave, every track implementer,
  every merge agent, and **both adversaries in every review round**, technical and vision
  alike. Whether a build passes, whether a test is real, whether a surface matches
  `DESIGN.md`, whether the delivered feature list matches the spec: each is a check against a
  written standard, and checking is not creative. A merge agent is an implementer, not a
  reviewer: it resolves conflicts, runs the checks for every package either branch touched,
  and fixes what breaks on the winning branch.
- **Fable — as sparingly as possible, and only for what is genuinely creative.** Work whose
  answer is in no document and cannot be checked against one: a product or design call with no
  precedent in `DESIGN.md` or `PRODUCT.md`, the first shape of a new piece of shared
  vocabulary, a track split for work nobody has scoped yet, copy where the tone is the
  deliverable. It reaches a conclusion and hands off. It does not write the code, run the
  suite or review the result — once the shape is decided, everything after it is
  implementation, and implementation is Opus.
- **The test is whether an agent with the docs open could do it.** Applying a rule, comparing
  to a spec, verifying a claim: Opus. Deciding what the rule should be where there is none yet:
  that, and only that, is Fable's. The round-cap call — clean, contested, or going again — is
  the orchestrator's own and is never spawned.
- **A reviewer that wants a change still does not make it.** The finding goes back to the
  Opus agent that owns the branch, exactly as the loop above requires — splitting roles does
  not split the territories, and an adversary editing the tree it just reviewed removes the
  second pair of eyes the loop exists for.

### The merge tournament

Do not fan every branch into the working branch at the end. Merge them **against each
other, pairwise, as they finish**: the first two tracks to come back clean merge into
one branch, the winner re-enters the queue, and it repeats until a single branch remains.
That last branch is the one that merges into the working branch.

Two reasons this beats a fan-in:

- **Integration failures surface early, and in pairs.** A fan-in discovers every
  cross-track problem at once, at the end, with three authors' changes tangled together.
  A tournament finds each one inside a merge of exactly two known things.
- **It never waits on the slowest track.** Merging starts the moment any two are ready,
  so the tournament runs concurrently with the tracks still looping.

The merge agent is given **both branches' intended-effect paragraphs alongside the
code**, and that is the part that matters. A conflict between two tracks means someone
crossed a territory line; resolving it mechanically — taking one side, or keeping both
hunks — is how a merge silently reverts half of a fix. Resolve it by understanding what
each side was FOR.

And the standing instruction to every merge agent: **the two changes were verified in
isolation, so verify them together.** Ask specifically what the combination does that
neither did alone. A supply-side change and a consumer-side change can each be correct
and still compose into something broken — precisely the class of bug that the territory
split makes invisible to the per-track reviewers, because neither of them can see the
other half. Run the checks for every package either branch touched, against the merged
tree, and fix what breaks on the winning branch rather than reporting a green result
nobody observed.

### The foundation wave: shared files land BEFORE anyone forks

Some files are touched by every track — the `packages/ts/types/src/` barrel plus
whichever domain file beside it a new shape belongs in, the schema string in
`packages/ts/data/src/schema.ts`, the purge lists, `biome.json`'s package list, `docs/`.
If tracks fork before those settle, every branch edits the same lines and the merge is
exactly the conflict the territory split was meant to avoid.

So when work needs shared vocabulary, run a **foundation wave first**: one agent, no
parallelism, merged into the integration branch before any worktree is created.

**The foundation wave is explicitly authorized to create the shared material the tracks
will need, and is expected to** — not to defer it as somebody's later problem:

- **Types, enums and entity schemas**, keyed by an enum so a new variant is a value and
  not a schema change (see "Provider-Agnostic Data Shapes").
- **`DEFINE TABLE` / `DEFINE INDEX`** for every new entity, plus its rows in the deletion
  purge. Three rules go with this, all cheap now and expensive later:
  - **Production SurrealDB serves only `DEFINE`d tables; the dev stack does not enforce
    that.** An undeclared table passes locally and fails in production. The schema is also
    one contiguous string literal that several worktrees cannot append to independently.
  - **Every user-owned table needs a `created_by` column and must be purged by it.**
    Purging through a parent row leaks every orphan, permanently.
  - **SurrealDB will not use a composite index whose second column is a nested path**, so
    denormalize a top-level scalar beside the object — the way `node` stores `created_by`
    beside its composite id.
- **Request DTOs** (`Create*Request` / `Update*Request`) for every new entity. These are
  the shared contract between a form and the API, and they can only drift if each surface
  invents its own shape.
- **Docs**, including reconciling any document of record the new types contradict.
  Shipping a foundation whose docs disagree with its types hands every branch a false spec.

Rules that make a foundation wave safe:

- **Additive by default.** Existing rows must parse unchanged. Adding a `.default()` to a
  NEW field on an EXISTING entity makes it required on the inferred output type and breaks
  every construction site — use `.optional()` there and document what absent means.
  (`.default()` stays correct on new entities and new schemas.) And state the fallback: a
  field whose absent case the foundation leaves unstated gets its default decided by
  whichever track reads it first.
- **Beware refinements on entity schemas.** `.refine()`/`.check()` make `.omit()` and
  `.partial()` THROW at module evaluation, which takes the API down at import and is
  invisible to `tsc`. Prefer a discriminated union, or a free predicate the DTOs call.
- **It gets the same two-adversary review as any other track, and needs it most** — a
  defect here propagates into every branch that forks from it. **No worktree is created
  until both adversaries come back clean on it.**
- **Prove back-compat, never assert it.** If the work claims a new representation
  reproduces an existing one losslessly, it ships a test that enumerates the live branches
  it must reproduce — and the strong form (distinctness/injectivity) where the property
  allows, not hand-picked cases. An author is the last person able to audit their own
  losslessness claim; that is what the adversaries are for.
- **Do not silently drop a checklist item.** If implementation shows a specified field or
  approach is wrong, say so in the thread and get agreement; changing the contract inside
  a commit message is how a downstream track ends up implementing against a field that no
  longer exists.
- **State in the hand-off** anything that would break a branch already forked from an
  earlier revision of the foundation.

## MarkItDown Preprocessing (required)

Before reading or reasoning about any non-text source file (PDF, DOCX, PPTX, XLSX,
images, audio, HTML, CSV, JSON, XML, ZIP, EPUB, and other formats MarkItDown supports),
**always preprocess it through [MarkItDown](https://github.com/microsoft/markitdown)
first** and work from the resulting Markdown. Do not attempt to parse these binary or
rich formats directly.

```bash
markitdown path/to/source.pdf -o path/to/source.md
```

Save the generated Markdown alongside the source (same directory, same basename, `.md`
extension) so it can be reused and version-controlled.

MarkItDown is installed via pipx:

```bash
pipx install 'markitdown[all]'
```
